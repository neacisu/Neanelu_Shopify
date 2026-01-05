import { Redis as IORedis, type Redis, type RedisOptions } from 'ioredis';

export type RedisConnection = Redis;

export type CreateRedisConnectionOptions = Readonly<{
  redisUrl: string;
  redisOptions?: RedisOptions;
}>;

export function createRedisConnection(options: CreateRedisConnectionOptions): RedisConnection {
  const { redisUrl, redisOptions } = options;
  return new IORedis(redisUrl, {
    enableReadyCheck: true,
    connectTimeout: 10_000,
    retryStrategy: (times) => Math.min(times * 50, 2_000),
    maxRetriesPerRequest: null,
    ...redisOptions,
  });
}
