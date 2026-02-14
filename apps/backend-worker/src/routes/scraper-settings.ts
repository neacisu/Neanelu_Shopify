import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import type {
  ScraperActivityDataPoint,
  ScraperConfigResponse,
  ScraperHealthResponse,
  ScraperQueueStatusResponse,
  ScraperRobotsTestResponse,
  ScraperRunResponse,
  ScraperSettingsResponse,
  ScraperSettingsUpdateRequest,
} from '@app/types';
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest } from 'fastify';
import { chromium } from 'playwright-core';

import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { isUrlAllowed } from '@app/scraper';
import { Redis } from 'ioredis';

type ScraperSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type RequestWithSession = FastifyRequest & {
  session?: {
    shopId: string;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return { success: true, data, meta: { request_id: requestId, timestamp: nowIso() } } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: { code, message },
    meta: { request_id: requestId, timestamp: nowIso() },
    status,
  } as const;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'invalid-url';
  }
}

async function probeBrowserStatus(): Promise<ScraperHealthResponse> {
  const started = Date.now();
  try {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const version = browser.version();
    await browser.close();
    return {
      status: 'available',
      chromiumVersion: version,
      checkedAt: nowIso(),
      launchTimeMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser unavailable';
    const lowered = message.toLowerCase();
    const status: ScraperHealthResponse['status'] =
      lowered.includes('executable doesn') || lowered.includes('install')
        ? 'not_installed'
        : 'unavailable';
    return {
      status,
      message,
      checkedAt: nowIso(),
      launchTimeMs: Date.now() - started,
    };
  }
}

const DEFAULT_RATE_LIMIT = 1;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_UA = 'NeaneluPIM/1.0';
const DEFAULT_ROBOTS_TTL = 86400;
const DEFAULT_BROWSER_STATUS: ScraperSettingsResponse['browserStatus'] = 'not_installed';

type ScraperSettingsRow = Readonly<{
  scraperEnabled: boolean | null;
  scraperRateLimitPerDomain: number | null;
  scraperTimeoutMs: number | null;
  scraperMaxConcurrentPages: number | null;
  scraperUserAgent: string | null;
  scraperRobotsCacheTtl: number | null;
  scraperConnectionStatus:
    | ScraperSettingsResponse['browserStatus']
    | 'pending'
    | 'ok'
    | 'disabled'
    | null;
}>;

function mapConnectionStatus(
  status: ScraperSettingsRow['scraperConnectionStatus']
): ScraperSettingsResponse['browserStatus'] {
  if (status === 'ok') return 'available';
  if (status === 'pending') return 'unavailable';
  if (status === 'error') return 'error';
  if (status === 'not_installed') return 'not_installed';
  if (status === 'disabled') return 'unavailable';
  if (status === 'available' || status === 'unavailable') return status;
  return DEFAULT_BROWSER_STATUS;
}

export const scraperSettingsRoutes: FastifyPluginCallback<ScraperSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/scraper',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const data = await withTenantContext(session.shopId, async (client) => {
          const settingsResult = await client.query<ScraperSettingsRow>(
            `SELECT
               scraper_enabled AS "scraperEnabled",
               scraper_rate_limit_per_domain AS "scraperRateLimitPerDomain",
               scraper_timeout_ms AS "scraperTimeoutMs",
               scraper_max_concurrent_pages AS "scraperMaxConcurrentPages",
               scraper_user_agent AS "scraperUserAgent",
               scraper_robots_cache_ttl AS "scraperRobotsCacheTtl",
               scraper_connection_status AS "scraperConnectionStatus"
             FROM shop_ai_credentials
             WHERE shop_id = $1`,
            [session.shopId]
          );
          const settingsRow = settingsResult.rows[0];

          const today = await client.query<{
            pages_scraped: string;
            success_count: string;
            failed_count: string;
            avg_latency_ms: string | null;
            robots_blocked: string;
            deduped: string;
            login_detected: string;
            cheerio_fast_path: string;
          }>(
            `SELECT
               COUNT(*)::text AS pages_scraped,
               COUNT(*) FILTER (WHERE status = 'completed')::text AS success_count,
               COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
               AVG(duration_ms)::text AS avg_latency_ms,
               COUNT(*) FILTER (WHERE status = 'robots_blocked')::text AS robots_blocked,
               COALESCE(SUM(content_hashes_deduped),0)::text AS deduped,
               COUNT(*) FILTER (WHERE status = 'login_detected')::text AS login_detected,
               COUNT(*) FILTER (WHERE method = 'cheerio')::text AS cheerio_fast_path
             FROM scraper_runs
             WHERE shop_id = $1
               AND started_at >= date_trunc('day', now())
               AND started_at < date_trunc('day', now()) + interval '1 day'`,
            [session.shopId]
          );

          const trends = await client.query<{
            day: string;
            total: string;
            success: string;
            failed: string;
            deduped: string;
          }>(
            `WITH days AS (
               SELECT generate_series(
                 date_trunc('day', now()) - interval '6 day',
                 date_trunc('day', now()),
                 interval '1 day'
               )::date AS day
             ),
             agg AS (
               SELECT
                 DATE(COALESCE(started_at, created_at)) AS day,
                 COUNT(*)::text AS total,
                 COUNT(*) FILTER (WHERE status = 'completed')::text AS success,
                 COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
                 COALESCE(SUM(content_hashes_deduped),0)::text AS deduped
               FROM scraper_runs
               WHERE shop_id = $1
               GROUP BY DATE(COALESCE(started_at, created_at))
             )
             SELECT
               days.day::text AS day,
               COALESCE(agg.total,'0') AS total,
               COALESCE(agg.success,'0') AS success,
               COALESCE(agg.failed,'0') AS failed,
               COALESCE(agg.deduped,'0') AS deduped
             FROM days
             LEFT JOIN agg ON agg.day = days.day
             ORDER BY days.day`,
            [session.shopId]
          );

          const domains = await client.query<{
            domain: string;
            total_pages: string;
            success_count: string;
            avg_latency_ms: string | null;
            robots_blocked: string;
            last_scraped_at: string | null;
          }>(
            `SELECT
               COALESCE(NULLIF(split_part(COALESCE(target_urls[1], ''), '/', 3), ''), 'unknown') AS domain,
               COUNT(*)::text AS total_pages,
               COUNT(*) FILTER (WHERE status = 'completed')::text AS success_count,
               AVG(duration_ms)::text AS avg_latency_ms,
               COUNT(*) FILTER (WHERE status = 'robots_blocked')::text AS robots_blocked,
               MAX(COALESCE(completed_at, started_at, created_at))::text AS last_scraped_at
             FROM scraper_runs
             WHERE shop_id = $1
             GROUP BY 1
             ORDER BY COUNT(*) DESC
             LIMIT 25`,
            [session.shopId]
          );

          const row = today.rows[0];
          const pagesScraped = Number(row?.pages_scraped ?? 0);
          const successCount = Number(row?.success_count ?? 0);
          let browserStatus = mapConnectionStatus(settingsRow?.scraperConnectionStatus ?? null);
          if (
            settingsRow?.scraperEnabled &&
            (browserStatus === 'unavailable' || browserStatus === 'not_installed')
          ) {
            const probe = await probeBrowserStatus();
            browserStatus = probe.status;
            await client.query(
              `UPDATE shop_ai_credentials
               SET
                 scraper_connection_status = $2,
                 scraper_last_checked_at = now(),
                 scraper_last_success_at = CASE WHEN $2 = 'ok' THEN now() ELSE scraper_last_success_at END,
                 scraper_last_error = CASE WHEN $2 = 'error' THEN $3 ELSE NULL END,
                 updated_at = now()
               WHERE shop_id = $1`,
              [
                session.shopId,
                probe.status === 'available'
                  ? 'ok'
                  : probe.status === 'not_installed'
                    ? 'not_installed'
                    : probe.status === 'error'
                      ? 'error'
                      : 'pending',
                probe.message ?? null,
              ]
            );
          }

          const response: ScraperSettingsResponse = {
            enabled: settingsRow?.scraperEnabled ?? env.scraperEnabled,
            rateLimitPerDomain:
              settingsRow?.scraperRateLimitPerDomain ??
              env.scraperRateLimitPerDomain ??
              DEFAULT_RATE_LIMIT,
            timeoutMs: settingsRow?.scraperTimeoutMs ?? env.scraperTimeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxConcurrentPages:
              settingsRow?.scraperMaxConcurrentPages ??
              env.scraperMaxConcurrentPages ??
              DEFAULT_MAX_PAGES,
            userAgent: settingsRow?.scraperUserAgent ?? env.scraperUserAgent ?? DEFAULT_UA,
            robotsCacheTtl:
              settingsRow?.scraperRobotsCacheTtl ?? env.scraperRobotsCacheTtl ?? DEFAULT_ROBOTS_TTL,
            respectRobotsTxt: true,
            browserStatus,
            refreshedAt: nowIso(),
            todayStats: {
              pagesScraped,
              successRate: pagesScraped > 0 ? successCount / pagesScraped : 0,
              avgLatencyMs: Number(row?.avg_latency_ms ?? 0),
              robotsBlocked: Number(row?.robots_blocked ?? 0),
              deduped: Number(row?.deduped ?? 0),
              loginDetected: Number(row?.login_detected ?? 0),
              cheerioFastPath: Number(row?.cheerio_fast_path ?? 0),
            },
            weekTrends: {
              pagesScraped: trends.rows.map((t) => Number(t.total ?? 0)),
              success: trends.rows.map((t) => Number(t.success ?? 0)),
              failed: trends.rows.map((t) => Number(t.failed ?? 0)),
              deduped: trends.rows.map((t) => Number(t.deduped ?? 0)),
            },
            domainPerformance: domains.rows.map((d) => {
              const total = Number(d.total_pages ?? 0);
              const success = Number(d.success_count ?? 0);
              return {
                domain: d.domain,
                totalPages: total,
                successRate: total > 0 ? success / total : 0,
                avgLatencyMs: Number(d.avg_latency_ms ?? 0),
                robotsBlocked: Number(d.robots_blocked ?? 0),
                lastScrapedAt: d.last_scraped_at ?? null,
              };
            }),
          };
          return response;
        });
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ error }, 'Failed to load scraper settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
      }
    }
  );

  server.put(
    '/settings/scraper',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const body = (request.body ?? {}) as ScraperSettingsUpdateRequest;
      if (
        body.rateLimitPerDomain !== undefined &&
        (body.rateLimitPerDomain < 1 || body.rateLimitPerDomain > 100)
      ) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid rate limit'));
      }
      if (body.timeoutMs !== undefined && (body.timeoutMs < 1000 || body.timeoutMs > 120_000)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid timeout'));
      }
      if (
        body.maxConcurrentPages !== undefined &&
        (body.maxConcurrentPages < 1 || body.maxConcurrentPages > 100)
      ) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid max concurrent pages'));
      }
      if (
        body.robotsCacheTtl !== undefined &&
        (body.robotsCacheTtl < 60 || body.robotsCacheTtl > 604_800)
      ) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid robots cache TTL'));
      }
      if (body.userAgent?.trim().length === 0) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid user agent'));
      }

      try {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `INSERT INTO shop_ai_credentials (shop_id)
             VALUES ($1)
             ON CONFLICT (shop_id) DO NOTHING`,
            [session.shopId]
          );

          const updates: string[] = [];
          const values: (string | number | boolean)[] = [session.shopId];
          let idx = 2;

          if (body.enabled !== undefined) {
            updates.push(`scraper_enabled = $${idx++}`);
            values.push(body.enabled);
            updates.push(`scraper_connection_status = $${idx++}`);
            values.push(body.enabled ? 'pending' : 'disabled');
            updates.push(`scraper_last_error = NULL`);
          }
          if (body.rateLimitPerDomain !== undefined) {
            updates.push(`scraper_rate_limit_per_domain = $${idx++}`);
            values.push(body.rateLimitPerDomain);
          }
          if (body.timeoutMs !== undefined) {
            updates.push(`scraper_timeout_ms = $${idx++}`);
            values.push(body.timeoutMs);
          }
          if (body.maxConcurrentPages !== undefined) {
            updates.push(`scraper_max_concurrent_pages = $${idx++}`);
            values.push(body.maxConcurrentPages);
          }
          if (body.userAgent !== undefined) {
            updates.push(`scraper_user_agent = $${idx++}`);
            values.push(body.userAgent.trim());
          }
          if (body.robotsCacheTtl !== undefined) {
            updates.push(`scraper_robots_cache_ttl = $${idx}`);
            values.push(body.robotsCacheTtl);
          }

          if (updates.length > 0) {
            await client.query(
              `UPDATE shop_ai_credentials
               SET ${updates.join(', ')}, updated_at = now()
               WHERE shop_id = $1`,
              values
            );
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to update scraper settings');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update settings')
          );
      }

      return reply.send(successEnvelope(request.id, { updated: true }));
    }
  );

  server.get(
    '/settings/scraper/configs',
    { preHandler: [requireSession(sessionConfig)] },
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
            source_id: string;
            source_name: string;
            name: string;
            scraper_type: 'CHEERIO' | 'PLAYWRIGHT' | 'PUPPETEER';
            target_url_pattern: string;
            is_active: boolean;
            last_run_at: string | null;
            success_rate: string | null;
            rate_limit: { requestsPerSecond?: number } | null;
            proxy_config: { type: string; host: string } | null;
          }>(
            `SELECT
               sc.id,
               sc.source_id,
               ps.name as source_name,
               sc.name,
               sc.scraper_type,
               sc.target_url_pattern,
               sc.is_active,
               sc.last_run_at::text,
               sc.success_rate::text,
               sc.rate_limit,
               sc.proxy_config
             FROM scraper_configs sc
             JOIN prod_sources ps ON ps.id = sc.source_id
             WHERE sc.shop_id = $1
             ORDER BY sc.created_at DESC`,
            [session.shopId]
          );
          return result.rows;
        });
        const data: ScraperConfigResponse[] = rows.map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          sourceName: r.source_name,
          name: r.name,
          scraperType: r.scraper_type,
          targetUrlPattern: r.target_url_pattern,
          isActive: r.is_active,
          lastRunAt: r.last_run_at,
          successRate: r.success_rate != null ? Number(r.success_rate) : null,
          rateLimit: r.rate_limit?.requestsPerSecond
            ? { requestsPerSecond: Number(r.rate_limit.requestsPerSecond) }
            : null,
          proxyConfig: r.proxy_config ?? null,
        }));
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ error }, 'Failed to list scraper configs');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to list configs'));
      }
    }
  );

  server.get(
    '/settings/scraper/sources',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const sources = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{ id: string; name: string }>(
            `SELECT id, name
               FROM prod_sources
              WHERE is_active = true
                AND (shop_id = $1 OR shop_id IS NULL)
              ORDER BY name ASC`,
            [session.shopId]
          );
          return result.rows;
        });
        return reply.send(successEnvelope(request.id, { sources }));
      } catch (error) {
        logger.error({ error }, 'Failed to list scraper sources');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to list sources'));
      }
    }
  );

  server.post(
    '/settings/scraper/configs',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const body = (request.body ?? {}) as Partial<ScraperConfigResponse>;
      if (!body.sourceId || !body.name || !body.targetUrlPattern) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing required fields'));
      }
      try {
        const created = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{ id: string }>(
            `INSERT INTO scraper_configs
             (shop_id, source_id, name, scraper_type, target_url_pattern, selectors, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
             RETURNING id`,
            [
              session.shopId,
              body.sourceId,
              body.name,
              body.scraperType ?? 'PLAYWRIGHT',
              body.targetUrlPattern,
              JSON.stringify({}),
              body.isActive ?? true,
            ]
          );
          return result.rows[0]?.id ?? null;
        });
        return reply.send(successEnvelope(request.id, { id: created }));
      } catch (error) {
        logger.error({ error }, 'Failed to create scraper config');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to create config'));
      }
    }
  );

  server.put(
    '/settings/scraper/configs/:id',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const params = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<ScraperConfigResponse>;
      try {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `UPDATE scraper_configs
             SET
               name = COALESCE($2, name),
               target_url_pattern = COALESCE($3, target_url_pattern),
               is_active = COALESCE($4, is_active),
               updated_at = now()
             WHERE id = $1
               AND shop_id = $5`,
            [
              params.id,
              body.name ?? null,
              body.targetUrlPattern ?? null,
              body.isActive ?? null,
              session.shopId,
            ]
          );
        });
        return reply.send(successEnvelope(request.id, { updated: true }));
      } catch (error) {
        logger.error({ error }, 'Failed to update scraper config');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update config'));
      }
    }
  );

  server.delete(
    '/settings/scraper/configs/:id',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const params = request.params as { id: string };
      try {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `UPDATE scraper_configs
             SET is_active = false, updated_at = now()
             WHERE id = $1
               AND shop_id = $2`,
            [params.id, session.shopId]
          );
        });
        return reply.send(successEnvelope(request.id, { deleted: true }));
      } catch (error) {
        logger.error({ error }, 'Failed to delete scraper config');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to delete config'));
      }
    }
  );

  server.get(
    '/settings/scraper/runs',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const q = request.query as { page?: string; limit?: string; from?: string; to?: string };
      const page = Math.max(1, Number(q.page ?? 1));
      const limit = Math.min(100, Math.max(1, Number(q.limit ?? 25)));
      const offset = (page - 1) * limit;
      try {
        const rows = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{
            id: string;
            config_id: string;
            config_name: string;
            status: ScraperRunResponse['status'];
            method: ScraperRunResponse['method'];
            pages_crawled: string;
            products_found: string;
            errors_count: string;
            content_hashes_deduped: string;
            duration_ms: string | null;
            started_at: string | null;
            completed_at: string | null;
          }>(
            `SELECT
               sr.id,
               sr.config_id,
               sc.name as config_name,
               sr.status,
               COALESCE(sr.method, 'playwright') as method,
               sr.pages_crawled::text,
               sr.products_found::text,
               sr.errors_count::text,
               COALESCE(sr.content_hashes_deduped,0)::text AS content_hashes_deduped,
               sr.duration_ms::text,
               sr.started_at::text,
               sr.completed_at::text
             FROM scraper_runs sr
             JOIN scraper_configs sc ON sc.id = sr.config_id
             WHERE sr.shop_id = $1
               AND ($2::timestamptz IS NULL OR sr.started_at >= $2)
               AND ($3::timestamptz IS NULL OR sr.started_at <= $3)
             ORDER BY sr.created_at DESC
             LIMIT $4 OFFSET $5`,
            [session.shopId, q.from ?? null, q.to ?? null, limit, offset]
          );
          return result.rows;
        });
        const data: ScraperRunResponse[] = rows.map((r) => ({
          id: r.id,
          configId: r.config_id,
          configName: r.config_name,
          status: r.status,
          method: r.method,
          pagesCrawled: Number(r.pages_crawled ?? 0),
          productsFound: Number(r.products_found ?? 0),
          errorsCount: Number(r.errors_count ?? 0),
          contentHashesDeduped: Number(r.content_hashes_deduped ?? 0),
          durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
          startedAt: r.started_at,
          completedAt: r.completed_at,
        }));
        return reply.send(successEnvelope(request.id, { page, limit, items: data }));
      } catch (error) {
        logger.error({ error }, 'Failed to list scraper runs');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to list runs'));
      }
    }
  );

  server.get(
    '/settings/scraper/health',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const data = await probeBrowserStatus();
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `INSERT INTO shop_ai_credentials (shop_id)
             VALUES ($1)
             ON CONFLICT (shop_id) DO NOTHING`,
            [session.shopId]
          );
          await client.query(
            `UPDATE shop_ai_credentials
             SET
               scraper_connection_status = $2,
               scraper_last_checked_at = now(),
               scraper_last_success_at = CASE WHEN $2 = 'ok' THEN now() ELSE scraper_last_success_at END,
               scraper_last_error = CASE WHEN $2 = 'error' THEN $3 ELSE NULL END,
               updated_at = now()
             WHERE shop_id = $1`,
            [
              session.shopId,
              data.status === 'available'
                ? 'ok'
                : data.status === 'not_installed'
                  ? 'not_installed'
                  : data.status === 'error'
                    ? 'error'
                    : 'pending',
              data.message ?? null,
            ]
          );
        });
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        const data: ScraperHealthResponse = {
          status: 'error',
          message: error instanceof Error ? error.message : 'Browser health probe failed',
          checkedAt: nowIso(),
        };
        return reply.send(successEnvelope(request.id, data));
      }
    }
  );

  server.post(
    '/settings/scraper/robots-test',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const body = (request.body ?? {}) as { url?: string };
      if (!body.url) {
        return reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing url'));
      }
      const redis = new Redis(env.redisUrl);
      try {
        const allowed = await isUrlAllowed(
          body.url,
          redis,
          env.scraperUserAgent ?? DEFAULT_UA,
          env.scraperRobotsCacheTtl ?? DEFAULT_ROBOTS_TTL
        );
        const domain = getDomain(body.url);
        const key = `scraper:robots:${domain}`;
        const cached = await redis.exists(key);
        const data: ScraperRobotsTestResponse = {
          url: body.url,
          domain,
          allowed,
          robotsTxtFound: cached > 0,
          robotsTxtCached: cached > 0,
          checkedAt: nowIso(),
          relevantRules: [],
        };
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ error }, 'robots test failed');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Robots test failed'));
      } finally {
        await redis.quit();
      }
    }
  );

  server.get(
    '/settings/scraper/queue-status',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const row = await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `DELETE FROM scraper_queue
             WHERE status IN ('completed', 'failed')
               AND shop_id = $1
               AND created_at < now() - interval '7 days'`,
            [session.shopId]
          );
          const result = await client.query<{
            pending: string;
            processing: string;
            completed: string;
            failed: string;
            oldest_pending_at: string | null;
          }>(
            `SELECT
               COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
               COUNT(*) FILTER (WHERE status = 'processing')::text AS processing,
               COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
               COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
               MIN(created_at) FILTER (WHERE status = 'pending')::text AS oldest_pending_at
             FROM scraper_queue
             WHERE shop_id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });
        const data: ScraperQueueStatusResponse = {
          pending: Number(row?.pending ?? 0),
          processing: Number(row?.processing ?? 0),
          completed: Number(row?.completed ?? 0),
          failed: Number(row?.failed ?? 0),
          oldestPendingAt: row?.oldest_pending_at ?? null,
        };
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ error }, 'Failed queue status');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed queue status'));
      }
    }
  );

  server.post(
    '/settings/scraper/queue/purge-failed',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const result = await withTenantContext(session.shopId, async (client) => {
          const deleted = await client.query<{ count: string }>(
            `WITH rows AS (
               DELETE FROM scraper_queue
                WHERE status = 'failed'
                  AND shop_id = $1
              RETURNING 1
             )
             SELECT COUNT(*)::text AS count FROM rows`,
            [session.shopId]
          );
          return Number(deleted.rows[0]?.count ?? 0);
        });
        return reply.send(successEnvelope(request.id, { deleted: result }));
      } catch (error) {
        logger.error({ error }, 'Failed purge failed queue items');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to purge failed items')
          );
      }
    }
  );

  server.post(
    '/settings/scraper/queue/retry-failed',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      try {
        const result = await withTenantContext(session.shopId, async (client) => {
          const updated = await client.query<{ count: string }>(
            `WITH rows AS (
               UPDATE scraper_queue
                  SET status = 'pending',
                      next_attempt_at = now(),
                      error_message = NULL
                WHERE status = 'failed'
                  AND shop_id = $1
              RETURNING 1
             )
             SELECT COUNT(*)::text AS count FROM rows`,
            [session.shopId]
          );
          return Number(updated.rows[0]?.count ?? 0);
        });
        return reply.send(successEnvelope(request.id, { retried: result }));
      } catch (error) {
        logger.error({ error }, 'Failed retry failed queue items');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to retry failed items')
          );
      }
    }
  );

  server.get(
    '/settings/scraper/activity',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const days = Math.max(
        1,
        Math.min(30, Number((request.query as { days?: string }).days ?? 7))
      );
      try {
        const rows = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{
            day: string;
            cheerio: string;
            playwright: string;
            failed: string;
            robots_blocked: string;
            deduped: string;
          }>(
            `WITH days AS (
               SELECT generate_series(
                 date_trunc('day', now()) - ($2::int - 1) * interval '1 day',
                 date_trunc('day', now()),
                 interval '1 day'
               )::date AS day
             ),
             agg AS (
               SELECT
                 DATE(COALESCE(started_at, created_at)) AS day,
                 COUNT(*) FILTER (WHERE method = 'cheerio')::text AS cheerio,
                 COUNT(*) FILTER (WHERE method = 'playwright')::text AS playwright,
                 COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
                 COUNT(*) FILTER (WHERE status = 'robots_blocked')::text AS robots_blocked,
                 COALESCE(SUM(content_hashes_deduped),0)::text AS deduped
               FROM scraper_runs
               WHERE shop_id = $1
               GROUP BY DATE(COALESCE(started_at, created_at))
             )
             SELECT
               days.day::text AS day,
               COALESCE(agg.cheerio,'0') AS cheerio,
               COALESCE(agg.playwright,'0') AS playwright,
               COALESCE(agg.failed,'0') AS failed,
               COALESCE(agg.robots_blocked,'0') AS robots_blocked,
               COALESCE(agg.deduped,'0') AS deduped
             FROM days
             LEFT JOIN agg ON agg.day = days.day
             ORDER BY days.day`,
            [session.shopId, days]
          );
          return result.rows;
        });
        const data: ScraperActivityDataPoint[] = rows.map((r) => ({
          date: r.day,
          cheerio: Number(r.cheerio ?? 0),
          playwright: Number(r.playwright ?? 0),
          failed: Number(r.failed ?? 0),
          robotsBlocked: Number(r.robots_blocked ?? 0),
          deduped: Number(r.deduped ?? 0),
        }));
        return reply.send(successEnvelope(request.id, data));
      } catch (error) {
        logger.error({ error }, 'Failed activity');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed activity'));
      }
    }
  );
};
