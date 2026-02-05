import { getDbPool } from '../db.js';
import type { MatchWithSource } from '../types/consensus.js';

export type ProdSimilarityMatch = Readonly<{
  id: string;
  productId: string | null;
  sourceId: string | null;
  sourceUrl: string;
  sourceProductId: string | null;
  sourceTitle: string | null;
  sourceGtin: string | null;
  sourceBrand: string | null;
  sourceSku: string | null;
  sourcePrice: string | null;
  sourceCurrency: string | null;
  sourceData: Record<string, unknown> | null;
  matchDetails: Record<string, unknown> | null;
  extractionSessionId: string | null;
  specsExtracted: Record<string, unknown> | null;
  scrapedAt: string | null;
  similarityScore: string;
  matchMethod: string;
  matchConfidence: string | null;
  isPrimarySource: boolean | null;
  validationNotes: string | null;
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
  sourceProductId?: string | null;
  sourceTitle?: string | null;
  sourceGtin?: string | null;
  sourceBrand?: string | null;
  sourceSku?: string | null;
  sourcePrice?: string | null;
  sourceCurrency?: string | null;
  sourceData?: Record<string, unknown> | null;
  matchDetails?: Record<string, unknown> | null;
  extractionSessionId?: string | null;
  specsExtracted?: Record<string, unknown> | null;
  scrapedAt?: string | null;
  validationNotes?: string | null;
  similarityScore: number;
  matchMethod: string;
  matchConfidence?: 'pending' | 'confirmed' | 'rejected' | 'uncertain';
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
  if (data.similarityScore < 0.9) {
    throw new Error('Similarity score below minimum threshold.');
  }
  const existing = await findBySourceUrl(data.sourceUrl);
  if (existing) {
    throw new Error('Duplicate match detected for source_url.');
  }

  const pool = getDbPool();
  const result = await pool.query<ProdSimilarityMatch>(
    `INSERT INTO prod_similarity_matches (
       product_id,
       source_id,
       source_url,
       source_product_id,
       source_title,
       source_gtin,
       source_brand,
       source_sku,
       source_price,
       source_currency,
       source_data,
       match_details,
       extraction_session_id,
       specs_extracted,
       scraped_at,
       validation_notes,
       similarity_score,
       match_method,
       match_confidence,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now(), now())
     RETURNING
       id,
       product_id as "productId",
       source_id as "sourceId",
       source_url as "sourceUrl",
       source_product_id as "sourceProductId",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_brand as "sourceBrand",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       match_details as "matchDetails",
       extraction_session_id as "extractionSessionId",
       specs_extracted as "specsExtracted",
       scraped_at as "scrapedAt",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       validation_notes as "validationNotes",
       verified_by as "verifiedBy",
       verified_at as "verifiedAt",
       rejection_reason as "rejectionReason",
       created_at as "createdAt",
       updated_at as "updatedAt"`,
    [
      data.productId ?? null,
      data.sourceId ?? null,
      data.sourceUrl,
      data.sourceProductId ?? null,
      data.sourceTitle ?? null,
      data.sourceGtin ?? null,
      data.sourceBrand ?? null,
      data.sourceSku ?? null,
      data.sourcePrice ?? null,
      data.sourceCurrency ?? null,
      data.sourceData ?? null,
      data.matchDetails ?? null,
      data.extractionSessionId ?? null,
      data.specsExtracted ?? null,
      data.scrapedAt ?? null,
      data.validationNotes ?? null,
      data.similarityScore,
      data.matchMethod,
      data.matchConfidence ?? 'pending',
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
       source_product_id as "sourceProductId",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_brand as "sourceBrand",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       match_details as "matchDetails",
       extraction_session_id as "extractionSessionId",
       specs_extracted as "specsExtracted",
       scraped_at as "scrapedAt",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       validation_notes as "validationNotes",
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
       source_product_id as "sourceProductId",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_brand as "sourceBrand",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       match_details as "matchDetails",
       extraction_session_id as "extractionSessionId",
       specs_extracted as "specsExtracted",
       scraped_at as "scrapedAt",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       validation_notes as "validationNotes",
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

export async function updateSpecsExtracted(params: {
  id: string;
  specsExtracted: Record<string, unknown>;
  extractionSessionId: string;
  scrapedAt?: Date;
}): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `UPDATE prod_similarity_matches
        SET specs_extracted = $1,
            extraction_session_id = $2,
            scraped_at = COALESCE($3, now()),
            updated_at = now()
      WHERE id = $4`,
    [
      JSON.stringify(params.specsExtracted),
      params.extractionSessionId,
      params.scrapedAt ?? null,
      params.id,
    ]
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
       source_product_id as "sourceProductId",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_brand as "sourceBrand",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       match_details as "matchDetails",
       extraction_session_id as "extractionSessionId",
       specs_extracted as "specsExtracted",
       scraped_at as "scrapedAt",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       validation_notes as "validationNotes",
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

export async function findBySourceUrl(sourceUrl: string): Promise<ProdSimilarityMatch | null> {
  const pool = getDbPool();
  const result = await pool.query<ProdSimilarityMatch>(
    `SELECT
       id,
       product_id as "productId",
       source_id as "sourceId",
       source_url as "sourceUrl",
       source_product_id as "sourceProductId",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_brand as "sourceBrand",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       match_details as "matchDetails",
       extraction_session_id as "extractionSessionId",
       specs_extracted as "specsExtracted",
       scraped_at as "scrapedAt",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       validation_notes as "validationNotes",
       verified_by as "verifiedBy",
       verified_at as "verifiedAt",
       rejection_reason as "rejectionReason",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM prod_similarity_matches
    WHERE source_url = $1
    ORDER BY similarity_score DESC
    LIMIT 1`,
    [sourceUrl]
  );
  return result.rows[0] ?? null;
}

export async function deleteMatch(id: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(`DELETE FROM prod_similarity_matches WHERE id = $1`, [id]);
}

export async function getPrimaryMatch(productId: string): Promise<ProdSimilarityMatch | null> {
  const pool = getDbPool();
  const result = await pool.query<ProdSimilarityMatch>(
    `SELECT
       id,
       product_id as "productId",
       source_id as "sourceId",
       source_url as "sourceUrl",
       source_product_id as "sourceProductId",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_brand as "sourceBrand",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       match_details as "matchDetails",
       extraction_session_id as "extractionSessionId",
       specs_extracted as "specsExtracted",
       scraped_at as "scrapedAt",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       validation_notes as "validationNotes",
       verified_by as "verifiedBy",
       verified_at as "verifiedAt",
       rejection_reason as "rejectionReason",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM prod_similarity_matches
    WHERE product_id = $1
      AND is_primary_source = true
    ORDER BY similarity_score DESC
    LIMIT 1`,
    [productId]
  );
  return result.rows[0] ?? null;
}

export async function findPendingMatches(limit = 200): Promise<ProdSimilarityMatch[]> {
  const pool = getDbPool();
  const result = await pool.query<ProdSimilarityMatch>(
    `SELECT
       id,
       product_id as "productId",
       source_id as "sourceId",
       source_url as "sourceUrl",
       source_product_id as "sourceProductId",
       source_title as "sourceTitle",
       source_gtin as "sourceGtin",
       source_brand as "sourceBrand",
       source_sku as "sourceSku",
       source_price as "sourcePrice",
       source_currency as "sourceCurrency",
       source_data as "sourceData",
       match_details as "matchDetails",
       extraction_session_id as "extractionSessionId",
       specs_extracted as "specsExtracted",
       scraped_at as "scrapedAt",
       similarity_score as "similarityScore",
       match_method as "matchMethod",
       match_confidence as "matchConfidence",
       is_primary_source as "isPrimarySource",
       validation_notes as "validationNotes",
       verified_by as "verifiedBy",
       verified_at as "verifiedAt",
       rejection_reason as "rejectionReason",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM prod_similarity_matches
    WHERE match_confidence = 'pending'
    ORDER BY created_at ASC
    LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getConfirmedMatchesWithSources(
  productId: string
): Promise<MatchWithSource[]> {
  const pool = getDbPool();
  const result = await pool.query<MatchWithSource>(
    `SELECT
       psm.id as "matchId",
       psm.product_id as "productId",
       psm.source_id as "sourceId",
       ps.name as "sourceName",
       psm.source_url as "sourceUrl",
       psm.similarity_score::numeric as "similarityScore",
       psm.specs_extracted as "specsExtracted",
       COALESCE(ps.trust_score, 0.5)::numeric as "trustScore",
       psm.extraction_session_id as "extractionSessionId",
       psm.match_confidence as "matchConfidence",
       psm.created_at as "createdAt"
     FROM prod_similarity_matches psm
     LEFT JOIN prod_sources ps ON ps.id = psm.source_id
    WHERE psm.product_id = $1
      AND psm.match_confidence = 'confirmed'
      AND psm.specs_extracted IS NOT NULL
    ORDER BY psm.similarity_score DESC`,
    [productId]
  );
  return result.rows;
}

export async function countMatchesBySource(productId: string): Promise<Map<string, number>> {
  const pool = getDbPool();
  const result = await pool.query<{ source_name: string; count: string }>(
    `SELECT COALESCE(ps.name, 'unknown') as source_name, COUNT(*)::text as count
       FROM prod_similarity_matches psm
       LEFT JOIN prod_sources ps ON ps.id = psm.source_id
      WHERE psm.product_id = $1
        AND psm.match_confidence = 'confirmed'
      GROUP BY ps.name`,
    [productId]
  );
  return new Map(result.rows.map((row) => [row.source_name, Number(row.count)]));
}

export async function getMatchesWithExtractedSpecs(productId: string): Promise<MatchWithSource[]> {
  const pool = getDbPool();
  const result = await pool.query<MatchWithSource>(
    `SELECT
       psm.id as "matchId",
       psm.product_id as "productId",
       psm.source_id as "sourceId",
       ps.name as "sourceName",
       psm.source_url as "sourceUrl",
       psm.similarity_score::numeric as "similarityScore",
       psm.specs_extracted as "specsExtracted",
       COALESCE(ps.trust_score, 0.5)::numeric as "trustScore",
       psm.extraction_session_id as "extractionSessionId",
       psm.match_confidence as "matchConfidence",
       psm.created_at as "createdAt"
     FROM prod_similarity_matches psm
     LEFT JOIN prod_sources ps ON ps.id = psm.source_id
    WHERE psm.product_id = $1
      AND psm.specs_extracted IS NOT NULL
    ORDER BY psm.similarity_score DESC`,
    [productId]
  );
  return result.rows;
}

export async function batchUpdateConfidence(params: {
  ids: string[];
  confidence: 'pending' | 'confirmed' | 'rejected' | 'uncertain';
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
      WHERE id = ANY($4::uuid[])`,
    [params.confidence, params.verifiedBy ?? null, params.rejectionReason ?? null, params.ids]
  );
}
