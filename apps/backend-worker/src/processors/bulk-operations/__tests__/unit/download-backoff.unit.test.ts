import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createDownloadStream } from '../../pipeline/stages/download.js';

function logStep(message: string): void {
  console.info(`[download-backoff] ${new Date().toISOString()} ${message}`);
}

void describe('download backoff', () => {
  const servers: http.Server[] = [];

  after(() => {
    logStep('server:stop:all');
    for (const s of servers) s.close();
  });

  void it('applies exponential backoff with jitter on retryable status', async () => {
    logStep('test:start');
    let calls = 0;

    const server = http.createServer((req, res) => {
      logStep(`server:request ${req.method ?? ''} ${req.url ?? ''}`);
      if (!req.url || req.url !== '/retry') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      calls += 1;
      if (calls === 1) {
        res.statusCode = 503;
        res.end('busy');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'identity');
      res.end('ok');
    });
    servers.push(server);

    logStep('server:start');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = `http://127.0.0.1:${addr.port}/retry`;
    logStep(`server:ready ${url}`);

    const retries: { attempt: number; delayMs: number }[] = [];

    const originalRandom = Math.random;
    Math.random = () => 0; // deterministic jitter

    try {
      logStep('createDownloadStream:before');
      const dl = await createDownloadStream({
        url,
        maxRetries: 1,
        connectTimeoutMs: 2_000,
        readTimeoutMs: 2_000,
        onRetry: ({ attempt, delayMs }) => retries.push({ attempt, delayMs }),
      });
      logStep('createDownloadStream:after');

      const buf: Buffer[] = [];
      for await (const chunk of dl.stream) {
        buf.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      logStep('stream:consumed');

      assert.equal(Buffer.concat(buf).toString('utf8'), 'ok');
      assert.equal(calls, 2);
      assert.equal(retries.length, 1);
      assert.equal(retries[0]?.attempt, 1);
      assert.equal(retries[0]?.delayMs, 500);
      logStep('test:done');
    } finally {
      Math.random = originalRandom;
    }
  });
});
