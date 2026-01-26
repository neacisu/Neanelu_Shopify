import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import { OpenAiBatchManager, createEmbeddingsProvider } from '@app/ai-engine';
import type { Logger } from '@app/logger';
import { enqueueAiBatchBackfillJob, enqueueAiBatchPollerJob } from '@app/queue-manager';
import type { AiBatchBackfillJobPayload } from '@app/types';

import {
  buildBatchJsonlLines,
  computeEmbeddingCandidates,
  type CandidateSummary,
  type ExistingEmbeddingRow,
  type ShopifyEmbeddingSourceRow,
} from './batch.js';
import { moveToEmbeddingDlq } from './dlq.js';
import { checkBackfillThrottle } from './throttle.js';
import { getDailyEmbeddingBudget, trackEmbeddingCost } from './cost-tracking.js';

type BackfillRunRow = Readonly<{
  id: string;
  status: string;
  lastProductId: string | null;
}>;

function isWithinNightlyWindow(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
}

function msUntilNextNightlyWindow(date: Date): number {
  const next = new Date(date);
  if (date.getHours() >= 22) {
    next.setDate(date.getDate() + 1);
  }
  next.setHours(22, 0, 0, 0);
  return Math.max(1000, next.getTime() - date.getTime());
}

function msUntilNextDay(date: Date): number {
  const next = new Date(date);
  next.setDate(date.getDate() + 1);
  next.setHours(0, 5, 0, 0);
  return Math.max(1000, next.getTime() - date.getTime());
}

async function writeJsonlTempFile(lines: readonly string[]): Promise<string> {
  const dir = join(tmpdir(), 'neanelu-openai-batch');
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `embedding-backfill-${Date.now()}.jsonl`);
  await writeFile(filePath, lines.join('\n'));
  return filePath;
}

async function getOrCreateBackfillRun(params: { shopId: string }): Promise<BackfillRunRow> {
  return await withTenantContext(params.shopId, async (client) => {
    const existing = await client.query<BackfillRunRow>(
      `SELECT id,
              status,
              last_product_id as "lastProductId"
         FROM embedding_backfill_runs
        WHERE shop_id = $1
          AND status IN ('pending', 'running', 'paused')
        ORDER BY created_at DESC
        LIMIT 1`,
      [params.shopId]
    );
    const row = existing.rows[0];
    if (row) return row;

    const inserted = await client.query<BackfillRunRow>(
      `INSERT INTO embedding_backfill_runs (
         shop_id,
         status,
         started_at,
         created_at,
         updated_at
       )
       VALUES ($1, 'running', now(), now(), now())
       RETURNING id, status, last_product_id as "lastProductId"`,
      [params.shopId]
    );
    return inserted.rows[0]!;
  });
}

export async function runAiBatchBackfill(params: {
  payload: AiBatchBackfillJobPayload;
  logger: Logger;
}): Promise<void> {
  const { payload, logger } = params;
  const env = loadEnv();

  if (!env.openAiApiKey) {
    logger.warn({ shopId: payload.shopId }, 'OPENAI_API_KEY missing; skipping backfill');
    return;
  }

  if (!env.openAiEmbeddingBackfillEnabled) {
    logger.info({ shopId: payload.shopId }, 'Backfill disabled via kill switch');
    return;
  }

  const now = new Date();
  if (payload.nightlyWindowOnly && !isWithinNightlyWindow(now)) {
    const delayMs = msUntilNextNightlyWindow(now);
    await enqueueAiBatchBackfillJob(
      {
        ...payload,
        requestedAt: Date.now(),
      },
      { delayMs }
    );
    logger.info({ shopId: payload.shopId, delayMs }, 'Backfill outside nightly window; delaying');
    return;
  }

  const provider = createEmbeddingsProvider({
    ...(env.openAiApiKey ? { openAiApiKey: env.openAiApiKey } : {}),
    ...(env.openAiBaseUrl ? { openAiBaseUrl: env.openAiBaseUrl } : {}),
    ...(env.openAiEmbeddingsModel ? { openAiEmbeddingsModel: env.openAiEmbeddingsModel } : {}),
    openAiTimeoutMs: env.openAiTimeoutMs,
  });

  const chunkSize = payload.chunkSize ?? env.openAiBatchMaxItems;
  const budget = await getDailyEmbeddingBudget({
    shopId: payload.shopId,
    dailyLimit: env.openAiEmbeddingDailyBudget,
  });

  if (budget.remaining <= 0) {
    const delayMs = msUntilNextDay(now);
    logger.warn(
      { shopId: payload.shopId, used: budget.used, limit: budget.limit },
      'Daily embedding budget exhausted; delaying backfill'
    );
    await enqueueAiBatchBackfillJob(
      {
        ...payload,
        requestedAt: Date.now(),
      },
      { delayMs }
    );
    return;
  }

  const throttle = await checkBackfillThrottle({
    shopId: payload.shopId,
    requestedItems: Math.min(chunkSize, budget.remaining),
  });

  if (!throttle.allowed) {
    logger.warn(
      { shopId: payload.shopId, delayMs: throttle.delayMs, reason: throttle.reason },
      'Backfill throttled'
    );
    await enqueueAiBatchBackfillJob(
      {
        ...payload,
        requestedAt: Date.now(),
      },
      { delayMs: throttle.delayMs }
    );
    return;
  }

  const run = await getOrCreateBackfillRun({ shopId: payload.shopId });
  const offsetProductId = payload.offsetProductId ?? run.lastProductId;

  const selection: { products: ShopifyEmbeddingSourceRow[]; candidates: CandidateSummary } =
    await withTenantContext(
      payload.shopId,
      async (
        client
      ): Promise<{ products: ShopifyEmbeddingSourceRow[]; candidates: CandidateSummary }> => {
        const productsRes = await client.query<ShopifyEmbeddingSourceRow>(
          `SELECT id,
              title,
              description,
              description_html as "descriptionHtml",
              vendor,
              product_type as "productType",
              tags
         FROM shopify_products
        WHERE shop_id = $1
          AND id > COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')
          AND NOT EXISTS (
            SELECT 1
              FROM shop_product_embeddings spe
             WHERE spe.shop_id = shopify_products.shop_id
               AND spe.product_id = shopify_products.id
               AND spe.embedding_type = $3
               AND spe.model_version = $4
               AND spe.status = 'ready'
          )
        ORDER BY id ASC
        LIMIT $5`,
          [payload.shopId, offsetProductId, 'combined', provider.model.name, chunkSize]
        );

        const ids = productsRes.rows.map((row) => row.id);
        const embeddingsRes = ids.length
          ? await client.query<ExistingEmbeddingRow>(
              `SELECT product_id as "productId",
                  content_hash as "contentHash",
                  status,
                  retry_count as "retryCount",
                  error_message as "errorMessage"
             FROM shop_product_embeddings
            WHERE shop_id = $1
              AND model_version = $2
              AND embedding_type = $3
              AND product_id = ANY($4::uuid[])`,
              [payload.shopId, provider.model.name, 'combined', ids]
            )
          : { rows: [] as ExistingEmbeddingRow[] };

        const existingMap = new Map<string, ExistingEmbeddingRow>();
        for (const row of embeddingsRes.rows) {
          existingMap.set(row.productId, row);
        }

        return {
          products: productsRes.rows,
          candidates: computeEmbeddingCandidates({
            products: productsRes.rows,
            existing: existingMap,
            embeddingType: 'combined',
            maxRetries: env.openAiEmbeddingMaxRetries,
          }),
        };
      }
    );

  const dlqCandidates = selection.candidates.dlqCandidates;
  if (dlqCandidates.length > 0) {
    await moveToEmbeddingDlq({
      logger,
      entries: dlqCandidates.map((candidate) => ({
        shopId: payload.shopId,
        productId: candidate.productId,
        embeddingType: 'combined',
        errorMessage: candidate.errorMessage,
        retryCount: candidate.retryCount,
        lastAttemptAt: new Date().toISOString(),
      })),
    });
  }

  if (selection.products.length === 0) {
    await withTenantContext(payload.shopId, async (client) => {
      await client.query(
        `UPDATE embedding_backfill_runs
            SET status = 'completed',
                completed_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [run.id]
      );
    });
    logger.info({ shopId: payload.shopId }, 'Backfill completed (no more products)');
    return;
  }

  const lastProductId = selection.products.at(-1)?.id ?? offsetProductId ?? null;

  if (selection.candidates.candidates.length === 0) {
    await withTenantContext(payload.shopId, async (client) => {
      await client.query(
        `UPDATE embedding_backfill_runs
            SET status = 'running',
                last_product_id = $1,
                processed_products = processed_products + $2,
                updated_at = now()
          WHERE id = $3`,
        [lastProductId, selection.products.length, run.id]
      );
    });
    await enqueueAiBatchBackfillJob(
      lastProductId
        ? { ...payload, offsetProductId: lastProductId, requestedAt: Date.now() }
        : { ...payload, requestedAt: Date.now() }
    );
    return;
  }

  const candidates = selection.candidates.candidates.slice(
    0,
    Math.min(chunkSize, budget.remaining)
  );
  const lines = buildBatchJsonlLines({
    candidates,
    embeddingType: 'combined',
    model: provider.model.name,
    dimensions: provider.model.dimensions,
  });

  const filePath = await writeJsonlTempFile(lines);
  const batchManager = new OpenAiBatchManager({
    apiKey: env.openAiApiKey,
    ...(env.openAiBaseUrl ? { baseUrl: env.openAiBaseUrl } : {}),
    timeoutMs: env.openAiTimeoutMs,
  });

  let inputFileId = '';
  let batchId = '';
  try {
    const uploaded = await batchManager.uploadJsonlFile({ filePath });
    inputFileId = uploaded.id;
    const batch = await batchManager.createBatch({
      inputFileId,
      endpoint: '/v1/embeddings',
      completionWindow: '24h',
      metadata: { shopId: payload.shopId, batchType: 'combined' },
    });
    batchId = batch.id;
    const expiresAt = batch.expires_at ? new Date(batch.expires_at * 1000) : null;

    const embeddingBatchId = await withTenantContext(payload.shopId, async (client) => {
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
           submitted_at,
           expires_at,
           created_at,
           updated_at
         )
         VALUES ($1, $2, 'submitted', $3, $4, $5, $6, $7, now(), $8, now(), now())
         RETURNING id`,
        [
          payload.shopId,
          'combined',
          batchId,
          inputFileId,
          provider.model.name,
          provider.model.dimensions,
          candidates.length,
          expiresAt ? expiresAt.toISOString() : null,
        ]
      );
      return insert.rows[0]?.id ?? '';
    });

    if (!embeddingBatchId) {
      throw new Error('embedding_batch_insert_failed');
    }

    await enqueueAiBatchPollerJob({
      shopId: payload.shopId,
      embeddingBatchId,
      openAiBatchId: batchId,
      requestedAt: Date.now(),
      triggeredBy: payload.triggeredBy,
      pollAttempt: 0,
    });

    await withTenantContext(payload.shopId, async (client) => {
      await client.query(
        `UPDATE embedding_backfill_runs
          SET status = 'running',
              last_product_id = $1,
              processed_products = processed_products + $2,
              updated_at = now()
        WHERE id = $3`,
        [lastProductId, candidates.length, run.id]
      );
    });

    await trackEmbeddingCost({
      shopId: payload.shopId,
      tokensUsed: 0,
      itemCount: candidates.length,
      model: provider.model.name,
    });

    await enqueueAiBatchBackfillJob(
      lastProductId
        ? { ...payload, offsetProductId: lastProductId, requestedAt: Date.now() }
        : { ...payload, requestedAt: Date.now() }
    );

    logger.info(
      { shopId: payload.shopId, embeddingBatchId, candidates: candidates.length },
      'Backfill batch created'
    );
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}
