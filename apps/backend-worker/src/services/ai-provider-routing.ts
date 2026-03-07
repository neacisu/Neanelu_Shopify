import type { AppEnv } from '@app/config';
import type { EmbeddingsProvider } from '@app/ai-engine';
import { createEmbeddingsProvider, createSelfhostedEmbeddingsProvider } from '@app/ai-engine';
import { decryptAesGcm, withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import type { ChatModelCredentials } from '@app/pim';
import type { AiProvider } from '@app/types';
import { Redis } from 'ioredis';
import { isFeatureFlagEnabled } from '../processors/bulk-operations/feature-flags.js';
import { getShopOpenAiConfig } from '../runtime/openai-config.js';
import {
  recordAiProviderRouting,
  recordSelfhostedFallbackToFrontier,
  setSelfhostedCircuitBreakerState,
} from '../otel/metrics.js';
import { loadSelfHostedCredentials } from './selfhosted-credentials.js';
import { loadXAICredentials } from './xai-credentials.js';

type ChatTaskType = 'extraction' | 'audit' | 'classification' | 'translation';

type RoutingRow = Readonly<{
  modelExtraction: string | null;
  modelAudit: string | null;
  modelClassification: string | null;
  modelTranslation: string | null;
  modelEmbedding: string | null;
}>;

type DeepSeekRow = Readonly<{
  deepseek_enabled: boolean;
  deepseek_api_key_ciphertext: Buffer | null;
  deepseek_api_key_iv: Buffer | null;
  deepseek_api_key_tag: Buffer | null;
  deepseek_base_url: string | null;
  deepseek_temperature: string | number | null;
  deepseek_max_tokens_per_request: number | null;
  deepseek_rate_limit_per_minute: number | null;
}>;

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

type FallbackStage = 'none' | 'primary' | 'secondary';

interface RoutingContext {
  shopId: string;
  taskType: ChatTaskType;
  env: AppEnv;
  logger: Logger;
}

const DEFAULT_CHAT_MODELS: Record<ChatTaskType, string> = {
  classification: 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
  translation: 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
  extraction: 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
  audit: 'selfhosted:Qwen/QwQ-32B-AWQ',
};

const FALLBACK_CHAT_MODELS: Record<ChatTaskType, string> = {
  classification: 'xai:grok-4-1-fast-non-reasoning',
  translation: 'xai:grok-4-1-fast-non-reasoning',
  extraction: 'xai:grok-4-1-fast-non-reasoning',
  audit: 'xai:grok-4-1-fast-non-reasoning',
};

const SECONDARY_FALLBACK_CHAT_MODELS: Record<ChatTaskType, string> = {
  classification: 'openai:gpt-4o-mini',
  translation: 'openai:gpt-4o-mini',
  extraction: 'openai:gpt-4o-mini',
  audit: 'openai:gpt-4o-mini',
};

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 4_000,
  timeoutMs: 30_000,
};

function buildEncryptionKey(encryptionKeyHex: string): Buffer {
  const key = Buffer.from(encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

function toNumber(value: string | number | null | undefined, fallback: number): number {
  if (value == null) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseProviderRoute(value: string): { provider: AiProvider; model: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf(':');
  if (separator <= 0 || separator >= trimmed.length - 1) return null;

  const provider = trimmed.slice(0, separator).trim() as AiProvider;
  const model = trimmed.slice(separator + 1).trim();
  if (!model) return null;
  return { provider, model };
}

async function loadTaskRoute(shopId: string, taskType: ChatTaskType): Promise<string> {
  const row = await withTenantContext(shopId, async (client) => {
    const result = await client.query<RoutingRow>(
      `SELECT
         model_extraction AS "modelExtraction",
         model_audit AS "modelAudit",
         model_classification AS "modelClassification",
         model_translation AS "modelTranslation",
         model_embedding AS "modelEmbedding"
       FROM shop_ai_credentials
       WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0] ?? null;
  });

  const columnMap: Record<ChatTaskType, keyof RoutingRow> = {
    extraction: 'modelExtraction',
    audit: 'modelAudit',
    classification: 'modelClassification',
    translation: 'modelTranslation',
  };

  const col = columnMap[taskType];
  return row?.[col] ?? DEFAULT_CHAT_MODELS[taskType];
}

async function loadDeepSeekCredentials(params: {
  shopId: string;
  env: AppEnv;
  model: string;
}): Promise<ChatModelCredentials | null> {
  const row = await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<DeepSeekRow>(
      `SELECT
         deepseek_enabled,
         deepseek_api_key_ciphertext,
         deepseek_api_key_iv,
         deepseek_api_key_tag,
         deepseek_base_url,
         deepseek_temperature,
         deepseek_max_tokens_per_request,
         deepseek_rate_limit_per_minute
       FROM shop_ai_credentials
       WHERE shop_id = $1`,
      [params.shopId]
    );
    return result.rows[0] ?? null;
  });

  if (!row?.deepseek_enabled) return null;
  if (!row.deepseek_api_key_ciphertext || !row.deepseek_api_key_iv || !row.deepseek_api_key_tag) {
    return null;
  }

  const apiKey = decryptAesGcm(
    row.deepseek_api_key_ciphertext,
    buildEncryptionKey(params.env.encryptionKeyHex),
    row.deepseek_api_key_iv,
    row.deepseek_api_key_tag
  ).toString('utf-8');

  return {
    provider: 'deepseek',
    apiKey,
    baseUrl: (row.deepseek_base_url ?? 'https://api.deepseek.com').replace(/\/$/, ''),
    model: params.model,
    temperature: toNumber(row.deepseek_temperature, 0.1),
    maxTokensPerRequest: row.deepseek_max_tokens_per_request ?? 4000,
    rateLimitPerMinute: row.deepseek_rate_limit_per_minute ?? 60,
  };
}

async function callWithRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const shouldFailFast = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    return /\b(400|401|403)\b/.test(error.message);
  };

  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= opts.maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const result = await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('retry_timeout')), {
            once: true,
          });
        }),
      ]);
      clearTimeout(timeout);
      return result;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (shouldFailFast(error) || attempt >= opts.maxRetries) {
        break;
      }
      const exponentialDelay = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
      const jitterMs = Math.floor(Math.random() * 1_000);
      await new Promise((resolve) => setTimeout(resolve, exponentialDelay + jitterMs));
      attempt += 1;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('retry_failed');
}

function routingOutcome(fallbackStage: FallbackStage): 'primary' | 'fallback' {
  return fallbackStage === 'none' ? 'primary' : 'fallback';
}

async function resolveXaiRoute(
  route: { provider: AiProvider; model: string },
  fallbackStage: FallbackStage,
  ctx: RoutingContext
): Promise<ChatModelCredentials | null> {
  const credentials = await callWithRetry(
    () =>
      loadXAICredentials({
        shopId: ctx.shopId,
        encryptionKeyHex: ctx.env.encryptionKeyHex,
      }),
    DEFAULT_RETRY
  ).catch(() => null);
  if (!credentials) {
    recordAiProviderRouting({ provider: 'xai', taskType: ctx.taskType, outcome: 'error' });
    return null;
  }
  recordAiProviderRouting({
    provider: 'xai',
    taskType: ctx.taskType,
    outcome: routingOutcome(fallbackStage),
  });
  return { ...credentials, provider: 'xai', model: route.model };
}

async function resolveOpenAiRoute(
  route: { provider: AiProvider; model: string },
  fallbackStage: FallbackStage,
  ctx: RoutingContext
): Promise<ChatModelCredentials | null> {
  const config = await callWithRetry(
    () =>
      getShopOpenAiConfig({
        shopId: ctx.shopId,
        env: ctx.env,
        logger: ctx.logger,
      }),
    DEFAULT_RETRY
  ).catch(() => null);
  if (!config || !config.enabled || !config.openAiApiKey) {
    recordAiProviderRouting({
      provider: 'openai',
      taskType: ctx.taskType,
      outcome: 'error',
    });
    return null;
  }

  recordAiProviderRouting({
    provider: 'openai',
    taskType: ctx.taskType,
    outcome: routingOutcome(fallbackStage),
  });
  return {
    provider: 'openai',
    apiKey: config.openAiApiKey,
    baseUrl: (config.openAiBaseUrl ?? ctx.env.openAiBaseUrl ?? 'https://api.openai.com').replace(
      /\/$/,
      ''
    ),
    model: route.model,
    temperature: 0.1,
    maxTokensPerRequest: 2000,
    rateLimitPerMinute: 0,
  };
}

async function resolveDeepseekRoute(
  route: { provider: AiProvider; model: string },
  fallbackStage: FallbackStage,
  ctx: RoutingContext
): Promise<ChatModelCredentials | null> {
  const credentials = await callWithRetry(
    () =>
      loadDeepSeekCredentials({
        shopId: ctx.shopId,
        env: ctx.env,
        model: route.model,
      }),
    DEFAULT_RETRY
  ).catch(() => null);
  if (!credentials) {
    recordAiProviderRouting({
      provider: 'deepseek',
      taskType: ctx.taskType,
      outcome: 'error',
    });
    return null;
  }
  recordAiProviderRouting({
    provider: 'deepseek',
    taskType: ctx.taskType,
    outcome: routingOutcome(fallbackStage),
  });
  return credentials;
}

async function tryFallbackChain(ctx: RoutingContext): Promise<ChatModelCredentials | null> {
  const fallbackRoute = parseProviderRoute(FALLBACK_CHAT_MODELS[ctx.taskType]);
  if (fallbackRoute) {
    if (
      fallbackRoute.provider === 'xai' ||
      fallbackRoute.provider === 'openai' ||
      fallbackRoute.provider === 'deepseek'
    ) {
      recordSelfhostedFallbackToFrontier(ctx.taskType, fallbackRoute.provider);
    }
    const fallbackCreds = await resolveProviderRoute(fallbackRoute, 'primary', ctx);
    if (fallbackCreds) {
      return fallbackCreds;
    }
  }
  const secondaryRoute = parseProviderRoute(SECONDARY_FALLBACK_CHAT_MODELS[ctx.taskType]);
  if (secondaryRoute) {
    return await resolveProviderRoute(secondaryRoute, 'secondary', ctx);
  }
  return null;
}

async function resolveSelfhostedRoute(
  route: { provider: AiProvider; model: string },
  fallbackStage: FallbackStage,
  ctx: RoutingContext
): Promise<ChatModelCredentials | null> {
  const enabled = await isFeatureFlagEnabled({
    shopId: ctx.shopId,
    flagKey: 'selfhosted_llm_enabled',
    fallback: false,
  });
  if (!enabled) {
    ctx.logger.warn(
      { shopId: ctx.shopId, taskType: ctx.taskType },
      'selfhosted_feature_flag_disabled'
    );
  }
  const selfHosted = enabled
    ? await callWithRetry(
        () =>
          loadSelfHostedCredentials({
            shopId: ctx.shopId,
            encryptionKeyHex: ctx.env.encryptionKeyHex,
          }),
        DEFAULT_RETRY
      ).catch(() => null)
    : null;
  if (!enabled || !selfHosted?.enabled) {
    return fallbackStage === 'none' ? await tryFallbackChain(ctx) : null;
  }

  if (
    selfHosted.connectionStatus === 'error' ||
    selfHosted.connectionStatus === 'disabled' ||
    selfHosted.connectionStatus === 'unreachable'
  ) {
    const redis = getRoutingRedis(ctx.env);
    const affectedEndpoints = selfHosted.endpoints.filter(
      (candidate) =>
        candidate.enabled &&
        candidate.modelId === route.model &&
        (candidate.type === 'chat' || candidate.type === 'both')
    );
    await Promise.all(
      affectedEndpoints.map(async (endpoint) => {
        await recordCircuitBreakerFailure({
          redis,
          redisPrefix: ctx.env.redisPrefix,
          endpointId: endpoint.id,
        });
      })
    );
    ctx.logger.warn(
      {
        shopId: ctx.shopId,
        connectionStatus: selfHosted.connectionStatus,
        taskType: ctx.taskType,
      },
      'selfhosted_unavailable_fallback'
    );
    return fallbackStage === 'none' ? await tryFallbackChain(ctx) : null;
  }

  const endpoint = selfHosted.endpoints.find(
    (candidate) =>
      candidate.enabled &&
      candidate.modelId === route.model &&
      (candidate.type === 'chat' || candidate.type === 'both')
  );
  if (!endpoint) {
    if (fallbackStage === 'none') {
      ctx.logger.warn(
        { shopId: ctx.shopId, taskType: ctx.taskType, model: route.model },
        'selfhosted_endpoint_missing_fallback'
      );
    }
    return fallbackStage === 'none' ? await tryFallbackChain(ctx) : null;
  }

  const redis = getRoutingRedis(ctx.env);
  const cbState = await getCircuitBreakerState({
    redis,
    redisPrefix: ctx.env.redisPrefix,
    endpointId: endpoint.id,
  });
  if (cbState === 'OPEN') {
    ctx.logger.info(
      { shopId: ctx.shopId, endpointId: endpoint.id },
      'circuit_breaker_open_failfast'
    );
    return await tryFallbackChain(ctx);
  }

  recordAiProviderRouting({
    provider: 'selfhosted',
    taskType: ctx.taskType,
    outcome: routingOutcome(fallbackStage),
  });
  await recordCircuitBreakerSuccess({
    redis,
    redisPrefix: ctx.env.redisPrefix,
    endpointId: endpoint.id,
  });
  return {
    provider: 'selfhosted',
    ...(selfHosted.bearerToken ? { apiKey: selfHosted.bearerToken } : {}),
    baseUrl: endpoint.baseUrl,
    model: endpoint.modelId,
    temperature: 0.1,
    maxTokensPerRequest: 4000,
    rateLimitPerMinute: 0,
  };
}

async function resolveProviderRoute(
  route: { provider: AiProvider; model: string },
  fallbackStage: FallbackStage,
  ctx: RoutingContext
): Promise<ChatModelCredentials | null> {
  if (route.provider === 'xai') {
    return resolveXaiRoute(route, fallbackStage, ctx);
  }
  if (route.provider === 'openai') {
    return resolveOpenAiRoute(route, fallbackStage, ctx);
  }
  if (route.provider === 'deepseek') {
    return resolveDeepseekRoute(route, fallbackStage, ctx);
  }
  if (route.provider === 'selfhosted') {
    return resolveSelfhostedRoute(route, fallbackStage, ctx);
  }
  ctx.logger.warn(
    { shopId: ctx.shopId, provider: route.provider, taskType: ctx.taskType },
    'AI provider routing is not supported for this runtime path'
  );
  return null;
}

export async function resolveChatTaskCredentials(params: {
  shopId: string;
  taskType: ChatTaskType;
  env: AppEnv;
  logger: Logger;
}): Promise<ChatModelCredentials | null> {
  const routeValue = await loadTaskRoute(params.shopId, params.taskType);
  const parsedRoute = parseProviderRoute(routeValue);
  if (!parsedRoute) {
    params.logger.warn(
      { shopId: params.shopId, routeValue, taskType: params.taskType },
      'Invalid AI model routing value'
    );
    return null;
  }
  return await resolveProviderRoute(parsedRoute, 'none', params);
}

const DEFAULT_EMBEDDING_ROUTE = 'selfhosted:qwen3-embedding-8b-q5km';
let cachedRoutingRedis: Redis | null = null;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2;
const CIRCUIT_BREAKER_OPEN_TIMEOUT_MS = 60_000;
const CIRCUIT_BREAKER_KEY_TTL_MS = 120_000;

function getRoutingRedis(env: AppEnv): Redis {
  if (cachedRoutingRedis) return cachedRoutingRedis;
  cachedRoutingRedis = new Redis(env.redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
    retryStrategy: (times: number) => Math.min(times * 50, 2_000),
  });
  return cachedRoutingRedis;
}

function normalizeRedisPrefix(prefix: string | undefined): string {
  if (!prefix) return '';
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

function estimateEmbeddingTokens(texts: readonly string[]): number {
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
  return Math.max(1, Math.ceil(totalChars / 4));
}

async function gateSelfhostedEmbeddingRequest(params: {
  redis: Redis;
  redisPrefix: string;
  shopId: string;
  endpointId: string;
  estimatedTokens: number;
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  bucketTtlMs: number;
}): Promise<{ allowed: boolean; delayMs: number }> {
  const prefix = normalizeRedisPrefix(params.redisPrefix);
  const tokenBucketKey = `${prefix}ratelimit:selfhosted-embed:tokens:${params.shopId}:${params.endpointId}`;
  const requestBucketKey = `${prefix}ratelimit:selfhosted-embed:requests:${params.shopId}:${params.endpointId}`;
  const tokenCount = await params.redis.incrby(tokenBucketKey, Math.max(1, params.estimatedTokens));
  if (tokenCount === Math.max(1, params.estimatedTokens)) {
    await params.redis.pexpire(tokenBucketKey, Math.max(1_000, Math.floor(params.bucketTtlMs)));
  }
  if (tokenCount > Math.max(1, Math.floor(params.maxTokensPerMinute))) {
    await params.redis.decrby(tokenBucketKey, Math.max(1, params.estimatedTokens));
    return { allowed: false, delayMs: 1_000 };
  }
  const requestCount = await params.redis.incr(requestBucketKey);
  if (requestCount === 1) {
    await params.redis.pexpire(requestBucketKey, Math.max(1_000, Math.floor(params.bucketTtlMs)));
  }
  return {
    allowed: requestCount <= Math.max(1, Math.floor(params.maxRequestsPerMinute)),
    delayMs: requestCount <= Math.max(1, Math.floor(params.maxRequestsPerMinute)) ? 0 : 1_000,
  };
}

async function acquireSelfhostedSlot(params: {
  redis: Redis;
  redisPrefix: string;
  endpointId: string;
  maxConcurrent: number;
}): Promise<{ acquired: boolean; release: () => Promise<void> }> {
  const prefix = normalizeRedisPrefix(params.redisPrefix);
  const key = `${prefix}selfhosted:concurrency:${params.endpointId}`;
  const nextValue = await params.redis.incr(key);
  if (nextValue === 1) {
    await params.redis.pexpire(key, 120_000);
  }
  if (nextValue > params.maxConcurrent) {
    await params.redis.decr(key);
    return {
      acquired: false,
      release: async () => await Promise.resolve(),
    };
  }
  return {
    acquired: true,
    release: async () => {
      const remaining = await params.redis.decr(key);
      if (remaining <= 0) {
        await params.redis.del(key);
      }
    },
  };
}

function cbKeys(
  redisPrefix: string,
  endpointId: string
): {
  failures: string;
  state: string;
  lastOpen: string;
} {
  const prefix = normalizeRedisPrefix(redisPrefix);
  return {
    failures: `${prefix}cb:${endpointId}:failures`,
    state: `${prefix}cb:${endpointId}:state`,
    lastOpen: `${prefix}cb:${endpointId}:last_open`,
  };
}

async function getCircuitBreakerState(params: {
  redis: Redis;
  redisPrefix: string;
  endpointId: string;
}): Promise<'CLOSED' | 'OPEN' | 'HALF_OPEN'> {
  const keys = cbKeys(params.redisPrefix, params.endpointId);
  const rawState = await params.redis.get(keys.state);
  const state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' =
    rawState === 'OPEN' || rawState === 'HALF_OPEN' ? rawState : 'CLOSED';
  if (state !== 'OPEN') {
    setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state });
    return state;
  }
  const lastOpenRaw = await params.redis.get(keys.lastOpen);
  const lastOpen = Number(lastOpenRaw ?? '0');
  if (!Number.isFinite(lastOpen) || lastOpen <= 0) {
    setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'OPEN' });
    return 'OPEN';
  }
  if (Date.now() - lastOpen < CIRCUIT_BREAKER_OPEN_TIMEOUT_MS) {
    setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'OPEN' });
    return 'OPEN';
  }
  await params.redis.set(keys.state, 'HALF_OPEN', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
  await params.redis.set(keys.failures, '0', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
  setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'HALF_OPEN' });
  return 'HALF_OPEN';
}

async function recordCircuitBreakerFailure(params: {
  redis: Redis;
  redisPrefix: string;
  endpointId: string;
}): Promise<void> {
  const keys = cbKeys(params.redisPrefix, params.endpointId);
  const currentState = await params.redis.get(keys.state);
  if (currentState === 'HALF_OPEN') {
    await params.redis.set(keys.state, 'OPEN', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
    await params.redis.set(keys.lastOpen, String(Date.now()), 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
    await params.redis.set(keys.failures, '0', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
    setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'OPEN' });
    return;
  }

  const failures = await params.redis.incr(keys.failures);
  await params.redis.pexpire(keys.failures, CIRCUIT_BREAKER_KEY_TTL_MS);
  if (failures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    await params.redis.set(keys.state, 'OPEN', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
    await params.redis.set(keys.lastOpen, String(Date.now()), 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
    await params.redis.set(keys.failures, '0', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
    setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'OPEN' });
    return;
  }
  await params.redis.set(keys.state, 'CLOSED', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
  setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'CLOSED' });
}

async function recordCircuitBreakerSuccess(params: {
  redis: Redis;
  redisPrefix: string;
  endpointId: string;
}): Promise<void> {
  const keys = cbKeys(params.redisPrefix, params.endpointId);
  const currentState = await params.redis.get(keys.state);
  if (currentState === 'HALF_OPEN') {
    const successes = await params.redis.incr(keys.failures);
    await params.redis.pexpire(keys.failures, CIRCUIT_BREAKER_KEY_TTL_MS);
    if (successes >= CIRCUIT_BREAKER_SUCCESS_THRESHOLD) {
      await params.redis.set(keys.state, 'CLOSED', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
      await params.redis.del(keys.failures);
      await params.redis.del(keys.lastOpen);
      setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'CLOSED' });
      return;
    }
    setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'HALF_OPEN' });
    return;
  }

  await params.redis.del(keys.failures);
  await params.redis.set(keys.state, 'CLOSED', 'PX', CIRCUIT_BREAKER_KEY_TTL_MS);
  setSelfhostedCircuitBreakerState({ endpointId: params.endpointId, state: 'CLOSED' });
}

async function loadEmbeddingRoute(shopId: string): Promise<string> {
  const row = await withTenantContext(shopId, async (client) => {
    const result = await client.query<Pick<RoutingRow, 'modelEmbedding'>>(
      `SELECT model_embedding AS "modelEmbedding"
       FROM shop_ai_credentials
       WHERE shop_id = $1`,
      [shopId]
    );
    return result.rows[0] ?? null;
  });
  return row?.modelEmbedding ?? DEFAULT_EMBEDDING_ROUTE;
}

function normalizeEmbeddingBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) {
    return trimmed.slice(0, -3);
  }
  return trimmed;
}

export async function resolveEmbeddingsProvider(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
}): Promise<EmbeddingsProvider> {
  const routeValue = await loadEmbeddingRoute(params.shopId);
  const parsed = parseProviderRoute(routeValue);
  const route = parsed ?? parseProviderRoute(DEFAULT_EMBEDDING_ROUTE);
  if (!route) {
    return createEmbeddingsProvider({});
  }

  const buildOpenAiProvider = async (): Promise<EmbeddingsProvider> => {
    const config = await getShopOpenAiConfig({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
    });
    const modelName =
      route.provider === 'openai'
        ? route.model
        : config.openAiEmbeddingsModel?.trim() || 'text-embedding-3-large';
    return createEmbeddingsProvider({
      ...(config.openAiApiKey ? { openAiApiKey: config.openAiApiKey } : {}),
      ...(config.openAiBaseUrl ? { openAiBaseUrl: config.openAiBaseUrl } : {}),
      openAiEmbeddingsModel: modelName,
    });
  };

  const openAiFallback = async (reason: string): Promise<EmbeddingsProvider> => {
    params.logger.warn(
      { shopId: params.shopId, routeValue, reason },
      'selfhosted_embedding_fallback'
    );
    recordSelfhostedFallbackToFrontier('embedding', 'openai');
    recordAiProviderRouting({ provider: 'selfhosted', taskType: 'embedding', outcome: 'error' });
    return await buildOpenAiProvider();
  };

  if (route.provider === 'openai') {
    recordAiProviderRouting({ provider: 'openai', taskType: 'embedding', outcome: 'primary' });
    return await buildOpenAiProvider();
  }

  if (route.provider === 'selfhosted') {
    const enabled = await isFeatureFlagEnabled({
      shopId: params.shopId,
      flagKey: 'selfhosted_llm_enabled',
      fallback: false,
    });
    if (!enabled) {
      return openAiFallback('feature_flag_disabled');
    }

    const selfHosted = await loadSelfHostedCredentials({
      shopId: params.shopId,
      encryptionKeyHex: params.env.encryptionKeyHex,
    });
    if (!selfHosted?.enabled) {
      return openAiFallback('selfhosted_credentials_unavailable');
    }

    const endpoint = selfHosted.endpoints.find(
      (candidate) =>
        candidate.enabled &&
        candidate.modelId === route.model &&
        (candidate.type === 'embedding' || candidate.type === 'both')
    );
    if (!endpoint) {
      return openAiFallback('selfhosted_embedding_endpoint_missing');
    }

    const primaryProvider = createSelfhostedEmbeddingsProvider({
      baseUrl: normalizeEmbeddingBaseUrl(endpoint.baseUrl),
      ...(selfHosted.bearerToken ? { bearerToken: selfHosted.bearerToken } : {}),
      modelName: endpoint.modelId,
      dimensions: 2000,
      timeoutMs: endpoint.timeoutMs,
    });
    const fallbackProvider = await buildOpenAiProvider();
    recordAiProviderRouting({ provider: 'selfhosted', taskType: 'embedding', outcome: 'primary' });

    return {
      kind: 'selfhosted',
      model: primaryProvider.model,
      isAvailable(): boolean {
        return primaryProvider.isAvailable() || fallbackProvider.isAvailable();
      },
      async embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
        const redis = getRoutingRedis(params.env);
        const slot = await acquireSelfhostedSlot({
          redis,
          redisPrefix: params.env.redisPrefix,
          endpointId: endpoint.id,
          maxConcurrent: endpoint.maxConcurrentRequests,
        });
        if (!slot.acquired) {
          params.logger.warn(
            {
              shopId: params.shopId,
              endpointId: endpoint.id,
              reason: 'concurrency_limit_exceeded',
            },
            'selfhosted_embedding_fallback'
          );
          recordSelfhostedFallbackToFrontier('embedding', 'openai');
          recordAiProviderRouting({
            provider: 'openai',
            taskType: 'embedding',
            outcome: 'fallback',
          });
          return await fallbackProvider.embedTexts(texts);
        }

        try {
          const estimatedTokens = estimateEmbeddingTokens(texts);
          const rateGate = await gateSelfhostedEmbeddingRequest({
            redis,
            redisPrefix: params.env.redisPrefix,
            shopId: params.shopId,
            endpointId: endpoint.id,
            estimatedTokens,
            maxRequestsPerMinute: Math.max(
              endpoint.maxConcurrentRequests * 30,
              Math.floor(params.env.openAiEmbedRateLimitRequestsPerMinute / 2)
            ),
            maxTokensPerMinute: Math.max(
              10_000,
              Math.floor(params.env.openAiEmbedRateLimitTokensPerMinute / 2)
            ),
            bucketTtlMs: params.env.openAiEmbedRateLimitBucketTtlMs,
          });
          if (!rateGate.allowed) {
            params.logger.warn(
              {
                shopId: params.shopId,
                endpointId: endpoint.id,
                delayMs: rateGate.delayMs,
                reason: 'selfhosted_embedding_rate_limited',
              },
              'selfhosted_embedding_fallback'
            );
            recordSelfhostedFallbackToFrontier('embedding', 'openai');
            recordAiProviderRouting({
              provider: 'openai',
              taskType: 'embedding',
              outcome: 'fallback',
            });
            return await fallbackProvider.embedTexts(texts);
          }

          return await primaryProvider.embedTexts(texts);
        } catch (error) {
          params.logger.warn(
            { shopId: params.shopId, endpointId: endpoint.id, error },
            'selfhosted_embedding_call_failed_fallback'
          );
          recordSelfhostedFallbackToFrontier('embedding', 'openai');
          recordAiProviderRouting({
            provider: 'openai',
            taskType: 'embedding',
            outcome: 'fallback',
          });
          return await fallbackProvider.embedTexts(texts);
        } finally {
          await slot.release();
        }
      },
    };
  }

  return openAiFallback('unsupported_provider');
}
