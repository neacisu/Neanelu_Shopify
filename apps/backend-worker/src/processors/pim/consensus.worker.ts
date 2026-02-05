import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTenantContext } from '@app/database';
import { computeConsensus, mergeWithExistingSpecs } from '@app/pim';
import {
  CONSENSUS_JOB_BATCH,
  CONSENSUS_JOB_RECOMPUTE,
  CONSENSUS_JOB_SINGLE,
  CONSENSUS_QUEUE_NAME,
} from '../../queue/consensus-queue.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';

type ConsensusJobPayload = Readonly<{
  shopId: string;
  productId: string;
  trigger: 'match_confirmed' | 'extraction_complete' | 'manual' | 'batch';
}>;

type ConsensusBatchPayload = Readonly<{
  shopId: string;
  productIds: string[];
}>;

type AttributeProvenance = Readonly<{
  attributeName: string;
  value: unknown;
  sourceId: string;
  sourceName: string;
  trustScore: number;
  similarityScore: number;
  matchId: string;
  weight: number;
  resolvedAt: string;
  alternates: unknown[];
  conflictDetected: boolean;
}>;

type ConsensuResult = Readonly<{
  consensusSpecs: Record<string, unknown>;
  provenance: Record<string, AttributeProvenance>;
  qualityScore: number;
  qualityBreakdown: Record<string, unknown>;
  sourceCount: number;
  conflicts: unknown[];
  needsReview: boolean;
  skippedDueToManualCorrection: string[];
}>;

type DbClient = Readonly<{
  query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
}>;

const computeConsensusSafe = computeConsensus as unknown as (params: {
  client: DbClient;
  productId: string;
}) => Promise<ConsensuResult>;
const mergeWithExistingSpecsSafe = mergeWithExistingSpecs as unknown as (params: {
  client: DbClient;
  productId: string;
  consensusSpecs: Record<string, unknown>;
  provenance: Record<string, AttributeProvenance>;
}) => Promise<{ merged: Record<string, unknown>; skipped: string[] }>;

export interface ConsensusWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startConsensusWorker(logger: Logger): ConsensusWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: CONSENSUS_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('consensus-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (job.name === CONSENSUS_JOB_SINGLE || job.name === CONSENSUS_JOB_RECOMPUTE) {
              const payload = job.data as ConsensusJobPayload | null;
              if (!payload?.shopId || !payload.productId) {
                throw new Error('invalid_consensus_payload');
              }
              await processSingleConsensus(payload, logger);
              return;
            }

            if (job.name === CONSENSUS_JOB_BATCH) {
              const payload = job.data as ConsensusBatchPayload | null;
              if (!payload?.shopId || !payload.productIds?.length) {
                throw new Error('invalid_consensus_batch_payload');
              }
              await processBatchConsensus(payload, logger);
              return;
            }

            throw new Error(`unknown_consensus_job:${job.name}`);
          } finally {
            clearWorkerCurrentJob('consensus-worker');
          }
        }),
    }
  );
  return { worker, close: () => worker.close() };
}

async function processSingleConsensus(payload: ConsensusJobPayload, logger: Logger): Promise<void> {
  await withTenantContext(payload.shopId, async (client) => {
    const result = await computeConsensusSafe({ client, productId: payload.productId });
    const merged = await mergeWithExistingSpecsSafe({
      client: client as DbClient,
      productId: payload.productId,
      consensusSpecs: result.consensusSpecs,
      provenance: result.provenance,
    });

    const needsReview = result.needsReview;
    const reviewReason = needsReview ? 'consensus_conflict' : null;

    await client.query(
      `UPDATE prod_master
       SET quality_score = $2,
           quality_score_breakdown = $3::jsonb,
           needs_review = (needs_review OR $4),
           updated_at = now()
       WHERE id = $1`,
      [payload.productId, result.qualityScore, JSON.stringify(result.qualityBreakdown), needsReview]
    );

    await upsertProdSpecsSnapshot({
      client,
      productId: payload.productId,
      specs: merged.merged,
      provenance: result.provenance,
      needsReview,
      reviewReason,
    });

    if (merged.skipped.length > 0) {
      logger.info(
        { productId: payload.productId, skipped: merged.skipped },
        'Skipped manual-correction fields during consensus merge'
      );
    }
  });
}

async function processBatchConsensus(
  payload: ConsensusBatchPayload,
  logger: Logger
): Promise<void> {
  for (const productId of payload.productIds) {
    await processSingleConsensus({ shopId: payload.shopId, productId, trigger: 'batch' }, logger);
  }
}

async function upsertProdSpecsSnapshot(params: {
  client: {
    query: (
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: { id?: string; version?: number }[] }>;
  };
  productId: string;
  specs: unknown;
  provenance: unknown;
  needsReview: boolean;
  reviewReason: string | null;
}): Promise<void> {
  const current = await params.client.query(
    `SELECT id, version
     FROM prod_specs_normalized
     WHERE product_id = $1
       AND is_current = true
     LIMIT 1`,
    [params.productId]
  );

  const currentId = current.rows[0]?.id ?? null;
  const currentVersion = Number(current.rows[0]?.version ?? 0);
  const nextVersion = currentVersion > 0 ? currentVersion + 1 : 1;

  if (currentId) {
    await params.client.query(
      `UPDATE prod_specs_normalized
       SET is_current = false, updated_at = now()
       WHERE id = $1`,
      [currentId]
    );
  }

  await params.client.query(
    `INSERT INTO prod_specs_normalized (
       product_id,
       specs,
       raw_specs,
       provenance,
       version,
       is_current,
       needs_review,
       review_reason,
       created_at,
       updated_at
     )
     VALUES ($1, $2::jsonb, NULL, $3::jsonb, $4, true, $5, $6, now(), now())`,
    [
      params.productId,
      JSON.stringify(params.specs ?? {}),
      JSON.stringify(params.provenance ?? {}),
      nextVersion,
      params.needsReview,
      params.reviewReason,
    ]
  );
}
