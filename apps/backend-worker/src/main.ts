import 'dotenv/config';

import { loadEnv } from '@app/config';
import { createLogger } from '@app/logger';

import { buildServer } from './http/server.js';
import { startWebhookWorker } from './processors/webhooks/worker.js';
import { startTokenHealthWorker } from './processors/auth/token-health.worker.js';
import { startSyncWorker } from './processors/sync/worker.js';
import { startBulkOrchestratorWorker } from './processors/bulk-operations/orchestrator.worker.js';
import { startBulkPollerWorker } from './processors/bulk-operations/poller.worker.js';
import { startBulkMutationReconcileWorker } from './processors/bulk-operations/mutation-reconcile.worker.js';
import { startBulkIngestWorker } from './processors/bulk-operations/ingest.worker.js';
import { startBulkScheduleWorker } from './processors/bulk-operations/schedule.worker.js';
import { startAiBatchWorker } from './processors/ai/worker.js';
import { startAiBatchScheduleWorker } from './processors/ai/schedule.worker.js';
import { startOpenAiHealthWorker } from './processors/ai/health.worker.js';
import { startEnrichmentWorker } from './processors/enrichment/worker.js';
import { startSerperHealthWorker } from './processors/serper/health.worker.js';
import { startXaiHealthWorker } from './processors/xai/health.worker.js';
import { startSimilaritySearchWorker } from './processors/similarity/search-and-match.worker.js';
import { startAIAuditWorker } from './processors/similarity/ai-audit.worker.js';
import { scheduleTokenHealthJob, closeTokenHealthQueue } from './queue/token-health-queue.js';
import { closeSimilarityQueues } from './queue/similarity-queues.js';
import {
  setBulkOrchestratorWorkerHandle,
  setBulkIngestWorkerHandle,
  setBulkMutationReconcileWorkerHandle,
  setBulkPollerWorkerHandle,
  setAiBatchWorkerHandle,
  setTokenHealthWorkerHandle,
  setWebhookWorkerHandle,
} from './runtime/worker-registry.js';
import { emitQueueStreamEvent } from './runtime/queue-stream.js';
import { startQueueConfigListener } from './runtime/queue-config-listener.js';

const env = loadEnv();
const logger = createLogger({
  service: 'backend-worker',
  env: env.nodeEnv,
  level: env.logLevel,
});

const server = await buildServer({
  env,
  logger,
});

let webhookWorker: Awaited<ReturnType<typeof startWebhookWorker>> | null = null;
let tokenHealthWorker: Awaited<ReturnType<typeof startTokenHealthWorker>> | null = null;
let syncWorker: Awaited<ReturnType<typeof startSyncWorker>> | null = null;
let bulkOrchestratorWorker: Awaited<ReturnType<typeof startBulkOrchestratorWorker>> | null = null;
let bulkPollerWorker: Awaited<ReturnType<typeof startBulkPollerWorker>> | null = null;
let bulkMutationReconcileWorker: Awaited<
  ReturnType<typeof startBulkMutationReconcileWorker>
> | null = null;
let bulkIngestWorker: Awaited<ReturnType<typeof startBulkIngestWorker>> | null = null;
let bulkScheduleWorker: Awaited<ReturnType<typeof startBulkScheduleWorker>> | null = null;
let aiBatchWorker: Awaited<ReturnType<typeof startAiBatchWorker>> | null = null;
let aiBatchScheduleWorker: Awaited<ReturnType<typeof startAiBatchScheduleWorker>> | null = null;
let openAiHealthWorker: Awaited<ReturnType<typeof startOpenAiHealthWorker>> | null = null;
let enrichmentWorker: Awaited<ReturnType<typeof startEnrichmentWorker>> | null = null;
let serperHealthWorker: Awaited<ReturnType<typeof startSerperHealthWorker>> | null = null;
let xaiHealthWorker: Awaited<ReturnType<typeof startXaiHealthWorker>> | null = null;
let similaritySearchWorker: Awaited<ReturnType<typeof startSimilaritySearchWorker>> | null = null;
let similarityAIAuditWorker: Awaited<ReturnType<typeof startAIAuditWorker>> | null = null;
let queueConfigListener: Awaited<ReturnType<typeof startQueueConfigListener>> | null = null;

try {
  await server.listen({ port: env.port, host: '0.0.0.0' });
  logger.info({ port: env.port }, 'server listening');

  webhookWorker = startWebhookWorker(logger);
  setWebhookWorkerHandle(webhookWorker);
  logger.info({}, 'webhook worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'webhook-worker',
    timestamp: new Date().toISOString(),
  });

  tokenHealthWorker = startTokenHealthWorker(logger);
  setTokenHealthWorkerHandle(tokenHealthWorker);
  logger.info({}, 'token health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'token-health-worker',
    timestamp: new Date().toISOString(),
  });

  await scheduleTokenHealthJob(logger);

  syncWorker = startSyncWorker(logger);
  logger.info({}, 'sync worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'sync-worker',
    timestamp: new Date().toISOString(),
  });

  bulkOrchestratorWorker = startBulkOrchestratorWorker(logger);
  setBulkOrchestratorWorkerHandle(bulkOrchestratorWorker);
  logger.info({}, 'bulk orchestrator worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-orchestrator-worker',
    timestamp: new Date().toISOString(),
  });

  bulkPollerWorker = startBulkPollerWorker(logger);
  setBulkPollerWorkerHandle(bulkPollerWorker);
  logger.info({}, 'bulk poller worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-poller-worker',
    timestamp: new Date().toISOString(),
  });

  bulkMutationReconcileWorker = startBulkMutationReconcileWorker(logger);
  setBulkMutationReconcileWorkerHandle(bulkMutationReconcileWorker);
  logger.info({}, 'bulk mutation reconcile worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-mutation-reconcile-worker',
    timestamp: new Date().toISOString(),
  });

  bulkIngestWorker = startBulkIngestWorker(logger);
  setBulkIngestWorkerHandle(bulkIngestWorker);
  logger.info({}, 'bulk ingest worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-ingest-worker',
    timestamp: new Date().toISOString(),
  });

  bulkScheduleWorker = startBulkScheduleWorker(logger);
  logger.info({}, 'bulk schedule worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-schedule-worker',
    timestamp: new Date().toISOString(),
  });

  aiBatchWorker = startAiBatchWorker(logger);
  setAiBatchWorkerHandle(aiBatchWorker);
  logger.info({}, 'ai batch worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'ai-batch-worker',
    timestamp: new Date().toISOString(),
  });

  aiBatchScheduleWorker = startAiBatchScheduleWorker(logger);
  logger.info({}, 'ai batch schedule worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'ai-batch-schedule-worker',
    timestamp: new Date().toISOString(),
  });

  openAiHealthWorker = startOpenAiHealthWorker(logger);
  logger.info({}, 'openai health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'openai-health-worker',
    timestamp: new Date().toISOString(),
  });

  serperHealthWorker = startSerperHealthWorker(logger);
  logger.info({}, 'serper health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'serper-health-worker',
    timestamp: new Date().toISOString(),
  });

  xaiHealthWorker = startXaiHealthWorker(logger);
  logger.info({}, 'xai health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'xai-health-worker',
    timestamp: new Date().toISOString(),
  });

  enrichmentWorker = startEnrichmentWorker(logger);
  logger.info({}, 'enrichment worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'enrichment-worker',
    timestamp: new Date().toISOString(),
  });

  similaritySearchWorker = startSimilaritySearchWorker(logger);
  logger.info({}, 'similarity search worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'similarity-search-worker',
    timestamp: new Date().toISOString(),
  });

  similarityAIAuditWorker = startAIAuditWorker(logger);
  logger.info({}, 'similarity AI audit worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'ai-audit-worker',
    timestamp: new Date().toISOString(),
  });

  queueConfigListener = await startQueueConfigListener(env, logger, {
    'webhook-queue': webhookWorker?.worker as unknown as { concurrency?: number },
    'sync-queue': syncWorker?.worker as unknown as { concurrency?: number },
    'bulk-queue': bulkOrchestratorWorker?.worker as unknown as { concurrency?: number },
    'bulk-poller-queue': bulkPollerWorker?.worker as unknown as { concurrency?: number },
    'bulk-mutation-reconcile-queue': bulkMutationReconcileWorker?.worker as unknown as {
      concurrency?: number;
    },
    'ai-batch-queue': aiBatchWorker?.worker as unknown as { concurrency?: number },
    'pim-enrichment-queue': enrichmentWorker?.worker as unknown as { concurrency?: number },
    'pim-similarity-search': similaritySearchWorker?.worker as unknown as { concurrency?: number },
    'pim-ai-audit': similarityAIAuditWorker?.worker as unknown as { concurrency?: number },
  });
  logger.info({}, 'queue config listener started');
} catch (error) {
  logger.fatal({ error }, 'server failed to start');
  process.exitCode = 1;
}

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutdown started');
  try {
    if (webhookWorker) {
      await webhookWorker.close();
      webhookWorker = null;
      setWebhookWorkerHandle(null);
      logger.info({ signal }, 'webhook worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'webhook-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (tokenHealthWorker) {
      await tokenHealthWorker.close();
      tokenHealthWorker = null;
      setTokenHealthWorkerHandle(null);
      logger.info({ signal }, 'token health worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'token-health-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (syncWorker) {
      await syncWorker.close();
      syncWorker = null;
      logger.info({ signal }, 'sync worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'sync-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (bulkOrchestratorWorker) {
      await bulkOrchestratorWorker.close();
      bulkOrchestratorWorker = null;
      setBulkOrchestratorWorkerHandle(null);
      logger.info({ signal }, 'bulk orchestrator worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'bulk-orchestrator-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (bulkPollerWorker) {
      await bulkPollerWorker.close();
      bulkPollerWorker = null;
      setBulkPollerWorkerHandle(null);
      logger.info({ signal }, 'bulk poller worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'bulk-poller-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (bulkMutationReconcileWorker) {
      await bulkMutationReconcileWorker.close();
      bulkMutationReconcileWorker = null;
      setBulkMutationReconcileWorkerHandle(null);
      logger.info({ signal }, 'bulk mutation reconcile worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'bulk-mutation-reconcile-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (bulkIngestWorker) {
      await bulkIngestWorker.close();
      bulkIngestWorker = null;
      setBulkIngestWorkerHandle(null);
      logger.info({ signal }, 'bulk ingest worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'bulk-ingest-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (bulkScheduleWorker) {
      await bulkScheduleWorker.close();
      bulkScheduleWorker = null;
      logger.info({ signal }, 'bulk schedule worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'bulk-schedule-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (aiBatchWorker) {
      await aiBatchWorker.close();
      aiBatchWorker = null;
      setAiBatchWorkerHandle(null);
      logger.info({ signal }, 'ai batch worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'ai-batch-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (enrichmentWorker) {
      await enrichmentWorker.close();
      enrichmentWorker = null;
      logger.info({ signal }, 'enrichment worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'enrichment-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (similaritySearchWorker) {
      await similaritySearchWorker.close();
      similaritySearchWorker = null;
      logger.info({ signal }, 'similarity search worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'similarity-search-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (similarityAIAuditWorker) {
      await similarityAIAuditWorker.close();
      similarityAIAuditWorker = null;
      logger.info({ signal }, 'similarity AI audit worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'ai-audit-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (aiBatchScheduleWorker) {
      await aiBatchScheduleWorker.close();
      aiBatchScheduleWorker = null;
      logger.info({ signal }, 'ai batch schedule worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'ai-batch-schedule-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (openAiHealthWorker) {
      await openAiHealthWorker.close();
      openAiHealthWorker = null;
      logger.info({ signal }, 'openai health worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'openai-health-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (serperHealthWorker) {
      await serperHealthWorker.close();
      serperHealthWorker = null;
      logger.info({ signal }, 'serper health worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'serper-health-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (xaiHealthWorker) {
      await xaiHealthWorker.close();
      xaiHealthWorker = null;
      logger.info({ signal }, 'xai health worker stopped');
      emitQueueStreamEvent({
        type: 'worker.offline',
        workerId: 'xai-health-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (queueConfigListener) {
      await queueConfigListener.quit().catch(() => undefined);
      queueConfigListener = null;
      logger.info({ signal }, 'queue config listener stopped');
    }

    await closeTokenHealthQueue();
    await closeSimilarityQueues();
    await server.close();
    logger.info({ signal }, 'shutdown complete');
  } catch (error) {
    logger.error({ error, signal }, 'shutdown failed');
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
