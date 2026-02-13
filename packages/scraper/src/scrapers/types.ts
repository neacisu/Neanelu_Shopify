import type { Redis } from 'ioredis';
import type { Page } from 'playwright-core';

export type ScrapeMethod = 'cheerio' | 'playwright';

export type JsonLdProduct = Readonly<{
  '@context'?: string;
  '@type'?: string | string[];
  [key: string]: unknown;
}>;

export type ScrapeSuccessResult = Readonly<{
  status: 'success';
  url: string;
  method: ScrapeMethod;
  html: string;
  jsonLd: JsonLdProduct[];
  fetchedAt: Date;
  contentHash: string;
  fromCacheQueue?: boolean;
  sourceConfigId?: string | null;
}>;

export type ScrapeBlockedResult = Readonly<{
  status: 'robots_blocked' | 'login_detected' | 'failed';
  url: string;
  reason?: string;
  sourceConfigId?: string | null;
}>;

export type ScrapeResult = ScrapeSuccessResult | ScrapeBlockedResult;

export type ScraperConfigMatch = Readonly<{
  id: string;
  sourceId: string;
  targetUrlPattern: string;
  rateLimit: { requestsPerSecond?: number } | null;
  headers: Record<string, string> | null;
  cookies: { name: string; value: string; domain?: string; path?: string }[] | null;
  proxyConfig: {
    server?: string;
    username?: string;
    password?: string;
    host?: string;
    port?: number;
    protocol?: 'http' | 'https' | 'socks5';
  } | null;
}>;

export type ScrapeOptions = Readonly<{
  redis: Redis;
  userAgent: string;
  timeoutMs: number;
  rateLimitPerDomain: number;
  robotsCacheTtlSeconds: number;
  maxConcurrentPages: number;
  shopId?: string;
  sourceId?: string | null;
  sourceConfig?: ScraperConfigMatch | null;
  staticHtml?: string | null;
  fetchStaticHtml?: (url: string) => Promise<string | null>;
  onBrowserPage?: (delta: 1 | -1) => void;
  onRateLimited?: (params: {
    url: string;
    retryAtIso: string;
    configId?: string | null;
  }) => Promise<void>;
  shouldStopForQueue?: boolean;
  createRunRecord?: (params: {
    status: 'running' | 'completed' | 'failed' | 'deduped' | 'robots_blocked' | 'login_detected';
    url: string;
    configId?: string | null;
    sourceId?: string | null;
    method?: ScrapeMethod | null;
    durationMs?: number;
    pagesCrawled?: number;
    errorsCount?: number;
    errorLog?: unknown;
    contentHashesDeduped?: number;
  }) => Promise<void>;
  trackUsage?: (params: {
    endpoint: string;
    productId?: string | null;
    sourceUrl?: string;
    method: ScrapeMethod;
    responseTimeMs: number;
  }) => Promise<void>;
  isKnownHash?: (hash: string) => Promise<boolean>;
}>;

export type LoginDetectionResult = Readonly<{
  isLoginPage: boolean;
  reason?: string;
}>;

export type PageLike = Pick<Page, 'url' | 'content'> & {
  response?: () => Promise<{ status: () => number } | null>;
};
