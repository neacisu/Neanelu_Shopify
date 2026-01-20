import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTenantContext } from '@app/database';
import type { SessionConfig } from '../auth/session.js';
import { requireSession, getSessionFromRequest } from '../auth/session.js';
import { startBulkQueryFromContract } from '../processors/bulk-operations/orchestrator.js';

const DEFAULT_LIMIT = 20;

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
    error: { code, message },
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

type BulkRoutesOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type BulkRunRow = Readonly<{
  id: string;
  status: string;
  created_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  records_processed: number | null;
  query_type: string | null;
}>;

type BulkStepRow = Readonly<{
  step_name: string;
  status: string;
  created_at: Date | null;
}>;

type BulkErrorRow = Readonly<{
  id: string;
  error_type: string;
  error_code: string | null;
  error_message: string;
  line_number: number | null;
  payload: Record<string, unknown> | null;
  created_at: Date | null;
}>;

function normalizeRun(row: BulkRunRow & { error_count?: number | null }, steps?: BulkStepRow[]) {
  const order: { key: string; id: 'download' | 'parse' | 'transform' | 'save' }[] = [
    { key: 'download', id: 'download' },
    { key: 'parse', id: 'parse' },
    { key: 'transform', id: 'transform' },
    { key: 'save', id: 'save' },
  ];

  const stepStatuses = new Map<string, string>();
  steps?.forEach((step) => {
    const name = step.step_name.toLowerCase();
    for (const item of order) {
      if (name.includes(item.key)) {
        stepStatuses.set(item.id, step.status);
      }
    }
  });

  const completedCount = order.filter((item) => stepStatuses.get(item.id) === 'completed').length;
  const currentStep = order.find((item) => stepStatuses.get(item.id) !== 'completed')?.id ?? 'save';
  const percentage = Math.min(100, Math.round((completedCount / order.length) * 100));

  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    recordsProcessed: row.records_processed ?? null,
    errorCount: row.error_count ?? 0,
    progress: {
      percentage,
      step: currentStep,
    },
  };
}

function normalizeError(row: BulkErrorRow) {
  return {
    id: row.id,
    errorType: row.error_type,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    lineNumber: row.line_number,
    payload: row.payload,
  };
}

export const bulkRoutes: FastifyPluginAsync<BulkRoutesOptions> = (
  server: FastifyInstance,
  opts
): Promise<void> => {
  const { sessionConfig } = opts;
  const requireAdminSession = { preHandler: requireSession(sessionConfig) } as const;

  server.get('/bulk', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const query = request.query as {
      status?: string;
      page?: string;
      limit?: string;
      sort?: string;
      dir?: string;
    };

    const page = parseIntParam(query.page, 0, 0, 10_000);
    const limit = parseIntParam(query.limit, DEFAULT_LIMIT, 1, 100);
    const status = isNonEmptyString(query.status) ? query.status.trim() : null;
    const sortRaw = isNonEmptyString(query.sort) ? query.sort.trim() : 'startedAt';
    const dir = query.dir === 'asc' ? 'asc' : 'desc';

    const sortColumn = (() => {
      switch (sortRaw) {
        case 'startedAt':
          return 'started_at';
        case 'completedAt':
          return 'completed_at';
        case 'records':
          return 'records_processed';
        case 'duration':
          return 'completed_at';
        case 'errors':
          return 'error_count';
        case 'status':
          return 'status';
        default:
          return 'started_at';
      }
    })();

    const { runs, total } = await withTenantContext(session.shopId, async (client) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (status) {
        params.push(status);
        where.push(`status = $${params.length}`);
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const offset = page * limit;

      const totalRes = await client.query<{ total: number }>(
        `SELECT COUNT(*)::int as total FROM bulk_runs ${whereClause}`,
        params
      );

      const listRes = await client.query<BulkRunRow & { error_count: number }>(
        `SELECT br.id,
                br.status,
                br.created_at,
                br.started_at,
                br.completed_at,
                br.records_processed,
                br.query_type,
                COALESCE(err.error_count, 0) as error_count
         FROM bulk_runs br
         LEFT JOIN (
           SELECT bulk_run_id, COUNT(*)::int as error_count
           FROM bulk_errors
           GROUP BY bulk_run_id
         ) err ON err.bulk_run_id = br.id
         ${whereClause}
         ORDER BY ${sortColumn} ${dir}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      return {
        runs: listRes.rows.map((row) => normalizeRun(row)),
        total: totalRes.rows[0]?.total ?? 0,
      };
    });

    void reply.status(200).send(successEnvelope(request.id, { runs, total, page, limit }));
  });

  server.get('/bulk/current', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const run = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<BulkRunRow>(
        `SELECT id, status, created_at, started_at, completed_at, records_processed
         FROM bulk_runs
         WHERE status IN ('pending', 'running')
         ORDER BY created_at DESC
         LIMIT 1`
      );
      const row = res.rows[0] ?? null;
      if (!row) return null;
      const steps = await client.query<BulkStepRow>(
        `SELECT step_name, status, created_at
         FROM bulk_steps
         WHERE bulk_run_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [row.id]
      );
      return { row, steps: steps.rows };
    });

    void reply
      .status(200)
      .send(successEnvelope(request.id, run ? normalizeRun(run.row, run.steps) : null));
  });

  server.get('/bulk/:id', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: unknown }).id;
    if (!isNonEmptyString(id)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    const run = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<BulkRunRow & { error_count: number }>(
        `SELECT br.id,
                br.status,
                br.created_at,
                br.started_at,
                br.completed_at,
                br.records_processed,
                br.query_type,
                COALESCE(err.error_count, 0) as error_count
         FROM bulk_runs br
         LEFT JOIN (
           SELECT bulk_run_id, COUNT(*)::int as error_count
           FROM bulk_errors
           GROUP BY bulk_run_id
         ) err ON err.bulk_run_id = br.id
         WHERE br.id = $1
         LIMIT 1`,
        [id]
      );
      const row = res.rows[0] ?? null;
      if (!row) return null;
      const steps = await client.query<BulkStepRow>(
        `SELECT step_name, status, created_at
         FROM bulk_steps
         WHERE bulk_run_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [row.id]
      );
      return { row, steps: steps.rows };
    });

    if (!run) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Run not found'));
      return;
    }

    void reply.status(200).send(successEnvelope(request.id, normalizeRun(run.row, run.steps)));
  });

  server.post('/bulk/start', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    await startBulkQueryFromContract(session.shopId, {
      operationType: 'PRODUCTS_EXPORT',
      querySet: 'core',
      version: 'v2',
      triggeredBy: 'manual',
    });

    const run = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<BulkRunRow>(
        `SELECT id, status, created_at, started_at, completed_at, records_processed
         FROM bulk_runs
         WHERE status IN ('pending', 'running')
         ORDER BY created_at DESC
         LIMIT 1`
      );
      return res.rows[0] ?? null;
    });

    void reply.status(200).send(
      successEnvelope(request.id, {
        run_id: run?.id ?? null,
        status: run?.status ?? 'pending',
      })
    );
  });

  server.delete('/bulk/:id', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: unknown }).id;
    if (!isNonEmptyString(id)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    await withTenantContext(session.shopId, async (client) => {
      await client.query(
        `UPDATE bulk_runs
         SET status = 'cancelled', cancelled_at = now(), updated_at = now()
         WHERE id = $1`,
        [id]
      );
    });

    void reply.status(200).send(successEnvelope(request.id, { cancelled: true }));
  });

  server.post('/bulk/:id/retry', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: unknown }).id;
    if (!isNonEmptyString(id)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    const run = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<BulkRunRow>(
        `SELECT id, query_type FROM bulk_runs WHERE id = $1 LIMIT 1`,
        [id]
      );
      return res.rows[0] ?? null;
    });

    if (!run?.query_type) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Run not found'));
      return;
    }

    const body = (request.body ?? {}) as { mode?: unknown };
    const mode = body.mode === 'restart' ? 'restart' : 'resume';

    await startBulkQueryFromContract(session.shopId, {
      operationType: 'PRODUCTS_EXPORT',
      querySet:
        run.query_type === 'meta' || run.query_type === 'inventory' ? run.query_type : 'core',
      version: 'v2',
      triggeredBy: 'manual',
    });

    void reply.status(200).send(successEnvelope(request.id, { retried: true, mode }));
  });

  server.get('/bulk/:id/errors', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: unknown }).id;
    if (!isNonEmptyString(id)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    const limit = parseIntParam((request.query as { limit?: unknown }).limit, 50, 1, 200);

    const errors = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<BulkErrorRow>(
        `SELECT id, error_type, error_code, error_message, line_number, payload, created_at
         FROM bulk_errors
         WHERE bulk_run_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [id, limit]
      );
      return res.rows.map((row) => normalizeError(row));
    });

    void reply.status(200).send(successEnvelope(request.id, { errors }));
  });

  server.get('/bulk/:id/logs/stream', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: unknown }).id;
    if (!isNonEmptyString(id)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    const levelsRaw = (request.query as { levels?: unknown }).levels;
    const levels =
      typeof levelsRaw === 'string'
        ? new Set(
            levelsRaw
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v.length)
          )
        : null;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    let lastTs = new Date(0);
    let windowStart = Math.floor(Date.now() / 1000);
    let windowCount = 0;

    const send = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const interval = setInterval(() => {
      void (async () => {
        const entries = await withTenantContext(session.shopId, async (client) => {
          const steps = await client.query<{
            step_name: string;
            status: string;
            error_message: string | null;
            created_at: Date;
          }>(
            `SELECT step_name, status, error_message, created_at
           FROM bulk_steps
           WHERE bulk_run_id = $1
             AND created_at > $2
           ORDER BY created_at ASC
           LIMIT 50`,
            [id, lastTs]
          );

          const errors = await client.query<{
            error_message: string;
            error_type: string;
            created_at: Date;
          }>(
            `SELECT error_message, error_type, created_at
           FROM bulk_errors
           WHERE bulk_run_id = $1
             AND created_at > $2
           ORDER BY created_at ASC
           LIMIT 50`,
            [id, lastTs]
          );

          const logs = [
            ...steps.rows.map((row) => ({
              timestamp: row.created_at.toISOString(),
              level: row.status === 'failed' ? 'error' : 'info',
              message: row.error_message ?? `Step ${row.step_name} ${row.status}`,
              stepName: row.step_name,
            })),
            ...errors.rows.map((row) => ({
              timestamp: row.created_at.toISOString(),
              level: 'error',
              message: `${row.error_type}: ${row.error_message}`,
            })),
          ]
            .filter((entry) => (levels ? levels.has(entry.level) : true))
            .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

          return logs;
        });

        if (entries.length) {
          const nowSec = Math.floor(Date.now() / 1000);
          if (nowSec !== windowStart) {
            windowStart = nowSec;
            windowCount = 0;
          }
          const remaining = Math.max(0, 50 - windowCount);
          if (remaining <= 0) return;
          const limited =
            entries.length > remaining ? entries.slice(entries.length - remaining) : entries;

          const last = limited[limited.length - 1];
          if (last?.timestamp) {
            lastTs = new Date(last.timestamp);
          }
          windowCount += limited.length;
          send({ logs: limited });
        } else {
          reply.raw.write(': heartbeat\n\n');
        }
      })();
    }, 2000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  server.get('/logs/stream', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const levelsRaw = (request.query as { levels?: unknown }).levels;
    const levels =
      typeof levelsRaw === 'string'
        ? new Set(
            levelsRaw
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v.length)
          )
        : null;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    let lastTs = new Date(0);
    let windowStart = Math.floor(Date.now() / 1000);
    let windowCount = 0;

    const send = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const interval = setInterval(() => {
      void (async () => {
        const entries = await withTenantContext(session.shopId, async (client) => {
          const steps = await client.query<{
            step_name: string;
            status: string;
            error_message: string | null;
            created_at: Date;
          }>(
            `SELECT step_name, status, error_message, created_at
           FROM bulk_steps
           WHERE created_at > $1
           ORDER BY created_at ASC
           LIMIT 100`,
            [lastTs]
          );

          const errors = await client.query<{
            error_message: string;
            error_type: string;
            created_at: Date;
          }>(
            `SELECT error_message, error_type, created_at
           FROM bulk_errors
           WHERE created_at > $1
           ORDER BY created_at ASC
           LIMIT 100`,
            [lastTs]
          );

          const logs = [
            ...steps.rows.map((row) => ({
              timestamp: row.created_at.toISOString(),
              level: row.status === 'failed' ? 'error' : 'info',
              message: row.error_message ?? `Step ${row.step_name} ${row.status}`,
              stepName: row.step_name,
            })),
            ...errors.rows.map((row) => ({
              timestamp: row.created_at.toISOString(),
              level: 'error',
              message: `${row.error_type}: ${row.error_message}`,
            })),
          ]
            .filter((entry) => (levels ? levels.has(entry.level) : true))
            .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

          return logs;
        });

        if (entries.length) {
          const nowSec = Math.floor(Date.now() / 1000);
          if (nowSec !== windowStart) {
            windowStart = nowSec;
            windowCount = 0;
          }
          const remaining = Math.max(0, 50 - windowCount);
          if (remaining <= 0) return;
          const limited =
            entries.length > remaining ? entries.slice(entries.length - remaining) : entries;

          const last = limited[limited.length - 1];
          if (last?.timestamp) {
            lastTs = new Date(last.timestamp);
          }
          windowCount += limited.length;
          send({ logs: limited });
        } else {
          reply.raw.write(': heartbeat\n\n');
        }
      })();
    }, 2000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  server.get('/bulk/schedules', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const schedules = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<{
        id: string;
        cron: string;
        timezone: string;
        enabled: boolean;
      }>(
        `SELECT id, cron, timezone, enabled
         FROM bulk_schedules
         ORDER BY created_at DESC
         LIMIT 10`
      );
      return res.rows;
    });

    void reply.status(200).send(successEnvelope(request.id, { schedules }));
  });

  server.post('/bulk/schedules', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const body = (request.body ?? {}) as { cron?: unknown; timezone?: unknown; enabled?: unknown };
    if (!isNonEmptyString(body.cron) || !isNonEmptyString(body.timezone)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing fields'));
      return;
    }

    const cron = body.cron.trim();
    const timezone = body.timezone.trim();

    const enabled = body.enabled === false ? false : true;

    const schedule = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<{
        id: string;
        cron: string;
        timezone: string;
        enabled: boolean;
      }>(
        `INSERT INTO bulk_schedules (shop_id, cron, timezone, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now(), now())
         RETURNING id, cron, timezone, enabled`,
        [session.shopId, cron, timezone, enabled]
      );
      return res.rows[0];
    });

    void reply.status(200).send(successEnvelope(request.id, schedule));
  });

  server.put('/bulk/schedules/:id', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: unknown }).id;
    if (!isNonEmptyString(id)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    const body = (request.body ?? {}) as { cron?: unknown; timezone?: unknown; enabled?: unknown };
    if (!isNonEmptyString(body.cron) || !isNonEmptyString(body.timezone)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing fields'));
      return;
    }

    const cron = body.cron.trim();
    const timezone = body.timezone.trim();

    const enabled = body.enabled === false ? false : true;

    const schedule = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<{
        id: string;
        cron: string;
        timezone: string;
        enabled: boolean;
      }>(
        `UPDATE bulk_schedules
         SET cron = $1,
             timezone = $2,
             enabled = $3,
             updated_at = now()
         WHERE id = $4
         RETURNING id, cron, timezone, enabled`,
        [cron, timezone, enabled, id]
      );
      return res.rows[0] ?? null;
    });

    if (!schedule) {
      void reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Schedule not found'));
      return;
    }

    void reply.status(200).send(successEnvelope(request.id, schedule));
  });

  server.delete('/bulk/schedules/:id', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const id = (request.params as { id?: unknown }).id;
    if (!isNonEmptyString(id)) {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      return;
    }

    await withTenantContext(session.shopId, async (client) => {
      await client.query(`DELETE FROM bulk_schedules WHERE id = $1`, [id]);
    });

    void reply.status(200).send(successEnvelope(request.id, { deleted: true }));
  });

  return Promise.resolve();
};
