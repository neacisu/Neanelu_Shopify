import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import { configFromEnv, createQueue, createRedisConnection } from '@app/queue-manager';
import type {
  DashboardActivityResponse,
  DashboardAlertsResponse,
  DashboardStartSyncResponse,
  DashboardClearCacheResponse,
  DashboardAlert,
  DashboardSummaryResponse,
  DashboardSummaryTrendResponse,
  DashboardSummaryTrendPoint,
  DashboardHealthScoreResponse,
} from '@app/types';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Redis as RedisClient } from 'ioredis';
import type { SessionConfig } from '../auth/session.js';
import { requireSession, getSessionFromRequest } from '../auth/session.js';
import { activityKeyForUtcDate, formatUtcDate } from '../runtime/dashboard-activity.js';
import { getHttpLatencySnapshot } from '../runtime/http-latency.js';

type DashboardPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

const DASHBOARD_QUEUE_NAMES = [
  'webhook-queue',
  'sync-queue',
  'bulk-queue',
  'ai-batch-queue',
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
  } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
    status,
  } as const;
}

function parseIntParam(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function pingRedis(redis: RedisClient, timeoutMs = 1500): Promise<boolean> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('redis ping timeout')), timeoutMs).unref();
  });
  try {
    await Promise.race([redis.ping(), timeout]);
    return true;
  } catch {
    return false;
  }
}

async function getPendingJobsBacklog(env: AppEnv): Promise<number> {
  const qmOptions = { config: configFromEnv(env) };
  let total = 0;

  for (const name of DASHBOARD_QUEUE_NAMES) {
    const queue = createQueue(qmOptions, { name });
    try {
      const counts = await queue.getJobCounts('waiting', 'delayed');
      total += (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0);
    } finally {
      await queue.close().catch(() => undefined);
    }
  }

  return total;
}

const START_SYNC_QUEUE_NAME = 'sync-queue';
const START_SYNC_JOB_NAME = 'manual-sync';

const START_SYNC_COOLDOWN_SECONDS = 60 * 60; // max 1/hour
const START_SYNC_COOLDOWN_KEY_PREFIX = 'dashboard:start-sync:cooldown:v1:';

const CLEAR_CACHE_MAX_KEYS = 2000;
const CLEAR_CACHE_SCAN_COUNT = 500;
const CLEAR_CACHE_ALLOWED_PATTERNS = new Set<string>([
  'dashboard:*',
  'cache:*',
  'shopify:*',
  'neanelu:*',
]);

type ClearCacheBody = Readonly<{
  confirm?: unknown;
  patterns?: unknown;
}>;

function normalizePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

async function scanDeletePattern(redis: RedisClient, pattern: string, maxKeys: number) {
  let cursor = '0';
  let deleted = 0;

  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', CLEAR_CACHE_SCAN_COUNT);
    const nextCursor = result?.[0];
    const keys = result?.[1] ?? [];

    if (keys.length) {
      const remaining = Math.max(0, maxKeys - deleted);
      const toDelete = keys.slice(0, remaining);
      if (toDelete.length) {
        const pipeline = redis.pipeline();
        for (const k of toDelete) pipeline.del(k);
        const exec = await pipeline.exec();
        deleted +=
          exec?.reduce((acc, item) => {
            const n = Array.isArray(item) ? item[1] : 0;
            return acc + (typeof n === 'number' ? n : 0);
          }, 0) ?? 0;
      }
    }

    cursor = typeof nextCursor === 'string' ? nextCursor : '0';
  } while (cursor !== '0' && deleted < maxKeys);

  return deleted;
}

export const dashboardRoutes: FastifyPluginAsync<DashboardPluginOptions> = (
  server: FastifyInstance,
  opts
): Promise<void> => {
  const { env, logger, sessionConfig } = opts;
  const keyPrefix = env.redisPrefix;

  const redis = createRedisConnection({
    redisUrl: env.redisUrl,
    redisOptions: {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    },
  });

  redis.on('error', (error: unknown) => {
    logger.warn({ error }, 'Redis error (dashboard)');
  });

  server.addHook('onClose', async () => {
    await redis.quit().catch(() => undefined);
  });

  const requireAdminSession = { preHandler: requireSession(sessionConfig) } as const;

  server.get('/dashboard/summary', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString();

    const [dbSummary, queueBacklog] = await Promise.all([
      withTenantContext(session.shopId, async (client) => {
        const [
          productsResult,
          activeBulkRunsResult,
          apiTotalsResult,
          apiLatencyResult,
          qualityResult,
          lastSyncResult,
          enrichmentResult,
          aiCostResult,
        ] = await Promise.all([
          client.query<{ total_products: string }>(
            `SELECT COUNT(*)::text as total_products
               FROM shopify_products
              WHERE shop_id = $1`,
            [session.shopId]
          ),
          client.query<{ active_runs: string }>(
            `SELECT COUNT(*)::text as active_runs
               FROM bulk_runs
              WHERE shop_id = $1
                AND status IN ('pending', 'running')`,
            [session.shopId]
          ),
          client.query<{ total_count: string; error_count: string }>(
            `SELECT
                 COALESCE(SUM(request_count), 0)::text as total_count,
                 COALESCE(
                   SUM(CASE WHEN http_status >= 400 THEN request_count ELSE 0 END),
                   0
                 )::text as error_count
               FROM api_usage_log
              WHERE shop_id = $1
                AND created_at >= $2`,
            [session.shopId, since]
          ),
          client.query<{ p95_ms: number | null }>(
            `SELECT
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95_ms
               FROM api_usage_log
              WHERE shop_id = $1
                AND created_at >= $2
                AND response_time_ms IS NOT NULL`,
            [session.shopId, since]
          ),
          client.query<{ golden_count: string; total_count: string; avg_score: string }>(
            `SELECT
                 COALESCE(SUM(CASE WHEN quality_level = 'golden' THEN 1 ELSE 0 END), 0)::text as golden_count,
                 COUNT(*)::text as total_count,
                 COALESCE(AVG(quality_score), 0)::text as avg_score
               FROM shopify_products
              WHERE shop_id = $1`,
            [session.shopId]
          ),
          client.query<{ started_at: string | null; status: string | null }>(
            `SELECT started_at::text, status
               FROM bulk_runs
              WHERE shop_id = $1
              ORDER BY started_at DESC NULLS LAST
              LIMIT 1`,
            [session.shopId]
          ),
          client.query<{ success_count: string; total_count: string }>(
            `SELECT
                 COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)::text as success_count,
                 COUNT(*)::text as total_count
               FROM enrichment_jobs
              WHERE shop_id = $1
                AND created_at >= $2`,
            [session.shopId, since]
          ),
          client.query<{ total_cost: string }>(
            `SELECT COALESCE(SUM(cost_usd), 0)::text as total_cost
               FROM api_usage_log
              WHERE shop_id = $1
                AND created_at >= $2
                AND cost_usd IS NOT NULL`,
            [session.shopId, todayStart]
          ),
        ]);

        const totalProducts = Number(productsResult.rows[0]?.total_products ?? 0);
        const activeBulkRuns = Number(activeBulkRunsResult.rows[0]?.active_runs ?? 0);

        const totalApiCount = Number(apiTotalsResult.rows[0]?.total_count ?? 0);
        const errorApiCount = Number(apiTotalsResult.rows[0]?.error_count ?? 0);
        const apiErrorRate = totalApiCount > 0 ? errorApiCount / totalApiCount : null;

        const apiLatencyP95MsRaw = apiLatencyResult.rows[0]?.p95_ms;
        const apiLatencyP95Ms = typeof apiLatencyP95MsRaw === 'number' ? apiLatencyP95MsRaw : null;

        const goldenCount = Number(qualityResult.rows[0]?.golden_count ?? 0);
        const qualityTotal = Number(qualityResult.rows[0]?.total_count ?? 0);
        const goldenRate = qualityTotal > 0 ? goldenCount / qualityTotal : 0;
        const avgQualityScore = Number(qualityResult.rows[0]?.avg_score ?? 0);

        const lastSyncRow = lastSyncResult.rows[0];
        const lastSyncAt = lastSyncRow?.started_at ?? null;
        const lastSyncStatus = lastSyncRow?.status ?? null;

        const enrichSuccessCount = Number(enrichmentResult.rows[0]?.success_count ?? 0);
        const enrichTotalCount = Number(enrichmentResult.rows[0]?.total_count ?? 0);
        const enrichmentSuccessRate =
          enrichTotalCount > 0 ? enrichSuccessCount / enrichTotalCount : 0;

        const todayAiCost = Number(aiCostResult.rows[0]?.total_cost ?? 0);

        return {
          totalProducts,
          activeBulkRuns,
          apiErrorRate,
          apiLatencyP95Ms,
          goldenCount,
          goldenRate,
          avgQualityScore,
          lastSyncAt,
          lastSyncStatus,
          enrichmentSuccessRate,
          todayAiCost,
        };
      }),
      getPendingJobsBacklog(env).catch((error: unknown) => {
        logger.warn({ error }, 'Error computing queue backlog for summary');
        return 0;
      }),
    ]);

    const todayKey = activityKeyForUtcDate(now, keyPrefix);
    let todayWebhooks = 0;
    try {
      const raw = await redis.hget(todayKey, 'webhook');
      todayWebhooks = raw ? Number(raw) || 0 : 0;
    } catch {
      // ignore
    }

    const summary: DashboardSummaryResponse = {
      ...dbSummary,
      todayWebhooks,
      queueBacklog,
    };

    void reply.status(200).send(successEnvelope(request.id, summary));
  });

  server.get('/dashboard/summary/trend', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const days = parseIntParam((request.query as { days?: unknown }).days, 7, 1, 14);
    const now = new Date();

    const points: DashboardSummaryTrendPoint[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = formatUtcDate(d);
      const dayEnd = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const dayData = await withTenantContext(session.shopId, async (client) => {
        const [productsRes, qualityRes, enrichRes, apiRes, costRes] = await Promise.all([
          client.query<{ cnt: string }>(
            `SELECT COUNT(*)::text as cnt FROM shopify_products WHERE shop_id = $1 AND created_at < $2`,
            [session.shopId, dayEnd]
          ),
          client.query<{ golden: string; total: string; avg_score: string }>(
            `SELECT
               COALESCE(SUM(CASE WHEN quality_level = 'golden' THEN 1 ELSE 0 END), 0)::text as golden,
               COUNT(*)::text as total,
               COALESCE(AVG(quality_score), 0)::text as avg_score
             FROM shopify_products WHERE shop_id = $1 AND created_at < $2`,
            [session.shopId, dayEnd]
          ),
          client.query<{ success_count: string; total_count: string }>(
            `SELECT
               COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)::text as success_count,
               COUNT(*)::text as total_count
             FROM enrichment_jobs
             WHERE shop_id = $1 AND created_at >= $2 AND created_at < $3`,
            [session.shopId, d.toISOString(), dayEnd]
          ),
          client.query<{ total_count: string; error_count: string }>(
            `SELECT
               COALESCE(SUM(request_count), 0)::text as total_count,
               COALESCE(SUM(CASE WHEN http_status >= 400 THEN request_count ELSE 0 END), 0)::text as error_count
             FROM api_usage_log
             WHERE shop_id = $1 AND created_at >= $2 AND created_at < $3`,
            [session.shopId, d.toISOString(), dayEnd]
          ),
          client.query<{ total_cost: string }>(
            `SELECT COALESCE(SUM(cost_usd), 0)::text as total_cost
             FROM api_usage_log
             WHERE shop_id = $1 AND created_at >= $2 AND created_at < $3 AND cost_usd IS NOT NULL`,
            [session.shopId, d.toISOString(), dayEnd]
          ),
        ]);

        const totalProducts = Number(productsRes.rows[0]?.cnt ?? 0);
        const golden = Number(qualityRes.rows[0]?.golden ?? 0);
        const total = Number(qualityRes.rows[0]?.total ?? 0);
        const goldenRate = total > 0 ? golden / total : 0;
        const avgQualityScore = Number(qualityRes.rows[0]?.avg_score ?? 0);

        const enrichSuccess = Number(enrichRes.rows[0]?.success_count ?? 0);
        const enrichTotal = Number(enrichRes.rows[0]?.total_count ?? 0);
        const enrichmentSuccessRate = enrichTotal > 0 ? enrichSuccess / enrichTotal : 0;

        const apiTotal = Number(apiRes.rows[0]?.total_count ?? 0);
        const apiErrors = Number(apiRes.rows[0]?.error_count ?? 0);
        const apiErrorRate = apiTotal > 0 ? apiErrors / apiTotal : 0;

        const todayAiCost = Number(costRes.rows[0]?.total_cost ?? 0);

        return {
          totalProducts,
          goldenRate,
          avgQualityScore,
          enrichmentSuccessRate,
          apiErrorRate,
          todayAiCost,
        };
      });

      points.push({
        date: dateStr,
        ...dayData,
        queueBacklog: 0,
      });
    }

    void reply
      .status(200)
      .send(successEnvelope(request.id, { days, points } satisfies DashboardSummaryTrendResponse));
  });

  server.get('/dashboard/health-score', requireAdminSession, async (request, reply) => {
    const redisOk = await pingRedis(redis, 1500);
    const redisScore = redisOk ? 25 : 0;

    const latencySnap = getHttpLatencySnapshot();
    const latencyMs = latencySnap.sampleCount > 0 ? latencySnap.p95Seconds * 1000 : 0;
    const latencyScore = latencyMs <= 500 ? 25 : latencyMs <= 1000 ? 15 : latencyMs <= 2000 ? 5 : 0;

    let errorRateValue = 0;
    let errorRateScore = 25;
    try {
      const session = getSessionFromRequest(request, sessionConfig);
      if (session) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const result = await withTenantContext(session.shopId, async (client) => {
          return client.query<{ total_count: string; error_count: string }>(
            `SELECT
               COALESCE(SUM(request_count), 0)::text as total_count,
               COALESCE(SUM(CASE WHEN http_status >= 400 THEN request_count ELSE 0 END), 0)::text as error_count
             FROM api_usage_log WHERE shop_id = $1 AND created_at >= $2`,
            [session.shopId, since]
          );
        });
        const total = Number(result.rows[0]?.total_count ?? 0);
        const errors = Number(result.rows[0]?.error_count ?? 0);
        errorRateValue = total > 0 ? errors / total : 0;
        errorRateScore =
          errorRateValue < 0.05 ? 25 : errorRateValue < 0.1 ? 15 : errorRateValue < 0.2 ? 5 : 0;
      }
    } catch {
      errorRateScore = 12;
    }

    const backlog = await getPendingJobsBacklog(env).catch(() => 0);
    const backlogScore = backlog < 100 ? 25 : backlog < 500 ? 15 : backlog < 1000 ? 5 : 0;

    const score = redisScore + latencyScore + errorRateScore + backlogScore;
    const status: 'healthy' | 'degraded' | 'critical' =
      score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'critical';

    const response: DashboardHealthScoreResponse = {
      score,
      components: {
        redis: { ok: redisOk, score: redisScore },
        errorRate: { value: errorRateValue, score: errorRateScore },
        latency: { valueMs: latencyMs, score: latencyScore },
        backlog: { count: backlog, score: backlogScore },
      },
      status,
    };

    void reply.status(200).send(successEnvelope(request.id, response));
  });

  server.get('/dashboard/activity', requireAdminSession, async (request, reply) => {
    const days = parseIntParam((request.query as { days?: unknown }).days, 7, 1, 30);

    const points: DashboardActivityResponse['points'][number][] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      d.setUTCDate(d.getUTCDate() - i);
      const key = activityKeyForUtcDate(d, keyPrefix);
      const hash = await redis.hgetall(key);

      const get = (field: string) => {
        const raw = hash?.[field];
        const n = typeof raw === 'string' ? Number(raw) : 0;
        return Number.isFinite(n) ? n : 0;
      };

      const sync = get('sync');
      const webhook = get('webhook');
      const bulk = get('bulk');
      const aiBatch = get('ai-batch');
      const total = get('total') || sync + webhook + bulk + aiBatch;

      const date = formatUtcDate(d);
      points.push({
        date,
        timestamp: new Date(`${date}T00:00:00.000Z`).toISOString(),
        total,
        breakdown: { sync, webhook, bulk, aiBatch },
      });
    }

    void reply
      .status(200)
      .send(successEnvelope(request.id, { days, points } satisfies DashboardActivityResponse));
  });

  server.get('/dashboard/alerts', requireAdminSession, async (request, reply) => {
    const alerts: DashboardAlert[] = [];

    const redisOk = await pingRedis(redis, 1500);
    if (!redisOk) {
      alerts.push({
        id: 'redis_down',
        severity: 'critical',
        title: 'Redis down',
        description: 'Redis is not reachable. Caches, queues, and webhook dedupe may be degraded.',
      });
    }

    const latency = getHttpLatencySnapshot();
    if (latency.sampleCount >= 20 && latency.p95Seconds > 2) {
      alerts.push({
        id: 'api_slow',
        severity: 'warning',
        title: 'API slow',
        description: 'Recent API latency is above threshold (p95 > 2s).',
        details: {
          p95Seconds: latency.p95Seconds,
          windowMs: latency.windowMs,
          sampleCount: latency.sampleCount,
        },
      });
    }

    const backlog = await getPendingJobsBacklog(env).catch((error: unknown) => {
      logger.warn({ error }, 'Error computing queue backlog');
      return 0;
    });
    if (backlog > 1000) {
      alerts.push({
        id: 'jobs_backlog',
        severity: 'warning',
        title: 'Jobs backlog',
        description: `High pending backlog detected (${backlog} waiting/delayed).`,
        details: { backlog },
      });
    }

    const visible = alerts.slice(0, 3);
    void reply
      .status(200)
      .send(successEnvelope(request.id, { alerts: visible } satisfies DashboardAlertsResponse));
  });

  server.post('/dashboard/actions/start-sync', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const cooldownKey = `${keyPrefix}${START_SYNC_COOLDOWN_KEY_PREFIX}${session.shopId}`;
    const ok = await redis.set(cooldownKey, '1', 'EX', START_SYNC_COOLDOWN_SECONDS, 'NX');
    if (ok !== 'OK') {
      void reply
        .status(429)
        .send(
          errorEnvelope(
            request.id,
            429,
            'TOO_MANY_REQUESTS',
            'Start Sync is rate-limited (max 1/hour).'
          )
        );
      return;
    }

    const qmOptions = { config: configFromEnv(env) };
    const queue = createQueue(qmOptions, { name: START_SYNC_QUEUE_NAME });
    const jobId = `manual-sync:${session.shopId}:${Math.floor(Date.now() / 1000)}`;

    try {
      await queue.add(
        START_SYNC_JOB_NAME,
        { shopId: session.shopId, requestedAt: Date.now() },
        {
          jobId,
          removeOnComplete: 50,
          removeOnFail: 200,
          attempts: 1,
        }
      );

      void reply.status(200).send(
        successEnvelope(request.id, {
          enqueued: true,
          jobId,
          queue: START_SYNC_QUEUE_NAME,
        } satisfies DashboardStartSyncResponse)
      );
    } finally {
      await queue.close().catch(() => undefined);
    }
  });

  server.post('/dashboard/actions/clear-cache', requireAdminSession, async (request, reply) => {
    const body = (request.body ?? {}) as ClearCacheBody;
    const confirm = body.confirm === true;
    if (!confirm) {
      void reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Clear Cache requires explicit confirmation.'
          )
        );
      return;
    }

    const patterns = normalizePatterns(body.patterns);
    const allowed = patterns.filter((p) => CLEAR_CACHE_ALLOWED_PATTERNS.has(p));
    if (!allowed.length) {
      void reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            `No allowed patterns provided. Allowed: ${Array.from(CLEAR_CACHE_ALLOWED_PATTERNS).join(', ')}`
          )
        );
      return;
    }

    const expandPattern = (pattern: string) => {
      if (pattern.startsWith(keyPrefix)) return pattern;
      if (pattern === 'neanelu:*') return `${keyPrefix}*`;
      return `${keyPrefix}${pattern}`;
    };

    let deletedKeys = 0;
    for (const rawPattern of allowed) {
      const remaining = Math.max(0, CLEAR_CACHE_MAX_KEYS - deletedKeys);
      if (!remaining) break;
      deletedKeys += await scanDeletePattern(redis, expandPattern(rawPattern), remaining);
    }

    const truncated = deletedKeys >= CLEAR_CACHE_MAX_KEYS;
    void reply.status(200).send(
      successEnvelope(request.id, {
        deletedKeys,
        truncated,
      } satisfies DashboardClearCacheResponse)
    );
  });

  return Promise.resolve();
};
