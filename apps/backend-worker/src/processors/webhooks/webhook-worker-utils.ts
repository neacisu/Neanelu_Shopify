import { exp4BackoffMs, NEANELU_BACKOFF_STRATEGY } from '@app/queue-manager';

function primitiveToTelemetryString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return undefined;
}

/** ID job BullMQ pentru telemetrie / registry (doar primitive — fără `[object Object]`). */
export function webhookJobIdString(job: unknown): string | undefined {
  const id = (job as { id?: unknown } | null | undefined)?.id;
  return primitiveToTelemetryString(id);
}

/** Nume job pentru loguri / stream (primitive only). */
export function webhookJobNameString(name: unknown): string | undefined {
  return primitiveToTelemetryString(name);
}

export function computeWebhookJobBackoffMsForRetry(job: unknown): number | null {
  const j = job as
    | {
        attemptsMade?: number;
        opts?: { backoff?: unknown };
      }
    | undefined;

  const attemptsMade = typeof j?.attemptsMade === 'number' ? j.attemptsMade : null;
  if (attemptsMade === null || attemptsMade <= 0) return null;

  const configured = j?.opts?.backoff;
  const type =
    typeof configured === 'object' && configured !== null
      ? ((configured as Record<string, unknown>)['type'] as string | undefined)
      : undefined;

  let baseDelay = 0;
  if (typeof configured === 'number') {
    baseDelay = configured;
  } else if (typeof configured === 'object' && configured !== null) {
    baseDelay = Number((configured as Record<string, unknown>)['delay'] ?? 0) || 0;
  }

  if (type === NEANELU_BACKOFF_STRATEGY) return exp4BackoffMs(attemptsMade);
  if (type === 'exponential') return baseDelay * 2 ** Math.max(0, attemptsMade - 1);
  return baseDelay;
}
