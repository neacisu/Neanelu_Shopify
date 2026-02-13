export interface ScraperSettingsResponse {
  enabled: boolean;
  rateLimitPerDomain: number;
  timeoutMs: number;
  maxConcurrentPages: number;
  userAgent: string;
  robotsCacheTtl: number;
  respectRobotsTxt: true;
  browserStatus: 'available' | 'unavailable' | 'not_installed' | 'error';
  refreshedAt: string | null;
  todayStats: {
    pagesScraped: number;
    successRate: number;
    avgLatencyMs: number;
    robotsBlocked: number;
    deduped: number;
    loginDetected: number;
    cheerioFastPath: number;
  };
  weekTrends: {
    pagesScraped: number[];
    success: number[];
    failed: number[];
    deduped: number[];
  };
  domainPerformance: {
    domain: string;
    totalPages: number;
    successRate: number;
    avgLatencyMs: number;
    robotsBlocked: number;
    lastScrapedAt: string | null;
  }[];
}

export interface ScraperSettingsUpdateRequest {
  enabled?: boolean;
  rateLimitPerDomain?: number;
  timeoutMs?: number;
  maxConcurrentPages?: number;
  userAgent?: string;
  robotsCacheTtl?: number;
}

export interface ScraperHealthResponse {
  status: 'available' | 'unavailable' | 'not_installed' | 'error';
  chromiumVersion?: string;
  message?: string;
  checkedAt: string;
  launchTimeMs?: number;
}

export interface ScraperRobotsTestResponse {
  url: string;
  domain: string;
  allowed: boolean;
  robotsTxtFound: boolean;
  robotsTxtCached: boolean;
  checkedAt: string;
  relevantRules?: string[];
}

export interface ScraperConfigResponse {
  id: string;
  sourceId: string;
  sourceName?: string;
  name: string;
  scraperType: 'CHEERIO' | 'PLAYWRIGHT' | 'PUPPETEER';
  targetUrlPattern: string;
  isActive: boolean;
  lastRunAt: string | null;
  successRate: number | null;
  rateLimit: { requestsPerSecond: number } | null;
  proxyConfig: { type: string; host: string } | null;
}

export interface ScraperRunResponse {
  id: string;
  configId: string;
  configName?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'deduped';
  method: 'cheerio' | 'playwright' | null;
  pagesCrawled: number;
  productsFound: number;
  errorsCount: number;
  contentHashesDeduped: number;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ScraperQueueStatusResponse {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  oldestPendingAt: string | null;
}

export interface ScraperActivityDataPoint {
  date: string;
  cheerio: number;
  playwright: number;
  failed: number;
  robotsBlocked: number;
  deduped: number;
}
