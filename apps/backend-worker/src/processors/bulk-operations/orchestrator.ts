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

import { getBulkQueryContract, type BulkQuerySet, type BulkQueryVersion } from './queries/index.js';

export type BulkQueryCategory = string;

export type StartBulkQueryOptions = Readonly<{
  operationType: BulkOperationType;
  queryType: BulkQueryCategory;
  /** Optional version tag for contract-driven queries (e.g. v1). */
  queryVersion?: string;
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
    ...(options.queryVersion ? { queryVersion: options.queryVersion } : {}),
    graphqlQuery: options.graphqlQuery,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    triggeredBy: options.triggeredBy ?? 'system',
    requestedAt: Date.now(),
  });
}

export type StartBulkQueryFromContractOptions = Readonly<{
  operationType: BulkOperationType;
  querySet: BulkQuerySet;
  version?: BulkQueryVersion;
  idempotencyKey?: string;
  triggeredBy?: BulkJobTriggeredBy;
}>;

/**
 * Contract-driven entrypoint (PR-038): derive graphqlQuery from the versioned query registry.
 * This avoids hardcoding query strings inside workers/processors.
 */
export async function startBulkQueryFromContract(
  shopId: string,
  options: StartBulkQueryFromContractOptions
): Promise<void> {
  const contract = getBulkQueryContract({
    operationType: options.operationType,
    querySet: options.querySet,
    ...(options.version ? { version: options.version } : {}),
  });

  return startBulkQuery(shopId, {
    operationType: contract.operationType,
    queryType: contract.querySet,
    queryVersion: contract.version,
    graphqlQuery: contract.graphqlQuery,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.triggeredBy ? { triggeredBy: options.triggeredBy } : {}),
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
