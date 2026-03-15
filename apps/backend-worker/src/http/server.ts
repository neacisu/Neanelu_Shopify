import { checkDatabaseConnection, pool, createManagedRedis } from '@app/database';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { isShopifyApiConfigValid } from '@app/config';
import { registerAuthRoutes } from '../auth/index.js';
import {
  createSessionToken,
  getDefaultSessionConfig,
  getSessionFromRequest,
  requireSession,
  type SessionConfig,
} from '../auth/session.js';
import { webhookRoutes } from '../routes/webhooks.js';
import { queueRoutes } from '../routes/queues.js';
import { dashboardRoutes } from '../routes/dashboard.js';
import { bulkRoutes } from '../routes/bulk.js';
import { searchRoutes } from '../routes/search.js';
import { productsRoutes } from '../routes/products.js';
import { similarityMatchesRoutes } from '../routes/similarity-matches.js';
import { consensusRoutes } from '../routes/consensus.js';
import { aiSettingsRoutes } from '../routes/ai-settings.js';
import { serperSettingsRoutes } from '../routes/serper-settings.js';
import { xaiSettingsRoutes } from '../routes/xai-settings.js';
import { geminiSettingsRoutes } from '../routes/gemini-settings.js';
import { deepseekSettingsRoutes } from '../routes/deepseek-settings.js';
import { selfhostedSettingsRoutes } from '../routes/selfhosted-settings.js';
import { scraperSettingsRoutes } from '../routes/scraper-settings.js';
import { shopSettingsRoutes } from '../routes/shop-settings.js';
import { connectionStatusRoutes } from '../routes/connection-status.js';
import { webhookSettingsRoutes } from '../routes/webhook-settings.js';
import { queueSettingsRoutes } from '../routes/queue-settings.js';
import { pimStatsRoutes } from '../routes/pim-stats.js';
import { qualityWebhookSettingsRoutes } from '../routes/quality-webhook-settings.js';
import { uxEventsRoutes } from '../routes/ux-events.js';
import { collectionsRoutes } from '../routes/collections.js';
import { pimConfigRoutes } from '../routes/pim-config.js';
import { pimLexRoutes } from '../routes/pim-lex.js';
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

function okOrFail(v: boolean): 'ok' | 'fail' {
  return v ? 'ok' : 'fail';
}

async function buildReadinessPayload(env: AppEnv): Promise<{
  statusCode: 200 | 503;
  status: 'ready' | 'not_ready';
  checks: Readonly<Record<string, 'ok' | 'fail'>>;
}> {
  const checkTimeoutMs = 1500;
  const [databaseOk, redisOk, shopifyOk, webhookQueueOk] = await Promise.all([
    withTimeout(checkDatabaseConnection(), checkTimeoutMs, 'database check').catch(() => false),
    checkRedisConnection(env.redisUrl, checkTimeoutMs),
    Promise.resolve(isShopifyApiConfigValid(process.env)),
    checkWebhookQueueFunctional(env, checkTimeoutMs),
  ]);

  const readiness = getWorkerReadiness();
  const { webhookWorkerOk, tokenHealthWorkerOk } = readiness;

  const checks: Record<string, 'ok' | 'fail'> = {
    database: okOrFail(databaseOk),
    redis: okOrFail(redisOk),
    shopify_api: okOrFail(shopifyOk),
    queue_webhook: okOrFail(webhookQueueOk),
    worker_webhook: okOrFail(webhookWorkerOk),
    worker_sync: okOrFail(Boolean(readiness.syncWorkerOk)),
    worker_enrichment: okOrFail(Boolean(readiness.enrichmentWorkerOk)),
    worker_similarity_search: okOrFail(Boolean(readiness.similaritySearchWorkerOk)),
    worker_ai_audit: okOrFail(Boolean(readiness.similarityAIAuditWorkerOk)),
    worker_extraction: okOrFail(Boolean(readiness.extractionWorkerOk)),
    worker_consensus: okOrFail(Boolean(readiness.consensusWorkerOk)),
    worker_mv_refresh: okOrFail(Boolean(readiness.mvRefreshSchedulerOk)),
    worker_quality_webhook: okOrFail(Boolean(readiness.qualityWebhookWorkerOk)),
    worker_quality_webhook_sweep: okOrFail(Boolean(readiness.qualityWebhookSweepSchedulerOk)),
    worker_budget_reset: okOrFail(Boolean(readiness.budgetResetSchedulerOk)),
    worker_weekly_summary: okOrFail(Boolean(readiness.weeklySummarySchedulerOk)),
    worker_auto_enrichment: okOrFail(Boolean(readiness.autoEnrichmentSchedulerOk)),
    worker_raw_harvest_retention: okOrFail(Boolean(readiness.rawHarvestRetentionSchedulerOk)),
    worker_lex_extract_fragments: okOrFail(Boolean(readiness.lexExtractFragmentsWorkerOk)),
    worker_lex_extract_entities: okOrFail(Boolean(readiness.lexExtractEntitiesWorkerOk)),
    worker_lex_mine_terms: okOrFail(Boolean(readiness.lexMineTermsWorkerOk)),
    worker_lex_aggregate_stats: okOrFail(Boolean(readiness.lexAggregateStatsWorkerOk)),
    worker_lex_build_contexts: okOrFail(Boolean(readiness.lexBuildContextsWorkerOk)),
    worker_lex_embed_contexts: okOrFail(Boolean(readiness.lexEmbedContextsWorkerOk)),
    worker_lex_cluster_senses: okOrFail(Boolean(readiness.lexClusterSensesWorkerOk)),
    worker_lex_resolve_attributes: okOrFail(Boolean(readiness.lexResolveAttributesWorkerOk)),
    worker_lex_translate_candidates: okOrFail(Boolean(readiness.lexTranslateCandidatesWorkerOk)),
    worker_lex_compose_localizations: okOrFail(Boolean(readiness.lexComposeLocalizationsWorkerOk)),
    worker_lex_review_enqueue: okOrFail(Boolean(readiness.lexReviewEnqueueWorkerOk)),
    worker_lex_publish: okOrFail(Boolean(readiness.lexPublishWorkerOk)),
    worker_lex_schedule: okOrFail(Boolean(readiness.lexScheduleWorkerOk)),
    worker_lex_retention: okOrFail(Boolean(readiness.lexRetentionWorkerOk)),
  };

  if (tokenHealthWorkerOk != null) {
    checks['worker_token_health'] = okOrFail(tokenHealthWorkerOk);
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');

  return {
    statusCode: allOk ? 200 : 503,
    status: allOk ? 'ready' : 'not_ready',
    checks,
  };
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

function statusCodeToErrorCode(statusCode: number): string {
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
}

function buildErrorHandler(
  env: AppEnv,
  logger: Logger
): (error: Error, request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (error, request, reply) => {
    logger.error({ requestId: request.id, error }, 'request failed');

    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    const statusCodeRaw = (error as { statusCode?: unknown }).statusCode;
    const statusCode = typeof statusCodeRaw === 'number' ? statusCodeRaw : 500;
    const errorCode = statusCodeToErrorCode(statusCode);

    const safeMessage =
      env.nodeEnv === 'production' && statusCode >= 500 ? 'Internal Server Error' : errorMessage;

    void reply.status(statusCode).send({
      success: false,
      error: {
        code: errorCode,
        message: safeMessage,
      },
      meta: {
        request_id: request.id,
        timestamp,
      },
    });
  };
}

function buildOnRequestHook(
  logger: Logger,
  startNsKey: symbol
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    reply.header('x-request-id', request.id);
    setRequestIdAttribute(request.id);

    httpActiveRequests.add(1);
    (request as unknown as Record<symbol, bigint>)[startNsKey] = process.hrtime.bigint();

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
  };
}

function buildOnResponseHook(
  logger: Logger,
  startNsKey: symbol
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
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
  };
}

function buildSessionTokenHandler(
  sessionConfig: SessionConfig
): (request: FastifyRequest, reply: FastifyReply) => void {
  return (request, reply) => {
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
}

const UI_PROFILE_COOKIE = 'neanelu_ui_profile';

function getOrCreateUiProfileId(request: FastifyRequest, reply: FastifyReply, env: AppEnv): string {
  const existing = request.cookies[UI_PROFILE_COOKIE];
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const id = randomUUID();
  const secure = env.appHost.protocol === 'https:';
  void reply.cookie(UI_PROFILE_COOKIE, id, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  });
  return id;
}

async function handleGetUiProfile(
  request: FastifyRequest,
  reply: FastifyReply,
  env: AppEnv,
  logger: Logger
): Promise<void> {
  const id = getOrCreateUiProfileId(request, reply, env);

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
}

async function handlePostUiProfile(
  request: FastifyRequest,
  reply: FastifyReply,
  env: AppEnv,
  logger: Logger
): Promise<void> {
  const id = getOrCreateUiProfileId(request, reply, env);

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
    connectionTimeout: 120_000,
    requestTimeout: 120_000,
    requestIdHeader: 'x-request-id',
    genReqId(req) {
      const header = req.headers['x-request-id'];
      if (typeof header === 'string' && header.trim()) return header.trim();
      return randomUUID();
    },
  });

  await server.register(fastifyCookie);
  await server.register(fastifyMultipart, {
    limits: {
      fileSize: 200 * 1024 * 1024,
    },
  });
  await server.register(fastifyWebsocket);
  await server.register(webhookRoutes, { prefix: '/webhooks', appLogger: logger });

  const startNsKey = Symbol('requestStartNs');

  server.addHook('onRequest', buildOnRequestHook(logger, startNsKey));
  server.addHook('onResponse', buildOnResponseHook(logger, startNsKey));
  server.setErrorHandler(buildErrorHandler(env, logger));

  server.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });

  server.get('/health/ready', async (_request, reply) => {
    const readiness = await buildReadinessPayload(env);
    return reply
      .status(readiness.statusCode)
      .send({ status: readiness.status, checks: readiness.checks });
  });

  registerAuthRoutes(server, { env, logger });

  server.get('/', async (request, reply) => {
    const rawUrl = request.raw.url;
    const url = typeof rawUrl === 'string' && rawUrl.length > 0 ? rawUrl : '/';
    const withLeadingSlash = url.startsWith('/') ? url : `/${url}`;
    const target = `/app${withLeadingSlash}`;
    return reply.redirect(target);
  });

  server.get('/favicon.ico', async (_request, reply) => {
    return reply.redirect('/app/favicon.png');
  });

  const sessionConfig = getDefaultSessionConfig(env.shopifyApiSecret, env.shopifyApiKey);

  // Admin APIs (used by web-admin)
  // Primary mounting under /api/*
  await server.register(queueRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(dashboardRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(bulkRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(searchRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(productsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(similarityMatchesRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(consensusRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(pimStatsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(aiSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(serperSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(xaiSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(geminiSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(deepseekSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(selfhostedSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(scraperSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(shopSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(connectionStatusRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(webhookSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(queueSettingsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(qualityWebhookSettingsRoutes, {
    prefix: '/api',
    env,
    logger,
    sessionConfig,
  });
  await server.register(uxEventsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(collectionsRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(pimConfigRoutes, { prefix: '/api', env, logger, sessionConfig });
  await server.register(pimLexRoutes, { prefix: '/api', env, logger, sessionConfig });

  // Compatibility mounting without /api prefix.
  // Some reverse proxies (or legacy deployments) may strip `/api` before forwarding.
  // All endpoints remain protected by `requireSession()` inside the plugin.
  await server.register(queueRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(dashboardRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(bulkRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(searchRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(productsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(similarityMatchesRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(consensusRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(pimStatsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(aiSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(serperSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(xaiSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(geminiSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(deepseekSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(selfhostedSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(scraperSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(shopSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(connectionStatusRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(webhookSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(queueSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(qualityWebhookSettingsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(uxEventsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(collectionsRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(pimConfigRoutes, { prefix: '', env, logger, sessionConfig });
  await server.register(pimLexRoutes, { prefix: '', env, logger, sessionConfig });

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

  server.get('/api/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });

  server.get('/api/health/ready', async (_request, reply) => {
    const readiness = await buildReadinessPayload(env);
    return reply
      .status(readiness.statusCode)
      .send({ status: readiness.status, checks: readiness.checks });
  });

  const sessionTokenHandler = buildSessionTokenHandler(sessionConfig);
  server.get('/api/session/token', sessionTokenHandler);
  server.get('/session/token', sessionTokenHandler);

  const getUiProfileHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    await handleGetUiProfile(request, reply, env, logger);
  };
  const postUiProfileHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    await handlePostUiProfile(request, reply, env, logger);
  };

  server.get('/api/ui-profile', getUiProfileHandler);
  server.post('/api/ui-profile', postUiProfileHandler);
  server.get('/ui-profile', getUiProfileHandler);
  server.post('/ui-profile', postUiProfileHandler);

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

async function checkRedisConnection(_redisUrl: string, timeoutMs = 1500): Promise<boolean> {
  const client = createManagedRedis('health-ready-redis', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('redis check timeout')), timeoutMs).unref();
  });

  try {
    const pong = await Promise.race([client.ping(), timeout]);
    return pong === 'PONG';
  } catch {
    return false;
  }
}
