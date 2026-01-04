export type NodeEnv = 'development' | 'staging' | 'production' | 'test';

export type AppEnv = Readonly<{
  nodeEnv: NodeEnv;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  port: number;

  appHost: URL;

  databaseUrl: string;
  redisUrl: string;

  shopifyApiKey: string;
  shopifyApiSecret: string;
  scopes: readonly string[];

  encryptionKeyVersion: number;
  encryptionKeyHex: string;

  otelExporterOtlpEndpoint: string;
  otelServiceName: string;
}>;

type EnvSource = Record<string, string | undefined>;

function requiredString(env: EnvSource, key: string): string {
  const value = env[key];
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function optionalString(env: EnvSource, key: string): string | undefined {
  const value = env[key];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseNodeEnv(value: string | undefined): NodeEnv {
  const normalized = (value ?? 'development').trim();
  if (
    normalized === 'development' ||
    normalized === 'staging' ||
    normalized === 'production' ||
    normalized === 'test'
  ) {
    return normalized;
  }
  throw new Error(`Invalid NODE_ENV: ${normalized}`);
}

function parseLogLevel(value: string | undefined): AppEnv['logLevel'] {
  const normalized = (value ?? 'info').trim();
  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error' ||
    normalized === 'fatal'
  ) {
    return normalized;
  }
  throw new Error(`Invalid LOG_LEVEL: ${normalized}`);
}

function parsePort(value: string | undefined): number {
  const raw = (value ?? '65000').trim();
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

function parseUrl(env: EnvSource, key: string): URL {
  const value = requiredString(env, key);
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid URL in ${key}: ${value}`);
  }
}

function parseRedisUrl(env: EnvSource, key: string): string {
  const value = requiredString(env, key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL in ${key}: ${value}`);
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`Invalid Redis URL protocol for ${key}: ${url.protocol}`);
  }
  return value;
}

function parseScopes(value: string): readonly string[] {
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error('SCOPES must contain at least one scope');
  }
  return parts;
}

function parseEncryptionKeyVersion(env: EnvSource): number {
  const raw = requiredString(env, 'ENCRYPTION_KEY_VERSION');
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid ENCRYPTION_KEY_VERSION: ${raw}`);
  }
  return version;
}

function parseEncryptionKeyHex(env: EnvSource, version: number): string {
  const explicit = optionalString(env, 'ENCRYPTION_KEY_256');
  const versionedKeyName = `ENCRYPTION_KEY_V${version}`;
  const versioned = optionalString(env, versionedKeyName);
  const selected = versioned ?? explicit;
  if (!selected) {
    throw new Error(
      `Missing encryption key: set ${versionedKeyName} (preferred) or ENCRYPTION_KEY_256`
    );
  }

  const normalized = selected.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Encryption key must be a 32-byte hex string (64 hex chars)');
  }
  return normalized;
}

function parseOtelEndpoint(env: EnvSource): string {
  const raw = optionalString(env, 'OTEL_EXPORTER_OTLP_ENDPOINT') ?? '';
  if (!raw) return '';
  try {
    // Allow http(s) endpoints only.
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Invalid OTEL_EXPORTER_OTLP_ENDPOINT protocol: ${url.protocol}`);
    }
    return raw;
  } catch {
    throw new Error(`Invalid OTEL_EXPORTER_OTLP_ENDPOINT: ${raw}`);
  }
}

export function loadEnv(env: EnvSource = process.env): AppEnv {
  const nodeEnv = parseNodeEnv(env['NODE_ENV']);
  const logLevel = parseLogLevel(env['LOG_LEVEL']);
  const port = parsePort(env['PORT'] ?? env['APP_PORT']);

  const appHost = parseUrl(env, 'APP_HOST');
  const databaseUrl = requiredString(env, 'DATABASE_URL');
  const redisUrl = parseRedisUrl(env, 'REDIS_URL');

  const shopifyApiKey = requiredString(env, 'SHOPIFY_API_KEY');
  const shopifyApiSecret = requiredString(env, 'SHOPIFY_API_SECRET');
  const scopes = parseScopes(requiredString(env, 'SCOPES'));

  const encryptionKeyVersion = parseEncryptionKeyVersion(env);
  const encryptionKeyHex = parseEncryptionKeyHex(env, encryptionKeyVersion);

  const otelExporterOtlpEndpoint = parseOtelEndpoint(env);
  const otelServiceName = requiredString(env, 'OTEL_SERVICE_NAME');

  return {
    nodeEnv,
    logLevel,
    port,
    appHost,
    databaseUrl,
    redisUrl,
    shopifyApiKey,
    shopifyApiSecret,
    scopes,
    encryptionKeyVersion,
    encryptionKeyHex,
    otelExporterOtlpEndpoint,
    otelServiceName,
  };
}

export function isShopifyApiConfigValid(env: EnvSource = process.env): boolean {
  try {
    requiredString(env, 'SHOPIFY_API_KEY');
    requiredString(env, 'SHOPIFY_API_SECRET');
    parseScopes(requiredString(env, 'SCOPES'));
    parseUrl(env, 'APP_HOST');
    return true;
  } catch {
    return false;
  }
}
