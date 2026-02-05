import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { withTenantContext } from '@app/database';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { withTokenRetry } from '../auth/token-lifecycle.js';
import { shopifyApi } from '../shopify/client.js';
import type { SessionConfig } from '../auth/session.js';
import { requireSession, getSessionFromRequest } from '../auth/session.js';
import { startBulkQueryFromContract } from '../processors/bulk-operations/orchestrator.js';
import { readIngestCheckpoint } from '../processors/bulk-operations/pipeline/checkpoint.js';
import { enqueueBulkIngestJob } from '@app/queue-manager';

const DEFAULT_LIMIT = 20;

async function ensureBulkUploadDir(shopId: string, runId: string): Promise<string> {
  const configured = process.env['BULK_UPLOAD_DIR']?.trim();
  const baseCandidates = configured
    ? [configured]
    : ['/var/lib/neanelu/bulk-uploads', path.join(os.tmpdir(), 'neanelu', 'bulk-uploads')];

  let lastError: unknown = null;
  for (const base of baseCandidates) {
    const dir = path.join(base, shopId, runId);
    try {
      await mkdir(dir, { recursive: true });
      return dir;
    } catch (err) {
      lastError = err;
      if (err && typeof err === 'object' && 'code' in err && err.code === 'EACCES') {
        continue;
      }
      throw err;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('bulk_upload_dir_unavailable');
}

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

type WsConnection = Readonly<{
  socket: {
    readyState: number;
    send: (data: string) => void;
    ping: () => void;
    close: (code?: number, reason?: string) => void;
    on: (event: 'close' | 'error', listener: () => void) => void;
  };
}>;

type BulkRunRow = Readonly<{
  id: string;
  status: string;
  created_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  records_processed: number | null;
  bytes_processed?: number | null;
  result_size_bytes?: number | null;
  shopify_status?: string | null;
  shopify_error_code?: string | null;
  shopify_object_count?: number | null;
  shopify_root_object_count?: number | null;
  shopify_file_size_bytes?: number | null;
  shopify_updated_at?: Date | null;
  cursor_state?: Record<string, unknown> | null;
  query_type: string | null;
  shopify_operation_id?: string | null;
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

type ShopifyBulkOperationStatus =
  | 'CREATED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'CANCELING'
  | 'EXPIRED';

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
    if (name.includes('progress')) return;
    for (const item of order) {
      if (name.includes(item.key)) {
        stepStatuses.set(item.id, step.status);
      }
    }
  });

  const completedCount = order.filter((item) => stepStatuses.get(item.id) === 'completed').length;
  const currentStep = order.find((item) => stepStatuses.get(item.id) !== 'completed')?.id ?? 'save';
  const percentage = Math.min(100, Math.round((completedCount / order.length) * 100));

  const checkpoint = readIngestCheckpoint(row.cursor_state ?? null);

  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    recordsProcessed: row.records_processed ?? null,
    bytesProcessed: row.bytes_processed ?? null,
    resultSizeBytes: row.result_size_bytes ?? null,
    shopifyStatus: row.shopify_status ?? null,
    shopifyErrorCode: row.shopify_error_code ?? null,
    shopifyObjectCount: row.shopify_object_count ?? null,
    shopifyRootObjectCount: row.shopify_root_object_count ?? null,
    shopifyFileSizeBytes: row.shopify_file_size_bytes ?? null,
    shopifyUpdatedAt: row.shopify_updated_at?.toISOString() ?? null,
    errorCount: row.error_count ?? 0,
    checkpoint: checkpoint
      ? {
          committedRecords: checkpoint.committedRecords,
          committedBytes: checkpoint.version === 2 ? checkpoint.committedBytes : null,
          committedLines: checkpoint.version === 2 ? checkpoint.committedLines : null,
          lastCommitAt: checkpoint.lastCommitAtIso,
        }
      : null,
    progress: {
      percentage,
      step: currentStep,
    },
  };
}

function sanitizePayload(
  value: unknown,
  depth = 0
): Record<string, unknown> | null | string | number | boolean | unknown[] {
  if (depth > 4) return '[truncated]';
  if (value == null) return value as null;
  if (typeof value === 'string') return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const limited = value.slice(0, 50);
    return limited.map((item) => sanitizePayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const redactedKeys = new Set([
      'token',
      'access_token',
      'refresh_token',
      'secret',
      'password',
      'authorization',
      'cookie',
      'session',
      'api_key',
      'client_secret',
    ]);
    for (const [key, val] of Object.entries(obj)) {
      if (redactedKeys.has(key.toLowerCase())) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizePayload(val, depth + 1);
      }
    }
    return out;
  }
  return '[unsupported]';
}

function normalizeError(row: BulkErrorRow) {
  return {
    id: row.id,
    errorType: row.error_type,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    lineNumber: row.line_number,
    payload: row.payload ? (sanitizePayload(row.payload) as Record<string, unknown>) : null,
  };
}

function buildBulkOperationCancelMutation(): string {
  return `mutation BulkOperationCancel($id: ID!) {
  bulkOperationCancel(id: $id) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;
}

function buildCurrentBulkOperationQuery(): string {
  return `query CurrentBulkOperation {
  currentBulkOperation {
    id
    status
    errorCode
    createdAt
    completedAt
    objectCount
    rootObjectCount
    fileSize
    url
    partialDataUrl
  }
}`;
}

function buildBulkOperationNodeQuery(): string {
  return `query BulkOperationNode($id: ID!) {
  node(id: $id) {
    __typename
    ... on BulkOperation {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      rootObjectCount
      fileSize
      url
      partialDataUrl
    }
  }
}`;
}

export const streamBulkLogsWs = (params: {
  request: FastifyRequest;
  connection: WsConnection;
  shopId: string;
  runId?: string;
  logger: Logger;
  pollIntervalMs?: number;
}): void => {
  const { request, connection, shopId, runId, logger, pollIntervalMs = 2000 } = params;
  const query = request.query as { levels?: unknown } | undefined;
  const levelsRaw = query?.levels;
  const levels =
    typeof levelsRaw === 'string'
      ? new Set(
          levelsRaw
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v.length)
        )
      : null;

  let lastTs = new Date(0);
  let windowStart = Math.floor(Date.now() / 1000);
  let windowCount = 0;

  const send = (payload: unknown) => {
    if (connection.socket.readyState !== 1) return;
    connection.socket.send(JSON.stringify({ event: 'logs', data: payload }));
  };

  const poll = async () => {
    if (connection.socket.readyState !== 1) {
      return;
    }
    try {
      const entries = await withTenantContext(shopId, async (client) => {
        const steps = await client.query<{
          step_name: string;
          status: string;
          error_message: string | null;
          created_at: Date;
        }>(
          runId
            ? `SELECT step_name, status, error_message, created_at
           FROM bulk_steps
           WHERE bulk_run_id = $1
             AND created_at > $2
           ORDER BY created_at ASC
           LIMIT 50`
            : `SELECT step_name, status, error_message, created_at
           FROM bulk_steps
           WHERE created_at > $1
           ORDER BY created_at ASC
           LIMIT 100`,
          runId ? [runId, lastTs] : [lastTs]
        );

        const errors = await client.query<{
          error_message: string;
          error_type: string;
          created_at: Date;
        }>(
          runId
            ? `SELECT error_message, error_type, created_at
           FROM bulk_errors
           WHERE bulk_run_id = $1
             AND created_at > $2
           ORDER BY created_at ASC
           LIMIT 50`
            : `SELECT error_message, error_type, created_at
           FROM bulk_errors
           WHERE created_at > $1
           ORDER BY created_at ASC
           LIMIT 100`,
          runId ? [runId, lastTs] : [lastTs]
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
      } else if (connection.socket.readyState === 1) {
        connection.socket.ping();
      }
    } catch (error) {
      logger.warn({ error }, 'bulk logs ws poll failed');
    }
  };

  void poll();

  const interval = setInterval(() => {
    if (connection.socket.readyState !== 1) {
      clearInterval(interval);
      return;
    }
    void poll();
  }, pollIntervalMs);

  const onClose = () => {
    clearInterval(interval);
  };

  connection.socket.on('close', onClose);
  connection.socket.on('error', onClose);
};

export const bulkRoutes: FastifyPluginAsync<BulkRoutesOptions> = (
  server: FastifyInstance,
  opts
): Promise<void> => {
  const { sessionConfig, env, logger } = opts;
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
          return 'COALESCE(started_at, created_at)';
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
          return 'COALESCE(started_at, created_at)';
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
          br.bytes_processed,
          br.result_size_bytes,
          br.shopify_status,
          br.shopify_error_code,
          br.shopify_object_count,
          br.shopify_root_object_count,
          br.shopify_file_size_bytes,
          br.shopify_updated_at,
          br.cursor_state,
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
        `SELECT id,
           status,
           created_at,
           started_at,
           completed_at,
           records_processed,
           bytes_processed,
           result_size_bytes,
           shopify_status,
           shopify_error_code,
           shopify_object_count,
           shopify_root_object_count,
           shopify_file_size_bytes,
           shopify_updated_at,
           cursor_state
         FROM bulk_runs
        WHERE status IN ('pending', 'running', 'polling', 'downloading', 'processing')
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

  server.get('/bulk/active-shopify', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    try {
      const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');
      const activeRun = await withTenantContext(session.shopId, async (client) => {
        const res = await client.query<{ shopify_operation_id: string | null }>(
          `SELECT shopify_operation_id
           FROM bulk_runs
           WHERE status IN ('pending', 'running', 'polling', 'downloading', 'processing')
           ORDER BY created_at DESC
           LIMIT 1`
        );
        return res.rows[0]?.shopify_operation_id ?? null;
      });
      const useNodeQuery = Boolean(activeRun);
      let op: {
        id?: string | null;
        status?: ShopifyBulkOperationStatus | null;
        errorCode?: string | null;
        createdAt?: string | null;
        completedAt?: string | null;
        objectCount?: string | null;
        rootObjectCount?: string | null;
        fileSize?: string | null;
        url?: string | null;
        partialDataUrl?: string | null;
      } | null = null;

      if (useNodeQuery && activeRun) {
        const query = buildBulkOperationNodeQuery();
        const res = await withTokenRetry(
          session.shopId,
          encryptionKey,
          logger,
          async (accessToken, shopDomain) => {
            const client = shopifyApi.createClient({ shopDomain, accessToken });
            return await client.request<{
              node?: {
                __typename?: string | null;
                id?: string | null;
                status?: ShopifyBulkOperationStatus | null;
                errorCode?: string | null;
                createdAt?: string | null;
                completedAt?: string | null;
                objectCount?: string | null;
                rootObjectCount?: string | null;
                fileSize?: string | null;
                url?: string | null;
                partialDataUrl?: string | null;
              } | null;
            }>(query, { id: activeRun });
          }
        );
        const node = res.data?.node;
        if (node?.__typename === 'BulkOperation') {
          op = node;
        }
      } else {
        const query = buildCurrentBulkOperationQuery();
        const res = await withTokenRetry(
          session.shopId,
          encryptionKey,
          logger,
          async (accessToken, shopDomain) => {
            const client = shopifyApi.createClient({ shopDomain, accessToken });
            return await client.request<{
              currentBulkOperation?: {
                id?: string | null;
                status?: ShopifyBulkOperationStatus | null;
                errorCode?: string | null;
                createdAt?: string | null;
                completedAt?: string | null;
                objectCount?: string | null;
                rootObjectCount?: string | null;
                fileSize?: string | null;
                url?: string | null;
                partialDataUrl?: string | null;
              } | null;
            }>(query);
          }
        );
        op = res.data?.currentBulkOperation ?? null;
      }

      void reply.status(200).send(successEnvelope(request.id, { operation: op }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'active_bulk_lookup_failed';
      logger.error(
        { err, shopId: session.shopId },
        'Failed to fetch current Shopify bulk operation'
      );
      void reply
        .status(502)
        .send(errorEnvelope(request.id, 502, 'BULK_ACTIVE_LOOKUP_FAILED', message));
    }
  });

  server.post('/bulk/active-shopify/cancel', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    try {
      const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');
      const query = buildCurrentBulkOperationQuery();
      const mutation = buildBulkOperationCancelMutation();

      const opRes = await withTokenRetry(
        session.shopId,
        encryptionKey,
        logger,
        async (accessToken, shopDomain) => {
          const client = shopifyApi.createClient({ shopDomain, accessToken });
          return await client.request<{ currentBulkOperation?: { id?: string | null } | null }>(
            query
          );
        }
      );

      const opId = opRes.data?.currentBulkOperation?.id ?? null;
      if (!opId) {
        void reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'No active Shopify bulk operation'));
        return;
      }

      const cancelRes = await withTokenRetry(
        session.shopId,
        encryptionKey,
        logger,
        async (accessToken, shopDomain) => {
          const client = shopifyApi.createClient({ shopDomain, accessToken });
          return await client.request<{
            bulkOperationCancel?: {
              bulkOperation?: {
                id?: string | null;
                status?: ShopifyBulkOperationStatus | null;
              } | null;
              userErrors?: { field?: string[] | null; message?: string | null }[] | null;
            };
          }>(mutation, { id: opId });
        }
      );

      const userErrors = cancelRes.data?.bulkOperationCancel?.userErrors ?? [];
      if (userErrors.length) {
        const message = userErrors
          .map((e) => e?.message)
          .filter((m): m is string => Boolean(m))
          .join('; ');
        throw new Error(message || 'bulk_cancel_user_errors');
      }

      void reply.status(200).send(
        successEnvelope(request.id, {
          cancelled: true,
          operation: cancelRes.data?.bulkOperationCancel?.bulkOperation ?? null,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'bulk_cancel_failed';
      logger.error({ err, shopId: session.shopId }, 'Bulk cancel failed');
      void reply.status(502).send(errorEnvelope(request.id, 502, 'BULK_CANCEL_FAILED', message));
    }
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
          br.bytes_processed,
          br.result_size_bytes,
          br.shopify_status,
          br.shopify_error_code,
          br.shopify_object_count,
          br.shopify_root_object_count,
          br.shopify_file_size_bytes,
          br.shopify_updated_at,
          br.cursor_state,
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
      idempotencyKey: `manual-${randomUUID()}`,
    });

    const run = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<BulkRunRow>(
        `SELECT id, status, created_at, started_at, completed_at, records_processed
         FROM bulk_runs
         WHERE status IN ('pending', 'running', 'polling', 'downloading', 'processing')
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

  server.post('/bulk/upload', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const file = await (
      request as FastifyRequest & { file: () => Promise<MultipartFile | undefined> }
    ).file();
    if (!file) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing upload file'));
      return;
    }

    const allowed = new Set(['application/x-ndjson', 'application/json', 'text/plain']);
    if (file.mimetype && !allowed.has(file.mimetype)) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid JSONL mime type'));
      return;
    }

    const runId = randomUUID();
    const uploadDir = await ensureBulkUploadDir(session.shopId, runId);
    const filePath = path.join(uploadDir, 'bulk-upload.jsonl');

    let bytesWritten = 0;
    file.file.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });

    await pipeline(file.file, createWriteStream(filePath));

    await withTenantContext(session.shopId, async (client) => {
      await client.query(
        `INSERT INTO bulk_runs (
           id,
           shop_id,
           operation_type,
           query_type,
           status,
           started_at,
           result_size_bytes,
           created_at,
           updated_at
         )
         VALUES ($1, $2, 'PRODUCTS_EXPORT', 'core', 'running', now(), $3, now(), now())`,
        [runId, session.shopId, bytesWritten]
      );
    });

    await enqueueBulkIngestJob({
      shopId: session.shopId,
      bulkRunId: runId,
      localFilePath: filePath,
      triggeredBy: 'manual',
      requestedAt: Date.now(),
    });

    void reply.status(200).send(
      successEnvelope(request.id, {
        run_id: runId,
        status: 'running',
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

    const run = await withTenantContext(session.shopId, async (client) => {
      const res = await client.query<BulkRunRow>(
        `SELECT id, shopify_operation_id
         FROM bulk_runs
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      return res.rows[0] ?? null;
    });

    if (!run) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Run not found'));
      return;
    }

    let shopifyCancelled = false;
    if (run.shopify_operation_id) {
      try {
        const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');
        const mutation = buildBulkOperationCancelMutation();

        const res = await withTokenRetry(
          session.shopId,
          encryptionKey,
          logger,
          async (accessToken, shopDomain) => {
            const client = shopifyApi.createClient({ shopDomain, accessToken });
            return await client.request<{
              bulkOperationCancel?: {
                bulkOperation?: { id?: string | null; status?: string | null } | null;
                userErrors?: { field?: string[] | null; message?: string | null }[] | null;
              };
            }>(mutation, { id: run.shopify_operation_id });
          }
        );

        const userErrors = res.data?.bulkOperationCancel?.userErrors ?? [];
        if (userErrors.length) {
          const message = userErrors
            .map((e) => e?.message)
            .filter((m): m is string => Boolean(m))
            .join('; ');
          throw new Error(message || 'bulk_cancel_user_errors');
        }

        shopifyCancelled = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'bulk_cancel_failed';
        logger.error({ err, runId: id, shopId: session.shopId }, 'Bulk cancel failed');
        void reply.status(502).send(errorEnvelope(request.id, 502, 'BULK_CANCEL_FAILED', message));
        return;
      }
    }

    await withTenantContext(session.shopId, async (client) => {
      await client.query(
        `UPDATE bulk_runs
         SET status = 'cancelled', cancelled_at = now(), updated_at = now()
         WHERE id = $1`,
        [id]
      );
    });

    void reply.status(200).send(successEnvelope(request.id, { cancelled: true, shopifyCancelled }));
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

  server.get(
    '/bulk/:id/logs/ws',
    { ...requireAdminSession, websocket: true },
    (connection: WsConnection, request) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        connection.socket.close(1008, 'Session required');
        return;
      }

      const id = (request.params as { id?: unknown }).id;
      if (!isNonEmptyString(id)) {
        connection.socket.close(1008, 'Missing id');
        return;
      }

      streamBulkLogsWs({ request, connection, shopId: session.shopId, runId: id, logger });
    }
  );

  server.get(
    '/ingestion/:id/logs/ws',
    { ...requireAdminSession, websocket: true },
    (connection: WsConnection, request) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        connection.socket.close(1008, 'Session required');
        return;
      }

      const id = (request.params as { id?: unknown }).id;
      if (!isNonEmptyString(id)) {
        connection.socket.close(1008, 'Missing id');
        return;
      }

      streamBulkLogsWs({ request, connection, shopId: session.shopId, runId: id, logger });
    }
  );

  server.get(
    '/logs/ws',
    { ...requireAdminSession, websocket: true },
    (connection: WsConnection, request) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        connection.socket.close(1008, 'Session required');
        return;
      }

      streamBulkLogsWs({ request, connection, shopId: session.shopId, logger });
    }
  );

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
