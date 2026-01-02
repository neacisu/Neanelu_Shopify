import 'dotenv/config';

import { loadEnv } from '@app/config';
import { createLogger } from '@app/logger';

import { buildServer } from './http/server.js';
import { startWebhookWorker } from './processors/webhooks/worker.js';

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

try {
  await server.listen({ port: env.port, host: '0.0.0.0' });
  logger.info({ port: env.port }, 'server listening');

  webhookWorker = startWebhookWorker(logger);
  logger.info({}, 'webhook worker started');
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
      logger.info({ signal }, 'webhook worker stopped');
    }
    await server.close();
    logger.info({ signal }, 'shutdown complete');
  } catch (error) {
    logger.error({ error, signal }, 'shutdown failed');
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
