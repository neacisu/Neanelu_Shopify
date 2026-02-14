import robotsParserModule from 'robots-parser';
import type { Redis } from 'ioredis';
type RobotsParserFactory = (
  robotsUrl: string,
  robotsTxt: string
) => {
  isAllowed: (url: string, userAgent: string) => boolean | undefined;
};

const robotsParser = robotsParserModule as unknown as RobotsParserFactory;

const DEFAULT_ROBOTS_TTL_SECONDS = 86400;

function robotsTxtUrl(input: string): string | null {
  try {
    const url = new URL(input);
    return `${url.protocol}//${url.host}/robots.txt`;
  } catch {
    return null;
  }
}

function cacheKey(input: string): string | null {
  try {
    const url = new URL(input);
    return `scraper:robots:${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

async function fetchRobots(
  url: string,
  timeoutMs = 5000
): Promise<{ status: number; body: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = response.ok ? await response.text() : null;
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function isUrlAllowed(
  url: string,
  redis: Redis,
  userAgent: string,
  cacheTtlSeconds = DEFAULT_ROBOTS_TTL_SECONDS
): Promise<boolean> {
  const key = cacheKey(url);
  const robotsUrl = robotsTxtUrl(url);
  if (!key || !robotsUrl) return true;

  const cached = await redis.get(key);
  if (cached != null) {
    const parser = robotsParser(robotsUrl, cached);
    return parser.isAllowed(url, userAgent) ?? true;
  }

  const fetched = await fetchRobots(robotsUrl);
  if (fetched.status === 0 || fetched.status >= 500) {
    return true;
  }
  if (fetched.status >= 400 && fetched.status !== 404) {
    return false;
  }

  const body = fetched.body ?? '';
  await redis.set(key, body, 'EX', Math.max(60, cacheTtlSeconds));
  const parser = robotsParser(robotsUrl, body);
  return parser.isAllowed(url, userAgent) ?? true;
}
