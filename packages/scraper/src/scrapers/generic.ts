import { extractJsonLd } from '../utils/json-ld-extractor.js';
import { hashHtmlContent } from '../utils/content-hash.js';
import { isLoginPageFromHtml } from '../utils/login-detector.js';
import { waitForRateLimit } from '../utils/rate-limiter.js';
import { isUrlAllowed } from '../utils/robots-parser.js';
import { configureNewPage } from '../browser/page-factory.js';
import { releasePage } from '../browser/browser-manager.js';
import type { ScrapeOptions, ScrapeResult } from './types.js';

export async function scrapeProductPage(
  url: string,
  options: ScrapeOptions
): Promise<ScrapeResult> {
  const domain = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return 'unknown';
    }
  })();

  const startedAt = Date.now();
  const cfg = options.sourceConfig ?? null;

  const reportRun = async (
    status: 'running' | 'completed' | 'failed' | 'deduped' | 'robots_blocked' | 'login_detected',
    extra?: Partial<{
      method: 'cheerio' | 'playwright';
      pagesCrawled: number;
      errorsCount: number;
      errorLog: unknown;
      contentHashesDeduped: number;
    }>
  ) => {
    await options.createRunRecord?.({
      status,
      url,
      configId: cfg?.id ?? null,
      sourceId: cfg?.sourceId ?? options.sourceId ?? null,
      durationMs: Date.now() - startedAt,
      ...extra,
    });
  };

  await reportRun('running');

  const isAllowed = await isUrlAllowed(
    url,
    options.redis,
    options.userAgent,
    options.robotsCacheTtlSeconds
  );
  if (!isAllowed) {
    await reportRun('robots_blocked', { errorsCount: 1, errorLog: { reason: 'robots_blocked' } });
    return { status: 'robots_blocked', url, sourceConfigId: cfg?.id ?? null };
  }

  const waitedMs = await waitForRateLimit(
    url,
    options.redis,
    cfg?.rateLimit?.requestsPerSecond ?? options.rateLimitPerDomain
  );
  if (waitedMs > 0 && options.shouldStopForQueue && options.onRateLimited) {
    const retryAtIso = new Date(Date.now() + waitedMs).toISOString();
    await options.onRateLimited({ url, retryAtIso, configId: cfg?.id ?? null });
    await reportRun('failed', { errorsCount: 1, errorLog: { reason: 'rate_limited_enqueued' } });
    return { status: 'failed', url, sourceConfigId: cfg?.id ?? null, reason: 'rate_limited' };
  }

  const staticHtml =
    options.staticHtml ?? (options.fetchStaticHtml ? await options.fetchStaticHtml(url) : null);
  if (staticHtml) {
    const login = isLoginPageFromHtml(staticHtml);
    if (login.isLoginPage) {
      await reportRun('login_detected', { errorsCount: 1, errorLog: { reason: login.reason } });
      return {
        status: 'login_detected',
        url,
        sourceConfigId: cfg?.id ?? null,
        ...(login.reason ? { reason: login.reason } : {}),
      };
    }

    const jsonLd = extractJsonLd(staticHtml);
    if (jsonLd.length > 0) {
      const contentHash = hashHtmlContent(staticHtml);
      if (await options.isKnownHash?.(contentHash)) {
        await reportRun('deduped', { method: 'cheerio', contentHashesDeduped: 1 });
        return { status: 'failed', url, sourceConfigId: cfg?.id ?? null, reason: 'deduped' };
      }
      await reportRun('completed', { method: 'cheerio', pagesCrawled: 1 });
      await options.trackUsage?.({
        endpoint: domain,
        sourceUrl: url,
        method: 'cheerio',
        responseTimeMs: Date.now() - startedAt,
      });
      return {
        status: 'success',
        url,
        method: 'cheerio',
        html: staticHtml,
        jsonLd,
        fetchedAt: new Date(),
        contentHash,
        sourceConfigId: cfg?.id ?? null,
      };
    }
  }

  let page = null as Awaited<ReturnType<typeof configureNewPage>> | null;
  try {
    page = await configureNewPage({
      targetUrl: url,
      timeoutMs: options.timeoutMs,
      userAgent: options.userAgent,
      maxConcurrentPages: options.maxConcurrentPages,
      sourceConfig: cfg,
      ...(options.onBrowserPage ? { onBrowserPage: options.onBrowserPage } : {}),
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeoutMs });
    const html = await page.content();
    const login = isLoginPageFromHtml(html);
    if (login.isLoginPage) {
      await reportRun('login_detected', { errorsCount: 1, errorLog: { reason: login.reason } });
      return {
        status: 'login_detected',
        url,
        sourceConfigId: cfg?.id ?? null,
        ...(login.reason ? { reason: login.reason } : {}),
      };
    }
    const jsonLd = extractJsonLd(html);
    const contentHash = hashHtmlContent(html);
    if (await options.isKnownHash?.(contentHash)) {
      await reportRun('deduped', { method: 'playwright', contentHashesDeduped: 1 });
      return { status: 'failed', url, sourceConfigId: cfg?.id ?? null, reason: 'deduped' };
    }
    await reportRun('completed', { method: 'playwright', pagesCrawled: 1 });
    await options.trackUsage?.({
      endpoint: domain,
      sourceUrl: url,
      method: 'playwright',
      responseTimeMs: Date.now() - startedAt,
    });
    return {
      status: 'success',
      url,
      method: 'playwright',
      html,
      jsonLd,
      fetchedAt: new Date(),
      contentHash,
      sourceConfigId: cfg?.id ?? null,
    };
  } catch (error) {
    await reportRun('failed', {
      errorsCount: 1,
      errorLog: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      status: 'failed',
      url,
      sourceConfigId: cfg?.id ?? null,
      reason: error instanceof Error ? error.message : 'scrape_failed',
    };
  } finally {
    if (page) {
      await releasePage(page);
      options.onBrowserPage?.(-1);
    }
  }
}
