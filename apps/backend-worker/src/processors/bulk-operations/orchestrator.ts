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
import {
  getBulkMutationContract,
  type BulkMutationType,
  type BulkMutationVersion,
} from './mutations/index.js';
import { chunkJsonlFile } from './mutations/chunk-jsonl-file.js';
import { ensureBulkMutationArtifactsDir } from './mutations/artifacts-dir.js';

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
  mutationType: BulkMutationType;
  mutationVersion?: BulkMutationVersion;
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
  shopId: string,
  options: StartBulkMutationOptions
): Promise<void> {
  return startBulkMutationFromContract(shopId, {
    operationType: options.operationType,
    mutationType: options.mutationType,
    ...(options.mutationVersion ? { version: options.mutationVersion } : {}),
    inputPath: options.inputPath,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.triggeredBy ? { triggeredBy: options.triggeredBy } : {}),
  });
}

export type StartBulkMutationFromContractOptions = Readonly<{
  operationType: BulkOperationType;
  mutationType: BulkMutationType;
  version?: BulkMutationVersion;
  inputPath: string;
  idempotencyKey?: string;
  triggeredBy?: BulkJobTriggeredBy;
}>;

/**
 * Contract-driven entrypoint for bulk mutations (PR-039):
 * - Splits input JSONL into <=90MB chunks
 * - Enqueues a bulk orchestrator job per chunk
 *
 * Note: Each chunk is modeled as a separate bulk_run (idempotency by checksum).
 */
export async function startBulkMutationFromContract(
  shopId: string,
  options: StartBulkMutationFromContractOptions
): Promise<void> {
  const contract = getBulkMutationContract({
    operationType: options.operationType,
    mutationType: options.mutationType,
    ...(options.version ? { version: options.version } : {}),
  });

  // CONFORM Plan_de_implementare.md (F5.1.8): keep a safety margin under 100MB.
  const CHUNK_SIZE = 90 * 1024 * 1024;

  const outputDir = await ensureBulkMutationArtifactsDir({ shopId, purpose: 'chunks' });
  const filePrefix = `bulk.${contract.mutationType}.${contract.version}.${Date.now()}`;

  const chunked = await chunkJsonlFile({
    inputPath: options.inputPath,
    outputDir,
    targetBytes: CHUNK_SIZE,
    filePrefix,
  });

  const chunkCount = chunked.chunks.length;
  if (chunkCount === 0) {
    throw new Error('bulk_mutation_input_empty');
  }

  for (const chunk of chunked.chunks) {
    await enqueueBulkOrchestratorJob({
      shopId,
      operationType: contract.operationType,
      mutationType: contract.mutationType,
      mutationVersion: contract.version,
      graphqlMutation: contract.graphqlMutation,
      inputPath: chunk.filePath,
      chunkIndex: chunk.index,
      chunkCount,
      inputChecksum: chunk.sha256,
      inputBytes: chunk.bytes,
      inputRows: chunk.rows,
      ...(options.idempotencyKey
        ? { idempotencyKey: `${options.idempotencyKey}__chunk_${chunk.index}` }
        : {}),
      triggeredBy: options.triggeredBy ?? 'system',
      requestedAt: Date.now(),
    });
  }
}
