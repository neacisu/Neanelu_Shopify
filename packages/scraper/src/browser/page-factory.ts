import type { BrowserContextOptions, Page } from 'playwright-core';

import { acquireBrowser, releaseBrowserSlot } from './browser-manager.js';
import type { ScraperConfigMatch } from '../scrapers/types.js';

export type NewPageOptions = Readonly<{
  targetUrl: string;
  timeoutMs: number;
  userAgent: string;
  maxConcurrentPages: number;
  sourceConfig?: ScraperConfigMatch | null;
  onBrowserPage?: (delta: 1 | -1) => void;
}>;

function proxyFromConfig(
  config?: ScraperConfigMatch | null
): BrowserContextOptions['proxy'] | undefined {
  const proxy = config?.proxyConfig;
  if (!proxy) return undefined;
  if (proxy.server) {
    return {
      server: proxy.server,
      ...(proxy.username ? { username: proxy.username } : {}),
      ...(proxy.password ? { password: proxy.password } : {}),
    };
  }
  if (proxy.host && proxy.port) {
    const protocol = proxy.protocol ?? 'http';
    return {
      server: `${protocol}://${proxy.host}:${String(proxy.port)}`,
      ...(proxy.username ? { username: proxy.username } : {}),
      ...(proxy.password ? { password: proxy.password } : {}),
    };
  }
  return undefined;
}

export async function configureNewPage(options: NewPageOptions): Promise<Page> {
  const browser = await acquireBrowser({ maxConcurrentPages: options.maxConcurrentPages });
  options.onBrowserPage?.(1);
  try {
    const proxy = proxyFromConfig(options.sourceConfig);
    const contextOptions: BrowserContextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: options.userAgent,
      javaScriptEnabled: true,
    };
    if (proxy) {
      contextOptions.proxy = proxy;
    }
    const context = await browser.newContext(contextOptions);
    const cookies = options.sourceConfig?.cookies ?? [];
    if (cookies.length > 0) {
      await context.addCookies(
        cookies.map((cookie) => {
          const base = {
            name: cookie.name,
            value: cookie.value,
            path: cookie.path ?? '/',
            httpOnly: false,
            secure: false,
            sameSite: 'Lax' as const,
          };
          if (cookie.domain && cookie.domain.trim().length > 0) {
            return { ...base, domain: cookie.domain };
          }
          return { ...base, url: options.targetUrl };
        })
      );
    }
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(options.timeoutMs);
    page.setDefaultTimeout(options.timeoutMs);
    await page.setExtraHTTPHeaders({
      ...(options.sourceConfig?.headers ?? {}),
    });
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'stylesheet') {
        return route.abort();
      }
      return route.continue();
    });
    await page.setExtraHTTPHeaders({
      ...(options.sourceConfig?.headers ?? {}),
      ...(proxy ? { 'x-scraper-proxy-enabled': 'true' } : {}),
    });
    return page;
  } catch (error) {
    await releaseBrowserSlot();
    options.onBrowserPage?.(-1);
    throw error;
  }
}
