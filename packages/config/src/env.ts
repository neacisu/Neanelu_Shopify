export type NodeEnv = 'development' | 'staging' | 'production' | 'test';

export type AppEnv = Readonly<{
  nodeEnv: NodeEnv;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  port: number;

  appHost: URL;

  databaseUrl: string;
  redisUrl: string;
  bullmqProToken: string;

  /** PR-022 (F4.2): BullMQ Pro Groups fairness controls */
  maxActivePerShop: number;
  maxGlobalConcurrency: number;
  starvationTimeoutMs: number;

  // ============================================
  // CONCURRENCY KNOBS (Plan F5.2.8)
  // ============================================

  /** Max concurrent downloads per worker process (best-effort). */
  maxConcurrentDownloads: number;
  /** Max concurrent COPY/ingest jobs per shop (mapped onto maxActivePerShop). */
  maxConcurrentCopies: number;
  /** Max concurrent ingestion jobs per worker process (best-effort). */
  maxGlobalIngestion: number;

  shopifyApiKey: string;
  shopifyApiSecret: string;
  scopes: readonly string[];

  encryptionKeyVersion: number;
  encryptionKeyHex: string;

  otelExporterOtlpEndpoint: string;
  otelServiceName: string;

  // ============================================
  // BULK INGESTION (PR-042 / F5.2.5-F5.2.8)
  // ============================================

  /** Max rows per committed COPY batch into staging tables. */
  bulkCopyBatchRows: number;
  /** Max bytes per committed COPY batch into staging tables. */
  bulkCopyBatchBytes: number;
  /** Max buffered bytes in the HTTP download stream. */
  bulkDownloadHighWaterMarkBytes: number;
  /** Whether the merge stage should run ANALYZE after upserts. */
  bulkMergeAnalyze: boolean;
  /** Whether the merge stage is allowed to apply deletes for full snapshots only. */
  bulkMergeAllowDeletes: boolean;
  /** Whether the merge stage should REINDEX staging tables after merge. */
  bulkStagingReindex: boolean;

  // ============================================
  // AI / EMBEDDINGS (PR-043 / F5.2.9)
  // ============================================

  /** Optional. When missing, semantic dedup will auto-disable (safe fallback). */
  openAiApiKey?: string;
  /** Optional override; defaults to https://api.openai.com */
  openAiBaseUrl?: string;
  /** Embeddings model name; defaults to text-embedding-3-small */
  openAiEmbeddingsModel: string;
  /** Embeddings request timeout; defaults to 30s */
  openAiTimeoutMs: number;
  /** Max items per OpenAI batch file; defaults to 1000 */
  openAiBatchMaxItems: number;
  /** Poll interval (seconds) for OpenAI batch status; defaults to 3600 */
  openAiBatchPollSeconds: number;
  /** Retention (days) for OpenAI files; defaults to 30 */
  openAiBatchRetentionDays: number;
  /** Scheduler tick (seconds) for AI batch orchestration */
  openAiBatchScheduleTickSeconds: number;
  /** Max retries per embedding item before DLQ; defaults to 3 */
  openAiEmbeddingMaxRetries: number;
  /** Global kill switch for embeddings backfill */
  openAiEmbeddingBackfillEnabled: boolean;
  /** Daily budget for embeddings items; defaults to 100000 */
  openAiEmbeddingDailyBudget: number;
  /** OpenAI embeddings rate limit: tokens per minute */
  openAiEmbedRateLimitTokensPerMinute: number;
  /** OpenAI embeddings rate limit: requests per minute */
  openAiEmbedRateLimitRequestsPerMinute: number;
  /** OpenAI embeddings rate limit: bucket TTL in ms */
  openAiEmbedRateLimitBucketTtlMs: number;
  /** Throttle: max items per shop per hour */
  openAiEmbedThrottleShopHourlyLimit: number;
  /** Throttle: max items global per hour */
  openAiEmbedThrottleGlobalHourlyLimit: number;
  /** Vector search cache TTL in seconds */
  vectorSearchCacheTtlSeconds: number;
  /** Vector search query timeout in ms */
  vectorSearchQueryTimeoutMs: number;
  /** Embedding dimensions (defaults to 2000 for text-embedding-3-large) */
  openAiEmbeddingDimensions: number;

  // ============================================
  // BULK DEDUP + CONSENSUS + PIM SYNC (PR-043 / F5.2.9-F5.2.10)
  // ============================================

  /** Global kill-switches (still gated per shop via feature flags/settings). */
  bulkPimSyncEnabled: boolean;
  bulkSemanticDedupEnabled: boolean;
  bulkConsensusEnabled: boolean;

  /** Similarity thresholds; can be overridden per shop via settings. */
  bulkDedupeHighThreshold: number;
  bulkDedupeNeedsReviewThreshold: number;
  bulkDedupeMaxResults: number;
  bulkDedupeSuspiciousThreshold: number;
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

function parsePositiveIntWithDefault(env: EnvSource, key: string, defaultValue: number): number {
  const raw = env[key];
  if (raw == null || raw.trim() === '') return defaultValue;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${key}: expected positive integer, got ${raw}`);
  }
  return value;
}

function parsePositiveBytesWithDefault(env: EnvSource, key: string, defaultValue: number): number {
  const value = parsePositiveIntWithDefault(env, key, defaultValue);
  // Guardrail: avoid absurdly small buffers.
  return Math.max(1024, value);
}

function parseBooleanWithDefault(env: EnvSource, key: string, defaultValue: boolean): boolean {
  const raw = env[key];
  if (raw == null || raw.trim() === '') return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  throw new Error(`Invalid ${key}: expected boolean, got ${raw}`);
}

function parseFloatWithDefault(env: EnvSource, key: string, defaultValue: number): number {
  const raw = env[key];
  if (raw == null || raw.trim() === '') return defaultValue;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${key}: expected number, got ${raw}`);
  }
  return value;
}

function parseSimilarityThreshold(env: EnvSource, key: string, defaultValue: number): number {
  const value = parseFloatWithDefault(env, key, defaultValue);
  // Guardrails: keep meaningful and safe.
  if (value < 0.5 || value > 0.99) {
    throw new Error(`Invalid ${key}: expected [0.5, 0.99], got ${String(value)}`);
  }
  return value;
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
  const bullmqProToken = requiredString(env, 'BULLMQ_PRO_TOKEN');

  // PR-022 (F4.2.3) defaults: keep aligned with Plan_de_implementare.
  // These are controls for BullMQ Pro Groups fairness.
  // Plan F5.2.8 introduces explicit ingest naming; treat MAX_CONCURRENT_COPIES as an override.
  const maxConcurrentCopies = parsePositiveIntWithDefault(env, 'MAX_CONCURRENT_COPIES', 2);
  const maxActivePerShop = parsePositiveIntWithDefault(
    env,
    'MAX_ACTIVE_PER_SHOP',
    maxConcurrentCopies
  );

  const maxGlobalConcurrency = parsePositiveIntWithDefault(env, 'MAX_GLOBAL_CONCURRENCY', 50);
  const starvationTimeoutMs = parsePositiveIntWithDefault(env, 'STARVATION_TIMEOUT_MS', 60_000);

  // Plan F5.2.8: per-worker concurrency knobs (best-effort at runtime).
  const maxConcurrentDownloads = parsePositiveIntWithDefault(env, 'MAX_CONCURRENT_DOWNLOADS', 2);
  const maxGlobalIngestion = parsePositiveIntWithDefault(env, 'MAX_GLOBAL_INGESTION', 10);

  const shopifyApiKey = requiredString(env, 'SHOPIFY_API_KEY');
  const shopifyApiSecret = requiredString(env, 'SHOPIFY_API_SECRET');
  const scopes = parseScopes(requiredString(env, 'SCOPES'));

  const encryptionKeyVersion = parseEncryptionKeyVersion(env);
  const encryptionKeyHex = parseEncryptionKeyHex(env, encryptionKeyVersion);

  const otelExporterOtlpEndpoint = parseOtelEndpoint(env);
  const otelServiceName = requiredString(env, 'OTEL_SERVICE_NAME');

  // PR-042 (F5.2.5-F5.2.8): streaming ingestion knobs.
  const bulkCopyBatchRows = parsePositiveIntWithDefault(env, 'BULK_COPY_BATCH_ROWS', 25_000);
  const bulkCopyBatchBytes = parsePositiveBytesWithDefault(
    env,
    'BULK_COPY_BATCH_BYTES',
    32 * 1024 * 1024
  );
  const bulkDownloadHighWaterMarkBytes = parsePositiveBytesWithDefault(
    env,
    'BULK_DOWNLOAD_HIGH_WATERMARK_BYTES',
    1024 * 1024
  );
  const bulkMergeAnalyze = parseBooleanWithDefault(env, 'BULK_MERGE_ANALYZE', true);
  const bulkMergeAllowDeletes = parseBooleanWithDefault(env, 'BULK_MERGE_ALLOW_DELETES', false);
  const bulkStagingReindex = parseBooleanWithDefault(env, 'BULK_STAGING_REINDEX', true);

  // PR-043 (F5.2.9-F5.2.10): embeddings + dedup/consensus controls.
  const openAiApiKey = optionalString(env, 'OPENAI_API_KEY');
  const openAiBaseUrl = optionalString(env, 'OPENAI_BASE_URL');
  // PR-047: Upgraded default to text-embedding-3-large (2000 dims for HNSW) from text-embedding-3-small (1536 dims)
  const openAiEmbeddingsModel =
    optionalString(env, 'OPENAI_EMBEDDINGS_MODEL') ?? 'text-embedding-3-large';
  const openAiTimeoutMs = parsePositiveIntWithDefault(env, 'OPENAI_TIMEOUT_MS', 30_000);
  const openAiBatchMaxItems = parsePositiveIntWithDefault(env, 'OPENAI_BATCH_MAX_ITEMS', 1000);
  const openAiBatchPollSeconds = parsePositiveIntWithDefault(
    env,
    'OPENAI_BATCH_POLL_SECONDS',
    3600
  );
  const openAiBatchRetentionDays = parsePositiveIntWithDefault(
    env,
    'OPENAI_BATCH_RETENTION_DAYS',
    30
  );
  const openAiBatchScheduleTickSeconds = parsePositiveIntWithDefault(
    env,
    'OPENAI_BATCH_SCHEDULE_TICK_SECONDS',
    60
  );
  const openAiEmbeddingMaxRetries = parsePositiveIntWithDefault(
    env,
    'OPENAI_EMBEDDING_MAX_RETRIES',
    3
  );
  const openAiEmbeddingBackfillEnabled = parseBooleanWithDefault(
    env,
    'OPENAI_EMBEDDING_BACKFILL_ENABLED',
    true
  );
  const openAiEmbeddingDailyBudget = parsePositiveIntWithDefault(
    env,
    'OPENAI_EMBEDDING_DAILY_BUDGET',
    100000
  );
  const openAiEmbedRateLimitTokensPerMinute = parsePositiveIntWithDefault(
    env,
    'OPENAI_EMBED_RATELIMIT_TOKENS_PER_MIN',
    1_000_000
  );
  const openAiEmbedRateLimitRequestsPerMinute = parsePositiveIntWithDefault(
    env,
    'OPENAI_EMBED_RATELIMIT_REQUESTS_PER_MIN',
    3_000
  );
  const openAiEmbedRateLimitBucketTtlMs = parsePositiveIntWithDefault(
    env,
    'OPENAI_EMBED_RATELIMIT_BUCKET_TTL_MS',
    120_000
  );
  const openAiEmbedThrottleShopHourlyLimit = parsePositiveIntWithDefault(
    env,
    'OPENAI_EMBED_THROTTLE_SHOP_HOURLY',
    1000
  );
  const openAiEmbedThrottleGlobalHourlyLimit = parsePositiveIntWithDefault(
    env,
    'OPENAI_EMBED_THROTTLE_GLOBAL_HOURLY',
    10000
  );
  const vectorSearchCacheTtlSeconds = parsePositiveIntWithDefault(
    env,
    'VECTOR_SEARCH_CACHE_TTL_SECONDS',
    3600
  );
  const vectorSearchQueryTimeoutMs = parsePositiveIntWithDefault(
    env,
    'VECTOR_SEARCH_QUERY_TIMEOUT_MS',
    5000
  );
  const openAiEmbeddingDimensions = parsePositiveIntWithDefault(
    env,
    'OPENAI_EMBEDDING_DIMENSIONS',
    2000
  );

  const bulkPimSyncEnabled = parseBooleanWithDefault(env, 'BULK_PIM_SYNC_ENABLED', true);
  const bulkSemanticDedupEnabled = parseBooleanWithDefault(
    env,
    'BULK_SEMANTIC_DEDUP_ENABLED',
    true
  );
  const bulkConsensusEnabled = parseBooleanWithDefault(env, 'BULK_CONSENSUS_ENABLED', true);

  const bulkDedupeHighThreshold = parseSimilarityThreshold(env, 'BULK_DEDUPE_HIGH_THRESHOLD', 0.95);
  const bulkDedupeSuspiciousThreshold = parseSimilarityThreshold(
    env,
    'BULK_DEDUPE_SUSPICIOUS_THRESHOLD',
    0.85
  );
  const bulkDedupeNeedsReviewThreshold = parseSimilarityThreshold(
    env,
    'BULK_DEDUPE_NEEDS_REVIEW_THRESHOLD',
    0.9
  );
  const bulkDedupeMaxResults = parsePositiveIntWithDefault(env, 'BULK_DEDUPE_MAX_RESULTS', 10);

  // Plan F5.2.9 guardrails.
  if (bulkDedupeSuspiciousThreshold < 0.85) {
    throw new Error(
      `Invalid BULK_DEDUPE_SUSPICIOUS_THRESHOLD: expected >= 0.85 (plan requirement), got ${String(
        bulkDedupeSuspiciousThreshold
      )}`
    );
  }
  if (bulkDedupeHighThreshold < bulkDedupeSuspiciousThreshold) {
    throw new Error(
      `Invalid BULK_DEDUPE_HIGH_THRESHOLD: expected >= BULK_DEDUPE_SUSPICIOUS_THRESHOLD (${String(
        bulkDedupeSuspiciousThreshold
      )}), got ${String(bulkDedupeHighThreshold)}`
    );
  }

  return {
    nodeEnv,
    logLevel,
    port,
    appHost,
    databaseUrl,
    redisUrl,
    bullmqProToken,
    maxActivePerShop,
    maxGlobalConcurrency,
    starvationTimeoutMs,

    maxConcurrentDownloads,
    maxConcurrentCopies,
    maxGlobalIngestion,
    shopifyApiKey,
    shopifyApiSecret,
    scopes,
    encryptionKeyVersion,
    encryptionKeyHex,
    otelExporterOtlpEndpoint,
    otelServiceName,

    bulkCopyBatchRows,
    bulkCopyBatchBytes,
    bulkDownloadHighWaterMarkBytes,
    bulkMergeAnalyze,
    bulkMergeAllowDeletes,
    bulkStagingReindex,

    ...(openAiApiKey ? { openAiApiKey } : {}),
    ...(openAiBaseUrl ? { openAiBaseUrl } : {}),
    openAiEmbeddingsModel,
    openAiTimeoutMs,
    openAiBatchMaxItems,
    openAiBatchPollSeconds,
    openAiBatchRetentionDays,
    openAiBatchScheduleTickSeconds,
    openAiEmbeddingMaxRetries,
    openAiEmbeddingBackfillEnabled,
    openAiEmbeddingDailyBudget,
    openAiEmbedRateLimitTokensPerMinute,
    openAiEmbedRateLimitRequestsPerMinute,
    openAiEmbedRateLimitBucketTtlMs,
    openAiEmbedThrottleShopHourlyLimit,
    openAiEmbedThrottleGlobalHourlyLimit,
    vectorSearchCacheTtlSeconds,
    vectorSearchQueryTimeoutMs,
    openAiEmbeddingDimensions,

    bulkPimSyncEnabled,
    bulkSemanticDedupEnabled,
    bulkConsensusEnabled,
    bulkDedupeHighThreshold,
    bulkDedupeSuspiciousThreshold,
    bulkDedupeNeedsReviewThreshold,
    bulkDedupeMaxResults,
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
