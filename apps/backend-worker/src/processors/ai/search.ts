import type { PoolClient } from 'pg';

import { getOptimalEfSearch, setHnswEfSearch } from '@app/database';
import type { EmbeddingsProvider } from '@app/ai-engine';
import type { Logger } from '@app/logger';

import { toPgVectorLiteral } from '../bulk-operations/pim/vector.js';
import { normalizeSearchQuery } from './normalization.js';
import { AI_SPAN_NAMES, withAiSpan } from './otel/spans.js';

type SearchRow = Readonly<{
  productId: string;
  title: string;
  featuredImageUrl: string | null;
  vendor: string | null;
  productType: string | null;
  priceRange: { min: string; max: string; currency: string } | null;
  embeddingType: string;
  qualityLevel: string;
  similarity: number;
}>;

export type SearchResult = Readonly<{
  productId: string;
  title: string;
  featuredImageUrl: string | null;
  vendor: string | null;
  productType: string | null;
  priceRange: { min: string; max: string; currency: string } | null;
  similarity: number;
  embeddingType: string;
  qualityLevel: string;
}>;

function normalizeQuery(text: string): string {
  return normalizeSearchQuery(text);
}

export async function generateQueryEmbedding(params: {
  text: string;
  provider: EmbeddingsProvider;
  logger: Logger;
}): Promise<readonly number[]> {
  return withAiSpan(AI_SPAN_NAMES.SEARCH_EMBEDDING, { 'ai.shop_id': 'unknown' }, async () => {
    const normalized = normalizeQuery(params.text);
    if (!normalized) {
      throw new Error('SEARCH_QUERY_EMPTY');
    }

    if (!params.provider.isAvailable()) {
      params.logger.warn(
        { provider: params.provider.kind },
        'Embeddings provider not available for search'
      );
    }

    const embeddings = await params.provider.embedTexts([normalized]);
    const first = embeddings[0];
    if (!first) {
      throw new Error('SEARCH_EMBEDDING_EMPTY');
    }

    return first;
  });
}

export async function searchSimilarProducts(params: {
  client: PoolClient;
  shopId: string;
  embedding: readonly number[];
  limit: number;
  threshold: number;
  vendors?: readonly string[] | null;
  productTypes?: readonly string[] | null;
  priceMin?: number | null;
  priceMax?: number | null;
  categoryId?: string | null;
  efSearch?: number;
  queryTimeoutMs?: number;
  logger: Logger;
}): Promise<SearchResult[]> {
  return withAiSpan(AI_SPAN_NAMES.SEARCH_QUERY, { 'ai.shop_id': params.shopId }, async () => {
    const vectorLiteral = toPgVectorLiteral(params.embedding);
    const efSearch =
      typeof params.efSearch === 'number' && Number.isFinite(params.efSearch)
        ? Math.floor(params.efSearch)
        : getOptimalEfSearch(params.limit);

    await setHnswEfSearch(params.client, efSearch);
    if (typeof params.queryTimeoutMs === 'number' && Number.isFinite(params.queryTimeoutMs)) {
      const timeoutMs = Math.max(1, Math.floor(params.queryTimeoutMs));
      await params.client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    }

    const result = await params.client.query<SearchRow>(
      `SELECT p.id as "productId",
                p.title as "title",
                p.featured_image_url as "featuredImageUrl",
                p.vendor as "vendor",
                p.product_type as "productType",
                p.price_range as "priceRange",
                s.embedding_type as "embeddingType",
                s.quality_level as "qualityLevel",
                s.similarity as "similarity"
           FROM find_similar_shop_products(
                  $1,
                  $2::vector(2000),
                  $3,
                  $4
                ) s
           JOIN shopify_products p ON p.id = s.product_id
          WHERE p.shop_id = $1
            AND ($5::text[] IS NULL OR p.vendor = ANY($5::text[]))
            AND ($6::text[] IS NULL OR p.product_type = ANY($6::text[]))
            AND ($7::numeric IS NULL OR (p.price_range->>'max')::numeric >= $7::numeric)
            AND ($8::numeric IS NULL OR (p.price_range->>'min')::numeric <= $8::numeric)
            AND ($9::text IS NULL OR p.category_id = $9::text)
          ORDER BY s.similarity DESC`,
      [
        params.shopId,
        vectorLiteral,
        params.threshold,
        params.limit,
        params.vendors?.length ? params.vendors : null,
        params.productTypes?.length ? params.productTypes : null,
        params.priceMin ?? null,
        params.priceMax ?? null,
        params.categoryId ?? null,
      ]
    );

    params.logger.debug(
      {
        shopId: params.shopId,
        limit: params.limit,
        threshold: params.threshold,
        efSearch,
        rows: result.rowCount ?? 0,
      },
      'Vector search completed'
    );

    return result.rows.map((row) => ({
      productId: row.productId,
      title: row.title,
      featuredImageUrl: row.featuredImageUrl,
      vendor: row.vendor,
      productType: row.productType,
      priceRange: row.priceRange,
      similarity: row.similarity,
      embeddingType: row.embeddingType,
      qualityLevel: row.qualityLevel,
    }));
  });
}
