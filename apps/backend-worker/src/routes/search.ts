import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Redis as RedisClient } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { createRedisConnection } from '@app/queue-manager';
import { withTenantContext } from '@app/database';
import {
  createEmbeddingsProvider,
  EmbeddingsDisabledError,
  gateOpenAiEmbeddingRequest,
} from '@app/ai-engine';
import { checkBudget, trackCost } from '@app/pim';
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
import { toPgVectorLiteral } from '../processors/bulk-operations/pim/vector.js';
import { getCachedSearchResult, setCachedSearchResult } from '../processors/ai/cache.js';
import { AI_SPAN_NAMES, withAiSpan } from '../processors/ai/otel/spans.js';
import { getShopOpenAiConfig } from '../runtime/openai-config.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_THRESHOLD = 0.7;
const MIN_THRESHOLD = 0.1;
const MAX_THRESHOLD = 1;

interface SearchCursor {
  lastSimilarity: number;
  seenIds: string[];
}

function decodeSearchCursor(value: string): SearchCursor | null {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as SearchCursor;
    if (!parsed || typeof parsed.lastSimilarity !== 'number') return null;
    if (!Array.isArray(parsed.seenIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

type SearchRoutesOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type ExportJob = Readonly<{
  jobId: string;
  shopId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  downloadUrl?: string;
  format: 'csv' | 'json';
  error?: string;
  payload?: string;
  contentType?: string;
}>;

const exportJobs = new Map<string, ExportJob>();

type CategoryRow = Readonly<{
  id: string;
  parentId: string | null;
  name: string;
  shopifyTaxonomyId: string | null;
}>;

type CategoryNode = Readonly<{
  id: string;
  name: string;
  children?: CategoryNode[];
}>;

function buildCategoryTree(rows: readonly CategoryRow[]): CategoryNode[] {
  const byId = new Map<string, CategoryRow>();
  for (const row of rows) {
    byId.set(row.id, row);
  }

  const childrenByParent = new Map<string, CategoryRow[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row);
    childrenByParent.set(row.parentId, list);
  }

  const toNode = (row: CategoryRow): CategoryNode => {
    const childrenRows = childrenByParent.get(row.id) ?? [];
    const children = childrenRows.map(toNode);
    const id = row.shopifyTaxonomyId ?? row.id;
    return children.length ? { id, name: row.name, children } : { id, name: row.name };
  };

  const roots = rows.filter((row) => !row.parentId || !byId.has(row.parentId));
  return roots.map(toNode);
}

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

async function isOpenAiBudgetExceeded(shopId: string): Promise<boolean> {
  const status = await checkBudget('openai', shopId);
  return status.exceeded;
}

async function trackOpenAiSearchEmbeddingCost(params: {
  shopId: string;
  endpoint: 'search-query-embedding' | 'search-export-embedding';
  text: string;
  costPer1MTokens: number;
  responseTimeMs: number;
  errorMessage?: string;
}): Promise<void> {
  const estimatedTokens = estimateTokens(params.text);
  const estimatedCost = (estimatedTokens / 1_000_000) * params.costPer1MTokens;
  await trackCost({
    provider: 'openai',
    operation: 'embedding',
    endpoint: params.endpoint,
    shopId: params.shopId,
    requestCount: 1,
    tokensInput: estimatedTokens,
    tokensOutput: 0,
    estimatedCost,
    httpStatus: params.errorMessage ? 500 : 200,
    responseTimeMs: params.responseTimeMs,
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
  });
}

function toExportRow(result: ProductSearchResult) {
  return {
    id: result.id,
    title: result.title,
    similarity: result.similarity,
    vendor: result.vendor ?? '',
    productType: result.productType ?? '',
    priceMin: result.priceRange?.min ?? '',
    priceMax: result.priceRange?.max ?? '',
    priceCurrency: result.priceRange?.currency ?? '',
  };
}

function toCsv(rows: ProductSearchResult[]): string {
  const normalized = rows.map(toExportRow);
  const header = Object.keys(normalized[0] ?? {}).join(',');
  const csvRows = normalized.map((row) =>
    Object.values(row)
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header, ...csvRows].join('\n');
}

function toJson(rows: ProductSearchResult[]): string {
  return JSON.stringify(rows.map(toExportRow), null, 2);
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

        const query = request.query as {
          q?: unknown;
          limit?: unknown;
          threshold?: unknown;
          vendors?: unknown;
          productTypes?: unknown;
          priceMin?: unknown;
          priceMax?: unknown;
          categoryId?: unknown;
          cursor?: unknown;
        };
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
        const vendors =
          typeof query.vendors === 'string'
            ? query.vendors
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
            : [];
        const productTypes =
          typeof query.productTypes === 'string'
            ? query.productTypes
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
            : [];
        const priceMin = parseFloatParam(query.priceMin, NaN, 0, Number.MAX_SAFE_INTEGER);
        const priceMax = parseFloatParam(query.priceMax, NaN, 0, Number.MAX_SAFE_INTEGER);
        const categoryId = typeof query.categoryId === 'string' ? query.categoryId.trim() : '';

        const cursor = typeof query.cursor === 'string' ? query.cursor.trim() : '';
        const decodedCursor = cursor ? decodeSearchCursor(cursor) : null;

        const cacheKeyText = [
          rawText,
          `limit=${limit}`,
          `threshold=${threshold}`,
          `vendors=${vendors.join('|')}`,
          `productTypes=${productTypes.join('|')}`,
          `priceMin=${Number.isFinite(priceMin) ? priceMin : ''}`,
          `priceMax=${Number.isFinite(priceMax) ? priceMax : ''}`,
          `categoryId=${categoryId}`,
        ].join(' ');

        if (!cursor) {
          const cached = await getCachedSearchResult({
            redis,
            shopId: session.shopId,
            queryText: cacheKeyText,
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
                totalCount: cached.totalCount,
                hasMore: cached.totalCount > cached.results.length,
                nextCursor: null,
              } satisfies ProductSearchResponse)
            );
            return;
          }

          vectorSearchCacheMissTotal.add(1);
        }

        const openAiConfig = await getShopOpenAiConfig({
          shopId: session.shopId,
          env,
          logger,
        });

        if (await isOpenAiBudgetExceeded(session.shopId)) {
          void reply
            .status(429)
            .send(
              errorEnvelope(
                request.id,
                429,
                'BUDGET_EXCEEDED',
                'Bugetul zilnic OpenAI este epuizat. Incearca din nou dupa resetarea zilnica.'
              )
            );
          return;
        }

        const provider = createEmbeddingsProvider({
          ...(openAiConfig.openAiApiKey ? { openAiApiKey: openAiConfig.openAiApiKey } : {}),
          ...(openAiConfig.openAiBaseUrl ? { openAiBaseUrl: openAiConfig.openAiBaseUrl } : {}),
          openAiEmbeddingsModel: openAiConfig.openAiEmbeddingsModel,
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
        let totalCount = 0;

        try {
          const embedStartedAt = Date.now();
          const embedding = await generateQueryEmbedding({
            text: rawText,
            provider,
            logger,
          });
          await trackOpenAiSearchEmbeddingCost({
            shopId: session.shopId,
            endpoint: 'search-query-embedding',
            text: rawText,
            costPer1MTokens: env.openAiEmbeddingCostPer1MTokens,
            responseTimeMs: Date.now() - embedStartedAt,
          });

          const searchResult = await withTenantContext(session.shopId, async (client) => {
            const rows = await searchSimilarProducts({
              client,
              shopId: session.shopId,
              embedding,
              limit,
              threshold,
              vendors: vendors.length ? vendors : null,
              productTypes: productTypes.length ? productTypes : null,
              priceMin: Number.isFinite(priceMin) ? priceMin : null,
              priceMax: Number.isFinite(priceMax) ? priceMax : null,
              categoryId: categoryId || null,
              minSimilarity: decodedCursor?.lastSimilarity ?? null,
              excludeProductIds: decodedCursor?.seenIds ?? null,
              queryTimeoutMs: env.vectorSearchQueryTimeoutMs,
              logger,
            });

            const vectorLiteral = toPgVectorLiteral(embedding);
            const countResult = await client.query<{ count: number }>(
              `SELECT COUNT(*)::int as "count"
                 FROM shop_product_embeddings e
                 JOIN shopify_products p ON p.id = e.product_id
                WHERE e.shop_id = $1
                  AND e.status = 'ready'
                  AND p.shop_id = $1
                  AND (e.embedding <=> $2::vector(2000)) < (1.0 - $3::numeric)
                  AND ($4::text[] IS NULL OR p.vendor = ANY($4::text[]))
                  AND ($5::text[] IS NULL OR p.product_type = ANY($5::text[]))
                  AND ($6::numeric IS NULL OR (p.price_range->>'max')::numeric >= $6::numeric)
                  AND ($7::numeric IS NULL OR (p.price_range->>'min')::numeric <= $7::numeric)
                  AND ($8::text IS NULL OR p.category_id = $8::text)`,
              [
                session.shopId,
                vectorLiteral,
                threshold,
                vendors.length ? vendors : null,
                productTypes.length ? productTypes : null,
                Number.isFinite(priceMin) ? priceMin : null,
                Number.isFinite(priceMax) ? priceMax : null,
                categoryId || null,
              ]
            );

            return { rows, total: countResult.rows[0]?.count ?? 0 };
          });

          results = searchResult.rows.map((row) => ({
            id: row.productId,
            title: row.title,
            similarity: row.similarity,
            featuredImageUrl: row.featuredImageUrl,
            vendor: row.vendor,
            productType: row.productType,
            priceRange: row.priceRange,
          }));
          totalCount = searchResult.total;
        } catch (error) {
          await trackOpenAiSearchEmbeddingCost({
            shopId: session.shopId,
            endpoint: 'search-query-embedding',
            text: rawText,
            costPer1MTokens: env.openAiEmbeddingCostPer1MTokens,
            responseTimeMs: 0,
            errorMessage: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
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

        const hasMore = results.length === limit;
        const nextCursor =
          hasMore && results.length > 0
            ? encodeSearchCursor({
                lastSimilarity: results[results.length - 1]?.similarity ?? threshold,
                seenIds: results.map((result) => result.id),
              })
            : null;

        if (!cursor) {
          await setCachedSearchResult({
            redis,
            shopId: session.shopId,
            queryText: cacheKeyText,
            result: results,
            vectorSearchTimeMs: Math.round(durationMs),
            totalCount,
            config: { ttlSeconds: env.vectorSearchCacheTtlSeconds },
          });
        }

        void reply.status(200).send(
          successEnvelope(request.id, {
            results,
            query: rawText,
            vectorSearchTimeMs: Math.round(durationMs),
            cached: false,
            totalCount,
            hasMore,
            nextCursor,
          } satisfies ProductSearchResponse)
        );
      }
    );
  });

  server.get('/products/filters', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const { vendors, productTypes, priceRange, categories, enrichmentStatus } =
      await withTenantContext(session.shopId, async (client) => {
        const vendorRows = await client.query<{ vendor: string }>(
          `SELECT DISTINCT vendor
             FROM shopify_products
            WHERE shop_id = $1
              AND vendor IS NOT NULL
              AND vendor <> ''
            ORDER BY vendor ASC`,
          [session.shopId]
        );

        const productTypeRows = await client.query<{ productType: string }>(
          `SELECT DISTINCT product_type as "productType"
             FROM shopify_products
            WHERE shop_id = $1
              AND product_type IS NOT NULL
              AND product_type <> ''
            ORDER BY product_type ASC`,
          [session.shopId]
        );

        const priceRow = await client.query<{ min: string | null; max: string | null }>(
          `SELECT MIN((price_range->>'min')::numeric)::text as "min",
                  MAX((price_range->>'max')::numeric)::text as "max"
             FROM shopify_products
            WHERE shop_id = $1
              AND price_range IS NOT NULL`,
          [session.shopId]
        );

        const categoryRows = await client.query<CategoryRow>(
          `WITH RECURSIVE selected AS (
              SELECT id,
                     parent_id as "parentId",
                     name,
                     shopify_taxonomy_id as "shopifyTaxonomyId"
                FROM prod_taxonomy
               WHERE shopify_taxonomy_id IN (
                     SELECT DISTINCT category_id
                       FROM shopify_products
                      WHERE shop_id = $1
                        AND category_id IS NOT NULL
                   )
              UNION
              SELECT pt.id,
                     pt.parent_id as "parentId",
                     pt.name,
                     pt.shopify_taxonomy_id as "shopifyTaxonomyId"
                FROM prod_taxonomy pt
                JOIN selected s ON s."parentId" = pt.id
            )
            SELECT DISTINCT id, "parentId", name, "shopifyTaxonomyId"
              FROM selected`,
          [session.shopId]
        );

        const enrichmentRows = await client.query<{ status: string }>(
          `SELECT DISTINCT COALESCE(metafields->'app--neanelu--pim'->>'enrichment_status', metafields->>'enrichment_status') as status
             FROM shopify_products
            WHERE shop_id = $1
              AND metafields IS NOT NULL
              AND COALESCE(metafields->'app--neanelu--pim'->>'enrichment_status', metafields->>'enrichment_status') IS NOT NULL
            ORDER BY status ASC`,
          [session.shopId]
        );

        return {
          vendors: vendorRows.rows.map((row) => row.vendor),
          productTypes: productTypeRows.rows.map((row) => row.productType),
          priceRange: {
            min: priceRow.rows[0]?.min ? Number(priceRow.rows[0]?.min) : null,
            max: priceRow.rows[0]?.max ? Number(priceRow.rows[0]?.max) : null,
          },
          categories: buildCategoryTree(categoryRows.rows),
          enrichmentStatus: enrichmentRows.rows.map((row) => row.status),
        };
      });

    void reply.status(200).send(
      successEnvelope(request.id, {
        vendors,
        productTypes,
        priceRange,
        categories,
        enrichmentStatus,
      })
    );
  });

  server.post('/products/search/export', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawText = body['q'];
    const format = body['format'];
    if (!isNonEmptyString(rawText)) {
      void reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing query text'));
      return;
    }
    if (format !== 'csv' && format !== 'json') {
      void reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid format'));
      return;
    }

    const limit = parseIntParam(body['limit'], 2000, 1, 5000);
    const threshold = parseFloatParam(
      body['threshold'],
      DEFAULT_THRESHOLD,
      MIN_THRESHOLD,
      MAX_THRESHOLD
    );
    const vendors =
      typeof body['vendors'] === 'string'
        ? body['vendors']
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : Array.isArray(body['vendors'])
          ? body['vendors'].filter((v) => typeof v === 'string')
          : [];
    const productTypes =
      typeof body['productTypes'] === 'string'
        ? body['productTypes']
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : Array.isArray(body['productTypes'])
          ? body['productTypes'].filter((v) => typeof v === 'string')
          : [];
    const priceMin = parseFloatParam(body['priceMin'], NaN, 0, Number.MAX_SAFE_INTEGER);
    const priceMax = parseFloatParam(body['priceMax'], NaN, 0, Number.MAX_SAFE_INTEGER);
    const categoryId = typeof body['categoryId'] === 'string' ? body['categoryId'].trim() : '';

    const jobId = randomUUID();
    const initial: ExportJob = {
      jobId,
      shopId: session.shopId,
      status: 'queued',
      progress: 0,
      format,
    };
    exportJobs.set(jobId, initial);

    void reply.status(202).send(
      successEnvelope(request.id, {
        jobId,
        status: 'queued',
        estimatedCount: limit,
      })
    );

    void (async () => {
      exportJobs.set(jobId, { ...initial, status: 'processing', progress: 10 });
      try {
        if (await isOpenAiBudgetExceeded(session.shopId)) {
          exportJobs.set(jobId, {
            ...initial,
            status: 'failed',
            progress: 100,
            error: 'BUDGET_EXCEEDED: Bugetul zilnic OpenAI este epuizat.',
          });
          return;
        }

        const openAiConfig = await getShopOpenAiConfig({
          shopId: session.shopId,
          env,
          logger,
        });

        const provider = createEmbeddingsProvider({
          ...(openAiConfig.openAiApiKey ? { openAiApiKey: openAiConfig.openAiApiKey } : {}),
          ...(openAiConfig.openAiBaseUrl ? { openAiBaseUrl: openAiConfig.openAiBaseUrl } : {}),
          openAiEmbeddingsModel: openAiConfig.openAiEmbeddingsModel,
          openAiTimeoutMs: env.openAiTimeoutMs,
        });

        const embedStartedAt = Date.now();
        const embedding = await generateQueryEmbedding({ text: rawText, provider, logger });
        await trackOpenAiSearchEmbeddingCost({
          shopId: session.shopId,
          endpoint: 'search-export-embedding',
          text: rawText,
          costPer1MTokens: env.openAiEmbeddingCostPer1MTokens,
          responseTimeMs: Date.now() - embedStartedAt,
        });

        const searchRows = await withTenantContext(session.shopId, async (client) => {
          return searchSimilarProducts({
            client,
            shopId: session.shopId,
            embedding,
            limit,
            threshold,
            vendors: vendors.length ? vendors : null,
            productTypes: productTypes.length ? productTypes : null,
            priceMin: Number.isFinite(priceMin) ? priceMin : null,
            priceMax: Number.isFinite(priceMax) ? priceMax : null,
            categoryId: categoryId || null,
            queryTimeoutMs: env.vectorSearchQueryTimeoutMs,
            logger,
          });
        });

        exportJobs.set(jobId, { ...initial, status: 'processing', progress: 70 });

        const results = searchRows.map((row) => ({
          id: row.productId,
          title: row.title,
          similarity: row.similarity,
          featuredImageUrl: row.featuredImageUrl,
          vendor: row.vendor,
          productType: row.productType,
          priceRange: row.priceRange,
        })) satisfies ProductSearchResult[];

        const payload = format === 'csv' ? toCsv(results) : toJson(results);
        const contentType = format === 'csv' ? 'text/csv' : 'application/json';
        exportJobs.set(jobId, {
          ...initial,
          status: 'completed',
          progress: 100,
          payload,
          contentType,
          downloadUrl: `/api/products/search/export/${jobId}/download`,
        });
      } catch (error) {
        exportJobs.set(jobId, {
          ...initial,
          status: 'failed',
          progress: 100,
          error: error instanceof Error ? error.message : 'Export failed',
        });
      }
    })();
  });

  server.get('/products/search/export/:jobId', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      void reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      return;
    }

    const jobId = (request.params as { jobId?: string }).jobId;
    if (!jobId || !exportJobs.has(jobId)) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Export not found'));
      return;
    }

    const job = exportJobs.get(jobId);
    if (job?.shopId !== session.shopId) {
      void reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Export not found'));
      return;
    }

    void reply.status(200).send(
      successEnvelope(request.id, {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        downloadUrl: job.downloadUrl,
        error: job.error,
      })
    );
  });

  server.get(
    '/products/search/export/:jobId/download',
    requireAdminSession,
    async (request, reply) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        void reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
        return;
      }

      const jobId = (request.params as { jobId?: string }).jobId;
      const job = jobId ? exportJobs.get(jobId) : null;
      if (job?.shopId !== session.shopId || job?.status !== 'completed' || !job?.payload) {
        void reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Export not found'));
        return;
      }

      reply.header('Content-Type', job.contentType ?? 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="search-export.${job.format}"`);
      void reply.status(200).send(job.payload);
    }
  );

  return Promise.resolve();
};
