import { checkDatabaseConnection } from '@app/database';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { createClient } from 'redis';
import { randomUUID } from 'node:crypto';
import { isShopifyApiConfigValid } from '@app/config';
import { registerAuthRoutes } from '../auth/index.js';
import {
  createSessionToken,
  getDefaultSessionConfig,
  getSessionFromRequest,
  requireSession,
} from '../auth/session.js';
import { webhookRoutes } from '../routes/webhooks.js';
import { setRequestIdAttribute } from '@app/logger';
import {
  httpActiveRequests,
  recordHttpRequest,
  httpRequestSizeBytes,
  httpResponseSizeBytes,
} from '../otel/metrics.js';

function withoutQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs).unref();
  });
  return Promise.race([promise, timeout]);
}

export type BuildServerOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
}>;

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  const { env, logger } = options;

  const server = Fastify({
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    requestIdHeader: 'x-request-id',
    genReqId(req) {
      const header = req.headers['x-request-id'];
      if (typeof header === 'string' && header.trim()) return header.trim();
      return randomUUID();
    },
  });

  // Register cookie plugin for OAuth state
  await server.register(fastifyCookie);

  // Register routes
  // OAuth routes are registered via registerAuthRoutes below
  await server.register(webhookRoutes, { prefix: '/webhooks', appLogger: logger });

  const startNsKey = Symbol('requestStartNs');

  server.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);

    // Correlate request id with current OTel span (when tracing is active)
    setRequestIdAttribute(request.id);

    // Start active requests counter and record start timestamp for latency
    httpActiveRequests.add(1);
    (request as unknown as Record<symbol, bigint>)[startNsKey] = process.hrtime.bigint();

    // Best-effort request size (header may be absent)
    const len = request.headers['content-length'];
    const requestSizeBytes = typeof len === 'string' ? Number(len) : Number.NaN;
    if (Number.isFinite(requestSizeBytes)) {
      httpRequestSizeBytes.record(requestSizeBytes, {
        method: request.method,
        route: withoutQuery(request.url),
      });
    }

    logger.info(
      { requestId: request.id, method: request.method, path: withoutQuery(request.url) },
      'request received'
    );
  });

  server.addHook('onResponse', async (request, reply) => {
    httpActiveRequests.add(-1);

    const startNs = (request as unknown as Record<symbol, bigint>)[startNsKey];
    const durationSeconds =
      typeof startNs === 'bigint' ? Number(process.hrtime.bigint() - startNs) / 1_000_000_000 : 0;

    recordHttpRequest(request.method, withoutQuery(request.url), reply.statusCode, durationSeconds);

    const responseLength = reply.getHeader('content-length');
    const responseSizeBytes =
      typeof responseLength === 'string' ? Number(responseLength) : Number.NaN;
    if (Number.isFinite(responseSizeBytes)) {
      httpResponseSizeBytes.record(responseSizeBytes, {
        method: request.method,
        route: withoutQuery(request.url),
      });
    }

    logger.info(
      {
        requestId: request.id,
        method: request.method,
        path: withoutQuery(request.url),
        statusCode: reply.statusCode,
      },
      'request completed'
    );
  });

  server.setErrorHandler(async (error, request, reply) => {
    logger.error({ requestId: request.id, error }, 'request failed');

    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    const statusCodeRaw = (error as { statusCode?: unknown }).statusCode;
    const statusCode = typeof statusCodeRaw === 'number' ? statusCodeRaw : 500;

    const errorCode = (() => {
      switch (statusCode) {
        case 400:
          return 'BAD_REQUEST';
        case 401:
          return 'UNAUTHORIZED';
        case 403:
          return 'FORBIDDEN';
        case 404:
          return 'NOT_FOUND';
        case 413:
          return 'PAYLOAD_TOO_LARGE';
        case 429:
          return 'TOO_MANY_REQUESTS';
        default:
          return 'INTERNAL_SERVER_ERROR';
      }
    })();

    const safeMessage =
      env.nodeEnv === 'production' && statusCode >= 500 ? 'Internal Server Error' : errorMessage;
    const responseBody = {
      success: false,
      error: {
        code: errorCode,
        message: safeMessage,
      },
      meta: {
        request_id: request.id,
        timestamp,
      },
    };

    void reply.status(statusCode).send(responseBody);
  });

  server.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });

  server.get('/health/ready', async (_request, reply) => {
    const checkTimeoutMs = 1500;
    const [databaseOk, redisOk, shopifyOk] = await Promise.all([
      withTimeout(checkDatabaseConnection(), checkTimeoutMs, 'database check').catch(() => false),
      checkRedisConnection(env.redisUrl, checkTimeoutMs),
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

  // Register OAuth routes
  registerAuthRoutes(server, { env, logger });

  const sessionConfig = getDefaultSessionConfig(env.shopifyApiSecret, env.shopifyApiKey);

  server.get('/api/health', (request, reply) => {
    void reply.status(200).send({
      success: true,
      data: {
        status: 'ok',
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Helper endpoint for web-admin to obtain a Bearer token when cookie auth is available.
  // This token is the same signed session token used in the session cookie.
  server.get('/api/session/token', (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Session required',
        },
        meta: {
          request_id: request.id,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const token = createSessionToken(session, sessionConfig.secret);
    void reply.status(200).send({
      success: true,
      data: { token },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Debuggable auth check endpoint (useful for validating header injection)
  server.get('/api/whoami', { preHandler: requireSession(sessionConfig) }, (request, reply) => {
    const session = (
      request as typeof request & { session: { shopId: string; shopDomain: string } }
    ).session;
    void reply.status(200).send({
      success: true,
      data: {
        shopId: session.shopId,
        shopDomain: session.shopDomain,
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  await server.ready();
  return server;
}

async function checkRedisConnection(redisUrl: string, timeoutMs = 1500): Promise<boolean> {
  const client = createClient({ url: redisUrl });

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
      if (client.isReady) {
        await Promise.race([client.quit(), timeout]);
      } else {
        await client.disconnect();
      }
    } catch {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
    }
  }
}
