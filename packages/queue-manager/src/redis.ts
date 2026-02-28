import type { Redis, RedisOptions } from 'ioredis';
import { createManagedRedis } from '@app/database';

export type RedisConnection = Redis;

export type CreateRedisConnectionOptions = Readonly<{
  redisUrl: string;
  redisOptions?: RedisOptions;
}>;

let redisConnectionCounter = 0;

export function createRedisConnection(options: CreateRedisConnectionOptions): RedisConnection {
  const { redisOptions } = options;
  const connectionName = redisOptions?.connectionName;
  const managedName =
    typeof connectionName === 'string' && connectionName.trim()
      ? `queue-manager:${connectionName}`
      : `queue-manager:auto-${redisConnectionCounter++}`;

  return createManagedRedis(managedName, {
    enableReadyCheck: true,
    connectTimeout: 10_000,
    retryStrategy: (times) => Math.min(times * 50, 2_000),
    maxRetriesPerRequest: null,
    ...redisOptions,
  });
}
