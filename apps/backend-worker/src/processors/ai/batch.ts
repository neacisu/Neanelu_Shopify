import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnv } from '@app/config';
import { pool, withTenantContext } from '@app/database';
import { OpenAiBatchManager, createEmbeddingsProvider, sha256Hex } from '@app/ai-engine';
import type { Logger } from '@app/logger';
import { enqueueAiBatchPollerJob } from '@app/queue-manager';
import type { AiBatchOrchestratorJobPayload, AiBatchPollerJobPayload } from '@app/types';

import { normalizeText, toPgVectorLiteral } from '../bulk-operations/pim/vector.js';

export type ShopifyEmbeddingSourceRow = Readonly<{
  id: string;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[] | null;
}>;

export type ExistingEmbeddingRow = Readonly<{
  productId: string;
  contentHash: string;
  status: string | null;
}>;

export type EmbeddingCandidate = Readonly<{
  productId: string;
  content: string;
  contentHash: string;
}>;

export type CandidateSummary = Readonly<{
  candidates: readonly EmbeddingCandidate[];
  unchanged: number;
  emptyContent: number;
  retryable: number;
}>;

export type BatchOutputRecord = Readonly<{
  customId: string;
  statusCode: number;
  embedding: number[] | null;
  tokensUsed: number;
  errorMessage: string | null;
}>;

export type BatchErrorRecord = Readonly<{
  customId: string;
  errorMessage: string;
}>;

export type CleanupCandidateRow = Readonly<{
  id: string;
  inputFileId: string | null;
  outputFileId: string | null;
  errorFileId: string | null;
  completedAtIso: string | null;
  submittedAtIso: string | null;
  createdAtIso: string | null;
}>;

type ParsedCustomId = Readonly<{
  productId: string;
  embeddingType: string;
  contentHash: string;
}>;

const CUSTOM_ID_SEPARATOR = '|';

const OPENAI_ENDPOINT_EMBEDDINGS = '/v1/embeddings';

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ');
}

function normalizeField(input: string | null | undefined): string {
  return normalizeText(input ?? '');
}

function normalizeTags(tags: readonly string[] | null | undefined): string {
  if (!tags || tags.length === 0) return '';
  return tags
    .map((t) => normalizeField(t))
    .filter(Boolean)
    .join(', ');
}

export function buildShopifyEmbeddingContent(params: {
  product: ShopifyEmbeddingSourceRow;
  embeddingType: string;
}): { content: string; contentHash: string } {
  const { product, embeddingType } = params;
  const title = normalizeField(product.title);
  const vendor = normalizeField(product.vendor);
  const productType = normalizeField(product.productType);

  const descriptionRaw = product.descriptionHtml?.trim()
    ? stripHtml(product.descriptionHtml)
    : (product.description ?? '');
  const description = normalizeField(descriptionRaw);
  const tags = normalizeTags(product.tags);

  const parts: string[] = [];
  if (embeddingType === 'title') {
    if (title) parts.push(`Titlu: ${title}`);
    if (vendor) parts.push(`Brand: ${vendor}`);
    if (productType) parts.push(`Tip: ${productType}`);
  } else if (embeddingType === 'description') {
    if (description) parts.push(`Descriere: ${description}`);
  } else {
    if (title) parts.push(`Titlu: ${title}`);
    if (vendor) parts.push(`Brand: ${vendor}`);
    if (productType) parts.push(`Tip: ${productType}`);
    if (tags) parts.push(`Tag-uri: ${tags}`);
    if (description) parts.push(`Descriere: ${description}`);
  }

  const content = parts.join('\n');
  const hashInput = parts.join(CUSTOM_ID_SEPARATOR);
  const contentHash = sha256Hex(hashInput);

  return { content, contentHash };
}

export function computeEmbeddingCandidates(params: {
  products: readonly ShopifyEmbeddingSourceRow[];
  existing: ReadonlyMap<string, ExistingEmbeddingRow>;
  embeddingType: string;
}): CandidateSummary {
  const candidates: EmbeddingCandidate[] = [];
  let unchanged = 0;
  let emptyContent = 0;
  let retryable = 0;

  for (const product of params.products) {
    const { content, contentHash } = buildShopifyEmbeddingContent({
      product,
      embeddingType: params.embeddingType,
    });
    if (!content) {
      emptyContent += 1;
      continue;
    }

    const existing = params.existing.get(product.id);
    if (existing?.status && existing.status !== 'ready') {
      retryable += 1;
      candidates.push({
        productId: product.id,
        content,
        contentHash,
      });
      continue;
    }

    if (existing?.contentHash === contentHash) {
      unchanged += 1;
      continue;
    }

    candidates.push({
      productId: product.id,
      content,
      contentHash,
    });
  }

  return { candidates, unchanged, emptyContent, retryable };
}

export function buildCustomId(params: ParsedCustomId): string {
  return [params.productId, params.embeddingType, params.contentHash].join(CUSTOM_ID_SEPARATOR);
}

export function parseCustomId(value: string): ParsedCustomId | null {
  const parts = value.split(CUSTOM_ID_SEPARATOR);
  if (parts.length !== 3) return null;
  const [productId, embeddingType, contentHash] = parts;
  if (!productId || !embeddingType || !contentHash) return null;
  return { productId, embeddingType, contentHash };
}

export function buildBatchJsonlLines(params: {
  candidates: readonly EmbeddingCandidate[];
  embeddingType: string;
  model: string;
  dimensions: number;
}): string[] {
  return params.candidates.map((candidate) =>
    JSON.stringify({
      custom_id: buildCustomId({
        productId: candidate.productId,
        embeddingType: params.embeddingType,
        contentHash: candidate.contentHash,
      }),
      method: 'POST',
      url: OPENAI_ENDPOINT_EMBEDDINGS,
      body: {
        model: params.model,
        input: candidate.content,
        dimensions: params.dimensions,
      },
    })
  );
}

export function parseBatchOutputLines(lines: readonly string[]): BatchOutputRecord[] {
  const output: BatchOutputRecord[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as {
        custom_id?: string;
        response?: {
          status_code?: number;
          body?: {
            data?: { embedding?: number[] }[];
            usage?: { total_tokens?: number };
          };
        };
        error?: { message?: string };
      };

      const customId = typeof parsed.custom_id === 'string' ? parsed.custom_id : '';
      const statusCode = Number(parsed.response?.status_code ?? 0);
      const firstEmbedding = parsed.response?.body?.data?.[0]?.embedding;
      const embedding = Array.isArray(firstEmbedding) ? firstEmbedding : null;
      const tokensUsed = Number(parsed.response?.body?.usage?.total_tokens ?? 0);
      const errorMessage = typeof parsed.error?.message === 'string' ? parsed.error?.message : null;

      output.push({
        customId,
        statusCode,
        embedding,
        tokensUsed: Number.isFinite(tokensUsed) ? tokensUsed : 0,
        errorMessage,
      });
    } catch {
      // Skip invalid lines (do not throw - partial output should still be processed).
    }
  }

  return output;
}

export function parseBatchErrorLines(lines: readonly string[]): BatchErrorRecord[] {
  const output: BatchErrorRecord[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as { custom_id?: string; error?: { message?: string } };
      const customId = typeof parsed.custom_id === 'string' ? parsed.custom_id : '';
      const errorMessage = typeof parsed.error?.message === 'string' ? parsed.error.message : '';
      if (!customId || !errorMessage) continue;
      output.push({ customId, errorMessage });
    } catch {
      // Skip invalid lines.
    }
  }
  return output;
}

export function filterCleanupCandidates(params: {
  rows: readonly CleanupCandidateRow[];
  retentionDays: number;
  nowMs?: number;
}): CleanupCandidateRow[] {
  const nowMs = params.nowMs ?? Date.now();
  const cutoff = nowMs - params.retentionDays * 86400 * 1000;

  return params.rows.filter((row) => {
    const timestampIso = row.completedAtIso ?? row.submittedAtIso ?? row.createdAtIso;
    if (!timestampIso) return false;
    const ts = new Date(timestampIso).getTime();
    if (!Number.isFinite(ts) || ts > cutoff) return false;
    return Boolean(row.inputFileId ?? row.outputFileId ?? row.errorFileId);
  });
}

function mapOpenAiStatus(
  status: string
): 'pending' | 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled' {
  const normalized = status.toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'validating' || normalized === 'in_progress' || normalized === 'finalizing') {
    return 'processing';
  }
  if (normalized === 'queued') return 'submitted';
  return 'pending';
}

async function writeJsonlTempFile(params: {
  lines: readonly string[];
  shopId: string;
  batchType: string;
}): Promise<string> {
  const dir = join(tmpdir(), 'neanelu-ai-batch');
  await mkdir(dir, { recursive: true });
  const fileName = `embeddings-${params.batchType}-${params.shopId}-${Date.now()}.jsonl`;
  const filePath = join(dir, fileName);
  const payload = `${params.lines.join('\n')}\n`;
  await writeFile(filePath, payload, 'utf8');
  return filePath;
}

export async function runAiBatchOrchestrator(params: {
  payload: AiBatchOrchestratorJobPayload;
  logger: Logger;
}): Promise<void> {
  const { payload, logger } = params;
  const env = loadEnv();

  if (!env.openAiApiKey) {
    logger.warn({ shopId: payload.shopId }, 'OPENAI_API_KEY missing; skipping batch orchestrator');
    return;
  }

  const provider = createEmbeddingsProvider({
    ...(env.openAiApiKey ? { openAiApiKey: env.openAiApiKey } : {}),
    ...(env.openAiBaseUrl ? { openAiBaseUrl: env.openAiBaseUrl } : {}),
    ...(env.openAiEmbeddingsModel ? { openAiEmbeddingsModel: env.openAiEmbeddingsModel } : {}),
    openAiTimeoutMs: env.openAiTimeoutMs,
  });

  const model = payload.model ?? provider.model.name;
  const dimensions = payload.dimensions ?? provider.model.dimensions;
  const maxItems = payload.maxItems ?? env.openAiBatchMaxItems;

  const existingBatch = await withTenantContext(payload.shopId, async (client) => {
    const res = await client.query<{
      id: string;
      openaiBatchId: string | null;
    }>(
      `SELECT id,
              openai_batch_id as "openaiBatchId"
         FROM embedding_batches
        WHERE shop_id = $1
          AND batch_type = $2
          AND model = $3
          AND status IN ('pending', 'submitted', 'processing')
        ORDER BY created_at DESC
        LIMIT 1`,
      [payload.shopId, payload.batchType, model]
    );
    return res.rows[0] ?? null;
  });

  if (existingBatch?.openaiBatchId) {
    logger.info(
      { shopId: payload.shopId, embeddingBatchId: existingBatch.id },
      'Existing embedding batch in progress; skipping new batch creation'
    );
    await enqueueAiBatchPollerJob({
      shopId: payload.shopId,
      embeddingBatchId: existingBatch.id,
      openAiBatchId: existingBatch.openaiBatchId,
      requestedAt: Date.now(),
      triggeredBy: payload.triggeredBy,
      pollAttempt: 0,
    });
    return;
  }

  const selection = await withTenantContext(payload.shopId, async (client) => {
    const productsRes = await client.query<ShopifyEmbeddingSourceRow>(
      `SELECT id,
              title,
              description,
              description_html as "descriptionHtml",
              vendor,
              product_type as "productType",
              tags
         FROM shopify_products
        WHERE shop_id = $1`,
      [payload.shopId]
    );

    const embeddingsRes = await client.query<ExistingEmbeddingRow>(
      `SELECT product_id as "productId",
              content_hash as "contentHash",
              status
         FROM shop_product_embeddings
        WHERE shop_id = $1
          AND model_version = $2
          AND embedding_type = $3`,
      [payload.shopId, model, payload.embeddingType]
    );

    const existingMap = new Map<string, ExistingEmbeddingRow>();
    for (const row of embeddingsRes.rows) {
      existingMap.set(row.productId, row);
    }

    return computeEmbeddingCandidates({
      products: productsRes.rows,
      existing: existingMap,
      embeddingType: payload.embeddingType,
    });
  });

  if (selection.candidates.length === 0) {
    logger.info(
      {
        shopId: payload.shopId,
        unchanged: selection.unchanged,
        emptyContent: selection.emptyContent,
        retryable: selection.retryable,
      },
      'No pending embeddings detected'
    );
    return;
  }

  const candidates = selection.candidates.slice(0, maxItems);
  const lines = buildBatchJsonlLines({
    candidates,
    embeddingType: payload.embeddingType,
    model,
    dimensions,
  });

  const filePath = await writeJsonlTempFile({
    lines,
    shopId: payload.shopId,
    batchType: payload.batchType,
  });

  const batchManager = new OpenAiBatchManager({
    apiKey: env.openAiApiKey,
    ...(env.openAiBaseUrl ? { baseUrl: env.openAiBaseUrl } : {}),
    timeoutMs: env.openAiTimeoutMs,
  });

  let inputFileId = '';
  let batchId = '';
  let embeddingBatchId = '';
  let expiresAt: Date | null = null;

  try {
    const uploaded = await batchManager.uploadJsonlFile({ filePath });
    inputFileId = uploaded.id;

    const batch = await batchManager.createBatch({
      inputFileId,
      endpoint: OPENAI_ENDPOINT_EMBEDDINGS,
      completionWindow: '24h',
      metadata: {
        shop_id: payload.shopId,
        batch_type: payload.batchType,
      },
    });
    batchId = batch.id;
    expiresAt = batch.expires_at ? new Date(batch.expires_at * 1000) : null;

    embeddingBatchId = await withTenantContext(payload.shopId, async (client) => {
      const insert = await client.query<{ id: string }>(
        `INSERT INTO embedding_batches (
           shop_id,
           batch_type,
           status,
           openai_batch_id,
           input_file_id,
           model,
           dimensions,
           total_items,
           completed_items,
           failed_items,
           submitted_at,
           expires_at,
           created_at,
           updated_at
         )
         VALUES ($1, $2, 'submitted', $3, $4, $5, $6, $7, 0, 0, now(), $8, now(), now())
         RETURNING id`,
        [
          payload.shopId,
          payload.batchType,
          batchId,
          inputFileId,
          model,
          dimensions,
          candidates.length,
          expiresAt ? expiresAt.toISOString() : null,
        ]
      );
      return insert.rows[0]?.id ?? '';
    });
  } finally {
    await unlink(filePath).catch(() => undefined);
  }

  if (!embeddingBatchId) {
    throw new Error('embedding_batch_insert_failed');
  }

  logger.info(
    {
      shopId: payload.shopId,
      embeddingBatchId,
      openAiBatchId: batchId,
      totalItems: candidates.length,
    },
    'OpenAI batch created for embeddings'
  );

  await enqueueAiBatchPollerJob({
    shopId: payload.shopId,
    embeddingBatchId,
    openAiBatchId: batchId,
    requestedAt: Date.now(),
    triggeredBy: payload.triggeredBy,
    pollAttempt: 0,
  });
}

export async function runAiBatchPoller(params: {
  payload: AiBatchPollerJobPayload;
  logger: Logger;
}): Promise<void> {
  const { payload, logger } = params;
  const env = loadEnv();

  if (!env.openAiApiKey) {
    logger.warn({ shopId: payload.shopId }, 'OPENAI_API_KEY missing; skipping batch poller');
    return;
  }

  const batchManager = new OpenAiBatchManager({
    apiKey: env.openAiApiKey,
    ...(env.openAiBaseUrl ? { baseUrl: env.openAiBaseUrl } : {}),
    timeoutMs: env.openAiTimeoutMs,
  });

  const batch = await batchManager.getBatch(payload.openAiBatchId);
  const mappedStatus = mapOpenAiStatus(batch.status);

  const batchMetadata = await withTenantContext(payload.shopId, async (client) => {
    const res = await client.query<{
      id: string;
      model: string;
      dimensions: number;
      batchType: string;
    }>(
      `SELECT id,
              model,
              dimensions,
              batch_type as "batchType"
         FROM embedding_batches
        WHERE id = $1
          AND shop_id = $2
        LIMIT 1`,
      [payload.embeddingBatchId, payload.shopId]
    );
    return res.rows[0] ?? null;
  });

  if (!batchMetadata) {
    logger.warn(
      { shopId: payload.shopId, embeddingBatchId: payload.embeddingBatchId },
      'Embedding batch missing; skipping poller'
    );
    return;
  }

  const outputFileId = batch.output_file_id ?? null;
  const errorFileId = batch.error_file_id ?? null;
  const expiresAt = batch.expires_at ? new Date(batch.expires_at * 1000) : null;

  if (mappedStatus === 'submitted' || mappedStatus === 'processing' || mappedStatus === 'pending') {
    await withTenantContext(payload.shopId, async (client) => {
      await client.query(
        `UPDATE embedding_batches
            SET status = $1,
                output_file_id = COALESCE($2, output_file_id),
                error_file_id = COALESCE($3, error_file_id),
                expires_at = COALESCE($4, expires_at),
                updated_at = now()
          WHERE id = $5
            AND shop_id = $6`,
        [
          mappedStatus,
          outputFileId,
          errorFileId,
          expiresAt ? expiresAt.toISOString() : null,
          payload.embeddingBatchId,
          payload.shopId,
        ]
      );
    });

    const delayMs = Math.max(1_000, env.openAiBatchPollSeconds * 1000);
    await enqueueAiBatchPollerJob(
      {
        ...payload,
        pollAttempt: (payload.pollAttempt ?? 0) + 1,
        requestedAt: Date.now(),
      },
      { delayMs }
    );
    return;
  }

  if (mappedStatus === 'failed' || mappedStatus === 'cancelled') {
    await withTenantContext(payload.shopId, async (client) => {
      await client.query(
        `UPDATE embedding_batches
            SET status = $1,
                output_file_id = COALESCE($2, output_file_id),
                error_file_id = COALESCE($3, error_file_id),
                expires_at = COALESCE($4, expires_at),
                completed_at = now(),
                updated_at = now(),
                error_message = $5
          WHERE id = $6
            AND shop_id = $7`,
        [
          mappedStatus,
          outputFileId,
          errorFileId,
          expiresAt ? expiresAt.toISOString() : null,
          `openai_batch_${mappedStatus}`,
          payload.embeddingBatchId,
          payload.shopId,
        ]
      );
    });
    return;
  }

  const outputLines = outputFileId
    ? (await batchManager.downloadFile(outputFileId)).split('\n')
    : [];
  const errorLines = errorFileId ? (await batchManager.downloadFile(errorFileId)).split('\n') : [];

  const outputRecords = parseBatchOutputLines(outputLines);
  const errorRecords = parseBatchErrorLines(errorLines);

  const errorByCustomId = new Map<string, string>();
  for (const rec of errorRecords) {
    errorByCustomId.set(rec.customId, rec.errorMessage);
  }

  let completedItems = 0;
  let failedItems = 0;
  let tokensUsed = 0;
  const processedCustomIds = new Set<string>();

  await withTenantContext(payload.shopId, async (client) => {
    for (const record of outputRecords) {
      const parsedCustom = parseCustomId(record.customId);
      if (!parsedCustom) continue;
      processedCustomIds.add(record.customId);

      if (record.statusCode === 200 && record.embedding) {
        if (record.embedding.length !== batchMetadata.dimensions) {
          const errorMessage = `embedding_dimension_mismatch:${record.embedding.length}`;
          await client.query(
            `UPDATE shop_product_embeddings
                SET status = 'failed',
                    error_message = $1,
                    updated_at = now()
              WHERE shop_id = $2
                AND product_id = $3
                AND embedding_type = $4
                AND model_version = $5`,
            [
              errorMessage,
              payload.shopId,
              parsedCustom.productId,
              parsedCustom.embeddingType,
              batchMetadata.model,
            ]
          );
          failedItems += 1;
          continue;
        }

        const vec = toPgVectorLiteral(record.embedding);
        await client.query(
          `INSERT INTO shop_product_embeddings (
             shop_id,
             product_id,
             embedding_type,
             embedding,
             content_hash,
             model_version,
             dimensions,
             quality_level,
             source,
             lang,
             status,
             error_message,
             generated_at,
             created_at,
             updated_at
           )
           VALUES ($1, $2, $3, $4::vector(2000), $5, $6, $7, 'bronze', 'shopify', 'ro', 'ready', NULL, now(), now(), now())
           ON CONFLICT (shop_id, product_id, embedding_type, model_version)
           DO UPDATE SET
             embedding = EXCLUDED.embedding,
             content_hash = EXCLUDED.content_hash,
             dimensions = EXCLUDED.dimensions,
             quality_level = EXCLUDED.quality_level,
             source = EXCLUDED.source,
             lang = EXCLUDED.lang,
             status = 'ready',
             error_message = NULL,
             generated_at = now(),
             updated_at = now()`,
          [
            payload.shopId,
            parsedCustom.productId,
            parsedCustom.embeddingType,
            vec,
            parsedCustom.contentHash,
            batchMetadata.model,
            batchMetadata.dimensions,
          ]
        );
        completedItems += 1;
        tokensUsed += record.tokensUsed;
      } else {
        const errorMessage =
          record.errorMessage ?? errorByCustomId.get(record.customId) ?? 'openai_embedding_failed';
        await client.query(
          `UPDATE shop_product_embeddings
              SET status = 'failed',
                  error_message = $1,
                  updated_at = now()
            WHERE shop_id = $2
              AND product_id = $3
              AND embedding_type = $4
              AND model_version = $5`,
          [
            errorMessage,
            payload.shopId,
            parsedCustom.productId,
            parsedCustom.embeddingType,
            batchMetadata.model,
          ]
        );
        failedItems += 1;
      }
    }

    for (const rec of errorRecords) {
      if (processedCustomIds.has(rec.customId)) continue;
      const parsedCustom = parseCustomId(rec.customId);
      if (!parsedCustom) continue;
      await client.query(
        `UPDATE shop_product_embeddings
            SET status = 'failed',
                error_message = $1,
                updated_at = now()
          WHERE shop_id = $2
            AND product_id = $3
            AND embedding_type = $4
            AND model_version = $5`,
        [
          rec.errorMessage,
          payload.shopId,
          parsedCustom.productId,
          parsedCustom.embeddingType,
          batchMetadata.model,
        ]
      );
      failedItems += 1;
    }
  });

  const totalItems = batch.request_counts?.total ?? outputRecords.length;
  const failedTotal = Math.max(failedItems, batch.request_counts?.failed ?? 0);
  const completedTotal = Math.max(completedItems, batch.request_counts?.completed ?? 0);

  await withTenantContext(payload.shopId, async (client) => {
    await client.query(
      `UPDATE embedding_batches
          SET status = 'completed',
              output_file_id = COALESCE($1, output_file_id),
              error_file_id = COALESCE($2, error_file_id),
              completed_items = $3,
              failed_items = $4,
              total_items = $5,
              tokens_used = $6,
              completed_at = now(),
              expires_at = COALESCE($7, expires_at),
              updated_at = now()
        WHERE id = $8
          AND shop_id = $9`,
      [
        outputFileId,
        errorFileId,
        completedTotal,
        failedTotal,
        totalItems,
        tokensUsed,
        expiresAt ? expiresAt.toISOString() : null,
        payload.embeddingBatchId,
        payload.shopId,
      ]
    );
  });

  logger.info(
    {
      shopId: payload.shopId,
      embeddingBatchId: payload.embeddingBatchId,
      completedItems: completedTotal,
      failedItems: failedTotal,
    },
    'OpenAI batch embeddings processed'
  );
}

export async function runAiBatchCleanup(params: {
  shopId: string;
  retentionDays: number;
  logger: Logger;
}): Promise<void> {
  const { shopId, retentionDays, logger } = params;
  const env = loadEnv();

  if (!env.openAiApiKey) {
    logger.warn({ shopId }, 'OPENAI_API_KEY missing; skipping batch cleanup');
    return;
  }

  const batchManager = new OpenAiBatchManager({
    apiKey: env.openAiApiKey,
    ...(env.openAiBaseUrl ? { baseUrl: env.openAiBaseUrl } : {}),
    timeoutMs: env.openAiTimeoutMs,
  });

  const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000);

  const rows = await withTenantContext(shopId, async (client) => {
    const res = await client.query<{
      id: string;
      inputFileId: string | null;
      outputFileId: string | null;
      errorFileId: string | null;
      completedAtIso: string | null;
      submittedAtIso: string | null;
      createdAtIso: string | null;
    }>(
      `SELECT id,
              input_file_id as "inputFileId",
              output_file_id as "outputFileId",
              error_file_id as "errorFileId",
              completed_at as "completedAtIso",
              submitted_at as "submittedAtIso",
              created_at as "createdAtIso"
         FROM embedding_batches
        WHERE shop_id = $1
          AND status IN ('completed', 'failed', 'cancelled')
          AND COALESCE(completed_at, submitted_at, created_at) < $2
          AND (
            input_file_id IS NOT NULL OR
            output_file_id IS NOT NULL OR
            error_file_id IS NOT NULL
          )
        ORDER BY COALESCE(completed_at, submitted_at, created_at) ASC
        LIMIT 100`,
      [shopId, cutoff.toISOString()]
    );
    return res.rows;
  });

  const candidates = filterCleanupCandidates({
    rows,
    retentionDays,
  });

  for (const row of candidates) {
    const fileIds = [row.inputFileId, row.outputFileId, row.errorFileId].filter(
      (id): id is string => Boolean(id)
    );

    for (const fileId of fileIds) {
      await batchManager.deleteFile(fileId).catch((err) => {
        logger.warn({ shopId, embeddingBatchId: row.id, err }, 'Failed to delete OpenAI file');
      });
    }

    await withTenantContext(shopId, async (client) => {
      await client.query(
        `UPDATE embedding_batches
            SET input_file_id = NULL,
                output_file_id = NULL,
                error_file_id = NULL,
                updated_at = now()
          WHERE id = $1
            AND shop_id = $2`,
        [row.id, shopId]
      );
    });
  }
}

export async function listShops(): Promise<readonly string[]> {
  const res = await pool.query<{ id: string }>(`SELECT id FROM shops`);
  return res.rows.map((row) => row.id);
}

export async function loadEmbeddingBatchIds(params: {
  shopId: string;
}): Promise<readonly { id: string; openAiBatchId: string }[]> {
  return await withTenantContext(params.shopId, async (client) => {
    const res = await client.query<{ id: string; openAiBatchId: string }>(
      `SELECT id,
              openai_batch_id as "openAiBatchId"
         FROM embedding_batches
        WHERE shop_id = $1
          AND status IN ('submitted', 'processing')
          AND openai_batch_id IS NOT NULL`,
      [params.shopId]
    );
    return res.rows;
  });
}
