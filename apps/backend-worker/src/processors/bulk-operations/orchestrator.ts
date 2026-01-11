/**
 * Bulk Operations Orchestration Facade
 *
 * PR-036 (F5.1.1): Provide explicit entrypoints to start bulk operations.
 *
 * Notes:
 * - This module is intentionally thin: it enqueues the orchestrator job.
 * - Polling/downloading/processing is handled by later PRs (PR-037+).
 */

import type { BulkJobTriggeredBy, BulkOperationType } from '@app/types';
import { enqueueBulkOrchestratorJob } from '@app/queue-manager';

export type BulkQueryCategory = string;

export type StartBulkQueryOptions = Readonly<{
  operationType: BulkOperationType;
  queryType: BulkQueryCategory;
  graphqlQuery: string;
  idempotencyKey?: string;
  triggeredBy?: BulkJobTriggeredBy;
}>;

/**
 * Plan-compatible facade for starting Shopify Bulk query operations.
 */
export async function startBulkQuery(
  shopId: string,
  options: StartBulkQueryOptions
): Promise<void> {
  await enqueueBulkOrchestratorJob({
    shopId,
    operationType: options.operationType,
    queryType: options.queryType,
    graphqlQuery: options.graphqlQuery,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    triggeredBy: options.triggeredBy ?? 'system',
    requestedAt: Date.now(),
  });
}

export type StartBulkMutationOptions = Readonly<{
  operationType: BulkOperationType;
  mutationType: string;
  inputPath: string;
  idempotencyKey?: string;
  triggeredBy?: BulkJobTriggeredBy;
}>;

/**
 * Placeholder facade for bulk mutations.
 *
 * Bulk mutations require staged upload + JSONL chunking, implemented later (PR-039).
 */
export function startBulkMutation(
  _shopId: string,
  _options: StartBulkMutationOptions
): Promise<never> {
  return Promise.reject(new Error('startBulkMutation_not_implemented_PR039'));
}
