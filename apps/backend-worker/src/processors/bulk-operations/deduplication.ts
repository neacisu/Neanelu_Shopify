import type { EmbeddingsProvider } from '@app/ai-engine';

import { normalizeText, toPgVectorLiteral } from './pim/vector.js';

export type DedupeThresholds = Readonly<{
  highConfidence: number; // auto link to existing
  suspicious: number; // flag for review / cluster
}>;

export type DedupeDecision =
  | Readonly<{ kind: 'exact_duplicate'; existingProductId: string; method: 'gtin' }>
  | Readonly<{
      kind: 'semantic_duplicate';
      existingProductId: string;
      method: 'semantic';
      similarity: number;
    }>
  | Readonly<{
      kind: 'suspicious';
      candidateProductId: string;
      method: 'semantic';
      similarity: number;
    }>
  | Readonly<{ kind: 'unique' }>;

type SimilarProductRow = Readonly<{
  product_id: string;
  similarity: number;
  title: string | null;
  brand: string | null;
}>;

export async function checkDuplicateForShopifyProduct(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  gtin: string | null;
  title: string;
  vendor: string | null;
  thresholds: DedupeThresholds;
  semanticEnabled: boolean;
  embeddingsProvider: EmbeddingsProvider;
  maxResults: number;
}): Promise<
  Readonly<{
    decision: DedupeDecision;
    embedding: readonly number[] | null;
    matches: readonly SimilarProductRow[];
  }>
> {
  const gtin = normalizeText(params.gtin) || null;
  const title = normalizeText(params.title);
  const vendor = normalizeText(params.vendor);

  // 1) Primary: GTIN exact match.
  if (gtin) {
    const existing = await findProdMasterByGtin({ client: params.client, gtin });
    if (existing) {
      return {
        decision: { kind: 'exact_duplicate', existingProductId: existing, method: 'gtin' },
        embedding: null,
        matches: [],
      };
    }
  }

  // 2) Secondary: semantic match.
  if (!params.semanticEnabled || !params.embeddingsProvider.isAvailable()) {
    return { decision: { kind: 'unique' }, embedding: null, matches: [] };
  }

  const text = `${title} ${vendor}`.trim();
  if (!text) {
    return { decision: { kind: 'unique' }, embedding: null, matches: [] };
  }

  const [embedding] = await params.embeddingsProvider.embedTexts([text]);
  if (!embedding) {
    return { decision: { kind: 'unique' }, embedding: null, matches: [] };
  }

  const matches = await findSimilarProducts({
    client: params.client,
    queryEmbedding: embedding,
    similarityThreshold: params.thresholds.suspicious,
    maxResults: params.maxResults,
  });

  const best = matches[0];
  if (!best) {
    return { decision: { kind: 'unique' }, embedding, matches };
  }

  if (best.similarity >= params.thresholds.highConfidence) {
    return {
      decision: {
        kind: 'semantic_duplicate',
        existingProductId: best.product_id,
        method: 'semantic',
        similarity: best.similarity,
      },
      embedding,
      matches,
    };
  }

  if (best.similarity >= params.thresholds.suspicious) {
    return {
      decision: {
        kind: 'suspicious',
        candidateProductId: best.product_id,
        method: 'semantic',
        similarity: best.similarity,
      },
      embedding,
      matches,
    };
  }

  return { decision: { kind: 'unique' }, embedding, matches };
}

export async function createSuspiciousDedupeCluster(params: {
  client: {
    query: (sql: string, values?: readonly unknown[]) => Promise<{ rows: { id: string }[] }>;
  };
  canonicalProductId: string;
  newProductId: string;
  similarity: number;
  matchCriteria: unknown;
  matchFields: unknown;
}): Promise<string> {
  const existing = await params.client.query(
    `SELECT c.id
     FROM prod_dedupe_clusters c
     INNER JOIN prod_dedupe_cluster_members m_c
       ON m_c.cluster_id = c.id
      AND m_c.product_id = $1
     INNER JOIN prod_dedupe_cluster_members m_n
       ON m_n.cluster_id = c.id
      AND m_n.product_id = $2
     WHERE c.cluster_type = 'SEMANTIC'
       AND c.status = 'pending'
       AND c.canonical_product_id = $1
     LIMIT 1`,
    [params.canonicalProductId, params.newProductId]
  );

  let clusterId = existing.rows[0]?.id;
  if (!clusterId) {
    const cluster = await params.client.query(
      `INSERT INTO prod_dedupe_clusters (
         cluster_type,
         match_criteria,
         canonical_product_id,
         member_count,
         confidence_score,
         status,
         created_at,
         updated_at
       )
       VALUES ('SEMANTIC', $1::jsonb, $2, 2, $3, 'pending', now(), now())
       RETURNING id`,
      [JSON.stringify(params.matchCriteria ?? {}), params.canonicalProductId, params.similarity]
    );

    clusterId = cluster.rows[0]?.id;
    if (!clusterId) throw new Error('dedupe_cluster_insert_failed');
  } else {
    await params.client.query(
      `UPDATE prod_dedupe_clusters
       SET
         confidence_score = GREATEST(COALESCE(confidence_score, 0), $2),
         match_criteria = (COALESCE(match_criteria, '{}'::jsonb) || $1::jsonb),
         updated_at = now()
       WHERE id = $3`,
      [JSON.stringify(params.matchCriteria ?? {}), params.similarity, clusterId]
    );
  }

  await params.client.query(
    `INSERT INTO prod_dedupe_cluster_members (cluster_id, product_id, similarity_score, match_fields, is_canonical)
     VALUES
       ($1, $2, 1.0, '{}'::jsonb, true),
       ($1, $3, $4, $5::jsonb, false)
     ON CONFLICT (cluster_id, product_id)
     DO UPDATE SET
       similarity_score = EXCLUDED.similarity_score,
       match_fields = EXCLUDED.match_fields,
       is_canonical = EXCLUDED.is_canonical,
       updated_at = now()`,
    [
      clusterId,
      params.canonicalProductId,
      params.newProductId,
      params.similarity,
      JSON.stringify(params.matchFields ?? {}),
    ]
  );

  return clusterId;
}

async function findProdMasterByGtin(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  gtin: string;
}): Promise<string | null> {
  const res = await params.client.query<Readonly<{ id: string }>>(
    `SELECT id
     FROM prod_master
     WHERE gtin = $1
     LIMIT 1`,
    [params.gtin]
  );
  return res.rows[0]?.id ?? null;
}

async function findSimilarProducts(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  queryEmbedding: readonly number[];
  similarityThreshold: number;
  maxResults: number;
}): Promise<readonly SimilarProductRow[]> {
  const vec = toPgVectorLiteral(params.queryEmbedding);
  const res = await params.client.query<SimilarProductRow>(
    `SELECT product_id, similarity, title, brand
     FROM find_similar_products($1::vector(2000), $2::float, $3::int)
     ORDER BY similarity DESC`,
    [vec, params.similarityThreshold, params.maxResults]
  );
  return res.rows;
}
