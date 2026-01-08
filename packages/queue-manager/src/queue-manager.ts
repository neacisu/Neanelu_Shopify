import type { AppEnv } from '@app/config';

import {
  type JobPro,
  QueueEventsPro as BullQueueEvents,
  QueuePro as BullQueue,
  WorkerPro as BullWorker,
  type ConnectionOptions,
  type JobsProOptions,
  type MinimalJob,
  type QueueEventsOptions,
  type QueueProOptions,
  type WorkerProOptions,
} from '@taskforcesh/bullmq-pro';

import { context as otelContext, metrics, propagation } from '@opentelemetry/api';

import {
  defaultJobTimeoutMs,
  defaultQueuePolicy,
  exp4BackoffMs,
  NEANELU_BACKOFF_STRATEGY,
} from './policy.js';
import { QUEUE_NAMES, type KnownQueueName, toDlqQueueName } from './names.js';
import { wrapProcessorWithDelayHandling } from './job-delay.js';

function requireNonEmpty(value: string, key: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing required config value: ${key}`);
  }
  return trimmed;
}

export type QueueManagerConfig = Readonly<{
  redisUrl: string;
  bullmqProToken: string;
}>;

type TelemetryCarrier = Record<string, string>;

function carrierFromTelemetry(raw: unknown): TelemetryCarrier | null {
  if (raw == null) return null;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Accept either raw traceparent or a JSON string {traceparent,tracestate}.
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          const traceparent =
            typeof obj['traceparent'] === 'string' ? obj['traceparent'] : undefined;
          const tracestate = typeof obj['tracestate'] === 'string' ? obj['tracestate'] : undefined;
          if (!traceparent) return null;
          return {
            traceparent,
            ...(tracestate ? { tracestate } : {}),
          };
        }
      } catch {
        return null;
      }
    }

    return { traceparent: trimmed };
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const traceparent = typeof obj['traceparent'] === 'string' ? obj['traceparent'] : undefined;
    const tracestate = typeof obj['tracestate'] === 'string' ? obj['tracestate'] : undefined;
    if (!traceparent) return null;
    return {
      traceparent,
      ...(tracestate ? { tracestate } : {}),
    };
  }

  return null;
}

function extractContextFromTelemetry(raw: unknown) {
  const carrier = carrierFromTelemetry(raw);
  if (!carrier?.['traceparent']) return otelContext.active();

  return propagation.extract(otelContext.active(), carrier, {
    get: (c, key) => c[key],
    keys: (c) => Object.keys(c),
  });
}

export function extractOtelContextFromTelemetryMetadata(metadata: unknown) {
  return extractContextFromTelemetry(metadata);
}

export async function withJobTelemetryContext<T>(
  job: unknown,
  fn: () => T | Promise<T>
): Promise<T> {
  const telemetry = (job as { opts?: { telemetry?: { metadata?: unknown } } } | null | undefined)
    ?.opts?.telemetry;
  const extracted = extractContextFromTelemetry(telemetry?.metadata);
  return await otelContext.with(extracted, fn);
}

export function buildJobTelemetryFromActiveContext(): { metadata: string } | undefined {
  const carrier: TelemetryCarrier = {};

  propagation.inject(otelContext.active(), carrier, {
    set: (c, key, value) => {
      c[key] = String(value);
    },
  });

  const traceparent = carrier['traceparent'];
  if (!traceparent) return undefined;

  const tracestate = carrier['tracestate'];
  return {
    metadata: JSON.stringify({
      traceparent,
      ...(tracestate ? { tracestate } : {}),
    }),
  };
}

const meter = metrics.getMeter('neanelu-shopify.queue-manager');
const dlqEntriesTotal = meter.createCounter('queue_dlq_entries_total', {
  description: 'Total jobs moved to DLQ',
});

export function configFromEnv(env: AppEnv): QueueManagerConfig {
  return {
    redisUrl: env.redisUrl,
    bullmqProToken: env.bullmqProToken,
  };
}

export type CreateQueueManagerOptions = Readonly<{
  config: QueueManagerConfig;
  /** Override for bullmq connection options; url is always set from config.redisUrl. */
  connection?: Omit<ConnectionOptions, 'url'>;
}>;

function parsePositiveIntEnv(key: string): number | null {
  const raw = process.env[key];
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${key}: expected positive integer, got ${raw}`);
  }
  return value;
}

function dlqRetentionAgeSeconds(): number {
  // Default: 30 days
  const days = parsePositiveIntEnv('QUEUE_MANAGER_DLQ_RETENTION_DAYS') ?? 30;
  return days * 86400;
}

function buildConnection(config: QueueManagerConfig, override?: Omit<ConnectionOptions, 'url'>) {
  return {
    url: config.redisUrl,
    // Standard Redis defaults (BullMQ uses ioredis under the hood)
    enableReadyCheck: true,
    connectTimeout: 10_000,
    retryStrategy: (times: number) => Math.min(times * 50, 2_000),
    maxRetriesPerRequest: null,
    ...(override ?? {}),
  } satisfies ConnectionOptions;
}

export type DlqEntry = Readonly<{
  originalQueue: string;
  originalJobId: string | null;
  originalJobName: string;
  attemptsMade: number;
  failedReason: string | null;
  stacktrace: readonly string[];
  data: unknown;
  occurredAt: string;
}>;

export type CreateQueueOptions = Readonly<{
  name: string;
  queueOptions?: Omit<QueueProOptions, 'connection' | 'defaultJobOptions'>;
  defaultJobOptions?: Partial<JobsProOptions>;
}>;

export function createQueue(
  options: CreateQueueManagerOptions,
  queue: CreateQueueOptions
): BullQueue {
  requireNonEmpty(options.config.bullmqProToken, 'BULLMQ_PRO_TOKEN');
  const policy = defaultQueuePolicy();

  const overrideJobOptions = queue.defaultJobOptions ?? {};
  const mergedBackoff = overrideJobOptions.backoff ?? policy.backoff;

  return new BullQueue(queue.name, {
    connection: buildConnection(options.config, options.connection),
    defaultJobOptions: {
      ...(overrideJobOptions as Omit<JobsProOptions, 'backoff'>),
      attempts: overrideJobOptions.attempts ?? policy.attempts,
      removeOnComplete: overrideJobOptions.removeOnComplete ?? policy.removeOnComplete,
      removeOnFail: overrideJobOptions.removeOnFail ?? policy.removeOnFail,
      backoff: mergedBackoff,
    },
    ...(queue.queueOptions ?? {}),
  });
}

export type CreateQueueEventsOptions = Readonly<{
  name: string;
  queueEventsOptions?: Omit<QueueEventsOptions, 'connection'>;
}>;

export function createQueueEvents(
  options: CreateQueueManagerOptions,
  queueEvents: CreateQueueEventsOptions
): BullQueueEvents {
  requireNonEmpty(options.config.bullmqProToken, 'BULLMQ_PRO_TOKEN');
  return new BullQueueEvents(queueEvents.name, {
    connection: buildConnection(options.config, options.connection),
    ...(queueEvents.queueEventsOptions ?? {}),
  });
}

export type CreateWorkerOptions<TData = unknown> = Readonly<{
  name: string;
  processor: (job: JobPro<TData>, token?: string, signal?: AbortSignal) => Promise<unknown>;
  workerOptions?: Omit<WorkerProOptions, 'connection' | 'settings'>;
  /** Default job execution timeout for this worker. Set to null to disable. */
  jobTimeoutMs?: number | null;
  /** If true, processors can delay jobs by throwing an error with a numeric `delayMs` field. */
  enableDelayHandling?: boolean;
  /** If true, failed jobs that exhausted retries are copied into `${name}-dlq`. */
  enableDlq?: boolean;
  onDlqEntry?: (entry: DlqEntry) => void;
  /**
   * How often (ms) to check for stalled jobs. Defaults to 30_000 (30s).
   * Set to 0 to disable stall detection.
   */
  stalledInterval?: number;
  /**
   * Max times a job can be recovered from stalled state before failing.
   * Defaults to 1. Set higher for long-running jobs that may stall.
   */
  maxStalledCount?: number;
}>;

export function createWorker<TData = unknown>(
  options: CreateQueueManagerOptions,
  worker: CreateWorkerOptions<TData>
): { worker: BullWorker<TData>; dlqQueue?: BullQueue } {
  requireNonEmpty(options.config.bullmqProToken, 'BULLMQ_PRO_TOKEN');
  const policy = defaultQueuePolicy();
  const strictDlq = process.env['QUEUE_MANAGER_DLQ_STRICT'] === 'true';

  const resolvedTimeoutMs =
    worker.jobTimeoutMs ??
    (QUEUE_NAMES.includes(worker.name as KnownQueueName)
      ? defaultJobTimeoutMs(worker.name as KnownQueueName)
      : null);

  const wrappedProcessor: CreateWorkerOptions<TData>['processor'] = async (job, token, signal) => {
    const telemetry = (job?.opts as unknown as { telemetry?: { metadata?: unknown } } | undefined)
      ?.telemetry;
    const extracted = extractContextFromTelemetry(telemetry?.metadata);

    return otelContext.with(extracted, async () => {
      if (!resolvedTimeoutMs || resolvedTimeoutMs <= 0) {
        return worker.processor(job, token, signal);
      }

      const timeoutController = new AbortController();
      const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;

      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          timeoutController.abort();
          reject(new Error(`Job exceeded timeout of ${resolvedTimeoutMs}ms`));
        }, resolvedTimeoutMs);

        combinedSignal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const reason: unknown = (combinedSignal as unknown as { reason?: unknown }).reason;
            reject(reason instanceof Error ? reason : new Error('Job aborted'));
          },
          { once: true }
        );
      });

      return Promise.race([worker.processor(job, token, combinedSignal), timeoutPromise]);
    });
  };

  // Set after worker creation; used for best-effort rateLimitGroup integration.
  let workerRef: BullWorker<TData> | null = null;

  const finalProcessor = worker.enableDelayHandling
    ? wrapProcessorWithDelayHandling<TData>(wrappedProcessor, {
        queueName: worker.name,
        rateLimitGroup: async (job, delayMs) => {
          const w = workerRef as unknown as {
            rateLimitGroup?: (j: unknown, ms: number) => unknown;
          };
          if (typeof w?.rateLimitGroup === 'function') {
            await Promise.resolve(w.rateLimitGroup(job, Math.max(0, Math.floor(delayMs))));
          }
        },
      })
    : wrappedProcessor;

  const dlqQueue = worker.enableDlq
    ? createQueue(options, { name: toDlqQueueName(worker.name) })
    : undefined;

  const w = new BullWorker<TData>(worker.name, finalProcessor, {
    connection: buildConnection(options.config, options.connection),
    settings: {
      backoffStrategy: (attemptsMade: number, type?: string, _err?: Error, job?: MinimalJob) => {
        if (type === NEANELU_BACKOFF_STRATEGY) return exp4BackoffMs(attemptsMade);

        const configured = job?.opts.backoff;
        const baseDelay =
          typeof configured === 'number'
            ? configured
            : typeof configured === 'object' && configured
              ? (configured.delay ?? 0)
              : 0;

        if (type === 'exponential') return baseDelay * 2 ** Math.max(0, attemptsMade - 1);
        return baseDelay;
      },
      // Stall detection settings (F4.2.3)
      ...(worker.stalledInterval !== undefined && { stalledInterval: worker.stalledInterval }),
      ...(worker.maxStalledCount !== undefined && { maxStalledCount: worker.maxStalledCount }),
    },
    ...(worker.workerOptions ?? {}),
  });

  workerRef = w;

  if (dlqQueue) {
    const handleFailed = async (job: JobPro<TData> | undefined, err: Error): Promise<void> => {
      if (!job) return;

      const maxAttempts = job.opts.attempts ?? policy.attempts;
      // BullMQ semantics: attemptsMade is the 1-based attempt count (1..attempts).
      // Only enqueue to DLQ on the terminal failure.
      const exhausted = job.attemptsMade >= maxAttempts;
      if (!exhausted) return;

      const entry: DlqEntry = {
        originalQueue: worker.name,
        originalJobId: job.id != null ? String(job.id) : null,
        originalJobName: job.name,
        attemptsMade: job.attemptsMade,
        failedReason: err.message,
        stacktrace: job.stacktrace ?? [],
        data: job.data,
        occurredAt: new Date().toISOString(),
      };

      try {
        // BullMQ validates that custom jobIds cannot contain ':'
        const derivedJobId = entry.originalJobId ? `${worker.name}__${entry.originalJobId}` : null;
        const ageSeconds = dlqRetentionAgeSeconds();
        await dlqQueue.add(job.name, entry, {
          ...(derivedJobId ? { jobId: derivedJobId } : {}),
          removeOnComplete: { age: ageSeconds },
          removeOnFail: { age: ageSeconds },
        });

        dlqEntriesTotal.add(1, { queue_name: worker.name });

        // Required by policy: do not hide failures (log + metric).
        // Keep this log compact to avoid large payloads; `entry.data` may be big.
        console.error('[queue-manager] job moved to DLQ', {
          queueName: worker.name,
          dlqQueueName: dlqQueue.name,
          jobName: entry.originalJobName,
          originalJobId: entry.originalJobId,
          attemptsMade: entry.attemptsMade,
          failedReason: entry.failedReason,
        });

        worker.onDlqEntry?.(entry);

        // Best-effort: reduce noise in the original failed set.
        try {
          await job.remove();
        } catch {
          // ignore
        }
      } catch (err) {
        // If DLQ write fails, keep the original job for investigation.
        console.error('[queue-manager] failed to write DLQ entry', {
          queueName: worker.name,
          jobId: job.id != null ? String(job.id) : null,
          jobName: job.name,
          error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
        });

        if (strictDlq) throw err;
      }
    };

    w.on('failed', (job: JobPro<TData> | undefined, err: Error) => {
      void handleFailed(job, err);
    });
  }

  if (dlqQueue) return { worker: w, dlqQueue };
  return { worker: w };
}

export type PruneQueueOptions = Readonly<{
  /** Remove jobs older than this many milliseconds. */
  olderThanMs: number;
  /** Limit per state. */
  limit?: number;
}>;

export async function pruneQueue(queue: BullQueue, options: PruneQueueOptions): Promise<void> {
  const limit = options.limit ?? 1000;
  const grace = options.olderThanMs;

  // Clean across common states.
  await queue.clean(grace, limit, 'completed');
  await queue.clean(grace, limit, 'failed');
  await queue.clean(grace, limit, 'delayed');
  await queue.clean(grace, limit, 'wait');
}
