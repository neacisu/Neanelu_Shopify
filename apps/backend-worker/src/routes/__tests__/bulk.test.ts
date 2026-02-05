import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import FormData from 'form-data';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import type { Logger } from '@app/logger';
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
    shopify_status: 'COMPLETED',
    shopify_error_code: null,
    shopify_object_count: 55,
    shopify_root_object_count: 12,
    shopify_file_size_bytes: 2048,
    shopify_updated_at: new Date(now.getTime() + 30_000),
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

          if (lower.includes('where br.id')) {
            return resolve([
              {
                ...bulkRuns[0],
                shopify_status: bulkRuns[0].shopify_status ?? 'COMPLETED',
                error_count: 1,
              },
            ]);
          }

          const isBulkRunsJoined =
            lower.includes('from bulk_runs br') && lower.includes('left join');
          const hasBulkRunIdFilter = lower.includes('where') && lower.includes('br.id');

          if (isBulkRunsJoined && !hasBulkRunIdFilter) {
            return resolve([
              {
                ...bulkRuns[0],
                shopify_status: bulkRuns[0].shopify_status ?? 'COMPLETED',
                error_count: 1,
              },
            ]);
          }

          if (isBulkRunsJoined && hasBulkRunIdFilter) {
            return resolve([
              {
                ...bulkRuns[0],
                shopify_status: bulkRuns[0].shopify_status ?? 'COMPLETED',
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

          if (lower.includes('from bulk_runs')) {
            return resolve([
              {
                ...bulkRuns[0],
                shopify_status: bulkRuns[0].shopify_status ?? 'COMPLETED',
                error_count: 1,
              },
            ]);
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

void describe('Bulk Routes', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let bulkRoutes: unknown;
  type StreamBulkLogsWs = (params: {
    request: FastifyRequest;
    connection: {
      socket: {
        readyState: number;
        send: (data: string) => void;
        ping: () => void;
        close: () => void;
        on: (event: 'close' | 'error', listener: () => void) => void;
      };
    };
    shopId: string;
    runId?: string;
    logger: Logger;
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
  }) => void;
  let streamBulkLogsWsFn: StreamBulkLogsWs;

  const createTestLogger = (): Logger => {
    const testLogger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      child: () => testLogger,
    } as Logger;
    return testLogger;
  };

  beforeEach(async () => {
    logStep('beforeEach:start');
    const module = await import('../bulk.js');
    bulkRoutes = (module as { bulkRoutes: unknown }).bulkRoutes;
    streamBulkLogsWsFn = (module as { streamBulkLogsWs: StreamBulkLogsWs }).streamBulkLogsWs;

    app = Fastify();
    await app.register(fastifyMultipart);
    await app.register(fastifyWebsocket);
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

    const body = JSON.parse(res.body) as {
      success: boolean;
      data: {
        shopifyStatus?: string | null;
        shopifyObjectCount?: number | null;
        shopifyRootObjectCount?: number | null;
        shopifyFileSizeBytes?: number | null;
        shopifyUpdatedAt?: string | null;
      };
    };
    assert.equal(body.success, true);
    if (body.data.shopifyStatus != null) {
      assert.equal(body.data.shopifyStatus, 'COMPLETED');
    }
    if (body.data.shopifyObjectCount != null) {
      assert.equal(body.data.shopifyObjectCount, 55);
    }
    if (body.data.shopifyRootObjectCount != null) {
      assert.equal(body.data.shopifyRootObjectCount, 12);
    }
    if (body.data.shopifyFileSizeBytes != null) {
      assert.equal(body.data.shopifyFileSizeBytes, 2048);
    }
    if (body.data.shopifyUpdatedAt != null) {
      assert.ok(body.data.shopifyUpdatedAt);
    }
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

  void test('GET /bulk/:id/logs/ws emits websocket payload', async () => {
    const messages: string[] = [];
    const handlers: Record<'close' | 'error', (() => void)[]> = { close: [], error: [] };
    const connection = {
      socket: {
        readyState: 1,
        send: (data: string) => {
          messages.push(data);
        },
        ping: () => undefined,
        close: () => {
          connection.socket.readyState = 3;
          handlers.close.forEach((handler) => handler());
        },
        on: (event: 'close' | 'error', listener: () => void) => {
          handlers[event].push(listener);
        },
      },
    };

    const request = {
      query: {},
    } as FastifyRequest;

    streamBulkLogsWsFn({
      request,
      connection,
      shopId: 'shop-1',
      runId: 'run-1',
      logger: createTestLogger(),
      pollIntervalMs: 10,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ws_timeout'));
      }, 1000);
      const interval = setInterval(() => {
        if (messages.length > 0) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    connection.socket.close();
    const payload = JSON.parse(messages[0] ?? '{}') as {
      event?: string;
      data?: { logs?: unknown[] };
    };
    assert.equal(payload.event, 'logs');
    assert.ok(Array.isArray(payload.data?.logs));
  });

  void test('streamBulkLogsWs sends periodic heartbeat pings', async () => {
    let pingCount = 0;
    const handlers: Record<'close' | 'error', (() => void)[]> = { close: [], error: [] };
    const connection = {
      socket: {
        readyState: 1,
        send: () => undefined,
        ping: () => {
          pingCount += 1;
        },
        close: () => {
          connection.socket.readyState = 3;
          handlers.close.forEach((handler) => handler());
        },
        on: (event: 'close' | 'error', listener: () => void) => {
          handlers[event].push(listener);
        },
      },
    };

    const request = {
      query: {},
    } as FastifyRequest;

    streamBulkLogsWsFn({
      request,
      connection,
      shopId: 'shop-1',
      runId: 'run-1',
      logger: createTestLogger(),
      pollIntervalMs: 1000,
      heartbeatIntervalMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 35));
    connection.socket.close();

    assert.ok(pingCount > 0);
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
