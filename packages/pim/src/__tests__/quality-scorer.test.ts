import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDbPool } from '../db.js';
import { computeConsensus, groupSpecsByAttribute } from '../services/consensus-engine.js';
import {
  calculateQualityScore,
  computeQualityBreakdown,
  getRequiredFieldsForTaxonomy,
} from '../services/quality-scorer.js';
import { getConfirmedMatchesWithSources } from '../repositories/similarity-matches.js';

const shouldSkip = !process.env['DATABASE_URL'];

describe('quality-scorer', { skip: shouldSkip }, () => {
  const pool = getDbPool();
  const ids: {
    taxonomyId?: string;
    productId?: string;
    sourceIds: string[];
    matchIds: string[];
  } = { sourceIds: [], matchIds: [] };

  beforeAll(async () => {
    const taxonomyRes = await pool.query<{ id: string }>(
      `INSERT INTO prod_taxonomy (name, slug, attribute_schema, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, now(), now())
       RETURNING id`,
      [
        'Test Taxonomy',
        `test-taxonomy-${randomUUID()}`,
        JSON.stringify({
          attributes: [
            { handle: 'brand', name: 'Brand' },
            { handle: 'category', name: 'Category' },
          ],
        }),
      ]
    );
    const taxonomyId = taxonomyRes.rows[0]?.id;
    if (!taxonomyId) {
      throw new Error('missing_taxonomy_id');
    }
    ids.taxonomyId = taxonomyId;

    const productRes = await pool.query<{ id: string }>(
      `INSERT INTO prod_master (internal_sku, canonical_title, taxonomy_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`test-sku-${randomUUID()}`, 'Quality Test Product', ids.taxonomyId]
    );
    const productId = productRes.rows[0]?.id;
    if (!productId) {
      throw new Error('missing_product_id');
    }
    ids.productId = productId;

    const sourceA = await pool.query<{ id: string }>(
      `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
       VALUES ($1, 'scraping', 0.85, true, now(), now())
       RETURNING id`,
      [`test-source-qa-${randomUUID()}`]
    );
    const sourceB = await pool.query<{ id: string }>(
      `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
       VALUES ($1, 'scraping', 0.80, true, now(), now())
       RETURNING id`,
      [`test-source-qb-${randomUUID()}`]
    );
    const sourceAId = sourceA.rows[0]?.id;
    const sourceBId = sourceB.rows[0]?.id;
    if (!sourceAId || !sourceBId) {
      throw new Error('missing_source_id');
    }
    ids.sourceIds.push(sourceAId, sourceBId);

    const specs = JSON.stringify({
      brand: 'Brand-X',
      category: 'Category-X',
      specifications: [{ name: 'Power', value: '100W' }],
    });

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
        0.92,
        'gtin_exact',
        specs,
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
        0.91,
        'gtin_exact',
        specs,
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
    if (ids.taxonomyId) {
      await pool.query(`DELETE FROM prod_taxonomy WHERE id = $1`, [ids.taxonomyId]);
    }
  });

  it('calculează corect completeness și scorul de calitate', async () => {
    const result = await computeConsensus({ client: pool, productId: ids.productId! });
    const matches = await getConfirmedMatchesWithSources(ids.productId!);
    const votes = groupSpecsByAttribute(matches);
    const requiredFields = await getRequiredFieldsForTaxonomy({
      client: pool,
      taxonomyId: ids.taxonomyId!,
    });
    const breakdown = computeQualityBreakdown({
      consensusSpecs: result.consensusSpecs,
      attributeVotes: votes,
      requiredFields,
      sourceCount: matches.length,
    });
    const score = calculateQualityScore(breakdown);

    expect(breakdown.completeness).toBe(1);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
