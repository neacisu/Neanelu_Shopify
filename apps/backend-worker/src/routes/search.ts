import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Redis as RedisClient } from 'ioredis';
import { createRedisConnection } from '@app/queue-manager';
import { withTenantContext } from '@app/database';
import {
  createEmbeddingsProvider,
  EmbeddingsDisabledError,
  gateOpenAiEmbeddingRequest,
} from '@app/ai-engine';
import type { ProductSearchResponse, ProductSearchResult } from '@app/types';
import type { SessionConfig } from '../auth/session.js';
import { getSessionFromRequest, requireSession } from '../auth/session.js';
import {
  recordAiQueryLatencyMs,
  openaiEmbedRateLimitAllowed,
  openaiEmbedRateLimitDenied,
  openaiEmbedRateLimitDelaySeconds,
  vectorSearchCacheHitTotal,
  vectorSearchCacheMissTotal,
  vectorSearchLatencySeconds,
} from '../otel/metrics.js';
import { generateQueryEmbedding, searchSimilarProducts } from '../processors/ai/search.js';
import { getCachedSearchResult, setCachedSearchResult } from '../processors/ai/cache.js';
import { AI_SPAN_NAMES, withAiSpan } from '../processors/ai/otel/spans.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_THRESHOLD = 0.7;
const MIN_THRESHOLD = 0.5;
const MAX_THRESHOLD = 0.95;

type SearchRoutesOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
  } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
    status,
  } as const;
}

function parseIntParam(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseFloatParam(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 1;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export const searchRoutes: FastifyPluginAsync<SearchRoutesOptions> = (
  server: FastifyInstance,
  opts
): Promise<void> => {
  const { env, logger, sessionConfig } = opts;
  const redis: RedisClient = createRedisConnection({
    redisUrl: env.redisUrl,
    redisOptions: {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    },
  });

  redis.on('error', (error: unknown) => {
    logger.warn({ error }, 'Redis error (search cache)');
  });

  server.addHook('onClose', async () => {
    await redis.quit().catch(() => undefined);
  });

  const requireAdminSession = { preHandler: requireSession(sessionConfig) } as const;

  server.get('/products/search', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    return withAiSpan(
      AI_SPAN_NAMES.SEARCH_QUERY,
      { 'ai.shop_id': session?.shopId ?? 'unknown' },
      async () => {
        if (!session) {
          void reply
            .status(401)
            .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
          return;
        }

        const query = request.query as { q?: unknown; limit?: unknown; threshold?: unknown };
        const rawText = query.q;
        if (!isNonEmptyString(rawText)) {
          void reply
            .status(400)
            .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing query text'));
          return;
        }

        const limit = parseIntParam(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
        const threshold = parseFloatParam(
          query.threshold,
          DEFAULT_THRESHOLD,
          MIN_THRESHOLD,
          MAX_THRESHOLD
        );

        const cached = await getCachedSearchResult({
          redis,
          shopId: session.shopId,
          queryText: rawText,
          config: { ttlSeconds: env.vectorSearchCacheTtlSeconds },
        });

        if (cached) {
          vectorSearchCacheHitTotal.add(1);
          void reply.status(200).send(
            successEnvelope(request.id, {
              results: cached.results,
              query: rawText,
              vectorSearchTimeMs: cached.vectorSearchTimeMs,
              cached: true,
            } satisfies ProductSearchResponse)
          );
          return;
        }

        vectorSearchCacheMissTotal.add(1);

        const provider = createEmbeddingsProvider({
          ...(env.openAiApiKey ? { openAiApiKey: env.openAiApiKey } : {}),
          ...(env.openAiBaseUrl ? { openAiBaseUrl: env.openAiBaseUrl } : {}),
          ...(env.openAiEmbeddingsModel
            ? { openAiEmbeddingsModel: env.openAiEmbeddingsModel }
            : {}),
          openAiTimeoutMs: env.openAiTimeoutMs,
        });

        const rateLimit = await gateOpenAiEmbeddingRequest({
          redis,
          shopId: session.shopId,
          estimatedTokens: estimateTokens(rawText),
          config: {
            maxTokensPerMinute: env.openAiEmbedRateLimitTokensPerMinute,
            maxRequestsPerMinute: env.openAiEmbedRateLimitRequestsPerMinute,
            bucketTtlMs: env.openAiEmbedRateLimitBucketTtlMs,
          },
        });

        if (!rateLimit.allowed) {
          openaiEmbedRateLimitDenied.add(1);
          if (rateLimit.delayMs > 0) {
            openaiEmbedRateLimitDelaySeconds.record(rateLimit.delayMs / 1000);
          }
          void reply
            .status(429)
            .send(
              errorEnvelope(
                request.id,
                429,
                'TOO_MANY_REQUESTS',
                'Embedding rate limit exceeded. Try again later.'
              )
            );
          return;
        }

        openaiEmbedRateLimitAllowed.add(1);

        const start = process.hrtime.bigint();
        let results: ProductSearchResult[] = [];

        try {
          const embedding = await generateQueryEmbedding({
            text: rawText,
            provider,
            logger,
          });

          const searchRows = await withTenantContext(session.shopId, async (client) => {
            return searchSimilarProducts({
              client,
              shopId: session.shopId,
              embedding,
              limit,
              threshold,
              queryTimeoutMs: env.vectorSearchQueryTimeoutMs,
              logger,
            });
          });

          results = searchRows.map((row) => ({
            id: row.productId,
            title: row.title,
            similarity: row.similarity,
          }));
        } catch (error) {
          if (error instanceof EmbeddingsDisabledError) {
            void reply
              .status(503)
              .send(errorEnvelope(request.id, 503, 'SERVICE_UNAVAILABLE', 'Embeddings disabled'));
            return;
          }
          throw error;
        }

        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        vectorSearchLatencySeconds.record(durationMs / 1000);
        recordAiQueryLatencyMs(durationMs);

        await setCachedSearchResult({
          redis,
          shopId: session.shopId,
          queryText: rawText,
          result: results,
          vectorSearchTimeMs: Math.round(durationMs),
          config: { ttlSeconds: env.vectorSearchCacheTtlSeconds },
        });

        void reply.status(200).send(
          successEnvelope(request.id, {
            results,
            query: rawText,
            vectorSearchTimeMs: Math.round(durationMs),
            cached: false,
          } satisfies ProductSearchResponse)
        );
      }
    );
  });

  return Promise.resolve();
};
