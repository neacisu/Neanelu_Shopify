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

export interface BulkOrchestratorJobPayload {
  shopId: string;
  operationType: BulkOperationType;
  /** Optional category for observability/debugging (e.g. 'core', 'inventory'). */
  queryType?: string;
  /** GraphQL query to run via bulkOperationRunQuery. */
  graphqlQuery: string;
  /** Optional idempotency key. If omitted, orchestrator will derive one from inputs. */
  idempotencyKey?: string;
  triggeredBy: BulkJobTriggeredBy;
  requestedAt: number;
}

export interface BulkPollerJobPayload {
  shopId: string;
  bulkRunId: string;
  shopifyOperationId: string;
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
  const job = data as Partial<BulkOrchestratorJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.operationType !== 'string') return false;
  if (!(BULK_OPERATION_TYPES as readonly string[]).includes(job.operationType)) return false;

  if (job.queryType !== undefined && typeof job.queryType !== 'string') return false;

  if (typeof job.graphqlQuery !== 'string' || !job.graphqlQuery.trim()) return false;

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

  return true;
}
