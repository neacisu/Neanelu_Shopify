import { getDbPool } from '../db.js';

export type ProdSimilarityMatch = Readonly<{
  id: string;
  productId: string | null;
  sourceId: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
  sourceGtin: string | null;
  sourceSku: string | null;
  sourcePrice: string | null;
  sourceCurrency: string | null;
  sourceData: Record<string, unknown> | null;
  similarityScore: string;
  matchMethod: string;
  matchConfidence: string | null;
  isPrimarySource: boolean | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}>;

export type NewProdSimilarityMatch = Readonly<{
  productId?: string | null;
  sourceId?: string | null;
  sourceUrl: string;
  sourceTitle?: string | null;
  sourceGtin?: string | null;
  sourceSku?: string | null;
  sourcePrice?: string | null;
  sourceCurrency?: string | null;
  sourceData?: Record<string, unknown> | null;
  similarityScore: number;
  matchMethod: string;
}>;

export async function hasEnoughConfirmedMatches(
  productId: string,
  threshold = 3
): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
       FROM prod_similarity_matches
      WHERE product_id = $1
        AND match_confidence = 'confirmed'`,
    [productId]
  );
  return Number(result.rows[0]?.count ?? 0) >= threshold;
}

export async function createMatch(data: NewProdSimilarityMatch): Promise<ProdSimilarityMatch> {
  const pool = getDbPool();
  const result = await pool.query<ProdSimilarityMatch>(
    `INSERT INTO prod_similarity_matches (
       product_id,
       source_id,
       source_url,
       source_title,
       source_gtin,
       source_sku,
       source_price,
       source_currency,
       source_data,
       similarity_score,
       match_method,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
     RETURNING
       id,
       product_id as "productId",
       source_id as "sourceId",
       source_url as "sourceUrl",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       verified_by as "verifiedBy",
       verified_at as "verifiedAt",
       rejection_reason as "rejectionReason",
       created_at as "createdAt",
       updated_at as "updatedAt"`,
    [
      data.productId ?? null,
      data.sourceId ?? null,
      data.sourceUrl,
      data.sourceTitle ?? null,
      data.sourceGtin ?? null,
      data.sourceSku ?? null,
      data.sourcePrice ?? null,
      data.sourceCurrency ?? null,
      data.sourceData ?? null,
      data.similarityScore,
      data.matchMethod,
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to insert prod_similarity_matches row.');
  }
  return row;
}

export async function findByProductId(productId: string): Promise<ProdSimilarityMatch[]> {
  const pool = getDbPool();
  const result = await pool.query<ProdSimilarityMatch>(
    `SELECT
       id,
       product_id as "productId",
       source_id as "sourceId",
       source_url as "sourceUrl",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       verified_by as "verifiedBy",
       verified_at as "verifiedAt",
       rejection_reason as "rejectionReason",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM prod_similarity_matches
    WHERE product_id = $1
    ORDER BY similarity_score DESC`,
    [productId]
  );
  return result.rows;
}

export async function findBySourceGtin(gtin: string): Promise<ProdSimilarityMatch[]> {
  const pool = getDbPool();
  const result = await pool.query<ProdSimilarityMatch>(
    `SELECT
       id,
       product_id as "productId",
       source_id as "sourceId",
       source_url as "sourceUrl",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       verified_by as "verifiedBy",
       verified_at as "verifiedAt",
       rejection_reason as "rejectionReason",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM prod_similarity_matches
    WHERE source_gtin = $1
    ORDER BY similarity_score DESC`,
    [gtin]
  );
  return result.rows;
}

export async function updateConfidence(params: {
  id: string;
  confidence: 'pending' | 'confirmed' | 'rejected';
  verifiedBy?: string | null;
  rejectionReason?: string | null;
}): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `UPDATE prod_similarity_matches
        SET match_confidence = $1,
            verified_by = $2,
            verified_at = now(),
            rejection_reason = $3,
            updated_at = now()
      WHERE id = $4`,
    [params.confidence, params.verifiedBy ?? null, params.rejectionReason ?? null, params.id]
  );
}

export async function markAsPrimary(params: { id: string; productId: string }): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `UPDATE prod_similarity_matches
        SET is_primary_source = false,
            updated_at = now()
      WHERE product_id = $1`,
    [params.productId]
  );

  await pool.query(
    `UPDATE prod_similarity_matches
        SET is_primary_source = true,
            updated_at = now()
      WHERE id = $1`,
    [params.id]
  );
}

export async function getConfirmedMatches(productId: string): Promise<ProdSimilarityMatch[]> {
  const pool = getDbPool();
  const result = await pool.query<ProdSimilarityMatch>(
    `SELECT
       id,
       product_id as "productId",
       source_id as "sourceId",
       source_url as "sourceUrl",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       verified_by as "verifiedBy",
       verified_at as "verifiedAt",
       rejection_reason as "rejectionReason",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM prod_similarity_matches
    WHERE product_id = $1
      AND match_confidence = 'confirmed'
    ORDER BY similarity_score DESC`,
    [productId]
  );
  return result.rows;
}
