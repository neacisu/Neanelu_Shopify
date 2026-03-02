import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnv } from '@app/config';
import { pool, withTenantContext } from '@app/database';
import { OpenAiBatchManager } from '@app/ai-engine';
import type { Logger } from '@app/logger';
import { enqueueAiBatchPollerJob } from '@app/queue-manager';
import { BudgetExceededError, enforceBudget } from '@app/pim';

import { getShopOpenAiConfig } from '../../runtime/openai-config.js';
import { toPgVectorLiteral } from '../bulk-operations/pim/vector.js';
import { parseBatchOutputLines, parseBatchErrorLines } from './batch.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type TaxonomyRow = Readonly<{
  id: string;
  name: string;
  breadcrumbs: unknown;
}>;

export type TaxonomyBatchOrchestratorResult = Readonly<{
  alreadyRunning: boolean;
  embeddingBatchId: string | null;
  totalItems: number;
}>;

const TAXONOMY_BATCH_TYPE = 'taxonomy' as const;
const TAXONOMY_CUSTOM_ID_PREFIX = 'tax:';
const OPENAI_ENDPOINT_EMBEDDINGS = '/v1/embeddings';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function toBreadcrumbText(value: unknown): string {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(' ');
  }
  if (typeof value === 'string') return value;
  try {
    const asObj = value as { labels?: unknown };
    if (Array.isArray(asObj?.labels)) {
      return asObj.labels.map((item) => String(item)).join(' ');
    }
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function buildTaxonomyText(row: TaxonomyRow): string {
  const breadcrumbs = toBreadcrumbText(row.breadcrumbs);
  return `${row.name} ${breadcrumbs}`.trim();
}

function parseTaxonomyCustomId(customId: string): string | null {
  if (!customId.startsWith(TAXONOMY_CUSTOM_ID_PREFIX)) return null;
  return customId.slice(TAXONOMY_CUSTOM_ID_PREFIX.length) || null;
}

async function countActiveEmbeddingBatches(): Promise<number> {
  const res = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM embedding_batches
      WHERE status IN ('pending', 'submitted', 'processing')`
  );
  return Number(res.rows[0]?.count ?? 0);
}

// ──────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────────────────

export async function runTaxonomyBatchOrchestrator(params: {
  shopId: string;
  logger: Logger;
}): Promise<TaxonomyBatchOrchestratorResult> {
  const { shopId, logger } = params;
  const env = loadEnv();

  try {
    await enforceBudget({ provider: 'openai', shopId });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      logger.warn(
        { shopId, error: error.message },
        'OpenAI budget exceeded; skipping taxonomy batch orchestrator'
      );
      return { alreadyRunning: false, embeddingBatchId: null, totalItems: 0 };
    }
    throw error;
  }

  const openAiConfig = await getShopOpenAiConfig({ shopId, env, logger });
  if (!openAiConfig.enabled || !openAiConfig.openAiApiKey) {
    throw new Error('OpenAI is not configured for this shop');
  }

  const model = openAiConfig.openAiEmbeddingsModel;
  const dimensions = env.openAiEmbeddingDimensions ?? 2000;

  const existingBatch = await withTenantContext(shopId, async (client) => {
    const res = await client.query<{
      id: string;
      openaiBatchId: string;
    }>(
      `SELECT id,
              openai_batch_id AS "openaiBatchId"
         FROM embedding_batches
        WHERE shop_id = $1
          AND batch_type = $2
          AND status IN ('pending', 'submitted', 'processing')
          AND openai_batch_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [shopId, TAXONOMY_BATCH_TYPE]
    );
    return res.rows[0] ?? null;
  });

  if (existingBatch) {
    logger.info(
      { shopId, embeddingBatchId: existingBatch.id },
      'Existing taxonomy embedding batch in progress; skipping new batch creation'
    );
    return {
      alreadyRunning: true,
      embeddingBatchId: existingBatch.id,
      totalItems: 0,
    };
  }

  const activeBatches = await countActiveEmbeddingBatches();
  if (activeBatches >= env.openAiBatchMaxGlobal) {
    logger.info(
      { shopId, activeBatches, maxGlobal: env.openAiBatchMaxGlobal },
      'Max global batches reached; skipping taxonomy batch creation'
    );
    return { alreadyRunning: false, embeddingBatchId: null, totalItems: 0 };
  }

  const rows = await withTenantContext(shopId, async (client) => {
    const res = await client.query<TaxonomyRow>(
      `SELECT id, name, breadcrumbs
         FROM prod_taxonomy
        WHERE is_active = true
          AND embedding IS NULL
        ORDER BY id`,
      []
    );
    return res.rows;
  });

  if (rows.length === 0) {
    logger.info({ shopId }, 'All taxonomy entries already have embeddings');
    return { alreadyRunning: false, embeddingBatchId: null, totalItems: 0 };
  }

  const lines = rows.map((row) => {
    const text = buildTaxonomyText(row);
    return JSON.stringify({
      custom_id: `${TAXONOMY_CUSTOM_ID_PREFIX}${row.id}`,
      method: 'POST',
      url: OPENAI_ENDPOINT_EMBEDDINGS,
      body: {
        model,
        input: text,
        dimensions,
      },
    });
  });

  const dir = join(tmpdir(), 'neanelu-ai-batch');
  await mkdir(dir, { recursive: true });
  const fileName = `taxonomy-embeddings-${shopId}-${Date.now()}.jsonl`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');

  const batchManager = new OpenAiBatchManager({
    apiKey: openAiConfig.openAiApiKey,
    ...(openAiConfig.openAiBaseUrl ? { baseUrl: openAiConfig.openAiBaseUrl } : {}),
    timeoutMs: env.openAiTimeoutMs,
  });

  let embeddingBatchId: string;

  try {
    const uploaded = await batchManager.uploadJsonlFile({ filePath });
    const inputFileId = uploaded.id;

    const batch = await batchManager.createBatch({
      inputFileId,
      endpoint: OPENAI_ENDPOINT_EMBEDDINGS,
      completionWindow: '24h',
      metadata: {
        shop_id: shopId,
        batch_type: TAXONOMY_BATCH_TYPE,
      },
    });

    const expiresAt = batch.expires_at ? new Date(batch.expires_at * 1000) : null;

    embeddingBatchId = await withTenantContext(shopId, async (client) => {
      const insert = await client.query<{ id: string }>(
        `INSERT INTO embedding_batches (
           shop_id, batch_type, status,
           openai_batch_id, input_file_id,
           model, dimensions,
           total_items, completed_items, failed_items,
           submitted_at, expires_at,
           created_at, updated_at
         )
         VALUES ($1, $2, 'submitted', $3, $4, $5, $6, $7, 0, 0, now(), $8, now(), now())
         RETURNING id`,
        [
          shopId,
          TAXONOMY_BATCH_TYPE,
          batch.id,
          inputFileId,
          model,
          dimensions,
          rows.length,
          expiresAt ? expiresAt.toISOString() : null,
        ]
      );
      return insert.rows[0]?.id ?? '';
    });

    if (!embeddingBatchId) {
      throw new Error('taxonomy_embedding_batch_insert_failed');
    }

    await enqueueAiBatchPollerJob({
      shopId,
      embeddingBatchId,
      openAiBatchId: batch.id,
      requestedAt: Date.now(),
      triggeredBy: 'manual',
      pollAttempt: 0,
    });

    logger.info(
      {
        shopId,
        embeddingBatchId,
        openAiBatchId: batch.id,
        totalItems: rows.length,
      },
      'Taxonomy embeddings batch submitted to OpenAI Batch API'
    );
  } finally {
    await unlink(filePath).catch(() => undefined);
  }

  return {
    alreadyRunning: false,
    embeddingBatchId,
    totalItems: rows.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Result processor (called from runAiBatchPoller when batchType === 'taxonomy')
// ──────────────────────────────────────────────────────────────────────────────

export async function processTaxonomyBatchResults(params: {
  shopId: string;
  embeddingBatchId: string;
  openAiBatchId: string;
  batchManager: OpenAiBatchManager;
  outputFileId: string | null;
  errorFileId: string | null;
  expiresAt: Date | null;
  requestCounts: { total?: number; completed?: number; failed?: number } | null;
  logger: Logger;
}): Promise<void> {
  const {
    shopId,
    embeddingBatchId,
    batchManager,
    outputFileId,
    errorFileId,
    expiresAt,
    requestCounts,
    logger,
  } = params;

  const outputLines = outputFileId
    ? (await batchManager.downloadFile(outputFileId)).split('\n')
    : [];
  const errorLines = errorFileId ? (await batchManager.downloadFile(errorFileId)).split('\n') : [];

  const outputRecords = parseBatchOutputLines(outputLines);
  const errorRecords = parseBatchErrorLines(errorLines);

  let completedItems = 0;
  let failedItems = 0;
  let tokensUsed = 0;
  const processedCustomIds = new Set<string>();

  await withTenantContext(shopId, async (client) => {
    for (const record of outputRecords) {
      processedCustomIds.add(record.customId);
      const taxonomyId = parseTaxonomyCustomId(record.customId);
      if (!taxonomyId) {
        logger.warn(
          { customId: record.customId },
          'Skipping taxonomy batch record with invalid custom_id'
        );
        failedItems += 1;
        continue;
      }

      if (record.statusCode === 200 && record.embedding) {
        const vec = toPgVectorLiteral(record.embedding);
        await client.query(
          `UPDATE prod_taxonomy
              SET embedding = $1::vector(2000),
                  updated_at = now()
            WHERE id = $2`,
          [vec, taxonomyId]
        );
        completedItems += 1;
        tokensUsed += record.tokensUsed;
      } else {
        const errorMessage = record.errorMessage ?? 'openai_embedding_failed';
        logger.warn(
          { taxonomyId, statusCode: record.statusCode, errorMessage },
          'Taxonomy embedding failed for entry'
        );
        failedItems += 1;
      }
    }

    for (const rec of errorRecords) {
      if (processedCustomIds.has(rec.customId)) continue;
      const taxonomyId = parseTaxonomyCustomId(rec.customId);
      if (!taxonomyId) continue;
      logger.warn(
        { taxonomyId, errorMessage: rec.errorMessage },
        'Taxonomy embedding error record'
      );
      failedItems += 1;
    }

    const totalItems = requestCounts?.total ?? outputRecords.length;
    const completedTotal = Math.max(completedItems, requestCounts?.completed ?? 0);
    const failedTotal = Math.max(failedItems, requestCounts?.failed ?? 0);

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
        embeddingBatchId,
        shopId,
      ]
    );

    logger.info(
      {
        shopId,
        embeddingBatchId,
        completedItems: completedTotal,
        failedItems: failedTotal,
        totalItems,
        tokensUsed,
      },
      'Taxonomy embeddings batch results processed'
    );
  });
}
