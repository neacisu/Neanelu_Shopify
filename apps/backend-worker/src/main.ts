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
import { scheduleTokenHealthJob, closeTokenHealthQueue } from './queue/token-health-queue.js';
import {
  setBulkOrchestratorWorkerHandle,
  setBulkIngestWorkerHandle,
  setBulkMutationReconcileWorkerHandle,
  setBulkPollerWorkerHandle,
  setTokenHealthWorkerHandle,
  setWebhookWorkerHandle,
} from './runtime/worker-registry.js';
import { emitQueueStreamEvent } from './runtime/queue-stream.js';

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

    await closeTokenHealthQueue();
    await server.close();
    logger.info({ signal }, 'shutdown complete');
  } catch (error) {
    logger.error({ error, signal }, 'shutdown failed');
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
