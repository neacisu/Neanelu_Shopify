import { PassThrough, Readable, Transform } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { createGunzip, createInflate } from 'node:zlib';

export interface DownloadStats {
  attempts: number;
  resumedFromBytes: number;
  contentEncoding: string;
}

export type DownloadStreamResult = Readonly<{
  stream: Readable;
  stats: DownloadStats;
}>;

export function createDownloadStream(params: {
  url: string;
  maxRetries?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  totalTimeoutMs?: number;
  highWaterMarkBytes?: number;
  /** Best-effort Range resume offset (bytes). Only supported for identity encoding. */
  resumeFromBytes?: number;
}): Promise<DownloadStreamResult> {
  const maxRetries = params.maxRetries ?? 3;
  const connectTimeoutMs = params.connectTimeoutMs ?? 30_000;
  const readTimeoutMs = params.readTimeoutMs ?? 60_000;
  const totalTimeoutMs = params.totalTimeoutMs ?? 4 * 60 * 60 * 1000;
  const highWaterMarkBytes = params.highWaterMarkBytes ?? 1024 * 1024;

  const out = new PassThrough({ highWaterMark: highWaterMarkBytes });

  const stats: DownloadStats = {
    attempts: 0,
    resumedFromBytes: 0,
    contentEncoding: 'identity',
  };

  let offsetBytes = Math.max(0, Math.trunc(params.resumeFromBytes ?? 0));
  let emittedAny = false;

  const startedAt = Date.now();

  const pump = async (): Promise<void> => {
    while (true) {
      stats.attempts += 1;
      const timeSpent = Date.now() - startedAt;
      if (timeSpent >= totalTimeoutMs) {
        throw new Error('bulk_download_total_timeout');
      }

      const controller = new AbortController();
      const remainingTotal = Math.max(1, totalTimeoutMs - timeSpent);
      const connectBudget = Math.min(connectTimeoutMs, remainingTotal);
      const connectTimer = setTimeout(() => controller.abort(), connectBudget);

      const headers = new Headers();
      if (offsetBytes > 0) {
        headers.set('Range', `bytes=${offsetBytes}-`);
      }

      let res: Response;
      try {
        res = await fetch(params.url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(connectTimer);
        if (stats.attempts <= maxRetries) {
          await delay(withJitterMs(backoffMs(stats.attempts)));
          continue;
        }
        throw err instanceof Error ? err : new Error('bulk_download_fetch_failed');
      } finally {
        clearTimeout(connectTimer);
      }

      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
      const isRetryableStatus =
        res.status === 408 || res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (!res.ok) {
        if (isRetryableStatus && stats.attempts <= maxRetries) {
          await delay(withJitterMs(retryAfterMs ?? backoffMs(stats.attempts)));
          continue;
        }
        throw new Error(`bulk_download_http_${res.status}`);
      }

      if (!res.body) {
        throw new Error('bulk_download_empty_body');
      }

      // Resume policy: best-effort only for identity encoding.
      const enc = (res.headers.get('content-encoding') ?? 'identity').toLowerCase();
      const acceptRanges = (res.headers.get('accept-ranges') ?? '').toLowerCase();

      // If we attempted a Range request but server did not honor it, restart from 0.
      if (offsetBytes > 0 && res.status !== 206) {
        offsetBytes = 0;
        continue;
      }

      // If we need to resume but encoding is compressed, we must restart from 0.
      // If we've already emitted any bytes, we cannot safely restart without duplicates.
      if (offsetBytes > 0 && enc !== 'identity') {
        if (emittedAny) {
          throw new Error('bulk_download_resume_not_supported_for_compressed_stream');
        }
        offsetBytes = 0;
        continue;
      }

      stats.contentEncoding = enc;
      const canResume = enc === 'identity' && acceptRanges.includes('bytes');
      if (offsetBytes > 0) stats.resumedFromBytes = offsetBytes;

      const raw = Readable.fromWeb(res.body as unknown as globalThis.ReadableStream<Uint8Array>);
      const decoded = new MaybeDecompressTransform(enc);
      raw.on('error', (e) => decoded.destroy(e));
      raw.pipe(decoded);

      let readTimer: NodeJS.Timeout | null = null;
      const resetReadTimer = (): void => {
        if (readTimer) clearTimeout(readTimer);
        readTimer = setTimeout(() => controller.abort(), readTimeoutMs);
      };

      resetReadTimer();

      try {
        await new Promise<void>((resolve, reject) => {
          decoded.on('data', (chunk: Buffer | string) => {
            emittedAny = true;
            resetReadTimer();
            // Track byte offsets only for identity streams (Range resume uses encoded bytes).
            if (canResume && typeof chunk !== 'string') {
              offsetBytes += chunk.length;
            }

            const ok = out.write(chunk);
            if (!ok) {
              decoded.pause();
              out.once('drain', () => {
                decoded.resume();
              });
            }
          });
          decoded.on('end', () => resolve());
          decoded.on('error', reject);
        });

        if (readTimer) clearTimeout(readTimer);
        out.end();
        return;
      } catch (err) {
        if (readTimer) clearTimeout(readTimer);
        decoded.destroy();

        if (stats.attempts >= maxRetries) {
          throw err instanceof Error ? err : new Error('bulk_download_stream_error');
        }

        // If we can't resume safely, only retry if we haven't emitted anything yet.
        if (!canResume && emittedAny) {
          throw err instanceof Error ? err : new Error('bulk_download_stream_error');
        }

        await delay(withJitterMs(backoffMs(stats.attempts)));
        continue;
      }
    }
  };

  pump().catch((err) => {
    out.destroy(err instanceof Error ? err : new Error('bulk_download_failed'));
  });

  return Promise.resolve({ stream: out, stats });
}

function backoffMs(attempt: number): number {
  const base = 500;
  const cap = 15_000;
  return Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
}

function withJitterMs(ms: number): number {
  const jitter = Math.floor(Math.random() * 250);
  return ms + jitter;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - Date.now());
}

class MaybeDecompressTransform extends Transform {
  private decided = false;
  private inner: Transform | null = null;

  public constructor(private readonly contentEncoding: string) {
    super();
  }

  public override _transform(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (error?: Error | null) => void
  ): void {
    try {
      if (!this.decided && typeof chunk !== 'string') {
        this.decided = true;
        if (this.contentEncoding === 'gzip' && looksLikeGzip(chunk)) {
          this.attach(createGunzip());
        } else if (this.contentEncoding === 'deflate' && looksLikeZlibDeflate(chunk)) {
          this.attach(createInflate());
        }
      }

      if (!this.inner) {
        this.push(chunk);
        cb();
        return;
      }

      this.inner.write(chunk, cb);
    } catch (err) {
      cb(err instanceof Error ? err : new Error('bulk_download_decompress_failed'));
    }
  }

  public override _flush(cb: (error?: Error | null) => void): void {
    if (!this.inner) {
      cb();
      return;
    }
    this.inner.end();
    cb();
  }

  private attach(inner: Transform): void {
    this.inner = inner;
    inner.on('data', (c: Buffer) => this.push(c));
    inner.on('error', (e: Error) => this.destroy(e));
  }
}

function looksLikeGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function looksLikeZlibDeflate(buf: Buffer): boolean {
  // Common zlib headers: 0x78 0x01 / 0x78 0x5E / 0x78 0x9C / 0x78 0xDA
  if (buf.length < 2) return false;
  if (buf[0] !== 0x78) return false;
  return buf[1] === 0x01 || buf[1] === 0x5e || buf[1] === 0x9c || buf[1] === 0xda;
}
