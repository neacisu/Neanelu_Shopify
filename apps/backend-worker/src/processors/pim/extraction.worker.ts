import { createHash } from 'crypto';
import { Redis } from 'ioredis';

import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import type { AppEnv } from '@app/config';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { pool, withTenantContext } from '@app/database';
import {
  createExtractionSession,
  updateSpecsExtracted,
  XaiExtractorService,
  SimpleHTMLFetcher,
} from '@app/pim';
import { scrapeProductPage, extractJsonLd } from '@app/scraper';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { loadXAICredentials } from '../../services/xai-credentials.js';
import { enqueueConsensusJob } from '../../queue/consensus-queue.js';
import {
  decrementScraperBrowserActivePages,
  incrementScraperBrowserActivePages,
  recordPimApiUsage,
  recordScraperAttempt,
  recordScraperCheerioFastPathHit,
  recordScraperDeduped,
  recordScraperFailure,
  recordScraperLatency,
  recordScraperLoginDetected,
  recordScraperRobotsBlocked,
  recordScraperSuccess,
} from '../../otel/metrics.js';

const warnLogger = (logger: Logger) =>
  logger as Logger & {
    warn: (data: Record<string, unknown>, message: string) => void;
  };

interface XaiCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokensPerRequest: number;
  rateLimitPerMinute: number;
  dailyBudget: number;
  budgetAlertThreshold: number;
}

interface ExtractionResult {
  success: boolean;
  data?: Record<string, unknown> & {
    confidence?: { overall?: number; fieldsUncertain?: string[] };
  };
  tokensUsed: { input: number; output: number };
  latencyMs: number;
  error?: string;
}

interface Extractor {
  extractProductFromHTML: (params: {
    html: string;
    sourceUrl: string;
    shopId: string;
    credentials: XaiCredentials;
    matchId?: string;
    productId?: string;
  }) => Promise<ExtractionResult>;
}

interface NewExtractionSession {
  harvestId: string;
  agentVersion: string;
  modelName?: string;
  extractedSpecs: Record<string, unknown>;
  groundingSnippets?: Record<string, unknown>;
  confidenceScore?: number;
  fieldConfidences?: Record<string, unknown>;
  tokensUsed?: number;
  latencyMs?: number;
  errorMessage?: string;
}

interface Fetcher {
  fetchHTML: (url: string) => Promise<{
    html: string;
    statusCode: number;
    contentType: string;
    fetchedAt: Date;
    error?: string;
  }>;
}

type SimpleHTMLFetcherConstructor = new () => Fetcher;

type LoadXAICredentialsFn = (params: {
  shopId: string;
  encryptionKeyHex: string;
}) => Promise<XaiCredentials | null>;

type CreateExtractionSessionFn = (params: NewExtractionSession) => Promise<{ id: string }>;

type UpdateSpecsExtractedFn = (params: {
  id: string;
  specsExtracted: Record<string, unknown>;
  extractionSessionId: string;
}) => Promise<void>;

const loadXAICredentialsSafe = loadXAICredentials as LoadXAICredentialsFn;
const createExtractionSessionSafe = createExtractionSession as CreateExtractionSessionFn;
const updateSpecsExtractedSafe = updateSpecsExtracted as UpdateSpecsExtractedFn;
const SimpleHTMLFetcherSafe = SimpleHTMLFetcher as unknown as SimpleHTMLFetcherConstructor;

type ExtractorConstructor = new () => Extractor;

const XaiExtractorServiceSafe = XaiExtractorService as unknown as ExtractorConstructor;

export const PIM_EXTRACTION_QUEUE_NAME = 'pim-extraction';
export const PIM_EXTRACTION_JOB = 'extract-specs';

type ExtractionJobPayload = Readonly<{
  shopId: string;
  matchId: string;
}>;

export interface ExtractionWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startExtractionWorker(logger: Logger): ExtractionWorkerHandle {
  const env = loadEnv();
  const scraperQueueSweepId = setInterval(() => {
    void runScraperQueueSweep(env, logger);
  }, 30_000);
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_EXTRACTION_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('pim-extraction-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (job.name !== PIM_EXTRACTION_JOB) {
              throw new Error(`unknown_extraction_job:${job.name}`);
            }

            const payload = job.data as ExtractionJobPayload | null;
            if (!payload?.shopId || !payload.matchId) {
              throw new Error('invalid_extraction_payload');
            }

            const match = await withTenantContext(payload.shopId, async (client) => {
              const result = await client.query<{
                id: string;
                source_url: string;
                product_id: string | null;
                source_id: string | null;
              }>(
                `SELECT id, source_url, product_id, source_id
                   FROM prod_similarity_matches
                  WHERE id = $1`,
                [payload.matchId]
              );
              return result.rows[0] ?? null;
            });

            if (!match) {
              warnLogger(logger).warn({ matchId: payload.matchId }, 'Extraction match not found');
              return;
            }

            const existingHarvest = await withTenantContext(payload.shopId, async (client) => {
              const result = await client.query<{ id: string; raw_html: string | null }>(
                `SELECT id, raw_html
                   FROM prod_raw_harvest
                  WHERE source_url = $1
                  ORDER BY fetched_at DESC
                  LIMIT 1`,
                [match.source_url]
              );
              return result.rows[0] ?? null;
            });

            let harvestId = existingHarvest?.id ?? null;
            let html = existingHarvest?.raw_html ?? null;

            if (!html) {
              const fetcher = new SimpleHTMLFetcherSafe();
              const fetched = await fetcher.fetchHTML(match.source_url);

              const domain = (() => {
                try {
                  return new URL(match.source_url).hostname.toLowerCase();
                } catch {
                  return 'unknown';
                }
              })();

              if (fetched.html) {
                const staticJsonLd = extractJsonLd(fetched.html);
                if (staticJsonLd.length > 0) {
                  html = fetched.html;
                  recordScraperCheerioFastPathHit(domain);
                  recordScraperSuccess(domain, 'cheerio');
                  recordScraperLatency(domain, 'cheerio', 0.01);
                }
              }

              if (!html) {
                const scraperSettings = await withTenantContext(payload.shopId, async (client) =>
                  resolveScraperRuntimeSettings(client, payload.shopId, env)
                );
                if (!scraperSettings.enabled) {
                  return;
                }
                const scraperStart = Date.now();
                recordScraperAttempt(domain, 'playwright');
                const sourceId = await withTenantContext(payload.shopId, async (client) =>
                  resolveSourceId(client, match.source_id, match.source_url)
                );
                const sourceConfig = await withTenantContext(payload.shopId, async (client) => {
                  const result = await client.query<{
                    id: string;
                    source_id: string;
                    target_url_pattern: string;
                    rate_limit: { requestsPerSecond?: number } | null;
                    headers: Record<string, string> | null;
                    cookies:
                      | { name: string; value: string; domain?: string; path?: string }[]
                      | null;
                    proxy_config: {
                      server?: string;
                      username?: string;
                      password?: string;
                      host?: string;
                      port?: number;
                      protocol?: 'http' | 'https' | 'socks5';
                    } | null;
                  }>(
                    `SELECT id, source_id, target_url_pattern, rate_limit, headers, cookies, proxy_config
                     FROM scraper_configs
                     WHERE shop_id = $2
                       AND is_active = true
                       AND $1 ~ target_url_pattern
                     ORDER BY updated_at DESC
                     LIMIT 1`,
                    [match.source_url, payload.shopId]
                  );
                  const row = result.rows[0];
                  if (!row) return null;
                  return {
                    id: row.id,
                    sourceId: row.source_id,
                    targetUrlPattern: row.target_url_pattern,
                    rateLimit: row.rate_limit,
                    headers: row.headers,
                    cookies: row.cookies,
                    proxyConfig: row.proxy_config,
                  };
                });
                const configId =
                  sourceConfig?.id ??
                  (await withTenantContext(payload.shopId, async (client) =>
                    ensureDefaultScraperConfig(client, payload.shopId, sourceId, match.source_url)
                  ));
                const redisClient = new Redis(env.redisUrl);
                let activeRunId: string | null = null;
                const scrapeResult = await scrapeProductPage(match.source_url, {
                  redis: redisClient,
                  userAgent: scraperSettings.userAgent,
                  timeoutMs: scraperSettings.timeoutMs,
                  rateLimitPerDomain: scraperSettings.rateLimitPerDomain,
                  robotsCacheTtlSeconds: scraperSettings.robotsCacheTtl,
                  maxConcurrentPages: scraperSettings.maxConcurrentPages,
                  sourceId,
                  sourceConfig: sourceConfig ?? {
                    id: configId,
                    sourceId,
                    targetUrlPattern: '.*',
                    rateLimit: null,
                    headers: null,
                    cookies: null,
                    proxyConfig: null,
                  },
                  shouldStopForQueue: true,
                  onRateLimited: async ({ url, retryAtIso, configId: maybeConfigId }) => {
                    await withTenantContext(payload.shopId, async (client) => {
                      await client.query(
                        `INSERT INTO scraper_queue
                           (shop_id, config_id, url, status, attempts, max_attempts, next_attempt_at, created_at)
                         VALUES ($1, $2, $3, 'pending', 0, 3, $4::timestamptz, now())`,
                        [payload.shopId, maybeConfigId ?? configId, url, retryAtIso]
                      );
                    });
                  },
                  fetchStaticHtml: () => Promise.resolve(fetched.html ?? null),
                  onBrowserPage: (delta) => {
                    if (delta === 1) incrementScraperBrowserActivePages(domain);
                    else decrementScraperBrowserActivePages(domain);
                  },
                  isKnownHash: async (hash) => {
                    const existing = await withTenantContext(payload.shopId, async (client) => {
                      const result = await client.query<{ id: string }>(
                        `SELECT id FROM prod_raw_harvest WHERE content_hash = $1 LIMIT 1`,
                        [hash]
                      );
                      return result.rows[0]?.id ?? null;
                    });
                    return Boolean(existing);
                  },
                  createRunRecord: async (run) => {
                    await withTenantContext(payload.shopId, async (client) => {
                      if (run.status === 'running') {
                        const inserted = await client.query<{ id: string }>(
                          `INSERT INTO scraper_runs
                           (shop_id, config_id, source_id, status, trigger_type, target_urls, started_at, created_at)
                           VALUES ($1, $2, $3, 'running', 'extraction_fallback', ARRAY[$4], now(), now())
                           RETURNING id`,
                          [payload.shopId, configId, sourceId, match.source_url]
                        );
                        activeRunId = inserted.rows[0]?.id ?? null;
                        return;
                      }
                      const runId = activeRunId;
                      if (!runId) return;
                      await client.query(
                        `UPDATE scraper_runs
                           SET status = $2,
                               duration_ms = $3,
                               errors_count = COALESCE($4, errors_count),
                               content_hashes_deduped = COALESCE($5, content_hashes_deduped),
                               method = COALESCE($6, method),
                               completed_at = now(),
                               error_log = COALESCE($7::jsonb, error_log)
                         WHERE id = $1
                           AND shop_id = $8`,
                        [
                          runId,
                          run.status,
                          run.durationMs ?? 0,
                          run.errorsCount ?? null,
                          run.contentHashesDeduped ?? null,
                          run.method ?? null,
                          run.errorLog ? JSON.stringify(run.errorLog) : null,
                          payload.shopId,
                        ]
                      );
                    });
                  },
                  trackUsage: async (usage) => {
                    await withTenantContext(payload.shopId, async (client) => {
                      await client.query(
                        `INSERT INTO api_usage_log
                           (api_provider, endpoint, request_count, estimated_cost, response_time_ms, product_id, shop_id, created_at)
                         VALUES ('scraper', $1, 1, 0, $2, $3, $4, now())`,
                        [
                          usage.endpoint.slice(0, 100),
                          usage.responseTimeMs,
                          match.product_id,
                          payload.shopId,
                        ]
                      );
                    });
                    recordPimApiUsage({
                      provider: 'scraper',
                      operation: 'other',
                      estimatedCost: 0,
                      requestCount: 1,
                      responseTimeMs: usage.responseTimeMs,
                    });
                  },
                });

                try {
                  const robotsBlockKey = `scraper:robots:block:streak:${domain}`;
                  const failureKey = `scraper:failure:streak:${domain}`;
                  const failureWindowTotalKey = `scraper:failure:window:total:${domain}`;
                  const failureWindowFailKey = `scraper:failure:window:fail:${domain}`;
                  const failureAlertCooldownKey = `scraper:failure:alert:cooldown:${domain}`;
                  if (scrapeResult.status === 'success') {
                    html = scrapeResult.html;
                    if (scrapeResult.method === 'cheerio') {
                      recordScraperSuccess(domain, 'cheerio');
                    } else {
                      recordScraperSuccess(domain, 'playwright');
                    }
                    recordScraperLatency(
                      domain,
                      scrapeResult.method,
                      (Date.now() - scraperStart) / 1000
                    );
                    await redisClient.del(robotsBlockKey);
                    await redisClient.del(failureKey);
                    await redisClient.incr(failureWindowTotalKey);
                    await redisClient.expire(failureWindowTotalKey, 1800);
                  } else if (scrapeResult.reason === 'deduped') {
                    recordScraperDeduped(domain, 'playwright');
                    await redisClient.incr(failureWindowTotalKey);
                    await redisClient.expire(failureWindowTotalKey, 1800);
                  } else if (scrapeResult.status === 'robots_blocked') {
                    recordScraperRobotsBlocked(domain);
                    await redisClient.incr(failureWindowTotalKey);
                    await redisClient.expire(failureWindowTotalKey, 1800);
                    const robotsStreak = await redisClient.incr(robotsBlockKey);
                    await redisClient.expire(robotsBlockKey, 3600);
                    await withTenantContext(payload.shopId, async (client) => {
                      await client.query(
                        `INSERT INTO pim_notifications (shop_id, type, title, body, read, created_at)
                         VALUES ($1, 'scraper.robots.blocked', 'Scraper blocked by robots.txt', $2::jsonb, false, now())`,
                        [payload.shopId, JSON.stringify({ url: match.source_url, domain })]
                      );
                      if (robotsStreak >= 5) {
                        await client.query(
                          `INSERT INTO pim_notifications (shop_id, type, title, body, read, created_at)
                           VALUES ($1, 'scraper.robots.mass_block', 'Scraper robots mass block', $2::jsonb, false, now())`,
                          [
                            payload.shopId,
                            JSON.stringify({ domain, blockedConsecutive: robotsStreak }),
                          ]
                        );
                      }
                    });
                  } else if (scrapeResult.status === 'login_detected') {
                    recordScraperLoginDetected(domain, 'playwright');
                    await redisClient.incr(failureWindowTotalKey);
                    await redisClient.expire(failureWindowTotalKey, 1800);
                    await withTenantContext(payload.shopId, async (client) => {
                      await client.query(
                        `INSERT INTO pim_notifications (shop_id, type, title, body, read, created_at)
                         VALUES ($1, 'scraper.login.detected', 'Scraper login wall detected', $2::jsonb, false, now())`,
                        [payload.shopId, JSON.stringify({ url: match.source_url, domain })]
                      );
                    });
                  } else {
                    recordScraperFailure(domain, 'playwright');
                    const failureStreak = await redisClient.incr(failureKey);
                    await redisClient.expire(failureKey, 1800);
                    const [total, fail]: [number, number] = await redisClient
                      .multi()
                      .incr(failureWindowTotalKey)
                      .expire(failureWindowTotalKey, 1800)
                      .incr(failureWindowFailKey)
                      .expire(failureWindowFailKey, 1800)
                      .exec()
                      .then((rows) => {
                        const totalValue = Number(rows?.[0]?.[1] ?? 0);
                        const failValue = Number(rows?.[2]?.[1] ?? 0);
                        return [totalValue, failValue];
                      });
                    const failureRatio = total > 0 ? fail / total : 0;
                    const canNotifyFailureRatio =
                      !(await redisClient.exists(failureAlertCooldownKey));
                    await withTenantContext(payload.shopId, async (client) => {
                      await client.query(
                        `INSERT INTO scraper_queue
                           (shop_id, config_id, url, status, attempts, max_attempts, next_attempt_at, created_at)
                         VALUES ($1, $2, $3, 'pending', 1, 3, now() + interval '1 minute', now())`,
                        [payload.shopId, configId, match.source_url]
                      );
                      await client.query(
                        `INSERT INTO pim_notifications (shop_id, type, title, body, read, created_at)
                         VALUES ($1, 'scraper.page.failed', 'Scraper page failed', $2::jsonb, false, now())`,
                        [payload.shopId, JSON.stringify({ url: match.source_url, domain })]
                      );
                      if (
                        failureStreak >= 3 ||
                        (total >= 6 && failureRatio > 0.5 && canNotifyFailureRatio)
                      ) {
                        await client.query(
                          `INSERT INTO pim_notifications (shop_id, type, title, body, read, created_at)
                           VALUES ($1, 'scraper.failure.high_rate', 'Scraper failure rate > 50%', $2::jsonb, false, now())`,
                          [
                            payload.shopId,
                            JSON.stringify({
                              domain,
                              failureStreak,
                              failureRatio,
                              windowTotal: total,
                            }),
                          ]
                        );
                        await redisClient.set(failureAlertCooldownKey, '1', 'EX', 900);
                      }
                    });
                  }
                } finally {
                  await redisClient.quit();
                }
              }

              if (!html) {
                if (fetched.error || !fetched.html) {
                  warnLogger(logger).warn(
                    { matchId: payload.matchId, error: fetched.error },
                    'Failed to fetch HTML for extraction'
                  );
                }
                return;
              }

              const contentHash = createHash('sha256').update(html).digest('hex');
              const sourceId = await withTenantContext(payload.shopId, async (client) => {
                return resolveSourceId(client, match.source_id, match.source_url);
              });

              harvestId = await withTenantContext(payload.shopId, async (client) => {
                const insert = await client.query<{ id: string }>(
                  `INSERT INTO prod_raw_harvest (
                     source_id,
                     source_url,
                     raw_json,
                     raw_html,
                     http_status,
                     processing_status,
                     content_hash,
                     fetched_at,
                     created_at
                   )
                   VALUES ($1, $2, $3, $4, $5, 'pending', $6, now(), now())
                   RETURNING id`,
                  [
                    sourceId,
                    match.source_url,
                    JSON.stringify({}),
                    html,
                    fetched.statusCode,
                    contentHash,
                  ]
                );
                return insert.rows[0]?.id ?? null;
              });
            }

            if (!harvestId || !html) {
              warnLogger(logger).warn(
                { matchId: payload.matchId },
                'Missing harvest data for extraction'
              );
              return;
            }

            const credentials = await loadXAICredentialsSafe({
              shopId: payload.shopId,
              encryptionKeyHex: env.encryptionKeyHex,
            });
            if (!credentials) {
              warnLogger(logger).warn(
                { shopId: payload.shopId },
                'xAI credentials missing for extraction'
              );
              return;
            }

            const extractor = new XaiExtractorServiceSafe();
            const extraction = await extractor.extractProductFromHTML({
              html,
              sourceUrl: match.source_url,
              shopId: payload.shopId,
              credentials,
              ...(match.id ? { matchId: match.id } : {}),
              ...(match.product_id ? { productId: match.product_id } : {}),
            });

            const confidenceOverall = extraction.data?.confidence?.overall;
            const fieldsUncertain = extraction.data?.confidence?.fieldsUncertain;
            const extractedSpecs = extraction.data ?? {};

            const sessionPayload: NewExtractionSession = {
              harvestId,
              agentVersion: 'xai-extractor-v1.0',
              modelName: credentials.model,
              extractedSpecs,
              tokensUsed: extraction.tokensUsed.input + extraction.tokensUsed.output,
              latencyMs: extraction.latencyMs,
            };

            if (confidenceOverall !== undefined) {
              sessionPayload.confidenceScore = confidenceOverall;
            }
            if (fieldsUncertain) {
              sessionPayload.fieldConfidences = { fieldsUncertain };
            }
            if (extraction.error) {
              sessionPayload.errorMessage = extraction.error;
            }

            const session = await createExtractionSessionSafe(sessionPayload);

            if (extraction.data) {
              await updateSpecsExtractedSafe({
                id: match.id,
                specsExtracted: extractedSpecs,
                extractionSessionId: session.id,
              });

              if (match.product_id) {
                await enqueueConsensusJob({
                  shopId: payload.shopId,
                  productId: match.product_id,
                  trigger: 'extraction_complete',
                });
              }
            }
          } finally {
            clearWorkerCurrentJob('pim-extraction-worker', jobId);
          }
        }),
    }
  );

  return {
    worker,
    close: async () => {
      clearInterval(scraperQueueSweepId);
      await worker.close();
    },
  };
}

async function runScraperQueueSweep(env: AppEnv, logger: Logger): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM scraper_queue
       WHERE status IN ('completed', 'failed')
         AND created_at < now() - interval '7 days'`
    );

    const dueRows = await pool.query<{
      id: string;
      shop_id: string | null;
      config_id: string;
      url: string;
      attempts: number;
      max_attempts: number;
    }>(
      `WITH due AS (
         SELECT id, shop_id, config_id, url, attempts, max_attempts
         FROM scraper_queue
         WHERE status = 'pending'
           AND shop_id IS NOT NULL
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         ORDER BY priority DESC, created_at ASC
         LIMIT 25
         FOR UPDATE SKIP LOCKED
       )
       UPDATE scraper_queue q
          SET status = 'processing',
              attempts = q.attempts + 1,
              last_attempt_at = now()
         FROM due
        WHERE q.id = due.id
      RETURNING q.id, q.shop_id, q.config_id, q.url, q.attempts, q.max_attempts`
    );

    for (const row of dueRows.rows) {
      const shopId = row.shop_id;
      if (!shopId) {
        continue;
      }

      const attemptNo = Number(row.attempts ?? 0);
      const maxAttempts = Number(row.max_attempts ?? 3);
      if (attemptNo > maxAttempts) {
        await pool.query(
          `UPDATE scraper_queue
             SET status = 'failed',
                 error_message = COALESCE(error_message, 'max_attempts_reached')
           WHERE id = $1`,
          [row.id]
        );
        continue;
      }

      try {
        const runtimeSettings = await withTenantContext(shopId, async (client) =>
          resolveScraperRuntimeSettings(client, shopId, env)
        );
        if (!runtimeSettings.enabled) {
          await pool.query(
            `UPDATE scraper_queue
               SET status = 'failed',
                   error_message = 'scraper_disabled_for_shop'
             WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        const config = await withTenantContext(shopId, async (client) => {
          const result = await client.query<{
            id: string;
            source_id: string;
            target_url_pattern: string;
            rate_limit: { requestsPerSecond?: number } | null;
            headers: Record<string, string> | null;
            cookies: { name: string; value: string; domain?: string; path?: string }[] | null;
            proxy_config: {
              server?: string;
              username?: string;
              password?: string;
              host?: string;
              port?: number;
              protocol?: 'http' | 'https' | 'socks5';
            } | null;
          }>(
            `SELECT id, source_id, target_url_pattern, rate_limit, headers, cookies, proxy_config
             FROM scraper_configs
             WHERE id = $1
               AND shop_id = $2
               AND is_active = true
             LIMIT 1`,
            [row.config_id, shopId]
          );
          const r = result.rows[0];
          if (!r) return null;
          return {
            id: r.id,
            sourceId: r.source_id,
            targetUrlPattern: r.target_url_pattern,
            rateLimit: r.rate_limit,
            headers: r.headers,
            cookies: r.cookies,
            proxyConfig: r.proxy_config,
          };
        });

        if (!config) {
          await pool.query(
            `UPDATE scraper_queue
               SET status = 'failed',
                   error_message = 'config_not_found_or_inactive'
             WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        const redis = new Redis(env.redisUrl);
        let runId: string | null = null;
        try {
          const result = await scrapeProductPage(row.url, {
            redis,
            userAgent: runtimeSettings.userAgent,
            timeoutMs: runtimeSettings.timeoutMs,
            rateLimitPerDomain: runtimeSettings.rateLimitPerDomain,
            robotsCacheTtlSeconds: runtimeSettings.robotsCacheTtl,
            maxConcurrentPages: runtimeSettings.maxConcurrentPages,
            sourceId: config.sourceId,
            sourceConfig: config,
            createRunRecord: async (run) => {
              await withTenantContext(shopId, async (client) => {
                if (run.status === 'running') {
                  const inserted = await client.query<{ id: string }>(
                    `INSERT INTO scraper_runs
                       (shop_id, config_id, source_id, status, trigger_type, target_urls, started_at, created_at)
                     VALUES ($1, $2, $3, 'running', 'queue_retry', ARRAY[$4], now(), now())
                     RETURNING id`,
                    [shopId, config.id, config.sourceId, row.url]
                  );
                  runId = inserted.rows[0]?.id ?? null;
                  return;
                }
                if (!runId) return;
                await client.query(
                  `UPDATE scraper_runs
                     SET status = $2,
                         duration_ms = $3,
                         errors_count = COALESCE($4, errors_count),
                         content_hashes_deduped = COALESCE($5, content_hashes_deduped),
                         method = COALESCE($6, method),
                         completed_at = now(),
                         error_log = COALESCE($7::jsonb, error_log)
                   WHERE id = $1
                     AND shop_id = $8`,
                  [
                    runId,
                    run.status,
                    run.durationMs ?? 0,
                    run.errorsCount ?? null,
                    run.contentHashesDeduped ?? null,
                    run.method ?? null,
                    run.errorLog ? JSON.stringify(run.errorLog) : null,
                    shopId,
                  ]
                );
              });
            },
            isKnownHash: async (hash) => {
              const existing = await withTenantContext(shopId, async (client) => {
                const q = await client.query<{ id: string }>(
                  `SELECT id FROM prod_raw_harvest WHERE content_hash = $1 LIMIT 1`,
                  [hash]
                );
                return q.rows[0]?.id ?? null;
              });
              return Boolean(existing);
            },
          });

          if (result.status === 'success' && result.html) {
            await withTenantContext(shopId, async (client) => {
              await client.query(
                `INSERT INTO prod_raw_harvest (
                   source_id, source_url, raw_json, raw_html, http_status, processing_status, content_hash, fetched_at, created_at
                 )
                 VALUES ($1, $2, $3, $4, 200, 'pending', $5, now(), now())`,
                [config.sourceId, row.url, JSON.stringify({}), result.html, result.contentHash]
              );
            });
            await pool.query(
              `UPDATE scraper_queue SET status = 'completed', error_message = NULL WHERE id = $1`,
              [row.id]
            );
          } else {
            const delayMinutes = Math.min(30, Math.max(1, attemptNo));
            const nextStatus = attemptNo >= maxAttempts ? 'failed' : 'pending';
            await pool.query(
              `UPDATE scraper_queue
                 SET status = $2,
                     next_attempt_at = CASE WHEN $2 = 'pending' THEN now() + ($3::int || ' minutes')::interval ELSE next_attempt_at END,
                     error_message = $4
               WHERE id = $1`,
              [row.id, nextStatus, delayMinutes, result.status]
            );
          }
        } finally {
          await redis.quit();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'queue_retry_failed';
        const delayMinutes = Math.min(30, Math.max(1, attemptNo));
        const nextStatus = attemptNo >= maxAttempts ? 'failed' : 'pending';
        await pool.query(
          `UPDATE scraper_queue
             SET status = $2,
                 next_attempt_at = CASE WHEN $2 = 'pending' THEN now() + ($3::int || ' minutes')::interval ELSE next_attempt_at END,
                 error_message = $4
           WHERE id = $1`,
          [row.id, nextStatus, delayMinutes, message]
        );
      }
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'scraper_queue_sweep_failed'
    );
  }
}

async function resolveScraperRuntimeSettings(
  client: { query: <T>(sql: string, params: unknown[]) => Promise<{ rows: T[] }> },
  shopId: string,
  env: AppEnv
): Promise<{
  enabled: boolean;
  rateLimitPerDomain: number;
  timeoutMs: number;
  maxConcurrentPages: number;
  userAgent: string;
  robotsCacheTtl: number;
}> {
  const row = await client.query<{
    scraper_enabled: boolean | null;
    scraper_rate_limit_per_domain: number | null;
    scraper_timeout_ms: number | null;
    scraper_max_concurrent_pages: number | null;
    scraper_user_agent: string | null;
    scraper_robots_cache_ttl: number | null;
  }>(
    `SELECT
       scraper_enabled,
       scraper_rate_limit_per_domain,
       scraper_timeout_ms,
       scraper_max_concurrent_pages,
       scraper_user_agent,
       scraper_robots_cache_ttl
     FROM shop_ai_credentials
     WHERE shop_id = $1
     LIMIT 1`,
    [shopId]
  );
  const r = row.rows[0];
  return {
    enabled: r?.scraper_enabled ?? env.scraperEnabled,
    rateLimitPerDomain: r?.scraper_rate_limit_per_domain ?? env.scraperRateLimitPerDomain,
    timeoutMs: r?.scraper_timeout_ms ?? env.scraperTimeoutMs,
    maxConcurrentPages: r?.scraper_max_concurrent_pages ?? env.scraperMaxConcurrentPages,
    userAgent: r?.scraper_user_agent ?? env.scraperUserAgent,
    robotsCacheTtl: r?.scraper_robots_cache_ttl ?? env.scraperRobotsCacheTtl,
  };
}

async function ensureDefaultScraperConfig(
  client: { query: <T>(sql: string, params: unknown[]) => Promise<{ rows: T[] }> },
  shopId: string,
  sourceId: string,
  sourceUrl: string
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM scraper_configs
     WHERE shop_id = $1
       AND source_id = $2
       AND is_active = true
     ORDER BY updated_at DESC
     LIMIT 1`,
    [shopId, sourceId]
  );
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  let hostPattern = '.*';
  try {
    const host = new URL(sourceUrl).hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    hostPattern = `^https?:\\/\\/(?:www\\.)?${host}(?:\\/|$)`;
  } catch {
    // keep generic fallback
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO scraper_configs
       (shop_id, source_id, name, scraper_type, target_url_pattern, selectors, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'PLAYWRIGHT', $4, $5::jsonb, true, now(), now())
     RETURNING id`,
    [shopId, sourceId, `auto-${sourceId.slice(0, 8)}`, hostPattern, JSON.stringify({})]
  );
  const insertedId = inserted.rows[0]?.id;
  if (!insertedId) {
    throw new Error('Failed to create default scraper config');
  }
  return insertedId;
}

async function resolveSourceId(
  client: { query: <T>(sql: string, params: unknown[]) => Promise<{ rows: T[] }> },
  sourceId: string | null,
  sourceUrl: string
): Promise<string> {
  if (sourceId) return sourceId;

  let hostname = 'unknown';
  let baseUrl = sourceUrl;
  try {
    const parsed = new URL(sourceUrl);
    hostname = parsed.hostname;
    baseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // keep defaults
  }

  const name = `external-${hostname}`.slice(0, 100);
  const existing = await client.query<{ id: string }>(
    `SELECT id
       FROM prod_sources
      WHERE name = $1
      LIMIT 1`,
    [name]
  );
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO prod_sources (name, source_type, base_url, priority, trust_score, is_active, created_at, updated_at)
     VALUES ($1, 'SCRAPER', $2, 50, 0.5, true, now(), now())
     RETURNING id`,
    [name, baseUrl]
  );
  const insertedId = inserted.rows[0]?.id;
  if (!insertedId) {
    throw new Error('Failed to resolve prod_sources entry for extraction');
  }
  return insertedId;
}
