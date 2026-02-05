import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { pool } from '@app/database';
import { computeConsensus } from '../../../../../../packages/pim/src/services/consensus-engine.js';

void describe('consensus integration', () => {
  const ids: {
    productId?: string;
    sourceIds: string[];
    matchIds: string[];
  } = { sourceIds: [], matchIds: [] };

  before(async () => {
    const productRes = await pool.query<{ id: string }>(
      `INSERT INTO prod_master (internal_sku, canonical_title)
       VALUES ($1, $2)
       RETURNING id`,
      [`int-sku-${randomUUID()}`, 'Integration Consensus Product']
    );
    const productId = productRes.rows[0]?.id;
    if (!productId) {
      throw new Error('missing_product_id');
    }
    ids.productId = productId;

    const sourceA = await pool.query<{ id: string }>(
      `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
       VALUES ($1, 'scraping', 0.92, true, now(), now())
       RETURNING id`,
      [`int-source-a-${randomUUID()}`]
    );
    const sourceB = await pool.query<{ id: string }>(
      `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
       VALUES ($1, 'scraping', 0.70, true, now(), now())
       RETURNING id`,
      [`int-source-b-${randomUUID()}`]
    );
    const sourceC = await pool.query<{ id: string }>(
      `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
       VALUES ($1, 'scraping', 0.60, true, now(), now())
       RETURNING id`,
      [`int-source-c-${randomUUID()}`]
    );
    const sourceAId = sourceA.rows[0]?.id;
    const sourceBId = sourceB.rows[0]?.id;
    const sourceCId = sourceC.rows[0]?.id;
    if (!sourceAId || !sourceBId || !sourceCId) {
      throw new Error('missing_source_id');
    }
    ids.sourceIds.push(sourceAId, sourceBId, sourceCId);

    const commonSpecs = {
      category: 'Categorie-Integrata',
      specifications: [{ name: 'Greutate', value: '2kg' }],
    };

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
        0.96,
        'gtin_exact',
        JSON.stringify({ ...commonSpecs, brand: 'Brand-A' }),
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
        0.93,
        'gtin_exact',
        JSON.stringify({ ...commonSpecs, brand: 'Brand-B' }),
      ]
    );
    const matchC = await pool.query<{ id: string }>(
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
        ids.sourceIds[2],
        `https://example.test/${randomUUID()}`,
        0.91,
        'gtin_exact',
        JSON.stringify({ ...commonSpecs, brand: 'Brand-C' }),
      ]
    );
    const matchAId = matchA.rows[0]?.id;
    const matchBId = matchB.rows[0]?.id;
    const matchCId = matchC.rows[0]?.id;
    if (!matchAId || !matchBId || !matchCId) {
      throw new Error('missing_match_id');
    }
    ids.matchIds.push(matchAId, matchBId, matchCId);
  });

  after(async () => {
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

  void test('computeConsensus returnează scor, provenance și conflicte', async () => {
    const result = await computeConsensus({ client: pool, productId: ids.productId! });
    const specs = result.consensusSpecs as { category?: string };
    assert.ok(result.qualityScore >= 0);
    assert.ok(result.qualityScore <= 1);
    assert.ok(specs.category);
    assert.ok(Object.keys(result.provenance).length > 0);
    assert.ok(Array.isArray(result.conflicts));
  });
});
