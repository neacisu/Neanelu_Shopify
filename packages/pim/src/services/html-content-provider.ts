export type HTMLFetchResult = Readonly<{
  html: string;
  statusCode: number;
  contentType: string;
  fetchedAt: Date;
  error?: string;
}>;

export interface HTMLContentProvider {
  fetchHTML(url: string): Promise<HTMLFetchResult>;
}

export class SimpleHTMLFetcher implements HTMLContentProvider {
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options?: { timeoutMs?: number; userAgent?: string }) {
    this.timeoutMs = options?.timeoutMs ?? 30000;
    this.userAgent =
      options?.userAgent ?? 'Mozilla/5.0 (compatible; NeaneluPIM/1.0; +https://neanelu.ro)';
  }

  async fetchHTML(url: string): Promise<HTMLFetchResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      const html = await response.text();
      return {
        html,
        statusCode: response.status,
        contentType: response.headers.get('content-type') ?? 'text/html',
        fetchedAt: new Date(),
      };
    } catch (error) {
      return {
        html: '',
        statusCode: 0,
        contentType: '',
        fetchedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown fetch error',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
