/**
 * Bulk Operations Job Contracts
 *
 * CONFORM: Plan_de_implementare F5.1 (Bulk Operations Orchestrator)
 *
 * Note: bulk_runs.status is enforced in DB as lowercase values:
 * pending|running|completed|failed|cancelled
 */

export const BULK_OPERATION_TYPES = [
  'PRODUCTS_EXPORT',
  'PRODUCTS_IMPORT',
  'ORDERS_EXPORT',
  'CUSTOMERS_EXPORT',
  'INVENTORY_EXPORT',
  'COLLECTIONS_EXPORT',
] as const;

export type BulkOperationType = (typeof BULK_OPERATION_TYPES)[number];

export type BulkRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type BulkJobTriggeredBy = 'manual' | 'scheduler' | 'webhook' | 'system';

export interface BulkOrchestratorJobPayloadQuery {
  shopId: string;
  operationType: BulkOperationType;
  /** Optional category for observability/debugging (e.g. 'core', 'inventory'). */
  queryType?: string;
  /** Optional version tag for a versioned query contract (e.g. 'v1'). */
  queryVersion?: string;
  /** GraphQL query to run via bulkOperationRunQuery. */
  graphqlQuery: string;
  /** Optional idempotency key. If omitted, orchestrator will derive one from inputs. */
  idempotencyKey?: string;
  triggeredBy: BulkJobTriggeredBy;
  requestedAt: number;
}

export interface BulkOrchestratorJobPayloadMutation {
  shopId: string;
  operationType: BulkOperationType;
  /** Logical mutation contract name (e.g. 'metafieldsSet'). */
  mutationType: string;
  /** Optional version tag for a versioned mutation contract (e.g. 'v1'). */
  mutationVersion?: string;
  /** GraphQL mutation template to run via bulkOperationRunMutation. */
  graphqlMutation: string;
  /** Local filesystem path to a JSONL variables file (one line per mutation). */
  inputPath: string;
  /** Optional chunk metadata for observability/debugging. */
  chunkIndex?: number;
  chunkCount?: number;
  /** Optional precomputed checksum/bytes/rows for the chunk file. */
  inputChecksum?: string;
  inputBytes?: number;
  inputRows?: number;
  /** Optional logical retry attempt for selective requeue (0 = first attempt). */
  retryAttempt?: number;
  /** Optional idempotency key. If omitted, orchestrator will derive one from inputs. */
  idempotencyKey?: string;
  triggeredBy: BulkJobTriggeredBy;
  requestedAt: number;
}

export type BulkOrchestratorJobPayload =
  | BulkOrchestratorJobPayloadQuery
  | BulkOrchestratorJobPayloadMutation;

export interface BulkPollerJobPayload {
  shopId: string;
  bulkRunId: string;
  shopifyOperationId: string;
  triggeredBy: BulkJobTriggeredBy;
  requestedAt: number;
  /** Optional internal counter for exponential backoff; maintained by poller worker. */
  pollAttempt?: number;
}

export interface BulkMutationReconcileJobPayload {
  shopId: string;
  bulkRunId: string;
  /** URL to the Shopify bulk result JSONL (or partialDataUrl when salvaged). */
  resultUrl: string;
  triggeredBy: BulkJobTriggeredBy;
  requestedAt: number;
}

// ============================================
// PR-042: Bulk Ingest (COPY+merge) Job
// ============================================

export interface BulkIngestJobPayload {
  shopId: string;
  bulkRunId: string;
  /** URL to the Shopify bulk result JSONL (or partialDataUrl when salvaged). */
  resultUrl: string;
  triggeredBy: BulkJobTriggeredBy;
  requestedAt: number;
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function validateBulkOrchestratorJobPayload(
  data: unknown
): data is BulkOrchestratorJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<BulkOrchestratorJobPayloadQuery & BulkOrchestratorJobPayloadMutation>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.operationType !== 'string') return false;
  if (!(BULK_OPERATION_TYPES as readonly string[]).includes(job.operationType)) return false;

  const isMutation =
    typeof job.mutationType === 'string' || typeof job.graphqlMutation === 'string';
  if (isMutation) {
    if (typeof job.mutationType !== 'string' || !job.mutationType.trim()) return false;
    if (job.mutationVersion !== undefined && typeof job.mutationVersion !== 'string') return false;
    if (typeof job.graphqlMutation !== 'string' || !job.graphqlMutation.trim()) return false;
    if (typeof job.inputPath !== 'string' || !job.inputPath.trim()) return false;
    if (job.chunkIndex !== undefined) {
      if (typeof job.chunkIndex !== 'number' || !Number.isFinite(job.chunkIndex)) return false;
      if (!Number.isInteger(job.chunkIndex) || job.chunkIndex < 0) return false;
    }
    if (job.chunkCount !== undefined) {
      if (typeof job.chunkCount !== 'number' || !Number.isFinite(job.chunkCount)) return false;
      if (!Number.isInteger(job.chunkCount) || job.chunkCount <= 0) return false;
    }
    if (job.inputChecksum !== undefined && typeof job.inputChecksum !== 'string') return false;
    if (job.inputBytes !== undefined) {
      if (typeof job.inputBytes !== 'number' || !Number.isFinite(job.inputBytes)) return false;
      if (!Number.isInteger(job.inputBytes) || job.inputBytes < 0) return false;
    }
    if (job.inputRows !== undefined) {
      if (typeof job.inputRows !== 'number' || !Number.isFinite(job.inputRows)) return false;
      if (!Number.isInteger(job.inputRows) || job.inputRows < 0) return false;
    }
    if (job.retryAttempt !== undefined) {
      if (typeof job.retryAttempt !== 'number' || !Number.isFinite(job.retryAttempt)) return false;
      if (!Number.isInteger(job.retryAttempt) || job.retryAttempt < 0) return false;
    }
  } else {
    if (job.queryType !== undefined && typeof job.queryType !== 'string') return false;
    if (job.queryVersion !== undefined && typeof job.queryVersion !== 'string') return false;
    if (typeof job.graphqlQuery !== 'string' || !job.graphqlQuery.trim()) return false;
  }

  if (job.idempotencyKey !== undefined && typeof job.idempotencyKey !== 'string') return false;

  if (
    job.triggeredBy !== 'manual' &&
    job.triggeredBy !== 'scheduler' &&
    job.triggeredBy !== 'webhook' &&
    job.triggeredBy !== 'system'
  ) {
    return false;
  }

  if (typeof job.requestedAt !== 'number' || !Number.isFinite(job.requestedAt)) return false;

  return true;
}

export function validateBulkPollerJobPayload(data: unknown): data is BulkPollerJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<BulkPollerJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.bulkRunId !== 'string' || !isCanonicalUuid(job.bulkRunId)) return false;
  if (typeof job.shopifyOperationId !== 'string' || !job.shopifyOperationId.trim()) return false;

  if (
    job.triggeredBy !== 'manual' &&
    job.triggeredBy !== 'scheduler' &&
    job.triggeredBy !== 'webhook' &&
    job.triggeredBy !== 'system'
  ) {
    return false;
  }

  if (typeof job.requestedAt !== 'number' || !Number.isFinite(job.requestedAt)) return false;

  if (job.pollAttempt !== undefined) {
    if (typeof job.pollAttempt !== 'number') return false;
    if (!Number.isFinite(job.pollAttempt)) return false;
    if (!Number.isInteger(job.pollAttempt)) return false;
    if (job.pollAttempt < 0) return false;
  }

  return true;
}

export function validateBulkMutationReconcileJobPayload(
  data: unknown
): data is BulkMutationReconcileJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<BulkMutationReconcileJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.bulkRunId !== 'string' || !isCanonicalUuid(job.bulkRunId)) return false;
  if (typeof job.resultUrl !== 'string' || !job.resultUrl.trim()) return false;

  if (
    job.triggeredBy !== 'manual' &&
    job.triggeredBy !== 'scheduler' &&
    job.triggeredBy !== 'webhook' &&
    job.triggeredBy !== 'system'
  ) {
    return false;
  }

  if (typeof job.requestedAt !== 'number' || !Number.isFinite(job.requestedAt)) return false;
  return true;
}

export function validateBulkIngestJobPayload(data: unknown): data is BulkIngestJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<BulkIngestJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.bulkRunId !== 'string' || !isCanonicalUuid(job.bulkRunId)) return false;
  if (typeof job.resultUrl !== 'string' || !job.resultUrl.trim()) return false;

  if (
    job.triggeredBy !== 'manual' &&
    job.triggeredBy !== 'scheduler' &&
    job.triggeredBy !== 'webhook' &&
    job.triggeredBy !== 'system'
  ) {
    return false;
  }

  if (typeof job.requestedAt !== 'number' || !Number.isFinite(job.requestedAt)) return false;
  return true;
}
