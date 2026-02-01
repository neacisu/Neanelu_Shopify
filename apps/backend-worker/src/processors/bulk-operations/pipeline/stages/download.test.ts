import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';

import { createDownloadStream } from './download.js';

function logStep(message: string): void {
  console.info(`[download-stage] ${new Date().toISOString()} ${message}`);
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

void describe('pipeline: download stage', () => {
  const servers: http.Server[] = [];

  after(() => {
    logStep('server:stop:all');
    for (const s of servers) s.close();
  });

  void it('retries on 503 and respects Retry-After', async () => {
    logStep('test:retry-after:start');
    let calls = 0;

    const server = http.createServer((req, res) => {
      logStep(`server:request ${req.method ?? ''} ${req.url ?? ''}`);
      if (!req.url) throw new Error('missing_url');
      if (req.url !== '/retry') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      calls += 1;
      if (calls === 1) {
        res.statusCode = 503;
        res.setHeader('Retry-After', '0');
        res.end('try later');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'identity');
      res.end('ok');
    });
    servers.push(server);

    logStep('server:start /retry');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = `http://127.0.0.1:${addr.port}/retry`;
    logStep(`server:ready ${url}`);

    logStep('createDownloadStream:before');
    const dl = await createDownloadStream({
      url,
      maxRetries: 3,
      connectTimeoutMs: 2_000,
      readTimeoutMs: 2_000,
    });
    logStep('createDownloadStream:after');
    const buf = await collect(dl.stream);
    logStep('stream:consumed');
    assert.equal(buf.toString('utf8'), 'ok');
    assert.equal(calls, 2);
    logStep('test:retry-after:done');
  });

  void it('supports best-effort Range resume for identity streams', async () => {
    logStep('test:range-resume:start');
    const payload = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz', 'utf8');
    let firstRequest = true;

    const server = http.createServer((req, res) => {
      logStep(`server:request ${req.method ?? ''} ${req.url ?? ''}`);
      if (!req.url) throw new Error('missing_url');
      if (req.url !== '/range') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Encoding', 'identity');

      const range = req.headers.range;
      if (firstRequest && !range) {
        firstRequest = false;
        // Send first part then abruptly close to force retry.
        res.statusCode = 200;
        res.flushHeaders();
        res.write(payload.subarray(0, 10));
        // Destroy the connection a moment later so the client observes a mid-stream failure.
        setTimeout(() => {
          res.socket?.destroy();
        }, 5);
        return;
      }

      if (typeof range === 'string') {
        const m = /^bytes=(\d+)-$/.exec(range);
        if (!m) {
          res.statusCode = 416;
          res.end('bad range');
          return;
        }
        const start = Number(m[1]);
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${payload.length - 1}/${payload.length}`);
        res.end(payload.subarray(start));
        return;
      }

      res.statusCode = 200;
      res.end(payload);
    });
    servers.push(server);

    logStep('server:start /range');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = `http://127.0.0.1:${addr.port}/range`;
    logStep(`server:ready ${url}`);

    logStep('createDownloadStream:before');
    const dl = await createDownloadStream({
      url,
      maxRetries: 3,
      connectTimeoutMs: 2_000,
      readTimeoutMs: 2_000,
    });
    logStep('createDownloadStream:after');
    const buf = await collect(dl.stream);
    logStep('stream:consumed');
    assert.equal(buf.toString('utf8'), payload.toString('utf8'));
    assert.ok(dl.stats.attempts >= 2);
    logStep('test:range-resume:done');
  });

  void it('decompresses gzip responses', async () => {
    logStep('test:gzip:start');
    const body = 'hello gzip';
    const gz = gzipSync(Buffer.from(body, 'utf8'));

    const server = http.createServer((req, res) => {
      logStep(`server:request ${req.method ?? ''} ${req.url ?? ''}`);
      if (!req.url) throw new Error('missing_url');
      if (req.url !== '/gzip') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'gzip');
      res.end(gz);
    });
    servers.push(server);

    logStep('server:start /gzip');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = `http://127.0.0.1:${addr.port}/gzip`;
    logStep(`server:ready ${url}`);

    logStep('createDownloadStream:before');
    const dl = await createDownloadStream({
      url,
      maxRetries: 1,
      connectTimeoutMs: 2_000,
      readTimeoutMs: 2_000,
    });
    logStep('createDownloadStream:after');
    const buf = await collect(dl.stream);
    logStep('stream:consumed');
    assert.equal(buf.toString('utf8'), body);
    logStep('test:gzip:done');
  });

  void it('fails when Content-Length does not match actual bytes', async () => {
    logStep('test:bad-length:start');
    const server = http.createServer((req, res) => {
      logStep(`server:request ${req.method ?? ''} ${req.url ?? ''}`);
      if (!req.url) throw new Error('missing_url');
      if (req.url !== '/bad-length') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      const payload = Buffer.from('abc', 'utf8');
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'identity');
      res.setHeader('Content-Length', '10');
      res.end(payload);
    });
    servers.push(server);

    logStep('server:start /bad-length');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = `http://127.0.0.1:${addr.port}/bad-length`;
    logStep(`server:ready ${url}`);

    await assert.rejects(async () => {
      logStep('createDownloadStream:before');
      const dl = await createDownloadStream({
        url,
        maxRetries: 0,
        connectTimeoutMs: 2_000,
        readTimeoutMs: 2_000,
      });
      logStep('createDownloadStream:after');
      await collect(dl.stream);
    }, /bulk_download_content_length_mismatch/);
    logStep('test:bad-length:done');
  });

  void it('fails when ETag checksum does not match payload', async () => {
    logStep('test:bad-etag:start');
    const server = http.createServer((req, res) => {
      logStep(`server:request ${req.method ?? ''} ${req.url ?? ''}`);
      if (!req.url) throw new Error('missing_url');
      if (req.url !== '/bad-etag') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      const payload = Buffer.from('etag-body', 'utf8');
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'identity');
      res.setHeader('ETag', '"00000000000000000000000000000000"');
      res.end(payload);
    });
    servers.push(server);

    logStep('server:start /bad-etag');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = `http://127.0.0.1:${addr.port}/bad-etag`;
    logStep(`server:ready ${url}`);

    await assert.rejects(async () => {
      logStep('createDownloadStream:before');
      const dl = await createDownloadStream({
        url,
        maxRetries: 0,
        connectTimeoutMs: 2_000,
        readTimeoutMs: 2_000,
      });
      logStep('createDownloadStream:after');
      await collect(dl.stream);
    }, /bulk_download_checksum_mismatch/);
    logStep('test:bad-etag:done');
  });
});
