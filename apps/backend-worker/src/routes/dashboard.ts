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

// Local list to avoid depending on dist exports of @app/queue-manager during tests.
const DASHBOARD_QUEUE_NAMES = [
  'webhook-queue',
  'sync-queue',
  'bulk-queue',
  'ai-batch-queue',
] as const;

type DashboardSummaryResponse = Readonly<{
  totalProducts: number;
  activeBulkRuns: number;
  apiErrorRate: number | null;
  apiLatencyP95Ms: number | null;
}>;

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
  'neanelu:*',
  'shopify:*',
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
        // `del` returns integer per key.
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

  const redis = createRedisConnection({
    redisUrl: env.redisUrl,
    redisOptions: {
      // Avoid eager connect during server startup (especially in tests/CI).
      lazyConnect: true,
      // Keep individual route calls from hanging when Redis is down.
      maxRetriesPerRequest: 1,
    },
  });

  // Prevent noisy/"Unhandled error event" logs from ioredis when Redis is not reachable.
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

    const summary = await withTenantContext(session.shopId, async (client) => {
      const [productsResult, activeBulkRunsResult, apiTotalsResult, apiLatencyResult] =
        await Promise.all([
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
        ]);

      const totalProducts = Number(productsResult.rows[0]?.total_products ?? 0);
      const activeBulkRuns = Number(activeBulkRunsResult.rows[0]?.active_runs ?? 0);

      const totalCount = Number(apiTotalsResult.rows[0]?.total_count ?? 0);
      const errorCount = Number(apiTotalsResult.rows[0]?.error_count ?? 0);
      const apiErrorRate = totalCount > 0 ? errorCount / totalCount : null;

      const apiLatencyP95MsRaw = apiLatencyResult.rows[0]?.p95_ms;
      const apiLatencyP95Ms = typeof apiLatencyP95MsRaw === 'number' ? apiLatencyP95MsRaw : null;

      return {
        totalProducts,
        activeBulkRuns,
        apiErrorRate,
        apiLatencyP95Ms,
      } satisfies DashboardSummaryResponse;
    });

    void reply.status(200).send(successEnvelope(request.id, summary));
  });

  server.get('/dashboard/activity', requireAdminSession, async (request, reply) => {
    const days = parseIntParam((request.query as { days?: unknown }).days, 7, 1, 30);

    const points: DashboardActivityResponse['points'][number][] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      d.setUTCDate(d.getUTCDate() - i);
      const key = activityKeyForUtcDate(d);
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

    // Restrict: max 3 alerts visible.
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

    const cooldownKey = `${START_SYNC_COOLDOWN_KEY_PREFIX}${session.shopId}`;
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

    let deletedKeys = 0;
    for (const pattern of allowed) {
      const remaining = Math.max(0, CLEAR_CACHE_MAX_KEYS - deletedKeys);
      if (!remaining) break;
      deletedKeys += await scanDeletePattern(redis, pattern, remaining);
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
