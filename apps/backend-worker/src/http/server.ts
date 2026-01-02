import { checkDatabaseConnection } from '@app/database';
import { isShopifyApiConfigValid } from '@app/config';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import Fastify, { type FastifyInstance } from 'fastify';
import { createClient } from 'redis';
import { randomUUID } from 'node:crypto';

export type BuildServerOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
}>;

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const { env, logger } = options;

  const server = Fastify({
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId(req) {
      const header = req.headers['x-request-id'];
      if (typeof header === 'string' && header.trim()) return header.trim();
      return randomUUID();
    },
  });

  server.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    logger.info(
      { requestId: request.id, method: request.method, path: request.url },
      'request received'
    );
  });

  server.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        requestId: request.id,
        method: request.method,
        path: request.url,
        statusCode: reply.statusCode,
      },
      'request completed'
    );
  });

  server.setErrorHandler(async (error, request, reply) => {
    logger.error({ requestId: request.id, error }, 'request failed');

    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const responseBody = {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: env.nodeEnv === 'production' ? 'Internal Server Error' : errorMessage,
      },
      meta: {
        request_id: request.id,
        timestamp,
      },
    };

    void reply.status(500).send(responseBody);
  });

  server.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });

  server.get('/health/ready', async (_request, reply) => {
    const [databaseOk, redisOk, shopifyOk] = await Promise.all([
      checkDatabaseConnection(),
      checkRedisConnection(env.redisUrl),
      Promise.resolve(isShopifyApiConfigValid(process.env)),
    ]);

    const checks = {
      database: databaseOk ? 'ok' : 'fail',
      redis: redisOk ? 'ok' : 'fail',
      shopify_api: shopifyOk ? 'ok' : 'fail',
    } as const;

    const allOk = databaseOk && redisOk && shopifyOk;
    const statusCode = allOk ? 200 : 503;
    const status = allOk ? 'ready' : 'not_ready';

    return reply.status(statusCode).send({ status, checks });
  });

  await server.ready();
  return server;
}

async function checkRedisConnection(redisUrl: string): Promise<boolean> {
  const client = createClient({ url: redisUrl });

  const timeoutMs = 1500;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('redis check timeout')), timeoutMs).unref();
  });

  try {
    await Promise.race([client.connect(), timeout]);
    const pong = await Promise.race([client.ping(), timeout]);
    return pong === 'PONG';
  } catch {
    return false;
  } finally {
    try {
      await client.quit();
    } catch {
      // ignore
    }
  }
}
