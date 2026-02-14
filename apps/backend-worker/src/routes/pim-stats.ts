import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTenantContext } from '@app/database';
import { configFromEnv, createQueue, ENRICHMENT_QUEUE_NAME } from '@app/queue-manager';
import { checkAllBudgets } from '@app/pim';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { recordPimQueuePaused, recordPimQueueResumed } from '../otel/metrics.js';
import {
  pauseCostSensitiveQueues,
  readCostSensitiveQueueStatus,
  resumeCostSensitiveQueues,
} from '../processors/pim/cost-sensitive-queues.js';

interface PimStatsPluginOptions {
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}

interface RequestWithSession {
  session?: {
    shopId: string;
  };
}

type WsConnection = Readonly<{
  socket: {
    readyState: number;
    send: (data: string) => void;
    ping: () => void;
    close: (code?: number, reason?: string) => void;
    on: (event: 'close' | 'error', listener: () => void) => void;
  };
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

function parseDateParam(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

const API_CACHE_TTL_MS = 60_000;
const API_CACHE_MAX_ENTRIES = 100;
const pimStatsCache = new Map<string, { data: unknown; expiresAt: number }>();

function buildCacheKey(routePath: string, shopId: string, params: Record<string, unknown>): string {
  return `${routePath}:${shopId}:${JSON.stringify(params)}`;
}

function getCached<T>(key: string): T | null {
  const entry = pimStatsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pimStatsCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached(key: string, data: unknown): void {
  pimStatsCache.set(key, { data, expiresAt: Date.now() + API_CACHE_TTL_MS });

  if (pimStatsCache.size <= API_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [cacheKey, entry] of pimStatsCache.entries()) {
    if (entry.expiresAt <= now) pimStatsCache.delete(cacheKey);
  }
}

export async function fetchScraperEventsSince(params: {
  client: {
    query: <T>(sql: string, values: unknown[]) => Promise<{ rows: T[] }>;
  };
  shopId: string;
  lastSeenAt: string;
}): Promise<
  {
    id: string;
    status: string;
    method: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    target_urls: string[] | null;
  }[]
> {
  const result = await params.client.query<{
    id: string;
    status: string;
    method: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    target_urls: string[] | null;
  }>(
    `SELECT id, status, method, started_at::text, completed_at::text, created_at::text, target_urls
     FROM scraper_runs
     WHERE shop_id = $1
       AND COALESCE(completed_at, started_at, created_at) > $2::timestamptz
     ORDER BY COALESCE(completed_at, started_at, created_at) ASC
     LIMIT 100`,
    [params.shopId, params.lastSeenAt]
  );
  return result.rows;
}

export const pimStatsRoutes: FastifyPluginAsync<PimStatsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { logger, sessionConfig, env } = options;

  server.get(
    '/pim/stats/enrichment-progress',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const query = request.query as { from?: string; to?: string };
      const parsedFrom = parseDateParam(query.from);
      const parsedTo = parseDateParam(query.to);
      const cacheKey = buildCacheKey('/pim/stats/enrichment-progress', session.shopId, {
        from: parsedFrom,
        to: parsedTo,
      });
      const cached = getCached<{
        pending: number;
        inProgress: number;
        completedToday: number;
        completedThisWeek: number;
        successRate: number;
        avgProcessingTime: number | null;
        pipelineStages: {
          id: string;
          name: string;
          count: number;
          status: 'idle' | 'active' | 'bottleneck';
          avgDuration: number | null;
        }[];
        trendPoints: { date: string; pending: number; completed: number }[];
        trendsData: { pending: number[]; completed: number[] };
        trendRange: { from: string; to: string } | null;
        sourcePerformance: {
          provider: string;
          totalRequests: number;
          totalCost: number;
          avgLatencyMs: number;
          successRate: number;
        }[];
        totals: {
          totalProducts: number;
          productsWithMatches: number;
          productsWithSpecs: number;
          totalMatches: number;
          confirmedMatches: number;
          pendingMatches: number;
          rejectedMatches: number;
        };
      }>(cacheKey);
      if (cached) {
        return reply.send(successEnvelope(request.id, cached));
      }

      try {
        const data = await withTenantContext(session.shopId, async (client) => {
          const rangeResult = await client.query<{
            min_date: string | null;
            max_date: string | null;
          }>(
            `SELECT
               MIN(created_at)::timestamptz as min_date,
               MAX(created_at)::timestamptz as max_date
             FROM (
               SELECT psm.created_at
                 FROM prod_similarity_matches psm
                 JOIN prod_channel_mappings pcm
                   ON pcm.product_id = psm.product_id
                  AND pcm.shop_id = $1
                  AND pcm.channel = 'shopify'
               UNION ALL
               SELECT psn.created_at
                 FROM prod_specs_normalized psn
                 JOIN prod_channel_mappings pcm
                   ON pcm.product_id = psn.product_id
                  AND pcm.shop_id = $1
                  AND pcm.channel = 'shopify'
               UNION ALL
               SELECT aul.created_at
                 FROM api_usage_log aul
                WHERE aul.shop_id = $1
             ) as dates`,
            [session.shopId]
          );
          const rangeRow = rangeResult.rows[0];
          const nowIso = new Date().toISOString();
          const from = parsedFrom ?? rangeRow?.min_date ?? nowIso;
          const to = parsedTo ?? rangeRow?.max_date ?? nowIso;
          const [
            totalsResult,
            matchesResult,
            specsResult,
            completedTodayResult,
            completedWeekResult,
            trendResult,
            avgLatencyResult,
            sourcePerfResult,
            stageDurationResult,
          ] = await Promise.all([
            client.query<{ total_products: string }>(
              `SELECT COUNT(DISTINCT pcm.product_id)::text as total_products
                   FROM prod_channel_mappings pcm
                  WHERE pcm.shop_id = $1
                    AND pcm.channel = 'shopify'`,
              [session.shopId]
            ),
            client.query<{
              total_matches: string;
              confirmed_matches: string;
              pending_matches: string;
              rejected_matches: string;
              products_with_matches: string;
            }>(
              `SELECT
                   COUNT(psm.id)::text as total_matches,
                   COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'confirmed')::text as confirmed_matches,
                   COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'pending')::text as pending_matches,
                   COUNT(psm.id) FILTER (WHERE psm.match_confidence = 'rejected')::text as rejected_matches,
                   COUNT(DISTINCT psm.product_id)::text as products_with_matches
                 FROM prod_similarity_matches psm
                 JOIN prod_channel_mappings pcm
                   ON pcm.product_id = psm.product_id
                  AND pcm.shop_id = $1
                  AND pcm.channel = 'shopify'`,
              [session.shopId]
            ),
            client.query<{ products_with_specs: string }>(
              `SELECT COUNT(DISTINCT pes.product_id)::text as products_with_specs
                   FROM prod_specs_normalized pes
                   JOIN prod_channel_mappings pcm
                     ON pcm.product_id = pes.product_id
                    AND pcm.shop_id = $1
                    AND pcm.channel = 'shopify'
                  WHERE pes.is_current = true`,
              [session.shopId]
            ),
            client.query<{ completed_today: string }>(
              `SELECT COUNT(DISTINCT pes.product_id)::text as completed_today
                 FROM prod_specs_normalized pes
                 JOIN prod_channel_mappings pcm
                   ON pcm.product_id = pes.product_id
                  AND pcm.shop_id = $1
                  AND pcm.channel = 'shopify'
                WHERE pes.is_current = true
                  AND pes.created_at >= date_trunc('day', now())
                  AND pes.created_at < date_trunc('day', now()) + interval '1 day'`,
              [session.shopId]
            ),
            client.query<{ completed_week: string }>(
              `SELECT COUNT(DISTINCT pes.product_id)::text as completed_week
                 FROM prod_specs_normalized pes
                 JOIN prod_channel_mappings pcm
                   ON pcm.product_id = pes.product_id
                  AND pcm.shop_id = $1
                  AND pcm.channel = 'shopify'
                WHERE pes.is_current = true
                  AND pes.created_at >= date_trunc('week', now())
                  AND pes.created_at < date_trunc('week', now()) + interval '7 days'`,
              [session.shopId]
            ),
            client.query<{
              day: string;
              pending: string;
              completed: string;
            }>(
              `WITH params AS (
                 SELECT
                   date_trunc('day', $1::timestamptz) as from_day,
                   date_trunc('day', $2::timestamptz) as to_day
               ),
               days AS (
                 SELECT generate_series(
                   (SELECT from_day FROM params),
                   (SELECT to_day FROM params),
                   interval '1 day'
                 )::date as day
               ),
               pending AS (
                 SELECT DATE(psm.created_at) as day, COUNT(*)::text as count
                   FROM prod_similarity_matches psm
                   JOIN prod_channel_mappings pcm
                     ON pcm.product_id = psm.product_id
                    AND pcm.shop_id = $3
                    AND pcm.channel = 'shopify'
                  WHERE psm.match_confidence = 'pending'
                    AND psm.created_at >= $1
                    AND psm.created_at <= $2
                  GROUP BY DATE(psm.created_at)
               ),
               completed AS (
                 SELECT DATE(psn.created_at) as day, COUNT(*)::text as count
                   FROM prod_specs_normalized psn
                   JOIN prod_channel_mappings pcm
                     ON pcm.product_id = psn.product_id
                    AND pcm.shop_id = $3
                    AND pcm.channel = 'shopify'
                  WHERE psn.is_current = true
                    AND psn.created_at >= $1
                    AND psn.created_at <= $2
                  GROUP BY DATE(psn.created_at)
               )
               SELECT
                 days.day::text as day,
                 COALESCE(pending.count, '0') as pending,
                 COALESCE(completed.count, '0') as completed
               FROM days
               LEFT JOIN pending ON pending.day = days.day
               LEFT JOIN completed ON completed.day = days.day
               ORDER BY days.day ASC`,
              [from, to, session.shopId]
            ),
            client.query<{ avg_latency_ms: string | null }>(
              `SELECT AVG(response_time_ms)::text as avg_latency_ms
                 FROM api_usage_log
                WHERE shop_id = $3
                  AND api_provider = 'xai'
                  AND endpoint = 'extract-product'
                  AND created_at >= $1
                  AND created_at <= $2`,
              [from, to, session.shopId]
            ),
            client.query<{
              api_provider: string;
              total_requests: string;
              total_cost: string;
              avg_latency_ms: string | null;
              success_count: string;
            }>(
              `SELECT
                 api_provider,
                 COUNT(*)::text as total_requests,
                 COALESCE(SUM(estimated_cost), 0)::text as total_cost,
                 AVG(response_time_ms)::text as avg_latency_ms,
                 COALESCE(SUM(CASE WHEN http_status < 400 THEN 1 ELSE 0 END), 0)::text as success_count
               FROM api_usage_log
              WHERE shop_id = $3
                AND created_at >= $1
                AND created_at <= $2
              GROUP BY api_provider`,
              [from, to, session.shopId]
            ),
            client.query<{ api_provider: string; endpoint: string | null; avg_ms: string | null }>(
              `SELECT api_provider, endpoint, AVG(response_time_ms)::text as avg_ms
                 FROM api_usage_log
                WHERE shop_id = $3
                  AND created_at >= $1
                  AND created_at <= $2
                GROUP BY api_provider, endpoint`,
              [from, to, session.shopId]
            ),
          ]);
          const totalsRow = totalsResult.rows[0];
          const matchesRow = matchesResult.rows[0];
          const specsRow = specsResult.rows[0];
          const totalProducts = Number(totalsRow?.total_products ?? 0);
          const productsWithMatches = Number(matchesRow?.products_with_matches ?? 0);
          const productsWithSpecs = Number(specsRow?.products_with_specs ?? 0);
          const totalMatches = Number(matchesRow?.total_matches ?? 0);
          const confirmedMatches = Number(matchesRow?.confirmed_matches ?? 0);
          const pendingMatches = Number(matchesRow?.pending_matches ?? 0);
          const rejectedMatches = Number(matchesRow?.rejected_matches ?? 0);

          const pending = Math.max(0, totalProducts - productsWithMatches);
          const inProgress = Math.max(0, productsWithMatches - productsWithSpecs);
          const successRate = totalMatches ? confirmedMatches / totalMatches : 0;
          const avgLatencyMs = Number(avgLatencyResult.rows[0]?.avg_latency_ms ?? 0);
          const avgProcessingTime = avgLatencyMs ? avgLatencyMs / 60000 : null;
          const completedToday = Number(completedTodayResult.rows[0]?.completed_today ?? 0);
          const completedThisWeek = Number(completedWeekResult.rows[0]?.completed_week ?? 0);
          const stageDurations = new Map<string, number>();
          for (const row of stageDurationResult.rows) {
            if (row.api_provider === 'serper') {
              const value = Number(row.avg_ms ?? 0);
              if (value) stageDurations.set('search', value / 60000);
              continue;
            }
            if (row.api_provider === 'xai' && row.endpoint === 'ai-audit') {
              const value = Number(row.avg_ms ?? 0);
              if (value) stageDurations.set('ai-audit', value / 60000);
              continue;
            }
            if (row.api_provider === 'xai' && row.endpoint === 'extract-product') {
              const value = Number(row.avg_ms ?? 0);
              if (value) stageDurations.set('extraction', value / 60000);
            }
          }
          const stageAvg = (key: string) => {
            const value = stageDurations.get(key);
            return value ? Math.round(value * 10) / 10 : null;
          };
          const trendPoints = trendResult.rows.map((trend) => ({
            date: trend.day,
            pending: Number(trend.pending ?? 0),
            completed: Number(trend.completed ?? 0),
          }));
          const sourcePerformance = sourcePerfResult.rows.map((row) => {
            const totalRequests = Number(row.total_requests ?? 0);
            const successCount = Number(row.success_count ?? 0);
            return {
              provider: row.api_provider,
              totalRequests,
              totalCost: Number(row.total_cost ?? 0),
              avgLatencyMs: Number(row.avg_latency_ms ?? 0),
              successRate: totalRequests ? successCount / totalRequests : 0,
            };
          });

          return {
            pending,
            inProgress,
            completedToday,
            completedThisWeek,
            successRate,
            avgProcessingTime,
            pipelineStages: [
              {
                id: 'pending',
                name: 'Pending',
                count: pending,
                status: pending > 0 ? 'active' : 'idle',
                avgDuration: null,
              },
              {
                id: 'search',
                name: 'Search',
                count: productsWithMatches,
                status: productsWithMatches > 0 ? 'active' : 'idle',
                avgDuration: stageAvg('search'),
              },
              {
                id: 'ai-audit',
                name: 'AI Audit',
                count: pendingMatches,
                status: pendingMatches > 0 ? 'active' : 'idle',
                avgDuration: stageAvg('ai-audit'),
              },
              {
                id: 'scraper',
                name: 'Scraper Fallback',
                count: pendingMatches,
                status: pendingMatches > 0 ? 'active' : 'idle',
                avgDuration: stageAvg('scraper'),
              },
              {
                id: 'extraction',
                name: 'Extraction',
                count: productsWithSpecs,
                status: productsWithSpecs > 0 ? 'active' : 'idle',
                avgDuration: stageAvg('extraction'),
              },
              {
                id: 'complete',
                name: 'Complete',
                count: confirmedMatches,
                status: confirmedMatches > 0 ? 'active' : 'idle',
                avgDuration: null,
              },
            ],
            trendPoints,
            trendsData: {
              pending: trendPoints.map((point) => point.pending),
              completed: trendPoints.map((point) => point.completed),
            },
            trendRange: rangeRow?.min_date && rangeRow?.max_date ? { from, to } : null,
            sourcePerformance,
            totals: {
              totalProducts,
              productsWithMatches,
              productsWithSpecs,
              totalMatches,
              confirmedMatches,
              pendingMatches,
              rejectedMatches,
            },
          };
        });

        setCached(cacheKey, data);
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load enrichment progress');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to load enrichment progress'
            )
          );
      }
    }
  );

  server.get(
    '/pim/stats/quality-distribution',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const query = request.query as { from?: string; to?: string };
      const from = parseDateParam(query.from);
      const to = parseDateParam(query.to);
      const cacheKey = buildCacheKey('/pim/stats/quality-distribution', session.shopId, {
        from,
        to,
      });
      const cached = getCached<{
        bronze: { count: number; percentage: number; avgQualityScore: number | null };
        silver: { count: number; percentage: number; avgQualityScore: number | null };
        golden: { count: number; percentage: number; avgQualityScore: number | null };
        review: { count: number; percentage: number; avgQualityScore: number | null };
        total: number;
        needsReviewCount: number;
        promotions: {
          toSilver24h: number;
          toGolden24h: number;
          toSilver7d: number;
          toGolden7d: number;
        };
        lastUpdate: string | null;
        refreshedAt: string | null;
        trend: {
          date: string;
          bronze: number;
          silver: number;
          golden: number;
          review: number;
        }[];
        trendRange: { from: string; to: string } | null;
      }>(cacheKey);
      if (cached) {
        return reply.send(successEnvelope(request.id, cached));
      }

      try {
        const data = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{
            data_quality_level: string | null;
            product_count: string | null;
            percentage: string | null;
            avg_quality_score: string | null;
            needs_review_count: string | null;
            promoted_to_silver_24h: string | null;
            promoted_to_golden_24h: string | null;
            promoted_to_silver_7d: string | null;
            promoted_to_golden_7d: string | null;
            last_update: string | null;
            refreshed_at: string | null;
          }>(
            `SELECT
               data_quality_level,
               product_count,
               percentage,
               avg_quality_score,
               needs_review_count,
               promoted_to_silver_24h,
               promoted_to_golden_24h,
               promoted_to_silver_7d,
               promoted_to_golden_7d,
               last_update,
               refreshed_at
               FROM mv_pim_quality_progress
              WHERE shop_id = $1`,
            [session.shopId]
          );
          const rangeResult = await client.query<{
            min_date: string | null;
            max_date: string | null;
          }>(
            `SELECT
               MIN(qe.created_at)::timestamptz as min_date,
               MAX(qe.created_at)::timestamptz as max_date
             FROM prod_quality_events qe
             JOIN prod_channel_mappings pcm
               ON pcm.product_id = qe.product_id
              AND pcm.shop_id = $1
              AND pcm.channel = 'shopify'`,
            [session.shopId]
          );
          const rangeRow = rangeResult.rows[0];
          const rangeFrom = from ?? rangeRow?.min_date ?? null;
          const rangeTo = to ?? rangeRow?.max_date ?? null;
          const trend: {
            date: string;
            bronze: number;
            silver: number;
            golden: number;
            review: number;
          }[] =
            rangeFrom && rangeTo
              ? (
                  await client.query<{
                    day: string;
                    bronze: string | null;
                    silver: string | null;
                    golden: string | null;
                    review: string | null;
                  }>(
                    `WITH days AS (
                       SELECT generate_series(
                         date_trunc('day', $1::timestamptz),
                         date_trunc('day', $2::timestamptz),
                         interval '1 day'
                       )::date as day
                     ),
                     agg AS (
                       SELECT
                         DATE(qe.created_at) as day,
                         qe.new_level,
                         COUNT(*)::text as count
                       FROM prod_quality_events qe
                       JOIN prod_channel_mappings pcm
                         ON pcm.product_id = qe.product_id
                        AND pcm.shop_id = $3
                        AND pcm.channel = 'shopify'
                       WHERE qe.created_at >= $1
                         AND qe.created_at <= $2
                       GROUP BY DATE(qe.created_at), qe.new_level
                     )
                     SELECT
                       days.day::text as day,
                       COALESCE(MAX(agg.count) FILTER (WHERE agg.new_level = 'bronze'), '0') as bronze,
                       COALESCE(MAX(agg.count) FILTER (WHERE agg.new_level = 'silver'), '0') as silver,
                       COALESCE(MAX(agg.count) FILTER (WHERE agg.new_level = 'golden'), '0') as golden,
                       COALESCE(MAX(agg.count) FILTER (WHERE agg.new_level = 'review_needed'), '0') as review
                     FROM days
                     LEFT JOIN agg ON agg.day = days.day
                     GROUP BY days.day
                     ORDER BY days.day ASC`,
                    [rangeFrom, rangeTo, session.shopId]
                  )
                ).rows.map((row) => ({
                  date: row.day,
                  bronze: Number(row.bronze ?? 0),
                  silver: Number(row.silver ?? 0),
                  golden: Number(row.golden ?? 0),
                  review: Number(row.review ?? 0),
                }))
              : [];

          const totals = new Map<
            string,
            {
              count: number;
              percentage: number;
              avgQualityScore: number | null;
              needsReviewCount: number;
              promotedToSilver24h: number;
              promotedToGolden24h: number;
              promotedToSilver7d: number;
              promotedToGolden7d: number;
              lastUpdate: string | null;
              refreshedAt: string | null;
            }
          >();
          for (const row of result.rows) {
            if (!row.data_quality_level) continue;
            totals.set(row.data_quality_level, {
              count: Number(row.product_count ?? 0),
              percentage: Number(row.percentage ?? 0),
              avgQualityScore:
                row.avg_quality_score == null ? null : Number(row.avg_quality_score ?? 0),
              needsReviewCount: Number(row.needs_review_count ?? 0),
              promotedToSilver24h: Number(row.promoted_to_silver_24h ?? 0),
              promotedToGolden24h: Number(row.promoted_to_golden_24h ?? 0),
              promotedToSilver7d: Number(row.promoted_to_silver_7d ?? 0),
              promotedToGolden7d: Number(row.promoted_to_golden_7d ?? 0),
              lastUpdate: row.last_update,
              refreshedAt: row.refreshed_at,
            });
          }

          const emptyLevel = {
            count: 0,
            percentage: 0,
            avgQualityScore: null,
            needsReviewCount: 0,
            promotedToSilver24h: 0,
            promotedToGolden24h: 0,
            promotedToSilver7d: 0,
            promotedToGolden7d: 0,
            lastUpdate: null,
            refreshedAt: null,
          };
          const bronze = totals.get('bronze') ?? emptyLevel;
          const silver = totals.get('silver') ?? emptyLevel;
          const golden = totals.get('golden') ?? emptyLevel;
          const review = totals.get('review_needed') ?? emptyLevel;
          const total = bronze.count + silver.count + golden.count + review.count;
          const refreshedAt =
            bronze.refreshedAt ?? silver.refreshedAt ?? golden.refreshedAt ?? review.refreshedAt;
          const lastUpdate =
            bronze.lastUpdate ?? silver.lastUpdate ?? golden.lastUpdate ?? review.lastUpdate;

          return {
            bronze: {
              count: bronze.count,
              percentage: bronze.percentage,
              avgQualityScore: bronze.avgQualityScore,
            },
            silver: {
              count: silver.count,
              percentage: silver.percentage,
              avgQualityScore: silver.avgQualityScore,
            },
            golden: {
              count: golden.count,
              percentage: golden.percentage,
              avgQualityScore: golden.avgQualityScore,
            },
            review: {
              count: review.count,
              percentage: review.percentage,
              avgQualityScore: review.avgQualityScore,
            },
            total,
            needsReviewCount: review.needsReviewCount,
            promotions: {
              toSilver24h:
                bronze.promotedToSilver24h +
                silver.promotedToSilver24h +
                golden.promotedToSilver24h +
                review.promotedToSilver24h,
              toGolden24h:
                bronze.promotedToGolden24h +
                silver.promotedToGolden24h +
                golden.promotedToGolden24h +
                review.promotedToGolden24h,
              toSilver7d:
                bronze.promotedToSilver7d +
                silver.promotedToSilver7d +
                golden.promotedToSilver7d +
                review.promotedToSilver7d,
              toGolden7d:
                bronze.promotedToGolden7d +
                silver.promotedToGolden7d +
                golden.promotedToGolden7d +
                review.promotedToGolden7d,
            },
            lastUpdate,
            refreshedAt,
            trend,
            trendRange: rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : null,
          };
        });

        setCached(cacheKey, data);
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load quality distribution');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to load quality distribution'
            )
          );
      }
    }
  );

  server.get(
    '/pim/stats/source-performance',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const cacheKey = buildCacheKey('/pim/stats/source-performance', session.shopId, {});
      const cached = getCached<{
        sources: {
          sourceType: string;
          sourceName: string;
          totalHarvests: number;
          successfulHarvests: number;
          pendingHarvests: number;
          failedHarvests: number;
          successRate: number;
          trustScore: number;
          isActive: boolean;
          lastHarvestAt: string | null;
          refreshedAt: string | null;
        }[];
        refreshedAt: string | null;
      }>(cacheKey);
      if (cached) return reply.send(successEnvelope(request.id, cached));

      try {
        const data = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{
            source_type: string | null;
            source_name: string | null;
            total_harvests: string | null;
            successful_harvests: string | null;
            pending_harvests: string | null;
            failed_harvests: string | null;
            success_rate: string | null;
            trust_score: string | null;
            is_active: boolean | null;
            last_harvest_at: string | null;
            refreshed_at: string | null;
          }>(
            `SELECT
               source_type,
               source_name,
               total_harvests,
               successful_harvests,
               pending_harvests,
               failed_harvests,
               success_rate,
               trust_score,
               is_active,
               last_harvest_at,
               refreshed_at
             FROM mv_pim_source_performance
            WHERE shop_id = $1
             ORDER BY success_rate DESC NULLS LAST`,
            [session.shopId]
          );
          const sources = result.rows.map((row) => ({
            sourceType: row.source_type ?? 'unknown',
            sourceName: row.source_name ?? 'Unknown source',
            totalHarvests: Number(row.total_harvests ?? 0),
            successfulHarvests: Number(row.successful_harvests ?? 0),
            pendingHarvests: Number(row.pending_harvests ?? 0),
            failedHarvests: Number(row.failed_harvests ?? 0),
            successRate: Number(row.success_rate ?? 0),
            trustScore: Number(row.trust_score ?? 0),
            isActive: Boolean(row.is_active),
            lastHarvestAt: row.last_harvest_at ?? null,
            refreshedAt: row.refreshed_at ?? null,
          }));
          return {
            sources,
            refreshedAt: sources[0]?.refreshedAt ?? null,
          };
        });
        setCached(cacheKey, data);
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load source performance');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to load source performance'
            )
          );
      }
    }
  );

  server.get(
    '/pim/stats/enrichment-sync',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const cacheKey = buildCacheKey('/pim/stats/enrichment-sync', session.shopId, {});
      const cached = getCached<{
        syncStatus: {
          dataQualityLevel: string;
          channel: string;
          productCount: number;
          syncedCount: number;
          syncRate: number;
          avgQualityScore: number;
          refreshedAt: string | null;
        }[];
        refreshedAt: string | null;
      }>(cacheKey);
      if (cached) return reply.send(successEnvelope(request.id, cached));

      try {
        const data = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{
            data_quality_level: string | null;
            channel: string | null;
            product_count: string | null;
            synced_count: string | null;
            sync_rate: string | null;
            avg_quality_score: string | null;
            refreshed_at: string | null;
          }>(
            `SELECT
               data_quality_level,
               channel,
               product_count,
               synced_count,
               sync_rate,
               avg_quality_score,
               refreshed_at
             FROM mv_pim_enrichment_status
            WHERE shop_id = $1
             ORDER BY data_quality_level ASC, channel ASC`,
            [session.shopId]
          );

          const syncStatus = result.rows.map((row) => ({
            dataQualityLevel: row.data_quality_level ?? 'unknown',
            channel: row.channel ?? 'unknown',
            productCount: Number(row.product_count ?? 0),
            syncedCount: Number(row.synced_count ?? 0),
            syncRate: Number(row.sync_rate ?? 0),
            avgQualityScore: Number(row.avg_quality_score ?? 0),
            refreshedAt: row.refreshed_at ?? null,
          }));

          return {
            syncStatus,
            refreshedAt: syncStatus[0]?.refreshedAt ?? null,
          };
        });

        setCached(cacheKey, data);
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load enrichment sync stats');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to load enrichment sync stats'
            )
          );
      }
    }
  );

  server.get(
    '/pim/stats/cost-tracking',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const query = request.query as { from?: string; to?: string };
      const from = parseDateParam(query.from);
      const to = parseDateParam(query.to);

      try {
        const data = await withTenantContext(session.shopId, async (client) => {
          const [daily, weekly, monthly] = await Promise.all([
            client.query<{ serper: string; xai: string; openai: string; scraper: string }>(
              `SELECT
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'serper'), 0) as serper,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'xai'), 0) as xai,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'openai'), 0) as openai,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'scraper'), 0) as scraper
               FROM api_usage_log
              WHERE created_at >= date_trunc('day', now())
                AND created_at < date_trunc('day', now()) + interval '1 day'`
            ),
            client.query<{ serper: string; xai: string; openai: string; scraper: string }>(
              `SELECT
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'serper'), 0) as serper,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'xai'), 0) as xai,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'openai'), 0) as openai,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'scraper'), 0) as scraper
               FROM api_usage_log
              WHERE created_at >= date_trunc('week', now())
                AND created_at < date_trunc('week', now()) + interval '7 days'`
            ),
            client.query<{ serper: string; xai: string; openai: string; scraper: string }>(
              `SELECT
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'serper'), 0) as serper,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'xai'), 0) as xai,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'openai'), 0) as openai,
                 COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'scraper'), 0) as scraper
               FROM api_usage_log
              WHERE created_at >= date_trunc('month', now())
                AND created_at < date_trunc('month', now()) + interval '1 month'`
            ),
          ]);
          const lastMonth = await client.query<{ serper: string; xai: string; openai: string }>(
            `SELECT
               COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'serper'), 0) as serper,
               COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'xai'), 0) as xai,
               COALESCE(SUM(estimated_cost) FILTER (WHERE api_provider = 'openai'), 0) as openai
             FROM api_usage_log
            WHERE created_at >= date_trunc('month', now()) - interval '1 month'
              AND created_at < date_trunc('month', now())`
          );

          const settings = await client.query<{
            serper_daily_budget: number | null;
            serper_budget_alert_threshold: number | null;
            xai_daily_budget: number | null;
            xai_budget_alert_threshold: number | null;
            openai_daily_budget: string | null;
            openai_budget_alert_threshold: string | null;
          }>(
            `SELECT
               serper_daily_budget,
               serper_budget_alert_threshold,
               xai_daily_budget,
               xai_budget_alert_threshold,
               openai_daily_budget,
               openai_budget_alert_threshold
             FROM shop_ai_credentials
            WHERE shop_id = $1`,
            [session.shopId]
          );
          const settingsRow = settings.rows[0];
          const serperBudget = settingsRow?.serper_daily_budget ?? null;
          const xaiBudget = settingsRow?.xai_daily_budget ?? null;
          const openAiBudget = settingsRow?.openai_daily_budget
            ? Number(settingsRow.openai_daily_budget)
            : null;
          const serperAlert = settingsRow?.serper_budget_alert_threshold ?? null;
          const xaiAlert = settingsRow?.xai_budget_alert_threshold ?? null;
          const openAiAlert = settingsRow?.openai_budget_alert_threshold
            ? Number(settingsRow.openai_budget_alert_threshold)
            : null;

          const todaySerper = Number(daily.rows[0]?.serper ?? 0);
          const todayXai = Number(daily.rows[0]?.xai ?? 0);
          const todayOpenAi = Number(daily.rows[0]?.openai ?? 0);
          const todayScraper = Number(daily.rows[0]?.scraper ?? 0);
          const thisWeekSerper = Number(weekly.rows[0]?.serper ?? 0);
          const thisWeekXai = Number(weekly.rows[0]?.xai ?? 0);
          const thisWeekOpenAi = Number(weekly.rows[0]?.openai ?? 0);
          const thisWeekScraper = Number(weekly.rows[0]?.scraper ?? 0);
          const thisMonthSerper = Number(monthly.rows[0]?.serper ?? 0);
          const thisMonthXai = Number(monthly.rows[0]?.xai ?? 0);
          const thisMonthOpenAi = Number(monthly.rows[0]?.openai ?? 0);
          const thisMonthScraper = Number(monthly.rows[0]?.scraper ?? 0);
          const lastMonthSerper = Number(lastMonth.rows[0]?.serper ?? 0);
          const lastMonthXai = Number(lastMonth.rows[0]?.xai ?? 0);
          const lastMonthOpenAi = Number(lastMonth.rows[0]?.openai ?? 0);

          const dailyTotal = todaySerper + todayXai + todayOpenAi + todayScraper;
          const hasBudget =
            serperBudget != null &&
            xaiBudget != null &&
            openAiBudget != null &&
            serperAlert != null &&
            xaiAlert != null &&
            openAiAlert != null;
          const dailyBudgetTotal = hasBudget ? serperBudget + xaiBudget + openAiBudget : null;
          const dailyPercentage =
            hasBudget && dailyBudgetTotal ? dailyTotal / dailyBudgetTotal : null;
          const warningThreshold = hasBudget ? Math.min(serperAlert, xaiAlert, openAiAlert) : null;
          const status =
            dailyPercentage == null || warningThreshold == null
              ? null
              : dailyPercentage >= 1
                ? 'critical'
                : dailyPercentage >= warningThreshold
                  ? 'warning'
                  : 'ok';

          const [goldenCurrent, goldenPrevious] = await Promise.all([
            client.query<{ count: string }>(
              `SELECT COUNT(*)::text as count
                 FROM prod_quality_events
                WHERE event_type = 'quality_promoted'
                  AND new_level = 'golden'
                  AND created_at >= date_trunc('month', now())
                  AND created_at < date_trunc('month', now()) + interval '1 month'`
            ),
            client.query<{ count: string }>(
              `SELECT COUNT(*)::text as count
                 FROM prod_quality_events
                WHERE event_type = 'quality_promoted'
                  AND new_level = 'golden'
                  AND created_at >= date_trunc('month', now()) - interval '1 month'
                  AND created_at < date_trunc('month', now())`
            ),
          ]);
          const goldenCount = Number(goldenCurrent.rows[0]?.count ?? 0);
          const goldenPrevCount = Number(goldenPrevious.rows[0]?.count ?? 0);
          const costPerGolden = goldenCount
            ? (thisMonthSerper + thisMonthXai + thisMonthOpenAi) / goldenCount
            : null;
          const previousCostPerGolden = goldenPrevCount
            ? (lastMonthSerper + lastMonthXai + lastMonthOpenAi) / goldenPrevCount
            : null;
          const trend =
            previousCostPerGolden && costPerGolden != null
              ? (costPerGolden - previousCostPerGolden) / previousCostPerGolden
              : null;

          const breakdownRange = await client.query<{
            min_date: string | null;
            max_date: string | null;
          }>(
            `SELECT
               MIN(created_at)::timestamptz as min_date,
               MAX(created_at)::timestamptz as max_date
             FROM api_usage_log
            WHERE shop_id = $1`,
            [session.shopId]
          );
          const rangeRow = breakdownRange.rows[0];
          const rangeFrom = from ?? rangeRow?.min_date ?? null;
          const rangeTo = to ?? rangeRow?.max_date ?? null;
          const breakdown =
            rangeFrom && rangeTo
              ? await client.query<{
                  date: string;
                  operation_type: string;
                  total_cost: string;
                }>(
                  `SELECT
               DATE(created_at) as date,
               CASE
                 WHEN api_provider = 'serper' THEN 'search'
                 WHEN api_provider = 'xai' AND endpoint = 'ai-audit' THEN 'audit'
                 WHEN api_provider = 'xai' AND endpoint = 'extract-product' THEN 'extraction'
                WHEN api_provider = 'openai' THEN 'embedding'
                 ELSE 'other'
               END as operation_type,
               SUM(estimated_cost) as total_cost
             FROM api_usage_log
            WHERE shop_id = $3
              AND created_at >= $1
              AND created_at <= $2
            GROUP BY DATE(created_at), operation_type
            ORDER BY DATE(created_at) ASC`,
                  [rangeFrom, rangeTo, session.shopId]
                )
              : { rows: [] };

          const breakdownMap = new Map<
            string,
            { search: number; audit: number; extraction: number; embedding: number }
          >();
          for (const row of breakdown.rows) {
            if (row.operation_type === 'other') continue;
            const entry = breakdownMap.get(row.date) ?? {
              search: 0,
              audit: 0,
              extraction: 0,
              embedding: 0,
            };
            if (row.operation_type === 'search') entry.search = Number(row.total_cost ?? 0);
            if (row.operation_type === 'audit') entry.audit = Number(row.total_cost ?? 0);
            if (row.operation_type === 'extraction') entry.extraction = Number(row.total_cost ?? 0);
            if (row.operation_type === 'embedding') entry.embedding = Number(row.total_cost ?? 0);
            breakdownMap.set(row.date, entry);
          }

          return {
            today: {
              serper: todaySerper,
              xai: todayXai,
              openai: todayOpenAi,
              scraper: todayScraper,
              total: dailyTotal,
            },
            thisWeek: {
              serper: thisWeekSerper,
              xai: thisWeekXai,
              openai: thisWeekOpenAi,
              scraper: thisWeekScraper,
              total: thisWeekSerper + thisWeekXai + thisWeekOpenAi + thisWeekScraper,
            },
            thisMonth: {
              serper: thisMonthSerper,
              xai: thisMonthXai,
              openai: thisMonthOpenAi,
              scraper: thisMonthScraper,
              total: thisMonthSerper + thisMonthXai + thisMonthOpenAi + thisMonthScraper,
            },
            budget:
              hasBudget && dailyBudgetTotal != null && dailyPercentage != null
                ? {
                    daily: dailyBudgetTotal,
                    used: dailyTotal,
                    percentage: dailyPercentage,
                    status,
                    warningThreshold,
                    criticalThreshold: 1,
                  }
                : null,
            costPerGolden: {
              current: costPerGolden,
              target: previousCostPerGolden,
              trend,
            },
            breakdown: Array.from(breakdownMap.entries()).map(([date, entry]) => ({
              date,
              search: entry.search,
              audit: entry.audit,
              extraction: entry.extraction,
              embedding: entry.embedding,
            })),
            breakdownRange: rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : null,
          };
        });

        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load cost tracking');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load cost tracking')
          );
      }
    }
  );

  server.get(
    '/pim/stats/cost-tracking/budget-status',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      try {
        const budgets = await checkAllBudgets(session.shopId);
        const scraperRatio = await withTenantContext(session.shopId, async (client) => {
          const usage = await client.query<{ used: string }>(
            `SELECT COALESCE(SUM(request_count),0)::text AS used
             FROM api_usage_log
             WHERE api_provider = 'scraper'
               AND created_at >= date_trunc('day', now())
               AND created_at < date_trunc('day', now()) + interval '1 day'`
          );
          const used = Number(usage.rows[0]?.used ?? 0);
          const limit = 10000;
          return { used, limit, ratio: used / limit };
        });
        return reply.send(
          successEnvelope(request.id, {
            providers: [
              ...budgets.map((budget) => ({
                provider: budget.provider,
                primary: budget.primary,
                ...(budget.secondary ? { secondary: budget.secondary } : {}),
                alertThreshold: budget.alertThreshold,
                exceeded: budget.exceeded,
                alertTriggered: budget.alertTriggered,
              })),
              {
                provider: 'scraper',
                primary: {
                  unit: 'requests',
                  used: scraperRatio.used,
                  limit: scraperRatio.limit,
                  remaining: Math.max(0, scraperRatio.limit - scraperRatio.used),
                  ratio: scraperRatio.ratio,
                },
                alertThreshold: 0.8,
                exceeded: scraperRatio.ratio >= 1,
                alertTriggered: scraperRatio.ratio >= 0.8,
              },
            ],
          })
        );
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load budget status');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load budget status')
          );
      }
    }
  );

  server.post(
    '/pim/stats/cost-tracking/pause-enrichment',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const queue = createQueue({ config: configFromEnv(env) }, { name: ENRICHMENT_QUEUE_NAME });
        await queue.pause();
        await queue.close();
        recordPimQueuePaused('manual', ENRICHMENT_QUEUE_NAME);
        return reply.send(successEnvelope(request.id, { paused: true }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to pause enrichment queue');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to pause enrichment queue'
            )
          );
      }
    }
  );

  server.post(
    '/pim/stats/cost-tracking/resume-enrichment',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const queue = createQueue({ config: configFromEnv(env) }, { name: ENRICHMENT_QUEUE_NAME });
        await queue.resume();
        await queue.close();
        recordPimQueueResumed('manual', ENRICHMENT_QUEUE_NAME);
        return reply.send(successEnvelope(request.id, { resumed: true }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to resume enrichment queue');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to resume enrichment queue'
            )
          );
      }
    }
  );

  server.post(
    '/pim/stats/cost-tracking/pause-all-cost-queues',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const results = await pauseCostSensitiveQueues({
          config: configFromEnv(env),
          trigger: 'manual',
          logger,
        });
        return reply.send(
          successEnvelope(request.id, {
            paused: true,
            queues: results,
          })
        );
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to pause all cost-sensitive queues');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to pause all cost-sensitive queues'
            )
          );
      }
    }
  );

  server.post(
    '/pim/stats/cost-tracking/resume-all-cost-queues',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const results = await resumeCostSensitiveQueues({
          config: configFromEnv(env),
          trigger: 'manual',
          logger,
        });
        return reply.send(
          successEnvelope(request.id, {
            resumed: true,
            queues: results,
          })
        );
      } catch (error) {
        logger.error(
          { requestId: request.id, error },
          'Failed to resume all cost-sensitive queues'
        );
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to resume all cost-sensitive queues'
            )
          );
      }
    }
  );

  server.get(
    '/pim/stats/cost-tracking/budget-guard-status',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const budgets = await checkAllBudgets(session.shopId);
        const queueStatus = await readCostSensitiveQueueStatus(configFromEnv(env));
        const scraperRatio = await withTenantContext(session.shopId, async (client) => {
          const usage = await client.query<{ used: string }>(
            `SELECT COALESCE(SUM(request_count),0)::text AS used
             FROM api_usage_log
             WHERE api_provider = 'scraper'
               AND created_at >= date_trunc('day', now())
               AND created_at < date_trunc('day', now()) + interval '1 day'`
          );
          const used = Number(usage.rows[0]?.used ?? 0);
          const limit = 10000;
          return {
            ratio: used / limit,
            exceeded: used >= limit,
            alertTriggered: used / limit >= 0.8,
          };
        });
        return reply.send(
          successEnvelope(request.id, {
            providers: [
              ...budgets.map((budget) => ({
                provider: budget.provider,
                exceeded: budget.exceeded,
                alertTriggered: budget.alertTriggered,
                ratio: budget.primary.ratio,
              })),
              {
                provider: 'scraper',
                exceeded: scraperRatio.exceeded,
                alertTriggered: scraperRatio.alertTriggered,
                ratio: scraperRatio.ratio,
              },
            ],
            queues: queueStatus,
          })
        );
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load budget guard status');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to load budget guard status'
            )
          );
      }
    }
  );

  server.put(
    '/pim/stats/cost-tracking/budgets',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const body = (request.body ?? {}) as {
        serperDailyBudget?: number;
        serperBudgetAlertThreshold?: number;
        xaiDailyBudget?: number;
        xaiBudgetAlertThreshold?: number;
        openaiDailyBudget?: number;
        openaiBudgetAlertThreshold?: number;
        openaiItemsDailyBudget?: number;
      };

      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      const addUpdate = (column: string, value: unknown): void => {
        updates.push(`${column} = $${idx}`);
        values.push(value);
        idx++;
      };

      if (typeof body.serperDailyBudget === 'number')
        addUpdate('serper_daily_budget', body.serperDailyBudget);
      if (typeof body.serperBudgetAlertThreshold === 'number')
        addUpdate('serper_budget_alert_threshold', body.serperBudgetAlertThreshold);
      if (typeof body.xaiDailyBudget === 'number')
        addUpdate('xai_daily_budget', body.xaiDailyBudget);
      if (typeof body.xaiBudgetAlertThreshold === 'number')
        addUpdate('xai_budget_alert_threshold', body.xaiBudgetAlertThreshold);
      if (typeof body.openaiDailyBudget === 'number')
        addUpdate('openai_daily_budget', body.openaiDailyBudget);
      if (typeof body.openaiBudgetAlertThreshold === 'number')
        addUpdate('openai_budget_alert_threshold', body.openaiBudgetAlertThreshold);
      if (typeof body.openaiItemsDailyBudget === 'number')
        addUpdate('openai_items_daily_budget', body.openaiItemsDailyBudget);

      if (updates.length === 0) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'INVALID_REQUEST', 'No budget fields provided'));
      }

      try {
        await withTenantContext(session.shopId, async (client) => {
          values.push(session.shopId);
          await client.query(
            `UPDATE shop_ai_credentials
                SET ${updates.join(', ')},
                    updated_at = now()
              WHERE shop_id = $${idx}`,
            values
          );
        });

        const maybeRedis = (
          server as FastifyInstance & {
            redis?: { del: (key: string) => Promise<unknown> };
          }
        ).redis;
        if (maybeRedis) {
          await maybeRedis.del('pim:budget:max_ratios');
        }

        return reply.send(successEnvelope(request.id, { updated: true }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update budgets');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update budgets')
          );
      }
    }
  );

  server.get(
    '/pim/events/quality',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const query = request.query as {
        limit?: string;
        offset?: string;
        type?: string;
        from?: string;
        to?: string;
        q?: string;
      };
      const limit = parseIntParam(query.limit, 50, 1, 200);
      const offset = parseIntParam(query.offset, 0, 0, 10_000);
      const eventType = typeof query.type === 'string' ? query.type : null;
      const from = parseDateParam(query.from);
      const to = parseDateParam(query.to);
      const search = typeof query.q === 'string' ? query.q : null;

      try {
        const data = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{
            id: string;
            event_type: string;
            product_id: string;
            previous_level: string | null;
            new_level: string | null;
            quality_score_after: string | null;
            quality_score_before: string | null;
            trigger_reason: string | null;
            trigger_details: Record<string, unknown> | null;
            webhook_sent: boolean;
            webhook_sent_at: string | null;
            webhook_status: 'sent' | 'pending' | 'retrying' | 'failed';
            webhook_last_http_status: number | null;
            created_at: string;
          }>(
            `SELECT
               qe.id,
               qe.event_type,
               qe.product_id,
               qe.previous_level,
               qe.new_level,
               qe.quality_score_after,
               qe.quality_score_before,
               qe.trigger_reason,
               qe.trigger_details,
               qe.webhook_sent,
               qe.webhook_sent_at,
               CASE
                 WHEN qe.webhook_sent = true THEN 'sent'
                 WHEN COALESCE(ld.attempt, 0) >= $7::int
                   AND (ld.http_status IS NULL OR ld.http_status < 200 OR ld.http_status > 299)
                   THEN 'failed'
                 WHEN COALESCE(ld.attempt, 0) > 0 THEN 'retrying'
                 ELSE 'pending'
               END AS webhook_status,
               ld.http_status AS webhook_last_http_status,
               qe.created_at
             FROM prod_quality_events qe
             LEFT JOIN LATERAL (
               SELECT qwd.http_status, qwd.attempt
               FROM quality_webhook_deliveries qwd
               WHERE qwd.event_id = qe.id
               ORDER BY qwd.created_at DESC
               LIMIT 1
             ) ld ON true
             WHERE EXISTS (
               SELECT 1
               FROM prod_channel_mappings pcm
               WHERE pcm.product_id = qe.product_id
                 AND pcm.shop_id = $8
                 AND pcm.channel = 'shopify'
             )
               AND ($1::text IS NULL OR qe.event_type = $1)
               AND ($2::timestamptz IS NULL OR qe.created_at >= $2)
               AND ($3::timestamptz IS NULL OR qe.created_at <= $3)
               AND ($4::text IS NULL OR qe.product_id::text ILIKE '%' || $4 || '%')
             ORDER BY qe.created_at DESC
             LIMIT $5 OFFSET $6`,
            [
              eventType,
              from,
              to,
              search,
              limit,
              offset,
              env.qualityWebhookMaxAttempts,
              session.shopId,
            ]
          );

          const totalCountResult = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text as count
               FROM prod_quality_events qe
              WHERE EXISTS (
                SELECT 1
                FROM prod_channel_mappings pcm
                WHERE pcm.product_id = qe.product_id
                  AND pcm.shop_id = $5
                  AND pcm.channel = 'shopify'
              )
                AND ($1::text IS NULL OR qe.event_type = $1)
                AND ($2::timestamptz IS NULL OR qe.created_at >= $2)
                AND ($3::timestamptz IS NULL OR qe.created_at <= $3)
                AND ($4::text IS NULL OR qe.product_id::text ILIKE '%' || $4 || '%')`,
            [eventType, from, to, search, session.shopId]
          );
          const totalCount = Number(totalCountResult.rows[0]?.count ?? 0);

          return {
            events: result.rows.map((row) => ({
              id: row.id,
              eventType: row.event_type,
              productId: row.product_id,
              previousLevel: row.previous_level ?? undefined,
              newLevel: row.new_level ?? undefined,
              qualityScore: row.quality_score_after
                ? Number(row.quality_score_after)
                : row.quality_score_before
                  ? Number(row.quality_score_before)
                  : null,
              triggerReason: row.trigger_reason ?? null,
              triggerDetails: row.trigger_details ?? null,
              webhookSent: row.webhook_sent,
              webhookSentAt: row.webhook_sent_at,
              webhookStatus: row.webhook_status,
              webhookLastHttpStatus: row.webhook_last_http_status,
              timestamp: row.created_at,
            })),
            hasMore: offset + limit < totalCount,
            totalCount,
          };
        });

        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load quality events');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load quality events')
          );
      }
    }
  );

  server.get(
    '/pim/notifications',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const rows = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{
            id: string;
            type: string;
            title: string;
            body: Record<string, unknown>;
            read: boolean;
            created_at: string;
          }>(
            `SELECT id, type, title, body, read, created_at
               FROM pim_notifications
              WHERE shop_id = $1
              ORDER BY created_at DESC
              LIMIT 100`,
            [session.shopId]
          );
          return result.rows;
        });
        return reply.send(successEnvelope(request.id, { notifications: rows }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load PIM notifications');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load notifications')
          );
      }
    }
  );

  server.put(
    '/pim/notifications/:id/read',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const params = request.params as { id?: string };
      if (!params.id) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing notification id'));
      }
      try {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `UPDATE pim_notifications
                SET read = true
              WHERE id = $1
                AND shop_id = $2`,
            [params.id, session.shopId]
          );
        });
        return reply.send(successEnvelope(request.id, { updated: true }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update notification');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update notification')
          );
      }
    }
  );

  server.put(
    '/pim/notifications/mark-all-read',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const updated = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{ count: string }>(
            `WITH updated_rows AS (
               UPDATE pim_notifications
               SET read = true
               WHERE shop_id = $1
                 AND read = false
               RETURNING 1
             )
             SELECT COUNT(*)::text AS count FROM updated_rows`,
            [session.shopId]
          );
          return Number(result.rows[0]?.count ?? 0);
        });
        return reply.send(successEnvelope(request.id, { updated }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to mark notifications as read');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to mark notifications as read'
            )
          );
      }
    }
  );

  server.get(
    '/pim/notifications/unread-count',
    {
      preHandler: [requireSession(sessionConfig)],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const count = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text as count
               FROM pim_notifications
              WHERE shop_id = $1
                AND read = false`,
            [session.shopId]
          );
          return Number(result.rows[0]?.count ?? 0);
        });
        return reply.send(successEnvelope(request.id, { count }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load unread notifications count');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load unread count')
          );
      }
    }
  );

  server.get(
    '/pim/events/ws',
    {
      preHandler: [requireSession(sessionConfig)],
      websocket: true,
    },
    (connection: WsConnection, request) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        connection.socket.close(1008, 'Unauthorized');
        return;
      }

      if (!connection?.socket) {
        logger.warn({ reason: 'missing_socket' }, 'pim events ws connection missing socket');
        return;
      }
      const socket = connection.socket;
      let closed = false;
      let lastSeenAt = new Date(Date.now() - 60_000).toISOString();

      const sendEvent = (event: string, data: unknown) => {
        if (closed || socket.readyState !== 1) return;
        socket.send(JSON.stringify({ event, data }));
      };

      const pollEvents = async () => {
        try {
          const data = await withTenantContext(session.shopId, async (client) => {
            const result = await client.query<{
              id: string;
              event_type: string;
              product_id: string;
              previous_level: string | null;
              new_level: string | null;
              quality_score_after: string | null;
              quality_score_before: string | null;
              trigger_reason: string | null;
              trigger_details: Record<string, unknown> | null;
              webhook_sent: boolean;
              webhook_sent_at: string | null;
              webhook_status: 'sent' | 'pending' | 'retrying' | 'failed';
              webhook_last_http_status: number | null;
              created_at: string;
            }>(
              `SELECT
                 qe.id,
                 qe.event_type,
                 qe.product_id,
                 qe.previous_level,
                 qe.new_level,
                 qe.quality_score_after,
                 qe.quality_score_before,
                 qe.trigger_reason,
                 qe.trigger_details,
                 qe.webhook_sent,
                 qe.webhook_sent_at,
                 CASE
                   WHEN qe.webhook_sent = true THEN 'sent'
                   WHEN COALESCE(ld.attempt, 0) >= $3::int
                     AND (ld.http_status IS NULL OR ld.http_status < 200 OR ld.http_status > 299)
                     THEN 'failed'
                   WHEN COALESCE(ld.attempt, 0) > 0 THEN 'retrying'
                   ELSE 'pending'
                 END AS webhook_status,
                 ld.http_status AS webhook_last_http_status,
                 qe.created_at
               FROM prod_quality_events qe
               LEFT JOIN LATERAL (
                 SELECT qwd.http_status, qwd.attempt
                 FROM quality_webhook_deliveries qwd
                 WHERE qwd.event_id = qe.id
                 ORDER BY qwd.created_at DESC
                 LIMIT 1
               ) ld ON true
               WHERE qe.created_at > $1
                 AND EXISTS (
                   SELECT 1
                   FROM prod_channel_mappings pcm
                   WHERE pcm.product_id = qe.product_id
                     AND pcm.shop_id = $2
                     AND pcm.channel = 'shopify'
                 )
               ORDER BY qe.created_at ASC
               LIMIT 100`,
              [lastSeenAt, session.shopId, env.qualityWebhookMaxAttempts]
            );

            return result.rows;
          });

          const scraperEvents = await withTenantContext(session.shopId, async (client) => {
            return fetchScraperEventsSince({
              client,
              shopId: session.shopId,
              lastSeenAt,
            });
          });

          if (data.length) {
            lastSeenAt = data[data.length - 1]?.created_at ?? lastSeenAt;
          }
          if (scraperEvents.length) {
            const last = scraperEvents[scraperEvents.length - 1];
            lastSeenAt = last?.completed_at ?? last?.started_at ?? last?.created_at ?? lastSeenAt;
          }

          for (const row of data) {
            sendEvent('quality.event', {
              id: row.id,
              eventType: row.event_type,
              productId: row.product_id,
              previousLevel: row.previous_level ?? undefined,
              newLevel: row.new_level ?? undefined,
              qualityScore: row.quality_score_after
                ? Number(row.quality_score_after)
                : row.quality_score_before
                  ? Number(row.quality_score_before)
                  : null,
              triggerReason: row.trigger_reason ?? null,
              triggerDetails: row.trigger_details ?? null,
              webhookSent: row.webhook_sent,
              webhookSentAt: row.webhook_sent_at,
              webhookStatus: row.webhook_status,
              webhookLastHttpStatus: row.webhook_last_http_status,
              timestamp: row.created_at,
            });
          }

          for (const row of scraperEvents) {
            const eventName =
              row.status === 'completed'
                ? 'scraper.page.success'
                : row.status === 'robots_blocked'
                  ? 'scraper.robots.blocked'
                  : row.status === 'login_detected'
                    ? 'scraper.login.detected'
                    : 'scraper.page.failed';
            sendEvent(eventName, {
              id: row.id,
              status: row.status,
              method: row.method,
              url: row.target_urls?.[0] ?? null,
              timestamp: row.completed_at ?? row.started_at ?? row.created_at,
            });
          }
        } catch (error) {
          logger.warn({ error }, 'quality events ws poll failed');
        }
      };

      void pollEvents();

      const interval = setInterval(() => {
        if (socket.readyState !== 1) {
          closed = true;
          clearInterval(interval);
          return;
        }
        void pollEvents();
        socket.ping();
      }, 15_000);

      const onClose = () => {
        closed = true;
        clearInterval(interval);
      };

      socket.on('close', onClose);
      socket.on('error', onClose);
    }
  );
  return Promise.resolve();
};
