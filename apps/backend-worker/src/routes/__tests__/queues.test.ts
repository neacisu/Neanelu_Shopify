import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Bypass session auth for route tests.
const requireSessionMock = () => (_req: unknown, _reply: unknown) => Promise.resolve();

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => requireSessionMock(),
  },
});

// Mock worker readiness.
const workerRegistryPath = new URL('../../runtime/worker-registry.js', import.meta.url).href;
void mock.module(workerRegistryPath, {
  namedExports: {
    getWorkerReadiness: () => ({ webhookWorkerOk: true, tokenHealthWorkerOk: true }),
    getWorkerCurrentJob: () => null,
  },
});

// Mock queue-manager so we don't need Redis.
const queueCalls: { name: string; method: string }[] = [];

interface JobStub {
  id: string;
  name: string;
  data: unknown;
  opts?: { attempts?: number };
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  progress: unknown;
  getState: () => Promise<string>;
  retry: () => Promise<void>;
  remove: () => Promise<void>;
  promote: () => Promise<void>;
}

function createJob(id: string): JobStub {
  return {
    id,
    name: 'job-name',
    data: { id, hello: 'world' },
    opts: { attempts: 3 },
    attemptsMade: 0,
    timestamp: 1700000000000,
    progress: 0,
    getState: () => Promise.resolve('waiting'),
    retry: () => {
      queueCalls.push({ name: 'webhooks', method: `job.retry:${id}` });
      return Promise.resolve();
    },
    remove: () => {
      queueCalls.push({ name: 'webhooks', method: `job.remove:${id}` });
      return Promise.resolve();
    },
    promote: () => {
      queueCalls.push({ name: 'webhooks', method: `job.promote:${id}` });
      return Promise.resolve();
    },
  };
}

const queueStub = {
  getJobCounts: () =>
    Promise.resolve({ waiting: 1, active: 0, completed: 2, failed: 3, delayed: 0 }),
  getJobs: () => Promise.resolve([createJob('1')]),
  getJobCountByTypes: () => Promise.resolve(1),
  getJob: (id: string) => Promise.resolve(id === 'missing' ? null : createJob(id)),
  pause: () => {
    queueCalls.push({ name: 'webhooks', method: 'pause' });
    return Promise.resolve();
  },
  resume: () => {
    queueCalls.push({ name: 'webhooks', method: 'resume' });
    return Promise.resolve();
  },
  clean: () => Promise.resolve(['a', 'b']),
  close: () => Promise.resolve(undefined),
};

void mock.module('@app/queue-manager', {
  namedExports: {
    QUEUE_NAMES: ['webhooks'],
    toDlqQueueName: (n: string) => `${n}-dlq`,
    configFromEnv: (_env: unknown) => ({}),
    createQueue: (_ctx: unknown, opts: { name: string }) => {
      queueCalls.push({ name: opts.name, method: 'createQueue' });
      return queueStub;
    },
    enqueueBulkIngestJob: () => Promise.resolve(undefined),
  },
});

void describe('Queue Admin Routes', () => {
  let app: FastifyInstance;
  let queueRoutes: unknown;

  beforeEach(async () => {
    const module = await import('../queues.js');
    queueRoutes = (module as { queueRoutes: unknown }).queueRoutes;

    app = Fastify();
    await app.register(
      queueRoutes as never,
      {
        env: { redisUrl: 'redis://localhost:6379', shopifyApiSecret: 'test' },
        logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
        sessionConfig: {},
      } as never
    );

    queueCalls.splice(0, queueCalls.length);
  });

  afterEach(async () => {
    await app.close();
  });

  void test('GET /queues returns queue list', async () => {
    const res = await app.inject({ method: 'GET', url: '/queues' });
    assert.strictEqual(res.statusCode, 200);

    const body: { success: boolean; data: { queues: unknown[] } } = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.queues));
  });

  void test('GET /queues/:name/jobs returns jobs with payloadPreview', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/queues/webhooks/jobs?status=waiting&page=0&limit=50',
    });
    assert.strictEqual(res.statusCode, 200);

    const body: { success: boolean; data: { jobs: { payloadPreview?: unknown }[] } } = res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.jobs.length > 0);
    assert.strictEqual(typeof body.data.jobs[0]?.payloadPreview, 'string');
  });

  void test('GET /queues/:name/jobs?q=... does single job lookup', async () => {
    const res = await app.inject({ method: 'GET', url: '/queues/webhooks/jobs?q=abc' });
    assert.strictEqual(res.statusCode, 200);

    const body: { success: boolean; data: { jobs: { id: string }[] } } = res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.jobs[0]?.id, 'abc');
  });

  void test('GET /queues/:name/jobs/:id returns detail', async () => {
    const res = await app.inject({ method: 'GET', url: '/queues/webhooks/jobs/1' });
    assert.strictEqual(res.statusCode, 200);

    const body: { success: boolean; data: { job: { id: string; data: unknown } } } = res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.job.id, '1');
    assert.ok(body.data.job.data);
  });

  void test('POST pause/resume hits queue methods', async () => {
    const pause = await app.inject({
      method: 'POST',
      url: '/queues/webhooks/pause',
      payload: {},
      headers: { 'Content-Type': 'application/json' },
    });
    assert.strictEqual(pause.statusCode, 200);

    const resume = await app.inject({
      method: 'POST',
      url: '/queues/webhooks/resume',
      payload: {},
      headers: { 'Content-Type': 'application/json' },
    });
    assert.strictEqual(resume.statusCode, 200);

    assert.ok(queueCalls.some((c) => c.method === 'pause'));
    assert.ok(queueCalls.some((c) => c.method === 'resume'));
  });

  void test('POST /queues/jobs/batch retries job', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/queues/jobs/batch',
      payload: JSON.stringify({ action: 'retry', queueName: 'webhooks', ids: ['1'] }),
      headers: { 'Content-Type': 'application/json' },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.ok(queueCalls.some((c) => c.method === 'job.retry:1'));
  });

  void test('invalid queue returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/queues/not-a-queue/jobs' });
    assert.strictEqual(res.statusCode, 404);
  });
});
