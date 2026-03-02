import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';

import { getShopOpenAiConfig } from '../runtime/openai-config.js';
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
  const env = loadEnv();

  const openAiConfig = await getShopOpenAiConfig({ shopId, env, logger });
  if (!openAiConfig.enabled || !openAiConfig.openAiApiKey) {
    logger.warn({ shopId }, 'OpenAI not configured; skipping taxonomy embeddings trigger');
    return { alreadyRunning: false, embeddingBatchId: null, totalItems: 0 };
  }

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
