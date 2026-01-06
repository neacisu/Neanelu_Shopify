import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { QUEUE_NAMES, configFromEnv, createQueue, toDlqQueueName } from '@app/queue-manager';
import type { JobType } from 'bullmq';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { onQueueStreamEvent, type QueueStreamEvent } from '../runtime/queue-stream.js';

type QueueAdminPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type QueueSummary = Readonly<{
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}>;

type QueueMetricsPoint = Readonly<{
  ts: number;
  timestamp: string;
  throughputJobsPerSec: number;
  completedDelta: number;
  failedDelta: number;
}>;

type WorkerSummary = Readonly<{
  id: string;
  ok: boolean;
  pid: number;
  uptimeSec: number;
  memoryRssBytes: number;
  memoryHeapUsedBytes: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  currentJob: Readonly<{
    jobId: string;
    jobName: string;
    startedAtIso: string;
    progressPct: number | null;
  }> | null;
}>;

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
  } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
    status,
  } as const;
}

function parseIntParam(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeQueueName(name: string): string {
  return name.trim();
}

const DEFAULT_QUEUE_NAMES: readonly string[] = [
  ...QUEUE_NAMES,
  // Include DLQs for visibility (even if empty)
  ...QUEUE_NAMES.map((q) => toDlqQueueName(q)),
  // Local queue used by backend-worker
  'token-health',
  'token-health-dlq',
];

const lastCountsByQueue = new Map<
  string,
  { completed: number; failed: number; lastTsMs: number }
>();
const metricsHistoryByQueue = new Map<string, QueueMetricsPoint[]>();

function pushMetricsPoint(queueName: string, snapshot: QueueSummary): void {
  const nowMs = Date.now();
  const prev = lastCountsByQueue.get(queueName);

  const completed = snapshot.completed;
  const failed = snapshot.failed;

  if (!prev) {
    lastCountsByQueue.set(queueName, { completed, failed, lastTsMs: nowMs });
    metricsHistoryByQueue.set(queueName, []);
    return;
  }

  const dtSec = Math.max(0.001, (nowMs - prev.lastTsMs) / 1000);
  const completedDelta = Math.max(0, completed - prev.completed);
  const failedDelta = Math.max(0, failed - prev.failed);
  const throughputJobsPerSec = (completedDelta + failedDelta) / dtSec;

  const history = metricsHistoryByQueue.get(queueName) ?? [];
  history.push({
    ts: nowMs,
    timestamp: new Date(nowMs).toISOString(),
    throughputJobsPerSec,
    completedDelta,
    failedDelta,
  });

  // Keep ~5 minutes at 2s sampling.
  const maxPoints = 150;
  if (history.length > maxPoints) history.splice(0, history.length - maxPoints);

  metricsHistoryByQueue.set(queueName, history);
  lastCountsByQueue.set(queueName, { completed, failed, lastTsMs: nowMs });
}

function isKnownQueueName(queueName: string): boolean {
  return DEFAULT_QUEUE_NAMES.includes(queueName);
}

function createQueueHandle(env: AppEnv, name: string) {
  return createQueue({ config: configFromEnv(env) }, { name });
}

async function listQueueSummaries(env: AppEnv): Promise<QueueSummary[]> {
  const summaries: QueueSummary[] = [];

  for (const name of DEFAULT_QUEUE_NAMES) {
    const queue = createQueueHandle(env, name);
    try {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed'
      );
      const snapshot: QueueSummary = {
        name,
        waiting: counts['waiting'] ?? 0,
        active: counts['active'] ?? 0,
        completed: counts['completed'] ?? 0,
        failed: counts['failed'] ?? 0,
        delayed: counts['delayed'] ?? 0,
      };

      summaries.push(snapshot);
      pushMetricsPoint(name, snapshot);
    } finally {
      await queue.close().catch(() => undefined);
    }
  }

  return summaries;
}

async function cleanFailedJobs(env: AppEnv, queueName: string): Promise<number> {
  const queue = createQueueHandle(env, queueName);
  try {
    let removed = 0;
    // Clean in batches; guard against infinite loops.
    for (let i = 0; i < 20; i++) {
      const ids = await queue.clean(0, 1000, 'failed');
      removed += ids.length;
      if (ids.length === 0) break;
    }
    return removed;
  } finally {
    await queue.close().catch(() => undefined);
  }
}

export const queueRoutes: FastifyPluginAsync<QueueAdminPluginOptions> = (
  server: FastifyInstance,
  opts
): Promise<void> => {
  const { env, logger, sessionConfig } = opts;

  const requireAdminSession = { preHandler: requireSession(sessionConfig) } as const;

  server.get('/queues', requireAdminSession, async (request, reply) => {
    const queues = await listQueueSummaries(env);
    void reply.status(200).send(successEnvelope(request.id, { queues }));
  });

  server.post('/queues/:name/pause', requireAdminSession, async (request, reply) => {
    const raw = (request.params as { name?: unknown }).name;
    const name = isNonEmptyString(raw) ? normalizeQueueName(raw) : '';
    if (!name || !isKnownQueueName(name)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    const queue = createQueueHandle(env, name);
    try {
      await queue.pause();
      void reply.status(200).send(successEnvelope(request.id, { name, status: 'paused' }));
    } finally {
      await queue.close().catch(() => undefined);
    }
  });

  server.post('/queues/:name/resume', requireAdminSession, async (request, reply) => {
    const raw = (request.params as { name?: unknown }).name;
    const name = isNonEmptyString(raw) ? normalizeQueueName(raw) : '';
    if (!name || !isKnownQueueName(name)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    const queue = createQueueHandle(env, name);
    try {
      await queue.resume();
      void reply.status(200).send(successEnvelope(request.id, { name, status: 'running' }));
    } finally {
      await queue.close().catch(() => undefined);
    }
  });

  server.delete('/queues/:name/jobs/failed', requireAdminSession, async (request, reply) => {
    const raw = (request.params as { name?: unknown }).name;
    const name = isNonEmptyString(raw) ? normalizeQueueName(raw) : '';
    if (!name || !isKnownQueueName(name)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    const removed = await cleanFailedJobs(env, name);
    void reply.status(200).send(successEnvelope(request.id, { name, removed }));
  });

  server.get('/queues/:name/jobs', requireAdminSession, async (request, reply) => {
    const rawName = (request.params as { name?: unknown }).name;
    const queueName = isNonEmptyString(rawName) ? normalizeQueueName(rawName) : '';
    if (!queueName || !isKnownQueueName(queueName)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    const query = request.query as {
      status?: string;
      page?: string;
      limit?: string;
      jobId?: string;
      q?: string;
    };

    const page = parseIntParam(query.page, 0, 0, 10_000);
    const limit = parseIntParam(query.limit, 50, 1, 100);
    const jobId = isNonEmptyString(query.jobId) ? query.jobId.trim() : null;
    const q = isNonEmptyString(query.q) ? query.q.trim() : null;

    const queue = createQueueHandle(env, queueName);

    try {
      const searchId = jobId ?? q;
      if (searchId) {
        const job = await queue.getJob(searchId);
        if (!job) {
          void reply.status(200).send(successEnvelope(request.id, { jobs: [], total: 0 }));
          return;
        }

        void reply.status(200).send(
          successEnvelope(request.id, {
            jobs: [
              {
                id: String(job.id),
                name: job.name,
                timestamp: job.timestamp,
                processedOn: job.processedOn ?? null,
                finishedOn: job.finishedOn ?? null,
                attemptsMade: job.attemptsMade,
                attempts: job.opts?.attempts ?? null,
                progress: job.progress,
                status: await job.getState(),
              },
            ],
            total: 1,
          })
        );
        return;
      }

      const status = isNonEmptyString(query.status) ? query.status.trim() : 'waiting';

      const types: JobType[] = (() => {
        switch (status) {
          case 'waiting':
          case 'active':
          case 'completed':
          case 'failed':
          case 'delayed':
            return [status];
          case 'all':
          default:
            return ['waiting', 'active', 'failed', 'delayed', 'completed'];
        }
      })();

      const start = page * limit;
      const end = start + limit - 1;

      const [jobs, total] = await Promise.all([
        queue.getJobs(types, start, end, true),
        queue.getJobCountByTypes(...types),
      ]);

      void reply.status(200).send(
        successEnvelope(request.id, {
          jobs: jobs.map((job) => ({
            id: String(job.id),
            name: job.name,
            timestamp: job.timestamp,
            processedOn: job.processedOn ?? null,
            finishedOn: job.finishedOn ?? null,
            attemptsMade: job.attemptsMade,
            attempts: job.opts?.attempts ?? null,
            progress: job.progress,
            status: types.length === 1 ? types[0] : null,
            payloadPreview: (() => {
              try {
                const s = JSON.stringify(job.data);
                if (s.length <= 300) return s;
                return `${s.slice(0, 300)}…`;
              } catch {
                return null;
              }
            })(),
          })),
          total,
          page,
          limit,
        })
      );
    } finally {
      await queue.close().catch(() => undefined);
    }
  });

  server.get('/queues/:name/jobs/:id', requireAdminSession, async (request, reply) => {
    const rawName = (request.params as { name?: unknown }).name;
    const rawId = (request.params as { id?: unknown }).id;

    const queueName = isNonEmptyString(rawName) ? normalizeQueueName(rawName) : '';
    const jobId = isNonEmptyString(rawId) ? rawId.trim() : '';

    if (!queueName || !isKnownQueueName(queueName)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    if (!jobId) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Job id required'));
      return;
    }

    const queue = createQueueHandle(env, queueName);
    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Job not found'));
        return;
      }

      const state = await job.getState().catch(() => null);

      const data: unknown = job.data;
      const opts: unknown = job.opts;

      void reply.status(200).send(
        successEnvelope(request.id, {
          job: {
            id: String(job.id),
            name: job.name,
            data,
            opts,
            progress: job.progress,
            attemptsMade: job.attemptsMade,
            timestamp: job.timestamp,
            processedOn: job.processedOn ?? null,
            finishedOn: job.finishedOn ?? null,
            failedReason: (job as unknown as { failedReason?: unknown }).failedReason ?? null,
            stacktrace: (job as unknown as { stacktrace?: unknown }).stacktrace ?? null,
            returnvalue: (job as unknown as { returnvalue?: unknown }).returnvalue ?? null,
            state: typeof state === 'string' ? state : null,
          },
        })
      );
    } finally {
      await queue.close().catch(() => undefined);
    }
  });

  server.post('/queues/:name/jobs/:id/retry', requireAdminSession, async (request, reply) => {
    const rawName = (request.params as { name?: unknown }).name;
    const rawId = (request.params as { id?: unknown }).id;

    const queueName = isNonEmptyString(rawName) ? normalizeQueueName(rawName) : '';
    const jobId = isNonEmptyString(rawId) ? rawId.trim() : '';

    if (!queueName || !isKnownQueueName(queueName)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    const queue = createQueueHandle(env, queueName);
    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Job not found'));
        return;
      }

      await job.retry();
      void reply.status(200).send(successEnvelope(request.id, { id: jobId, status: 'retried' }));
    } finally {
      await queue.close().catch(() => undefined);
    }
  });

  server.post('/queues/:name/jobs/:id/promote', requireAdminSession, async (request, reply) => {
    const rawName = (request.params as { name?: unknown }).name;
    const rawId = (request.params as { id?: unknown }).id;

    const queueName = isNonEmptyString(rawName) ? normalizeQueueName(rawName) : '';
    const jobId = isNonEmptyString(rawId) ? rawId.trim() : '';

    if (!queueName || !isKnownQueueName(queueName)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    const queue = createQueueHandle(env, queueName);
    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Job not found'));
        return;
      }

      await (job as unknown as { promote: () => Promise<void> }).promote();
      void reply.status(200).send(successEnvelope(request.id, { id: jobId, status: 'promoted' }));
    } finally {
      await queue.close().catch(() => undefined);
    }
  });

  server.delete('/queues/:name/jobs/:id', requireAdminSession, async (request, reply) => {
    const rawName = (request.params as { name?: unknown }).name;
    const rawId = (request.params as { id?: unknown }).id;

    const queueName = isNonEmptyString(rawName) ? normalizeQueueName(rawName) : '';
    const jobId = isNonEmptyString(rawId) ? rawId.trim() : '';

    if (!queueName || !isKnownQueueName(queueName)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    const queue = createQueueHandle(env, queueName);
    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Job not found'));
        return;
      }

      await job.remove();
      void reply.status(200).send(successEnvelope(request.id, { id: jobId, status: 'deleted' }));
    } finally {
      await queue.close().catch(() => undefined);
    }
  });

  server.post('/queues/jobs/batch', requireAdminSession, async (request, reply) => {
    const body = (request.body ?? {}) as {
      queueName?: unknown;
      action?: unknown;
      jobIds?: unknown;
      ids?: unknown;
    };

    const queueName = isNonEmptyString(body.queueName) ? normalizeQueueName(body.queueName) : '';
    const action = isNonEmptyString(body.action) ? body.action.trim() : '';
    const idsA = Array.isArray(body.ids) ? body.ids.filter(isNonEmptyString) : [];
    const idsB = Array.isArray(body.jobIds) ? body.jobIds.filter(isNonEmptyString) : [];
    const jobIds = [...idsA, ...idsB];

    if (!['retry', 'delete', 'promote'].includes(action)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid action'));
      return;
    }

    if (jobIds.length === 0) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'jobIds required'));
      return;
    }

    if (jobIds.length > 100) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Batch limit exceeded (max 100)'));
      return;
    }

    const queuesToSearch =
      queueName && isKnownQueueName(queueName) ? [queueName] : DEFAULT_QUEUE_NAMES;

    const results = [] as { id: string; ok: boolean; error?: string; queueName?: string }[];

    for (const id of jobIds) {
      let handled = false;

      for (const qName of queuesToSearch) {
        const queue = createQueueHandle(env, qName);
        try {
          const job = await queue.getJob(id);
          if (!job) continue;

          if (action === 'retry') {
            await job.retry();
          } else if (action === 'delete') {
            await job.remove();
          } else if (action === 'promote') {
            await (job as unknown as { promote: () => Promise<void> }).promote();
          }

          results.push({ id, ok: true, queueName: qName });
          handled = true;
          break;
        } catch (e) {
          const message = e instanceof Error ? e.message : 'unknown_error';
          results.push({ id, ok: false, error: message, queueName: qName });
          handled = true;
          break;
        } finally {
          await queue.close().catch(() => undefined);
        }
      }

      if (!handled) {
        results.push({ id, ok: false, error: 'not_found' });
      }
    }

    void reply.status(200).send(successEnvelope(request.id, { action, results }));
  });

  server.get('/queues/workers', requireAdminSession, async (request, reply) => {
    const registry = await import('../runtime/worker-registry.js');
    const readiness = registry.getWorkerReadiness();
    const webhookJob = registry.getWorkerCurrentJob('webhook-worker');
    const tokenHealthJob = registry.getWorkerCurrentJob('token-health-worker');

    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    const base: Omit<WorkerSummary, 'id' | 'ok' | 'currentJob'> = {
      pid: process.pid,
      uptimeSec: Math.floor(process.uptime()),
      memoryRssBytes: mem.rss,
      memoryHeapUsedBytes: mem.heapUsed,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
    };

    const workers: WorkerSummary[] = [
      {
        id: 'webhook-worker',
        ok: readiness.webhookWorkerOk,
        ...base,
        currentJob: webhookJob,
      },
      {
        id: 'token-health-worker',
        ok: readiness.tokenHealthWorkerOk ?? false,
        ...base,
        currentJob: tokenHealthJob,
      },
    ];

    void reply.status(200).send(successEnvelope(request.id, { workers }));
  });

  server.get('/queues/:name/metrics', requireAdminSession, async (request, reply) => {
    const rawName = (request.params as { name?: unknown }).name;
    const queueName = isNonEmptyString(rawName) ? normalizeQueueName(rawName) : '';
    if (!queueName || !isKnownQueueName(queueName)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Queue not found'));
      return;
    }

    const history = metricsHistoryByQueue.get(queueName) ?? [];
    void reply.status(200).send(
      successEnvelope(request.id, {
        queueName,
        points: history,
      })
    );
  });

  server.get('/queues/stream', requireAdminSession, async (request, reply) => {
    // SSE stream: queue snapshots every 2 seconds.
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');

    // Flush headers
    reply.raw.write('\n');

    let closed = false;

    const sendEvent = (event: string, data: unknown) => {
      if (closed) return;
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sendKeepAlive = () => {
      if (closed) return;
      reply.raw.write(`: ping ${Date.now()}\n\n`);
    };

    const unsubscribe = onQueueStreamEvent((evt: QueueStreamEvent) => {
      if (closed) return;
      const { type, ...data } = evt;
      sendEvent(type, data);
    });

    const sendSnapshot = async () => {
      try {
        const [queues, readiness] = await Promise.all([
          listQueueSummaries(env),
          import('../runtime/worker-registry.js').then((m) => m.getWorkerReadiness()),
        ]);

        sendEvent('queues.snapshot', {
          timestamp: nowIso(),
          queues,
          workers: {
            webhookWorkerOk: readiness.webhookWorkerOk,
            tokenHealthWorkerOk: readiness.tokenHealthWorkerOk,
          },
        });
      } catch (error) {
        logger.warn({ error }, 'queues stream snapshot failed');
      }
    };

    // Initial snapshot and periodic drift correction.
    void sendSnapshot();

    const interval = setInterval(() => {
      void sendSnapshot();
      sendKeepAlive();
    }, 15_000);

    request.raw.on('close', () => {
      closed = true;
      clearInterval(interval);
      unsubscribe();
    });

    // Keep the request open.
    return reply;
  });

  return Promise.resolve();
};
