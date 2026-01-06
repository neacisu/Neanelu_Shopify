import type { JobPro } from '@taskforcesh/bullmq-pro';
import { DelayedError } from '@taskforcesh/bullmq-pro';
import { context as otelContext, metrics, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('neanelu-shopify.queue-manager');
const ratelimitDelayedTotal = meter.createCounter('queue_ratelimit_delayed_total', {
  description: 'Total number of jobs delayed due to rate limiting (delayMs-shaped errors)',
});
const ratelimitDelaySeconds = meter.createHistogram('queue_ratelimit_delay_seconds', {
  description: 'Duration of rate limit delays in seconds (delayMs-shaped errors)',
  unit: 's',
});

export type DelayJobErrorShape = Readonly<{
  delayMs: number;
  name?: string;
}>;

export function isDelayJobError(err: unknown): err is DelayJobErrorShape {
  if (!err || typeof err !== 'object') return false;
  const maybe = err as Record<string, unknown>;
  return typeof maybe['delayMs'] === 'number' && Number.isFinite(maybe['delayMs']);
}

export async function moveJobToDelayedAndThrow(
  job: JobPro,
  delayMs: number,
  token?: string
): Promise<never> {
  const safeDelayMs = Math.max(0, Math.floor(delayMs));
  const when = Date.now() + safeDelayMs;

  await job.moveToDelayed(when, token);

  // Signal to BullMQ that the job was intentionally delayed.
  throw new DelayedError(`moved_to_delayed:${safeDelayMs}`);
}

export type RateLimitGroupFn = (job: JobPro, delayMs: number) => Promise<void>;

export function wrapProcessorWithDelayHandling<TData>(
  processor: (job: JobPro<TData>, token?: string, signal?: AbortSignal) => Promise<unknown>,
  options?: {
    /** Best-effort integration with BullMQ Pro Groups rate limiting (when available). */
    rateLimitGroup?: RateLimitGroupFn;
    /** Queue name for metrics/spans. */
    queueName?: string;
  }
): (job: JobPro<TData>, token?: string, signal?: AbortSignal) => Promise<unknown> {
  return async (job, token, signal) => {
    try {
      return await processor(job, token, signal);
    } catch (err) {
      // Duck-typing to avoid adding a hard dependency on @app/shopify-client.
      // Any error with a numeric `delayMs` will cause a delay without consuming attempts.
      if (isDelayJobError(err)) {
        const queueName = options?.queueName ?? 'unknown';
        const delaySeconds = Math.max(0, err.delayMs) / 1000;

        ratelimitDelayedTotal.add(1, { queue_name: queueName });
        ratelimitDelaySeconds.record(delaySeconds, { queue_name: queueName });

        const tracer = trace.getTracer('neanelu-shopify');
        const span = tracer.startSpan('queue.ratelimit.delay', {
          attributes: {
            'queue.name': queueName,
            'queue.delay_ms': Math.max(0, Math.floor(err.delayMs)),
          },
        });

        if (options?.rateLimitGroup) {
          try {
            await options.rateLimitGroup(job, err.delayMs);
          } catch {
            // best-effort
          }
        }

        try {
          return await otelContext.with(trace.setSpan(otelContext.active(), span), async () =>
            moveJobToDelayedAndThrow(job, err.delayMs, token)
          );
        } finally {
          span.end();
        }
      }
      throw err;
    }
  };
}
