import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTenantContext } from '@app/database';
import type { ExternalProductSearchResult } from '@app/types';
import {
  BudgetExceededError,
  enforceBudget,
  searchProductByGTIN,
  searchProductByMPN,
  searchProductByTitle,
} from '@app/pim';
import { SimilarityMatchService } from '@app/pim';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { enqueueAIAuditJob, enqueueExtractionJob } from '../../queue/similarity-queues.js';
import { maybeEnqueueConsensusAfterAutomation } from '../../services/pim-pipeline-state.js';

export const SIMILARITY_SEARCH_QUEUE_NAME = 'pim-similarity-search';
export const SIMILARITY_SEARCH_JOB = 'search-external';

type SimilaritySearchJobPayload = Readonly<{
  shopId: string;
  productId: string; // Shopify product id
}>;

function isFinalJobAttempt(
  job: { attemptsMade?: number; opts?: { attempts?: number } } | null
): boolean {
  const configuredAttempts =
    typeof job?.opts?.attempts === 'number' && job.opts.attempts > 0 ? job.opts.attempts : 1;
  const currentAttempt = typeof job?.attemptsMade === 'number' ? job.attemptsMade + 1 : 1;
  return currentAttempt >= configuredAttempts;
}

export interface SimilaritySearchWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startSimilaritySearchWorker(logger: Logger): SimilaritySearchWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: SIMILARITY_SEARCH_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('similarity-search-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (job.name !== SIMILARITY_SEARCH_JOB) {
              throw new Error(`unknown_similarity_search_job:${job.name}`);
            }

            const payload = job.data as SimilaritySearchJobPayload | null;
            if (!payload?.shopId || !payload.productId) {
              throw new Error('invalid_similarity_search_payload');
            }

            try {
              const product = await withTenantContext(payload.shopId, async (client) => {
                const result = await client.query<{
                  product_id: string;
                  title: string;
                  brand: string | null;
                  gtin: string | null;
                  mpn: string | null;
                }>(
                  `SELECT pcm.product_id,
                          sp.title,
                          pm.brand,
                          pm.gtin,
                          pm.mpn
                     FROM prod_channel_mappings pcm
                     JOIN shopify_products sp
                       ON sp.shopify_gid = pcm.external_id
                      AND sp.shop_id = $1
                     JOIN prod_master pm
                       ON pm.id = pcm.product_id
                    WHERE pcm.channel = 'shopify'
                      AND pcm.shop_id = $1
                      AND sp.id = $2`,
                  [payload.shopId, payload.productId]
                );
                return result.rows[0] ?? null;
              });

              if (!product) {
                logger.warn(
                  { shopId: payload.shopId, productId: payload.productId },
                  'Product not found'
                );
                return;
              }

              const service = new SimilarityMatchService();
              let results: ExternalProductSearchResult[] = [];
              let matchMethod = 'title_fuzzy';
              try {
                await enforceBudget({ provider: 'serper', shopId: payload.shopId });
              } catch (error) {
                if (error instanceof BudgetExceededError) {
                  logger.warn(
                    { shopId: payload.shopId, error: error.message },
                    'Serper budget exceeded; skipping external similarity search'
                  );
                  await withTenantContext(payload.shopId, async (client) => {
                    await maybeEnqueueConsensusAfterAutomation({
                      client,
                      shopId: payload.shopId,
                      productId: product.product_id,
                      trigger: 'similarity_complete',
                      logger,
                      context: 'similarity_budget_exceeded',
                    });
                  });
                  return;
                }
                throw error;
              }
              if (product.gtin) {
                results = await searchProductByGTIN(
                  product.gtin,
                  product.product_id,
                  payload.shopId
                );
                matchMethod = 'gtin_exact';
              } else if (product.brand && product.mpn) {
                results = await searchProductByMPN(
                  product.brand,
                  product.mpn,
                  product.product_id,
                  payload.shopId
                );
                matchMethod = 'mpn_exact';
              } else {
                results = await searchProductByTitle(
                  product.title,
                  product.brand ?? undefined,
                  product.product_id,
                  payload.shopId
                );
                matchMethod = 'title_fuzzy';
              }

              const summary = await service.processSerperResults({
                product: {
                  id: product.product_id,
                  title: product.title,
                  brand: product.brand,
                  gtin: product.gtin,
                },
                results,
                matchMethod,
              });

              if (summary.sentToAIAudit > 0) {
                const pendingMatches = await withTenantContext(payload.shopId, async (client) => {
                  const result = await client.query<{ id: string }>(
                    `SELECT id
                       FROM prod_similarity_matches
                      WHERE product_id = $1
                        AND match_confidence = 'pending'
                        AND (match_details ->> 'triage_decision') = 'ai_audit'
                      ORDER BY created_at DESC
                      LIMIT 50`,
                    [product.product_id]
                  );
                  return result.rows;
                });

                await Promise.all(
                  pendingMatches.map(async (match) =>
                    enqueueAIAuditJob({ shopId: payload.shopId, matchId: match.id })
                  )
                );
              }

              if (summary.autoApproved > 0) {
                // Auto-approved matches are confirmed immediately; we must continue the pipeline by
                // sending them to extraction (otherwise consensus can never happen).
                const autoApprovedMatches = await withTenantContext(
                  payload.shopId,
                  async (client) => {
                    const result = await client.query<{ id: string }>(
                      `SELECT id
                       FROM prod_similarity_matches
                      WHERE product_id = $1
                        AND match_confidence = 'confirmed'
                        AND specs_extracted IS NULL
                        AND (match_details ->> 'auto_approved') = 'true'
                      ORDER BY created_at DESC
                      LIMIT 50`,
                      [product.product_id]
                    );
                    return result.rows;
                  }
                );

                await Promise.all(
                  autoApprovedMatches.map(async (match) =>
                    enqueueExtractionJob({ shopId: payload.shopId, matchId: match.id })
                  )
                );
              }

              if (summary.autoApproved === 0 && summary.sentToAIAudit === 0) {
                await withTenantContext(payload.shopId, async (client) => {
                  await maybeEnqueueConsensusAfterAutomation({
                    client,
                    shopId: payload.shopId,
                    productId: product.product_id,
                    trigger: 'similarity_complete',
                    logger,
                    context: 'search_and_match_no_automated_followup',
                  });
                });
              }

              logger.info(
                { shopId: payload.shopId, productId: payload.productId, summary },
                'Similarity search completed'
              );
            } catch (error) {
              if (isFinalJobAttempt(job)) {
                logger.error(
                  {
                    shopId: payload.shopId,
                    productId: payload.productId,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  'similarity_search_failed_final_attempt'
                );
                await withTenantContext(payload.shopId, async (client) => {
                  const result = await client.query<{ product_id: string }>(
                    `SELECT pcm.product_id
                       FROM prod_channel_mappings pcm
                       JOIN shopify_products sp
                         ON sp.shopify_gid = pcm.external_id
                        AND sp.shop_id = $1
                      WHERE pcm.channel = 'shopify'
                        AND pcm.shop_id = $1
                        AND sp.id = $2
                      LIMIT 1`,
                    [payload.shopId, payload.productId]
                  );
                  const mappedProductId = result.rows[0]?.product_id ?? null;
                  if (!mappedProductId) {
                    return;
                  }
                  await maybeEnqueueConsensusAfterAutomation({
                    client,
                    shopId: payload.shopId,
                    productId: mappedProductId,
                    trigger: 'similarity_complete',
                    logger,
                    context: 'similarity_search_failed_final_attempt',
                  });
                });
              }
              throw error;
            }
          } finally {
            clearWorkerCurrentJob('similarity-search-worker', jobId);
          }
        }),
    }
  );

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
