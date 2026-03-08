import { Redis as IORedis, type Redis, type RedisOptions } from 'ioredis';

interface ManagedRedisEntry {
  name: string;
  options: RedisOptions;
  currentUrl: string;
  currentClient: Redis;
  proxyClient: Redis;
}

type WorkerRecreator = (newRedisUrl: string) => Promise<void>;

const managedRedis = new Map<string, ManagedRedisEntry>();
const workerRecreators = new Map<string, WorkerRecreator>();

let rotationInFlight: Promise<void> | null = null;

function getCurrentRedisUrl(): string {
  const redisUrl = process.env['REDIS_URL'] ?? '';
  if (!redisUrl.trim()) throw new Error('Missing REDIS_URL');
  return redisUrl.trim();
}

function createRedisClient(redisUrl: string, options: RedisOptions): Redis {
  return new IORedis(redisUrl, {
    enableReadyCheck: true,
    connectTimeout: 10_000,
    retryStrategy: (times) => Math.min(times * 50, 2_000),
    maxRetriesPerRequest: null,
    ...options,
  });
}

function createClientProxy(getCurrentClient: () => Redis): Redis {
  return new Proxy(Object.create(null) as Redis, {
    get(_, prop) {
      const client = getCurrentClient();
      const value = Reflect.get(client, prop, client) as unknown;
      if (typeof value !== 'function') return value;

      return (...args: unknown[]) => {
        const activeClient = getCurrentClient();
        const fn = Reflect.get(activeClient, prop, activeClient) as unknown;
        if (typeof fn !== 'function') {
          throw new Error(`[REDIS-MANAGER] Property ${String(prop)} is not callable`);
        }
        return (fn as (...inner: unknown[]) => unknown).apply(activeClient, args);
      };
    },
  });
}

/**
 * Creates a disposable Redis client for one-off operations like health probes.
 * NOT cached — caller is responsible for calling .disconnect() when done.
 */
export function createEphemeralRedis(options: RedisOptions = {}): Redis {
  const redisUrl = getCurrentRedisUrl();
  return new IORedis(redisUrl, {
    enableReadyCheck: true,
    connectTimeout: 5_000,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
    ...options,
  });
}

export function createManagedRedis(name: string, options: RedisOptions = {}): Redis {
  const cached = managedRedis.get(name);
  if (cached) return cached.proxyClient;

  const redisUrl = getCurrentRedisUrl();
  const state = {
    currentClient: createRedisClient(redisUrl, options),
  };
  const entry: ManagedRedisEntry = {
    name,
    options,
    currentUrl: redisUrl,
    currentClient: state.currentClient,
    proxyClient: createClientProxy(() => state.currentClient),
  };
  Object.defineProperty(entry, 'currentClient', {
    get: () => state.currentClient,
    set: (value: Redis) => {
      state.currentClient = value;
    },
  });
  managedRedis.set(name, entry);
  return entry.proxyClient;
}

export function registerWorkerRecreator(name: string, fn: WorkerRecreator): void {
  workerRecreators.set(name, fn);
}

export async function recreateAllWorkers(newRedisUrl: string): Promise<void> {
  for (const [name, recreate] of workerRecreators.entries()) {
    try {
      await recreate(newRedisUrl);
    } catch (error) {
      console.error('[REDIS-MANAGER] Worker recreation failed', { name, error });
    }
  }
}

export async function rotateAllManagedRedis(newRedisUrl: string): Promise<void> {
  if (!newRedisUrl.trim()) return;
  if (rotationInFlight) return rotationInFlight;

  rotationInFlight = (async () => {
    const rotationResults = await Promise.allSettled(
      [...managedRedis.values()].map(async (entry) => {
        if (entry.currentUrl === newRedisUrl) return;

        const next = createRedisClient(newRedisUrl, entry.options);
        await next.ping();

        const old = entry.currentClient;
        entry.currentClient = next;
        entry.currentUrl = newRedisUrl;

        await old.quit().catch(() => undefined);
      })
    );

    for (const result of rotationResults) {
      if (result.status === 'rejected') {
        console.error('[REDIS-MANAGER] Managed redis rotation failed', {
          error: String(result.reason),
        });
      }
    }

    await recreateAllWorkers(newRedisUrl);
  })();

  try {
    await rotationInFlight;
  } finally {
    rotationInFlight = null;
  }
}

export async function closeManagedRedisConnections(): Promise<void> {
  const closeResults = await Promise.allSettled(
    [...managedRedis.values()].map(async (entry) => {
      await entry.currentClient.quit().catch(() => undefined);
    })
  );
  managedRedis.clear();

  for (const result of closeResults) {
    if (result.status === 'rejected') {
      console.error('[REDIS-MANAGER] Managed redis close failed', { error: String(result.reason) });
    }
  }
}

export function getManagedRedisConnectionsCount(): number {
  return managedRedis.size;
}
