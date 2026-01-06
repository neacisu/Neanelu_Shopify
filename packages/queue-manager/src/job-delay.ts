import type { JobPro } from '@taskforcesh/bullmq-pro';
import { DelayedError } from '@taskforcesh/bullmq-pro';

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
  }
): (job: JobPro<TData>, token?: string, signal?: AbortSignal) => Promise<unknown> {
  return async (job, token, signal) => {
    try {
      return await processor(job, token, signal);
    } catch (err) {
      // Duck-typing to avoid adding a hard dependency on @app/shopify-client.
      // Any error with a numeric `delayMs` will cause a delay without consuming attempts.
      if (isDelayJobError(err)) {
        if (options?.rateLimitGroup) {
          try {
            await options.rateLimitGroup(job, err.delayMs);
          } catch {
            // best-effort
          }
        }
        return await moveJobToDelayedAndThrow(job, err.delayMs, token);
      }
      throw err;
    }
  };
}
