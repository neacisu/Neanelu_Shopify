import { chromium, type Browser, type Page } from 'playwright-core';

type AcquireOptions = Readonly<{
  maxConcurrentPages: number;
}>;

class BrowserManager {
  private browser: Browser | null = null;
  private activeSlots = 0;
  private waiters: (() => void)[] = [];
  private restartAttempts = 0;

  async acquireBrowser(options: AcquireOptions): Promise<Browser> {
    const maxPages = Math.max(1, options.maxConcurrentPages);
    await this.acquireSemaphore(maxPages);
    try {
      const browser = await this.ensureBrowser();
      this.activeSlots += 1;
      return browser;
    } catch (error) {
      this.releaseSemaphore();
      throw error;
    }
  }

  releaseSlot(): void {
    this.activeSlots = Math.max(0, this.activeSlots - 1);
    this.releaseSemaphore();
  }

  async releasePage(page: Page): Promise<void> {
    try {
      const context = page.context();
      await context.close();
    } catch {
      await page.close();
    } finally {
      this.releaseSlot();
    }
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.waiters = [];
    this.activeSlots = 0;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }
    try {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      this.restartAttempts = 0;
      return this.browser;
    } catch (error) {
      this.restartAttempts += 1;
      if (this.restartAttempts > 3) throw error;
      this.browser = null;
      return this.ensureBrowser();
    }
  }

  private async acquireSemaphore(maxPages: number): Promise<void> {
    if (this.activeSlots < maxPages) return;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private releaseSemaphore(): void {
    const next = this.waiters.shift();
    if (next) next();
  }
}

const instance = new BrowserManager();

process.on('SIGTERM', () => {
  void instance.shutdown();
});
process.on('SIGINT', () => {
  void instance.shutdown();
});

export async function acquirePage(options: AcquireOptions): Promise<Page> {
  const browser = await instance.acquireBrowser(options);
  return browser.newPage();
}

export async function acquireBrowser(options: AcquireOptions): Promise<Browser> {
  return instance.acquireBrowser(options);
}

export async function releasePage(page: Page): Promise<void> {
  await instance.releasePage(page);
}

export function releaseBrowserSlot(): Promise<void> {
  instance.releaseSlot();
  return Promise.resolve();
}

export async function shutdownBrowserManager(): Promise<void> {
  await instance.shutdown();
}
