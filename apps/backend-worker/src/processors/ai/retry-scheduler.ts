import type { Logger } from '@app/logger';
import type { AiEmbeddingBatchType, AiEmbeddingType } from '@app/types';

interface RetryCandidate {
  productId: string;
  retryCount: number;
}

interface RetryScheduleParams {
  shopId: string;
  batchType: AiEmbeddingBatchType;
  embeddingType: AiEmbeddingType;
  model: string;
  dimensions: number;
  candidates: RetryCandidate[];
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  logger: Logger;
}

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 5 * 60 * 1000;

export function calculateBackoffDelay(
  retryCount: number,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS
): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, Math.max(0, retryCount)), maxDelayMs);
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(delay + jitter));
}

export async function scheduleEmbeddingRetries(params: RetryScheduleParams): Promise<void> {
  const {
    shopId,
    batchType,
    embeddingType,
    model,
    dimensions,
    candidates,
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    logger,
  } = params;

  const uniqueCandidates = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.retryCount >= maxRetries) continue;
    const current = uniqueCandidates.get(candidate.productId);
    if (current === undefined || candidate.retryCount > current) {
      uniqueCandidates.set(candidate.productId, candidate.retryCount);
    }
  }

  if (uniqueCandidates.size === 0) return;

  const queueManager = await import('@app/queue-manager');
  const enqueue = queueManager.enqueueAiBatchOrchestratorJob as
    | ((
        payload: {
          shopId: string;
          batchType: AiEmbeddingBatchType;
          embeddingType: AiEmbeddingType;
          model: string;
          dimensions: number;
          requestedAt: number;
          triggeredBy: 'system';
          maxItems: number;
          productIds: string[];
        },
        options: { delayMs: number }
      ) => Promise<void>)
    | undefined;

  if (!enqueue) {
    throw new Error('enqueue_ai_batch_orchestrator_missing');
  }

  for (const [productId, retryCount] of uniqueCandidates.entries()) {
    const delayMs = calculateBackoffDelay(retryCount, baseDelayMs, maxDelayMs);
    await enqueue(
      {
        shopId,
        batchType,
        embeddingType,
        model,
        dimensions,
        requestedAt: Date.now(),
        triggeredBy: 'system',
        maxItems: 1,
        productIds: [productId],
      },
      { delayMs }
    );
    logger.info(
      { shopId, productId, retryCount, delayMs },
      'Scheduled embedding retry with backoff'
    );
  }
}
