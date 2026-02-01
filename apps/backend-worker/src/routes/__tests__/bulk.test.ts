import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import FormData from 'form-data';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

function logStep(message: string): void {
  console.info(`[bulk-routes] ${new Date().toISOString()} ${message}`);
}

const requireSessionMock = () => (_req: unknown, _reply: unknown) => Promise.resolve();

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => requireSessionMock(),
    getSessionFromRequest: () => ({
      shopId: 'shop-1',
      shopDomain: 'test.myshopify.com',
      createdAt: Date.now(),
    }),
  },
});

const startCalls: { shopId: string; querySet: string }[] = [];
const orchestratorPath = new URL(
  '../../processors/bulk-operations/orchestrator.js',
  import.meta.url
).href;
void mock.module(orchestratorPath, {
  namedExports: {
    startBulkQueryFromContract: (shopId: string, payload: { querySet: string }) => {
      startCalls.push({ shopId, querySet: payload.querySet });
      return Promise.resolve();
    },
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    enqueueBulkIngestJob: () => Promise.resolve(undefined),
  },
});

const now = new Date('2024-01-01T00:00:00.000Z');
const stepsRows = [
  { step_name: 'download', status: 'completed', error_message: null, created_at: now },
  {
    step_name: 'parse',
    status: 'completed',
    error_message: null,
    created_at: new Date(now.getTime() + 1000),
  },
];
const errorsRows = [
  { error_message: 'bad row', error_type: 'parse', created_at: new Date(now.getTime() + 2000) },
];

const bulkRuns = [
  {
    id: 'run-1',
    status: 'failed',
    created_at: now,
    started_at: now,
    completed_at: new Date(now.getTime() + 60_000),
    records_processed: 12,
    query_type: 'core',
  },
] as const;

const schedules = [{ id: 'sched-1', cron: '0 2 * * *', timezone: 'UTC', enabled: true }];

void mock.module('@app/database', {
  namedExports: {
    decryptAesGcm: () => Buffer.from(''),
    getOptimalEfSearch: () => 40,
    setHnswEfSearch: () => Promise.resolve(),
    pool: {
      query: () => Promise.resolve({ rows: [] }),
    },
    withTenantContext: async (
      _shopId: string,
      cb: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string) => {
          const lower = sql.toLowerCase();
          const resolve = (rows: unknown[]) =>
            Promise.resolve({ rows }) as Promise<{ rows: unknown[] }>;

          if (lower.includes('count(*)') && lower.includes('from bulk_runs')) {
            return resolve([{ total: 1 }]);
          }

          if (
            lower.includes('from bulk_runs br') &&
            lower.includes('left join') &&
            !lower.includes('where br.id')
          ) {
            return resolve([
              {
                ...bulkRuns[0],
                error_count: 1,
              },
            ]);
          }

          if (lower.includes('from bulk_runs br') && lower.includes('where br.id')) {
            return resolve([
              {
                ...bulkRuns[0],
                error_count: 1,
              },
            ]);
          }

          if (
            lower.includes('from bulk_runs') &&
            lower.includes(
              "status in ('pending', 'running', 'polling', 'downloading', 'processing')"
            )
          ) {
            return resolve([]);
          }

          if (lower.includes('from bulk_steps') && lower.includes('bulk_run_id')) {
            return resolve(stepsRows as unknown[]);
          }

          if (lower.includes('from bulk_errors') && lower.includes('bulk_run_id')) {
            if (lower.includes('error_type')) {
              return resolve(errorsRows as unknown[]);
            }
            return resolve([]);
          }

          if (lower.includes('select id, query_type from bulk_runs')) {
            return resolve([{ id: 'run-1', query_type: 'core' }]);
          }

          if (lower.includes('update bulk_runs') && lower.includes('cancelled')) {
            return resolve([]);
          }

          if (
            lower.includes('select id, cron, timezone, enabled') &&
            lower.includes('from bulk_schedules')
          ) {
            return resolve(schedules as unknown[]);
          }

          if (lower.includes('insert into bulk_schedules')) {
            return resolve(schedules as unknown[]);
          }

          if (lower.includes('update bulk_schedules')) {
            return resolve(schedules as unknown[]);
          }

          if (lower.includes('delete from bulk_schedules')) {
            return resolve([]);
          }

          return resolve([]);
        },
      };

      return cb(client);
    },
  },
});

void describe('Bulk Routes', () => {
  let app: FastifyInstance;
  let bulkRoutes: unknown;

  beforeEach(async () => {
    logStep('beforeEach:start');
    const module = await import('../bulk.js');
    bulkRoutes = (module as { bulkRoutes: unknown }).bulkRoutes;

    app = Fastify();
    await app.register(fastifyMultipart);
    await app.register(
      bulkRoutes as never,
      {
        env: { redisUrl: 'redis://localhost:6379', shopifyApiSecret: 'test' },
        logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
        sessionConfig: {},
      } as never
    );

    startCalls.splice(0, startCalls.length);
    logStep('beforeEach:done');
  });

  afterEach(async () => {
    if (app?.server.listening) {
      logStep('afterEach:close-app');
      await app.close();
    }
  });

  void test('GET /bulk returns paginated list', async () => {
    logStep('inject:GET /bulk:start');
    const res = await app.inject({ method: 'GET', url: '/bulk?page=0&limit=20' });
    logStep(`inject:GET /bulk:done status=${res.statusCode}`);
    assert.equal(res.statusCode, 200);

    const body = JSON.parse(res.body) as {
      success: boolean;
      data: { runs: unknown[]; total: number };
    };
    assert.equal(body.success, true);
    assert.equal(body.data.total, 1);
    assert.ok(Array.isArray(body.data.runs));
  });

  void test('GET /bulk/:id returns run detail', async () => {
    logStep('inject:GET /bulk/:id:start');
    const res = await app.inject({ method: 'GET', url: '/bulk/run-1' });
    logStep(`inject:GET /bulk/:id:done status=${res.statusCode}`);
    assert.equal(res.statusCode, 200);

    const body = JSON.parse(res.body) as { success: boolean };
    assert.equal(body.success, true);
  });

  void test('POST /bulk/start enqueues run', async () => {
    logStep('inject:POST /bulk/start:start');
    const res = await app.inject({ method: 'POST', url: '/bulk/start' });
    logStep(`inject:POST /bulk/start:done status=${res.statusCode}`);
    assert.equal(res.statusCode, 200);
    assert.equal(startCalls.length, 1);
  });

  void test('POST /bulk/:id/retry triggers orchestrator', async () => {
    logStep('inject:POST /bulk/:id/retry:start');
    const res = await app.inject({
      method: 'POST',
      url: '/bulk/run-1/retry',
      payload: { mode: 'restart' },
    });
    logStep(`inject:POST /bulk/:id/retry:done status=${res.statusCode}`);
    assert.equal(res.statusCode, 200);
    assert.equal(startCalls.length, 1);
  });

  void test('GET /bulk/:id/errors returns errors', async () => {
    logStep('inject:GET /bulk/:id/errors:start');
    const res = await app.inject({ method: 'GET', url: '/bulk/run-1/errors?limit=50' });
    logStep(`inject:GET /bulk/:id/errors:done status=${res.statusCode}`);
    assert.equal(res.statusCode, 200);

    const body = JSON.parse(res.body) as { success: boolean; data: { errors: unknown[] } };
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.errors));
  });

  void test('schedule CRUD works', async () => {
    logStep('inject:GET /bulk/schedules:start');
    const list = await app.inject({ method: 'GET', url: '/bulk/schedules' });
    logStep(`inject:GET /bulk/schedules:done status=${list.statusCode}`);
    assert.equal(list.statusCode, 200);

    logStep('inject:POST /bulk/schedules:start');
    const create = await app.inject({
      method: 'POST',
      url: '/bulk/schedules',
      payload: { cron: '0 2 * * *', timezone: 'UTC', enabled: true },
    });
    logStep(`inject:POST /bulk/schedules:done status=${create.statusCode}`);
    assert.equal(create.statusCode, 200);

    logStep('inject:PUT /bulk/schedules:start');
    const update = await app.inject({
      method: 'PUT',
      url: '/bulk/schedules/sched-1',
      payload: { cron: '0 3 * * *', timezone: 'UTC', enabled: false },
    });
    logStep(`inject:PUT /bulk/schedules:done status=${update.statusCode}`);
    assert.equal(update.statusCode, 200);

    logStep('inject:DELETE /bulk/schedules:start');
    const del = await app.inject({ method: 'DELETE', url: '/bulk/schedules/sched-1' });
    logStep(`inject:DELETE /bulk/schedules:done status=${del.statusCode}`);
    assert.equal(del.statusCode, 200);
  });

  void test('GET /bulk/:id/logs/stream emits event stream', async () => {
    logStep('listen:start');
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const url = new URL('/bulk/run-1/logs/stream', address);
    logStep(`listen:ready ${url.toString()}`);

    await new Promise<void>((resolve, reject) => {
      logStep('http:request:start');
      const req = http.request(
        {
          method: 'GET',
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          headers: { Accept: 'text/event-stream' },
        },
        (res) => {
          logStep(`http:response status=${res.statusCode ?? 0}`);
          assert.equal(res.statusCode, 200);
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            if (typeof chunk === 'string' && chunk.length > 0) {
              logStep('http:response:data');
              req.destroy();
              resolve();
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });

    logStep('listen:close');
    await app.close();
  });

  void test('POST /bulk/upload enqueues ingest from uploaded file', async () => {
    logStep('inject:POST /bulk/upload:start');
    const uploadDir = path.join(os.tmpdir(), 'neanelu-test-upload', randomUUID());
    process.env['BULK_UPLOAD_DIR'] = uploadDir;

    const form = new FormData();
    form.append('file', Buffer.from('{"id":1}\n'), {
      filename: 'upload.jsonl',
      contentType: 'application/x-ndjson',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/bulk/upload',
      payload: form.getBuffer(),
      headers: {
        ...form.getHeaders(),
        'content-length': String(form.getLengthSync()),
      },
    });

    logStep(`inject:POST /bulk/upload:done status=${res.statusCode}`);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { success: boolean; data?: { run_id?: string } };
    assert.equal(body.success, true);
    assert.ok(body.data?.run_id);

    logStep('cleanup:upload-dir');
    await rm(uploadDir, { recursive: true, force: true });
  });
});
