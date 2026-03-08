import type { Logger } from '@app/logger';
import {
  runTaxonomyBatchOrchestrator,
  type TaxonomyBatchOrchestratorResult,
} from '../processors/ai/taxonomy-batch.js';

export type TriggerTaxonomyEmbeddingsResult = TaxonomyBatchOrchestratorResult;

/**
 * Fire-and-forget wrapper for taxonomy embedding generation via Batch API.
 * Validates OpenAI credentials before delegating to the orchestrator.
 * Safe to call with `void triggerTaxonomyEmbeddings(...).catch(...)`.
 */
export async function triggerTaxonomyEmbeddings(params: {
  shopId: string;
  logger: Logger;
}): Promise<TriggerTaxonomyEmbeddingsResult> {
  const { shopId, logger } = params;
  const result = await runTaxonomyBatchOrchestrator({ shopId, logger });

  if (result.alreadyRunning) {
    logger.info(
      { shopId, embeddingBatchId: result.embeddingBatchId },
      'Taxonomy embedding batch already running'
    );
  } else if (result.embeddingBatchId) {
    logger.info(
      { shopId, embeddingBatchId: result.embeddingBatchId, totalItems: result.totalItems },
      'Taxonomy embedding batch triggered via Batch API'
    );
  } else {
    logger.info({ shopId }, 'No taxonomy entries need embeddings');
  }

  return result;
}
