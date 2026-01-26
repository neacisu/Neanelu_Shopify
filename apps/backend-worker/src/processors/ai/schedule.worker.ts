import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import {
  enqueueAiBatchBackfillJob,
  enqueueAiBatchCleanupJob,
  enqueueAiBatchOrchestratorJob,
} from '@app/queue-manager';
import { createEmbeddingsProvider } from '@app/ai-engine';

import { listShops } from './batch.js';

let lastCleanupAt: number | null = null;
let lastBackfillAt: number | null = null;

export interface AiBatchScheduleWorkerHandle {
  close: () => Promise<void>;
}

export async function runAiBatchScheduleTick(logger: Logger): Promise<void> {
  const env = loadEnv();
  const shops = await listShops();
  const provider = createEmbeddingsProvider({
    ...(env.openAiApiKey ? { openAiApiKey: env.openAiApiKey } : {}),
    ...(env.openAiBaseUrl ? { openAiBaseUrl: env.openAiBaseUrl } : {}),
    ...(env.openAiEmbeddingsModel ? { openAiEmbeddingsModel: env.openAiEmbeddingsModel } : {}),
    openAiTimeoutMs: env.openAiTimeoutMs,
  });

  for (const shopId of shops) {
    await enqueueAiBatchOrchestratorJob({
      shopId,
      batchType: 'combined',
      embeddingType: 'combined',
      model: provider.model.name,
      dimensions: provider.model.dimensions,
      requestedAt: Date.now(),
      triggeredBy: 'scheduler',
      maxItems: env.openAiBatchMaxItems,
    });
  }

  const now = Date.now();
  const cleanupIntervalMs = 24 * 60 * 60 * 1000;
  if (!lastCleanupAt || now - lastCleanupAt > cleanupIntervalMs) {
    lastCleanupAt = now;
    for (const shopId of shops) {
      await enqueueAiBatchCleanupJob({
        shopId,
        requestedAt: Date.now(),
        triggeredBy: 'scheduler',
        retentionDays: env.openAiBatchRetentionDays,
      });
    }
  }

  const backfillIntervalMs = 24 * 60 * 60 * 1000;
  if (!lastBackfillAt || now - lastBackfillAt > backfillIntervalMs) {
    lastBackfillAt = now;
    for (const shopId of shops) {
      await enqueueAiBatchBackfillJob({
        shopId,
        requestedAt: Date.now(),
        triggeredBy: 'scheduler',
        chunkSize: env.openAiBatchMaxItems,
        nightlyWindowOnly: true,
      });
    }
  }

  logger.info({ shops: shops.length }, 'AI batch schedule tick completed');
}

export function startAiBatchScheduleWorker(logger: Logger): AiBatchScheduleWorkerHandle {
  const env = loadEnv();
  const tickSeconds = env.openAiBatchScheduleTickSeconds;
  const tickMs = Number.isFinite(tickSeconds) && tickSeconds > 1 ? tickSeconds * 1000 : 60_000;

  let running = false;
  let closed = false;

  const tick = async (): Promise<void> => {
    if (running || closed) return;
    running = true;
    try {
      await runAiBatchScheduleTick(logger);
    } catch (err) {
      logger.error({ err }, 'AI batch schedule tick failed');
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), tickMs);
  void tick();

  return {
    close: async () => {
      closed = true;
      clearInterval(interval);
      await Promise.resolve();
    },
  };
}
