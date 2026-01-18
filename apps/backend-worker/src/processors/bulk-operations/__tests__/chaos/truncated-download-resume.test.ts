import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createDownloadStream } from '../../pipeline/stages/download.js';

void describe('chaos: truncated download resume', () => {
  const servers: http.Server[] = [];

  after(() => {
    for (const s of servers) s.close();
  });

  void it('retries after mid-stream disconnect and resumes with Range', async () => {
    const payload = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789', 'utf8');
    let first = true;

    const server = http.createServer((req, res) => {
      if (!req.url || req.url !== '/payload') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Encoding', 'identity');

      const range = req.headers.range;
      if (first && !range) {
        first = false;
        res.statusCode = 200;
        res.write(payload.subarray(0, 10));
        setTimeout(() => res.socket?.destroy(), 5);
        return;
      }

      if (typeof range === 'string') {
        const match = /^bytes=(\d+)-$/.exec(range);
        if (!match) {
          res.statusCode = 416;
          res.end('bad range');
          return;
        }
        const start = Number(match[1]);
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${payload.length - 1}/${payload.length}`);
        res.end(payload.subarray(start));
        return;
      }

      res.statusCode = 200;
      res.end(payload);
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = `http://127.0.0.1:${addr.port}/payload`;

    const retries: number[] = [];

    const dl = await createDownloadStream({
      url,
      maxRetries: 2,
      connectTimeoutMs: 2_000,
      readTimeoutMs: 2_000,
      onRetry: ({ attempt }) => retries.push(attempt),
    });

    const buf: Buffer[] = [];
    for await (const chunk of dl.stream) {
      buf.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }

    assert.equal(Buffer.concat(buf).toString('utf8'), payload.toString('utf8'));
    assert.ok(retries.length >= 1);
    assert.ok(dl.stats.attempts >= 2);
  });
});
