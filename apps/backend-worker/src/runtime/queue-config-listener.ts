import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { createClient } from 'redis';

interface QueueConfigMessage {
  queueName: string;
  config: { concurrency?: number };
  timestamp?: number;
}

interface WorkerLike {
  concurrency?: number;
  setConcurrency?: (value: number) => void;
  updateConcurrency?: (value: number) => void;
}

export type QueueWorkerRegistry = Readonly<Record<string, WorkerLike | null | undefined>>;

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function applyConcurrency(worker: WorkerLike, value: number): boolean {
  if (typeof worker.setConcurrency === 'function') {
    worker.setConcurrency(value);
    return true;
  }
  if (typeof worker.updateConcurrency === 'function') {
    worker.updateConcurrency(value);
    return true;
  }
  if (typeof worker.concurrency === 'number') {
    worker.concurrency = value;
    return true;
  }
  return false;
}

type RedisClient = ReturnType<typeof createClient>;

export async function startQueueConfigListener(
  env: AppEnv,
  logger: Logger,
  registry: QueueWorkerRegistry
): Promise<RedisClient> {
  const redis = createClient({ url: env.redisUrl });
  await redis.connect();

  await redis.subscribe('queue_config_changed', (message) => {
    const parsed = safeJsonParse<QueueConfigMessage>(message);
    if (!parsed || typeof parsed.queueName !== 'string') return;
    const concurrency = parsed.config?.concurrency;
    if (typeof concurrency !== 'number') return;

    const worker = registry[parsed.queueName];
    if (!worker) return;
    const applied = applyConcurrency(worker, concurrency);
    if (!applied) {
      logger.warn({ queueName: parsed.queueName }, 'Worker does not support dynamic concurrency');
    }
  });

  return redis;
}
