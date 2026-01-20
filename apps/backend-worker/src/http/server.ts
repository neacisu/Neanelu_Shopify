import { checkDatabaseConnection, pool } from '@app/database';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
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
import { queueRoutes } from '../routes/queues.js';
import { dashboardRoutes } from '../routes/dashboard.js';
import { bulkRoutes } from '../routes/bulk.js';
import { setRequestIdAttribute } from '@app/logger';
import {
  httpActiveRequests,
  recordHttpRequest,
  httpRequestSizeBytes,
  httpResponseSizeBytes,
} from '../otel/metrics.js';
import { getWorkerReadiness } from '../runtime/worker-registry.js';
import { configFromEnv, createQueue, WEBHOOK_QUEUE_NAME } from '@app/queue-manager';
import { recordHttpLatencySeconds } from '../runtime/http-latency.js';

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

async function checkWebhookQueueFunctional(env: AppEnv, timeoutMs = 1500): Promise<boolean> {
  const queue = createQueue({ config: configFromEnv(env) }, { name: WEBHOOK_QUEUE_NAME });
  try {
    await withTimeout(queue.getJobCounts(), timeoutMs, 'webhook queue check');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await withTimeout(queue.close(), timeoutMs, 'webhook queue close');
    } catch {
      // best-effort
    }
  }
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

    recordHttpLatencySeconds(durationSeconds);

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
    const [databaseOk, redisOk, shopifyOk, webhookQueueOk] = await Promise.all([
      withTimeout(checkDatabaseConnection(), checkTimeoutMs, 'database check').catch(() => false),
      checkRedisConnection(env.redisUrl, checkTimeoutMs),
      Promise.resolve(isShopifyApiConfigValid(process.env)),
      checkWebhookQueueFunctional(env, checkTimeoutMs),
    ]);

    const { webhookWorkerOk, tokenHealthWorkerOk } = getWorkerReadiness();

    const checks = {
      database: databaseOk ? 'ok' : 'fail',
      redis: redisOk ? 'ok' : 'fail',
      shopify_api: shopifyOk ? 'ok' : 'fail',
      queue_webhook: webhookQueueOk ? 'ok' : 'fail',
      worker_webhook: webhookWorkerOk ? 'ok' : 'fail',
      ...(tokenHealthWorkerOk == null
        ? {}
        : { worker_token_health: tokenHealthWorkerOk ? 'ok' : 'fail' }),
    } as const;

    const allOk = databaseOk && redisOk && shopifyOk && webhookQueueOk && webhookWorkerOk;
    const statusCode = allOk ? 200 : 503;
    const status = allOk ? 'ready' : 'not_ready';

    return reply.status(statusCode).send({ status, checks });
  });

  // Register OAuth routes
  registerAuthRoutes(server, { env, logger });

  // Shopify may load the app at the host root (e.g. /?shop=...&host=...)
  // while the web-admin SPA is mounted under /app. Redirect root requests
  // to /app and preserve the full query string.
  server.get('/', async (request, reply) => {
    const rawUrl = request.raw.url;
    const url = typeof rawUrl === 'string' && rawUrl.length > 0 ? rawUrl : '/';
    const withLeadingSlash = url.startsWith('/') ? url : `/${url}`;
    const target = `/app${withLeadingSlash}`;
    return reply.redirect(target);
  });

  // Avoid noisy 404s in browsers hitting the backend host root.
  server.get('/favicon.ico', async (_request, reply) => {
    return reply.redirect('/app/favicon.png');
  });

  const sessionConfig = getDefaultSessionConfig(env.shopifyApiSecret, env.shopifyApiKey);

  // Admin APIs (used by web-admin)
  // Primary mounting under /api/*
  await server.register(queueRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(dashboardRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(bulkRoutes, { prefix: '/api', env, logger, sessionConfig });

  // Compatibility mounting without /api prefix.
  // Some reverse proxies (or legacy deployments) may strip `/api` before forwarding.
  // All endpoints remain protected by `requireSession()` inside the plugin.
  await server.register(queueRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(dashboardRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(bulkRoutes, { prefix: '', env, logger, sessionConfig });

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

  // Alias health endpoints under /api prefix for web-admin compatibility
  server.get('/api/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });

  server.get('/api/health/ready', async (_request, reply) => {
    const checkTimeoutMs = 1500;
    const [databaseOk, redisOk, shopifyOk, webhookQueueOk] = await Promise.all([
      withTimeout(checkDatabaseConnection(), checkTimeoutMs, 'database check').catch(() => false),
      checkRedisConnection(env.redisUrl, checkTimeoutMs),
      Promise.resolve(isShopifyApiConfigValid(process.env)),
      checkWebhookQueueFunctional(env, checkTimeoutMs),
    ]);

    const { webhookWorkerOk, tokenHealthWorkerOk } = getWorkerReadiness();

    const checks = {
      database: databaseOk ? 'ok' : 'fail',
      redis: redisOk ? 'ok' : 'fail',
      shopify_api: shopifyOk ? 'ok' : 'fail',
      queue_webhook: webhookQueueOk ? 'ok' : 'fail',
      worker_webhook: webhookWorkerOk ? 'ok' : 'fail',
      ...(tokenHealthWorkerOk == null
        ? {}
        : { worker_token_health: tokenHealthWorkerOk ? 'ok' : 'fail' }),
    } as const;

    const allOk = databaseOk && redisOk && shopifyOk && webhookQueueOk && webhookWorkerOk;
    const statusCode = allOk ? 200 : 503;
    const status = allOk ? 'ready' : 'not_ready';

    return reply.status(statusCode).send({ status, checks });
  });

  // Helper endpoint for web-admin to obtain a Bearer token when cookie auth is available.
  // This token is the same signed session token used in the session cookie.
  const sessionTokenHandler = (request: FastifyRequest, reply: FastifyReply) => {
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
    const expiresAt = new Date(session.createdAt + sessionConfig.maxAge * 1000).toISOString();
    void reply.status(200).send({
      success: true,
      data: { token, expiresAt },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  };

  // Primary path (expected by frontend)
  server.get('/api/session/token', sessionTokenHandler);
  // Compatibility alias (for proxies that strip /api)
  server.get('/session/token', sessionTokenHandler);

  // DB-backed UI profile (preferences only, no secrets).
  // Used for multi-shop UX in non-embedded mode (e.g., remembering last shop domain).
  const uiProfileCookie = 'neanelu_ui_profile';

  function getOrCreateUiProfileId(request: FastifyRequest, reply: FastifyReply): string {
    const existing = request.cookies[uiProfileCookie];
    if (typeof existing === 'string' && existing.length > 0) return existing;

    const id = randomUUID();
    // Use secure cookies only when served over HTTPS.
    const secure = env.appHost.protocol === 'https:';
    void reply.cookie(uiProfileCookie, id, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    });
    return id;
  }

  function normalizeShopDomain(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function uniqDomainsPreserveOrder(domains: string[], max = 10): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const domain of domains) {
      const normalized = domain.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
      if (out.length >= max) break;
    }
    return out;
  }

  const getUiProfileHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const id = getOrCreateUiProfileId(request, reply);

    try {
      let row: {
        active_shop_domain: string | null;
        last_shop_domain: string | null;
        recent_shop_domains?: string[] | null;
      } | null = null;

      try {
        const result = await pool.query<{
          active_shop_domain: string | null;
          last_shop_domain: string | null;
          recent_shop_domains: string[] | null;
        }>(
          `SELECT active_shop_domain, last_shop_domain, recent_shop_domains
           FROM ui_user_profiles
           WHERE id = $1::uuid`,
          [id]
        );
        row = result.rows[0] ?? null;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        // Backward compatibility: DB may not have been migrated to include recent_shop_domains yet.
        if (code === '42703') {
          const result = await pool.query<{
            active_shop_domain: string | null;
            last_shop_domain: string | null;
          }>(
            `SELECT active_shop_domain, last_shop_domain
             FROM ui_user_profiles
             WHERE id = $1::uuid`,
            [id]
          );
          row = result.rows[0] ?? null;
        } else {
          throw err;
        }
      }

      if (!row) {
        await pool.query(
          `INSERT INTO ui_user_profiles (id)
           VALUES ($1::uuid)
           ON CONFLICT (id) DO NOTHING`,
          [id]
        );
      }

      void reply.status(200).send({
        success: true,
        data: {
          activeShopDomain: row?.active_shop_domain ?? null,
          lastShopDomain: row?.last_shop_domain ?? null,
          recentShopDomains: row?.recent_shop_domains ?? [],
        },
        meta: {
          request_id: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err }, 'ui_profile_fetch_failed');
      void reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load UI profile',
        },
        meta: {
          request_id: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  const postUiProfileHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const id = getOrCreateUiProfileId(request, reply);

    const body = (request.body ?? {}) as {
      activeShopDomain?: unknown;
      lastShopDomain?: unknown;
    };

    const activeShopDomain = normalizeShopDomain(body.activeShopDomain);
    const lastShopDomain = normalizeShopDomain(body.lastShopDomain);

    const newDomains = [activeShopDomain, lastShopDomain].filter((v): v is string => Boolean(v));

    try {
      let existingDomains: string[] = [];
      try {
        const existing = await pool.query<{ recent_shop_domains: string[] | null }>(
          `SELECT recent_shop_domains
           FROM ui_user_profiles
           WHERE id = $1::uuid`,
          [id]
        );
        existingDomains = existing.rows[0]?.recent_shop_domains ?? [];
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code !== '42703') throw err;
      }

      const recentShopDomains = uniqDomainsPreserveOrder([...newDomains, ...existingDomains], 10);

      try {
        await pool.query(
          `INSERT INTO ui_user_profiles (id, active_shop_domain, last_shop_domain, recent_shop_domains)
           VALUES ($1::uuid, $2, $3, $4::text[])
           ON CONFLICT (id)
           DO UPDATE SET
             active_shop_domain = COALESCE(EXCLUDED.active_shop_domain, ui_user_profiles.active_shop_domain),
             last_shop_domain = COALESCE(EXCLUDED.last_shop_domain, ui_user_profiles.last_shop_domain),
             recent_shop_domains = $4::text[],
             updated_at = now()`,
          [id, activeShopDomain, lastShopDomain, recentShopDomains]
        );
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        // Backward compatibility: DB may not have recent_shop_domains column yet.
        if (code === '42703') {
          await pool.query(
            `INSERT INTO ui_user_profiles (id, active_shop_domain, last_shop_domain)
             VALUES ($1::uuid, $2, $3)
             ON CONFLICT (id)
             DO UPDATE SET
               active_shop_domain = COALESCE(EXCLUDED.active_shop_domain, ui_user_profiles.active_shop_domain),
               last_shop_domain = COALESCE(EXCLUDED.last_shop_domain, ui_user_profiles.last_shop_domain),
               updated_at = now()`,
            [id, activeShopDomain, lastShopDomain]
          );
        } else {
          throw err;
        }
      }

      void reply.status(200).send({
        success: true,
        data: {
          activeShopDomain,
          lastShopDomain,
          recentShopDomains,
        },
        meta: {
          request_id: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error({ err }, 'ui_profile_update_failed');
      void reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update UI profile',
        },
        meta: {
          request_id: request.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };

  // Primary path (expected by frontend)
  server.get('/api/ui-profile', getUiProfileHandler);
  server.post('/api/ui-profile', postUiProfileHandler);
  // Compatibility alias (for proxies that strip /api)
  server.get('/ui-profile', getUiProfileHandler);
  server.post('/ui-profile', postUiProfileHandler);

  // Best-effort UI error reporting endpoint (used by the web-admin in production).
  // Keep it lightweight: accept JSON, log, and return 204.
  const uiErrorsHandler = (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.warn(
        {
          request_id: request.id,
          path: request.raw?.url,
          ui_error: request.body,
        },
        'ui_error_report'
      );
    } catch {
      // ignore
    }
    void reply.status(204).send();
  };

  server.post('/api/ui-errors', uiErrorsHandler);
  server.post('/ui-errors', uiErrorsHandler);

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
