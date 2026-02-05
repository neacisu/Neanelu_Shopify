import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDbPool } from '../db.js';
import { computeConsensus } from '../services/consensus-engine.js';

describe('consensus-engine', () => {
  const pool = getDbPool();
  const ids: { productId?: string; sourceIds: string[]; matchIds: string[] } = {
    sourceIds: [],
    matchIds: [],
  };

  beforeAll(async () => {
    const productRes = await pool.query<{ id: string }>(
      `INSERT INTO prod_master (internal_sku, canonical_title)
       VALUES ($1, $2)
       RETURNING id`,
      [`test-sku-${randomUUID()}`, 'Consensus Test Product']
    );
    const productId = productRes.rows[0]?.id;
    if (!productId) {
      throw new Error('missing_product_id');
    }
    ids.productId = productId;

    const sourceA = await pool.query<{ id: string }>(
      `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
       VALUES ($1, 'scraping', 0.90, true, now(), now())
       RETURNING id`,
      [`test-source-a-${randomUUID()}`]
    );
    const sourceB = await pool.query<{ id: string }>(
      `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
       VALUES ($1, 'scraping', 0.60, true, now(), now())
       RETURNING id`,
      [`test-source-b-${randomUUID()}`]
    );
    const sourceAId = sourceA.rows[0]?.id;
    const sourceBId = sourceB.rows[0]?.id;
    if (!sourceAId || !sourceBId) {
      throw new Error('missing_source_id');
    }
    ids.sourceIds.push(sourceAId, sourceBId);

    const matchA = await pool.query<{ id: string }>(
      `INSERT INTO prod_similarity_matches (
         product_id,
         source_id,
         source_url,
         similarity_score,
         match_method,
         match_confidence,
         specs_extracted,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6::jsonb, now(), now())
       RETURNING id`,
      [
        ids.productId,
        ids.sourceIds[0],
        `https://example.test/${randomUUID()}`,
        0.9,
        'gtin_exact',
        JSON.stringify({
          category: 'Categoria-A',
          brand: 'Brand-A',
          specifications: [{ name: 'Color', value: 'Blue' }],
        }),
      ]
    );
    const matchB = await pool.query<{ id: string }>(
      `INSERT INTO prod_similarity_matches (
         product_id,
         source_id,
         source_url,
         similarity_score,
         match_method,
         match_confidence,
         specs_extracted,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6::jsonb, now(), now())
       RETURNING id`,
      [
        ids.productId,
        ids.sourceIds[1],
        `https://example.test/${randomUUID()}`,
        0.95,
        'gtin_exact',
        JSON.stringify({
          category: 'Categoria-B',
          brand: 'Brand-B',
          specifications: [{ name: 'Color', value: 'Red' }],
        }),
      ]
    );

    const matchAId = matchA.rows[0]?.id;
    const matchBId = matchB.rows[0]?.id;
    if (!matchAId || !matchBId) {
      throw new Error('missing_match_id');
    }
    ids.matchIds.push(matchAId, matchBId);
  });

  afterAll(async () => {
    if (ids.matchIds.length > 0) {
      await pool.query(`DELETE FROM prod_similarity_matches WHERE id = ANY($1::uuid[])`, [
        ids.matchIds,
      ]);
    }
    if (ids.productId) {
      await pool.query(`DELETE FROM prod_master WHERE id = $1`, [ids.productId]);
    }
    if (ids.sourceIds.length > 0) {
      await pool.query(`DELETE FROM prod_sources WHERE id = ANY($1::uuid[])`, [ids.sourceIds]);
    }
  });

  it('alege castigatorul ponderat pentru atribute non-critice', async () => {
    const result = await computeConsensus({ client: pool, productId: ids.productId! });
    expect(result.consensusSpecs['category']).toBe('Categoria-A');
    expect(result.needsReview).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});
