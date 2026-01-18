import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export type FixtureServerHandle = Readonly<{
  url: string;
  close: () => Promise<void>;
  getStats: () => { totalRequests: number; rangeRequests: number };
}>;

function parseRange(
  range: string | undefined,
  size: number
): { start: number; end: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d+)-(\d+)?$/i.exec(range.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(size - 1, end) };
}

export async function createRangeFixtureServer(data: Buffer): Promise<FixtureServerHandle> {
  let totalRequests = 0;
  let rangeRequests = 0;

  const server = http.createServer((req, res) => {
    totalRequests += 1;

    if (!req.url || req.url !== '/') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    const range = parseRange(req.headers.range, data.length);
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      rangeRequests += 1;
      const slice = data.subarray(range.start, range.end + 1);
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${data.length}`);
      res.setHeader('Content-Length', String(slice.length));
      res.end(slice);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(data.length));
    res.end(data);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('fixture_server_failed_to_start');
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    getStats: () => ({ totalRequests, rangeRequests }),
  } as const;
}

export async function createFileFixtureServer(filePath: string): Promise<FixtureServerHandle> {
  let totalRequests = 0;
  let rangeRequests = 0;

  const stats = await stat(filePath);
  const size = stats.size;

  const server = http.createServer((req, res) => {
    totalRequests += 1;

    if (!req.url || req.url !== '/') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    const range = parseRange(req.headers.range, size);
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      rangeRequests += 1;
      const length = range.end - range.start + 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(length));
      createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(size));
    createReadStream(filePath).pipe(res);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('fixture_server_failed_to_start');
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    getStats: () => ({ totalRequests, rangeRequests }),
  } as const;
}
