import { configureNewPage } from '../browser/page-factory.js';
import { releasePage } from '../browser/browser-manager.js';

export async function fetchRenderedHtml(params: {
  url: string;
  timeoutMs: number;
  userAgent: string;
  maxConcurrentPages: number;
  onBrowserPage?: (delta: 1 | -1) => void;
}): Promise<string> {
  const page = await configureNewPage({
    targetUrl: params.url,
    timeoutMs: params.timeoutMs,
    userAgent: params.userAgent,
    maxConcurrentPages: params.maxConcurrentPages,
    ...(params.onBrowserPage ? { onBrowserPage: params.onBrowserPage } : {}),
  });
  try {
    await page.goto(params.url, { waitUntil: 'networkidle', timeout: params.timeoutMs });
    return await page.content();
  } finally {
    await releasePage(page);
    params.onBrowserPage?.(-1);
  }
}
