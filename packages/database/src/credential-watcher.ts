import { readFile, stat } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';

import { metrics } from '@opentelemetry/api';

import {
  rotatePool,
  getCurrentConnectionString,
  registerCredentialRefreshFn,
  isAuthError,
  pool,
} from './db.js';
import {
  createManagedRedis,
  rotateAllManagedRedis,
  getManagedRedisConnectionsCount,
} from './redis-manager.js';

const SECRETS_PATH = process.env['CREDENTIALS_FILE'] ?? '/secrets/neanelu-api.env';
const POLL_INTERVAL_MS = 5_000;
const HEALTH_PROBE_INTERVAL_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

const meter = metrics.getMeter('neanelu-shopify.database');
const credentialRotationTotal = meter.createCounter('credential_rotation_total', {
  description: 'Credential rotations by secret type and status',
});
const credentialRotationDuration = meter.createHistogram('credential_rotation_duration_seconds', {
  description: 'Credential rotation duration',
  unit: 's',
});
const credentialLastRotationTimestamp = meter.createObservableGauge(
  'credential_last_rotation_timestamp_seconds',
  {
    description: 'Unix timestamp of last successful credential rotation',
    unit: 's',
  }
);
const credentialManagedRedisConnections = meter.createObservableGauge(
  'credential_managed_redis_connections_total',
  {
    description: 'Total managed redis connections',
  }
);
const credentialManagedDbPools = meter.createObservableGauge('credential_managed_db_pools_total', {
  description: 'Total managed database pools (main + secondary)',
});
let _lastRotationTimestampSeconds = 0;
meter.addBatchObservableCallback(
  (obs) => {
    if (_lastRotationTimestampSeconds > 0) {
      obs.observe(credentialLastRotationTimestamp, _lastRotationTimestampSeconds);
    }
    obs.observe(credentialManagedRedisConnections, getManagedRedisConnectionsCount());
    obs.observe(credentialManagedDbPools, 1 + secondaryRotators.length);
  },
  [credentialLastRotationTimestamp, credentialManagedRedisConnections, credentialManagedDbPools]
);

let watching = false;
let lastMtimeMs = 0;
let healthProbeTimer: ReturnType<typeof setInterval> | null = null;

type SecondaryRotator = (newConnectionString: string) => Promise<void>;
const secondaryRotators: SecondaryRotator[] = [];

type ParsedSecrets = Record<string, string>;

export function registerSecondaryPoolRotator(fn: SecondaryRotator): void {
  secondaryRotators.push(fn);
}

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>): void {
  const payload = { component: 'credential-watcher', ...extra };
  if (level === 'error') console.error(`[CRED-WATCH] ${msg}`, payload);
  else if (level === 'warn') console.warn(`[CRED-WATCH] ${msg}`, payload);
  else console.info(`[CRED-WATCH] ${msg}`, payload);
}

export function parseAllSecrets(envContent: string): ParsedSecrets {
  const out: ParsedSecrets = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const eqIndex = trimmed.indexOf('=');
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (!key) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function syncProcessEnv(parsedSecrets: ParsedSecrets): void {
  for (const [key, value] of Object.entries(parsedSecrets)) {
    process.env[key] = value;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rotateAllPools(newUrl: string): Promise<void> {
  await rotatePool(newUrl);
  const secondaryResults = await Promise.allSettled(secondaryRotators.map((fn) => fn(newUrl)));
  for (const result of secondaryResults) {
    if (result.status === 'rejected') {
      log('error', 'Secondary pool rotation failed', { error: String(result.reason) });
    }
  }
}

async function applySecretsFromContent(content: string): Promise<boolean> {
  const parsed = parseAllSecrets(content);
  const newDatabaseUrl = parsed['DATABASE_URL']?.trim();
  const newRedisUrl = parsed['REDIS_URL']?.trim();
  if (!newDatabaseUrl) {
    log('warn', 'No DATABASE_URL found in credentials file');
    return false;
  }

  const currentDbUrl = getCurrentConnectionString();
  const currentRedisUrl = process.env['REDIS_URL']?.trim();
  const dbChanged = currentDbUrl !== newDatabaseUrl;
  const redisChanged = Boolean(newRedisUrl && newRedisUrl !== currentRedisUrl);
  if (!dbChanged && !redisChanged) {
    syncProcessEnv(parsed);
    log('info', 'Credentials unchanged, skipping rotation');
    return false;
  }

  syncProcessEnv(parsed);

  const startedAt = Date.now();
  if (dbChanged) await rotateAllPools(newDatabaseUrl);
  if (redisChanged && newRedisUrl) await rotateAllManagedRedis(newRedisUrl);

  const durationSeconds = (Date.now() - startedAt) / 1_000;
  if (dbChanged) {
    credentialRotationTotal.add(1, { secret_type: 'database', status: 'success' });
    credentialRotationDuration.record(durationSeconds, { secret_type: 'database' });
  }
  if (redisChanged) {
    credentialRotationTotal.add(1, { secret_type: 'redis', status: 'success' });
    credentialRotationDuration.record(durationSeconds, { secret_type: 'redis' });
  }
  _lastRotationTimestampSeconds = Math.floor(Date.now() / 1_000);
  return true;
}

async function handleChange(): Promise<void> {
  let content: string;
  try {
    content = await readFile(SECRETS_PATH, 'utf-8');
  } catch (err) {
    log('error', 'Failed to read credentials file', { path: SECRETS_PATH, error: String(err) });
    return;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const rotated = await applySecretsFromContent(content);
      if (rotated) {
        log('info', 'Credential rotation completed', { attempt });
      }
      return;
    } catch (err) {
      log('error', `Credential rotation attempt ${attempt}/${MAX_RETRIES} failed`, {
        error: String(err),
      });
      credentialRotationTotal.add(1, { secret_type: 'database', status: 'failure' });
      credentialRotationTotal.add(1, { secret_type: 'redis', status: 'failure' });
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  log('error', 'All credential rotation attempts exhausted');
}

export async function triggerCredentialRefresh(): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(SECRETS_PATH, 'utf-8');
  } catch (err) {
    log('error', 'triggerCredentialRefresh: failed to read file', {
      path: SECRETS_PATH,
      error: String(err),
    });
    return false;
  }

  try {
    return await applySecretsFromContent(content);
  } catch (err) {
    log('error', 'triggerCredentialRefresh: rotation failed', { error: String(err) });
    return false;
  }
}

async function runHealthProbe(): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  } catch (err) {
    if (isAuthError(err)) {
      log('warn', 'DB health probe detected auth error — triggering credential refresh');
      void triggerCredentialRefresh();
    }
  }

  try {
    const redis = createManagedRedis('credential-health-probe', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    await redis.ping();
  } catch (err) {
    log('warn', 'Redis health probe failed — triggering credential refresh', {
      error: String(err),
    });
    void triggerCredentialRefresh();
  }
}

export async function startCredentialWatcher(): Promise<void> {
  if (watching) {
    log('warn', 'Watcher already running');
    return;
  }

  registerCredentialRefreshFn(triggerCredentialRefresh);

  try {
    const s = await stat(SECRETS_PATH);
    lastMtimeMs = s.mtimeMs;
  } catch {
    log('info', 'Credentials file not found, watcher disabled (local dev mode)', {
      path: SECRETS_PATH,
    });
    return;
  }

  log('info', 'Starting credential file watcher', { path: SECRETS_PATH, pollMs: POLL_INTERVAL_MS });
  await handleChange();
  watchFile(SECRETS_PATH, { interval: POLL_INTERVAL_MS }, (curr) => {
    if (curr.mtimeMs <= lastMtimeMs) return;
    lastMtimeMs = curr.mtimeMs;
    void handleChange();
  });

  healthProbeTimer = setInterval(() => {
    void runHealthProbe();
  }, HEALTH_PROBE_INTERVAL_MS);

  watching = true;
  log('info', 'Health probes started', { intervalMs: HEALTH_PROBE_INTERVAL_MS });
}

export function stopCredentialWatcher(): void {
  if (!watching) return;
  unwatchFile(SECRETS_PATH);

  if (healthProbeTimer) {
    clearInterval(healthProbeTimer);
    healthProbeTimer = null;
  }

  watching = false;
  log('info', 'Credential watcher and health probes stopped');
}
