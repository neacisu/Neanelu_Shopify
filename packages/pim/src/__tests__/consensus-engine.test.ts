import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDbPool } from '../db.js';
import { computeConsensus, mergeWithExistingSpecs } from '../services/consensus-engine.js';

const shouldSkip = !process.env['DATABASE_URL'];

describe('consensus-engine', { skip: shouldSkip }, () => {
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
    expect(result.consensusSpecs['category']).toBeUndefined();
    expect(result.needsReview).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('calculeaza weighted average pentru numerice si majority voting pentru categorice', async () => {
    const productIds: string[] = [];
    const sourceIds: string[] = [];
    const matchIds: string[] = [];
    try {
      const productRes = await pool.query<{ id: string }>(
        `INSERT INTO prod_master (internal_sku, canonical_title)
         VALUES ($1, $2)
         RETURNING id`,
        [`test-sku-${randomUUID()}`, 'Consensus Numeric Product']
      );
      const productId = productRes.rows[0]?.id;
      if (!productId) {
        throw new Error('missing_product_id');
      }
      productIds.push(productId);

      const sourceA = await pool.query<{ id: string }>(
        `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
         VALUES ($1, 'scraping', 0.90, true, now(), now())
         RETURNING id`,
        [`test-num-source-a-${randomUUID()}`]
      );
      const sourceB = await pool.query<{ id: string }>(
        `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
         VALUES ($1, 'scraping', 0.60, true, now(), now())
         RETURNING id`,
        [`test-num-source-b-${randomUUID()}`]
      );
      const sourceC = await pool.query<{ id: string }>(
        `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
         VALUES ($1, 'scraping', 0.80, true, now(), now())
         RETURNING id`,
        [`test-num-source-c-${randomUUID()}`]
      );
      const sourceAId = sourceA.rows[0]?.id;
      const sourceBId = sourceB.rows[0]?.id;
      const sourceCId = sourceC.rows[0]?.id;
      if (!sourceAId || !sourceBId || !sourceCId) {
        throw new Error('missing_source_id');
      }
      sourceIds.push(sourceAId, sourceBId, sourceCId);

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
          productId,
          sourceAId,
          `https://example.test/${randomUUID()}`,
          0.9,
          'gtin_exact',
          JSON.stringify({
            brand: 'Brand-A',
            price: { amount: 100 },
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
          productId,
          sourceBId,
          `https://example.test/${randomUUID()}`,
          0.9,
          'gtin_exact',
          JSON.stringify({
            brand: 'Brand-A',
            price: { amount: 110 },
          }),
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
          productId,
          sourceCId,
          `https://example.test/${randomUUID()}`,
          0.9,
          'gtin_exact',
          JSON.stringify({
            brand: 'Brand-B',
            price: { amount: 120 },
          }),
        ]
      );
      const matchAId = matchA.rows[0]?.id;
      const matchBId = matchB.rows[0]?.id;
      const matchCId = matchC.rows[0]?.id;
      if (!matchAId || !matchBId || !matchCId) {
        throw new Error('missing_match_id');
      }
      matchIds.push(matchAId, matchBId, matchCId);

      const result = await computeConsensus({ client: pool, productId });
      const price = result.consensusSpecs['price'];
      expect(typeof price).toBe('number');
      expect(price as number).toBeCloseTo(109.57, 2);
      expect(result.consensusSpecs['brand']).toBe('Brand-A');
    } finally {
      if (matchIds.length > 0) {
        await pool.query(`DELETE FROM prod_similarity_matches WHERE id = ANY($1::uuid[])`, [
          matchIds,
        ]);
      }
      if (productIds.length > 0) {
        await pool.query(`DELETE FROM prod_master WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      if (sourceIds.length > 0) {
        await pool.query(`DELETE FROM prod_sources WHERE id = ANY($1::uuid[])`, [sourceIds]);
      }
    }
  });

  it('respinge explicit single-source pentru campuri critice', async () => {
    const productIds: string[] = [];
    const sourceIds: string[] = [];
    const matchIds: string[] = [];
    try {
      const productRes = await pool.query<{ id: string }>(
        `INSERT INTO prod_master (internal_sku, canonical_title)
         VALUES ($1, $2)
         RETURNING id`,
        [`test-sku-${randomUUID()}`, 'Consensus Single Source']
      );
      const productId = productRes.rows[0]?.id;
      if (!productId) {
        throw new Error('missing_product_id');
      }
      productIds.push(productId);

      const source = await pool.query<{ id: string }>(
        `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
         VALUES ($1, 'scraping', 0.90, true, now(), now())
         RETURNING id`,
        [`test-single-source-${randomUUID()}`]
      );
      const sourceId = source.rows[0]?.id;
      if (!sourceId) {
        throw new Error('missing_source_id');
      }
      sourceIds.push(sourceId);

      const match = await pool.query<{ id: string }>(
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
          productId,
          sourceId,
          `https://example.test/${randomUUID()}`,
          0.95,
          'gtin_exact',
          JSON.stringify({
            brand: 'Brand-Single',
          }),
        ]
      );
      const matchId = match.rows[0]?.id;
      if (!matchId) {
        throw new Error('missing_match_id');
      }
      matchIds.push(matchId);

      const result = await computeConsensus({ client: pool, productId });
      expect(result.consensusSpecs['brand']).toBeUndefined();
      expect(
        result.conflicts.some(
          (conflict) =>
            conflict.attributeName === 'brand' && conflict.reason === 'single_source_critical_field'
        )
      ).toBe(true);
    } finally {
      if (matchIds.length > 0) {
        await pool.query(`DELETE FROM prod_similarity_matches WHERE id = ANY($1::uuid[])`, [
          matchIds,
        ]);
      }
      if (productIds.length > 0) {
        await pool.query(`DELETE FROM prod_master WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      if (sourceIds.length > 0) {
        await pool.query(`DELETE FROM prod_sources WHERE id = ANY($1::uuid[])`, [sourceIds]);
      }
    }
  });

  it('respecta manual corrections granular in mergeWithExistingSpecs', async () => {
    const productIds: string[] = [];
    try {
      const productRes = await pool.query<{ id: string }>(
        `INSERT INTO prod_master (internal_sku, canonical_title)
         VALUES ($1, $2)
         RETURNING id`,
        [`test-sku-${randomUUID()}`, 'Consensus Manual Corrections']
      );
      const productId = productRes.rows[0]?.id;
      if (!productId) {
        throw new Error('missing_product_id');
      }
      productIds.push(productId);

      await pool.query(
        `INSERT INTO prod_specs_normalized (
          product_id,
          specs,
          raw_specs,
          provenance,
          version,
          is_current,
          needs_review,
          review_reason,
          created_at,
          updated_at
        )
        VALUES ($1, $2::jsonb, NULL, $3::jsonb, $4, true, false, NULL, now(), now())`,
        [
          productId,
          JSON.stringify({ brand: 'ManualBrand', category: 'ManualCategory' }),
          JSON.stringify({ brand: { manuallyEdited: true } }),
          1,
        ]
      );

      const merged = await mergeWithExistingSpecs({
        client: pool,
        productId,
        consensusSpecs: { brand: 'ConsensusBrand', category: 'ConsensusCategory' },
        provenance: {},
      });

      expect(merged.merged['brand']).toBe('ManualBrand');
      expect(merged.merged['category']).toBe('ConsensusCategory');
      expect(merged.skipped).toContain('brand');
    } finally {
      if (productIds.length > 0) {
        await pool.query(`DELETE FROM prod_specs_normalized WHERE product_id = ANY($1::uuid[])`, [
          productIds,
        ]);
        await pool.query(`DELETE FROM prod_master WHERE id = ANY($1::uuid[])`, [productIds]);
      }
    }
  });

  it('marcheaza conflictele cu autoResolveDisabled si nu seteaza campul in consensusSpecs', async () => {
    const productIds: string[] = [];
    const sourceIds: string[] = [];
    const matchIds: string[] = [];
    try {
      const productRes = await pool.query<{ id: string }>(
        `INSERT INTO prod_master (internal_sku, canonical_title)
         VALUES ($1, $2)
         RETURNING id`,
        [`test-sku-${randomUUID()}`, 'Consensus Auto Resolve']
      );
      const productId = productRes.rows[0]?.id;
      if (!productId) {
        throw new Error('missing_product_id');
      }
      productIds.push(productId);

      const sourceA = await pool.query<{ id: string }>(
        `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
         VALUES ($1, 'scraping', 1.0, true, now(), now())
         RETURNING id`,
        [`test-auto-source-a-${randomUUID()}`]
      );
      const sourceB = await pool.query<{ id: string }>(
        `INSERT INTO prod_sources (name, source_type, trust_score, is_active, created_at, updated_at)
         VALUES ($1, 'scraping', 0.9, true, now(), now())
         RETURNING id`,
        [`test-auto-source-b-${randomUUID()}`]
      );
      const sourceAId = sourceA.rows[0]?.id;
      const sourceBId = sourceB.rows[0]?.id;
      if (!sourceAId || !sourceBId) {
        throw new Error('missing_source_id');
      }
      sourceIds.push(sourceAId, sourceBId);

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
          productId,
          sourceAId,
          `https://example.test/${randomUUID()}`,
          1.0,
          'gtin_exact',
          JSON.stringify({ category: 'Cat-A' }),
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
          productId,
          sourceBId,
          `https://example.test/${randomUUID()}`,
          1.0,
          'gtin_exact',
          JSON.stringify({ category: 'Cat-B' }),
        ]
      );
      const matchAId = matchA.rows[0]?.id;
      const matchBId = matchB.rows[0]?.id;
      if (!matchAId || !matchBId) {
        throw new Error('missing_match_id');
      }
      matchIds.push(matchAId, matchBId);

      const result = await computeConsensus({ client: pool, productId });
      expect(result.consensusSpecs['category']).toBeUndefined();
      expect(
        result.conflicts.some(
          (conflict) => conflict.attributeName === 'category' && conflict.autoResolveDisabled
        )
      ).toBe(true);
    } finally {
      if (matchIds.length > 0) {
        await pool.query(`DELETE FROM prod_similarity_matches WHERE id = ANY($1::uuid[])`, [
          matchIds,
        ]);
      }
      if (productIds.length > 0) {
        await pool.query(`DELETE FROM prod_master WHERE id = ANY($1::uuid[])`, [productIds]);
      }
      if (sourceIds.length > 0) {
        await pool.query(`DELETE FROM prod_sources WHERE id = ANY($1::uuid[])`, [sourceIds]);
      }
    }
  });
});
