import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';
import {
  configFromEnv,
  createQueue,
  enqueueDlqEntry,
  type DlqEntry,
  type DlqQueueLike,
} from '@app/queue-manager';

import { recordEmbeddingDlqEntry } from '../../otel/metrics.js';
import { addAiEvent, AI_EVENTS } from './otel/events.js';
export const EMBEDDING_DLQ_QUEUE_NAME = 'embedding-product-dlq';

export interface EmbeddingDlqEntry {
  shopId: string;
  productId: string;
  embeddingType: string;
  errorMessage: string;
  retryCount: number;
  lastAttemptAt: string;
}

let cachedQueue: DlqQueueLike | null = null;

function getDlqQueue(): DlqQueueLike {
  if (cachedQueue) return cachedQueue;
  const env = loadEnv();
  cachedQueue = createQueue({ config: configFromEnv(env) }, { name: EMBEDDING_DLQ_QUEUE_NAME });
  return cachedQueue;
}

export async function moveToEmbeddingDlq(params: {
  entries: readonly EmbeddingDlqEntry[];
  logger: Logger;
}): Promise<void> {
  if (params.entries.length === 0) return;
  const queue = getDlqQueue();

  for (const entry of params.entries) {
    const dlqEntry: DlqEntry = {
      originalQueue: 'ai-embeddings',
      originalJobId: entry.productId,
      originalJobName: 'embedding.item',
      attemptsMade: entry.retryCount,
      failedReason: entry.errorMessage,
      stacktrace: [],
      data: entry,
      occurredAt: new Date().toISOString(),
    };

    await enqueueDlqEntry(queue, dlqEntry);
    recordEmbeddingDlqEntry();
    addAiEvent(AI_EVENTS.DLQ_MOVE, {
      shop_id: entry.shopId,
      product_id: entry.productId,
      embedding_type: entry.embeddingType,
      retry_count: entry.retryCount,
    });
    params.logger.error(
      { shopId: entry.shopId, productId: entry.productId, retryCount: entry.retryCount },
      'Embedding item moved to DLQ'
    );
  }
}
