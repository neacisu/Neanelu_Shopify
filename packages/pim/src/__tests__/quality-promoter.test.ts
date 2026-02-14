import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDbPool } from '../db.js';
import { applyQualityLevelChange, GOLDEN_MILESTONES } from '../services/quality-promoter.js';

// DB integration tests are opt-in. Default `pnpm test` should be mock/unit friendly.
const shouldSkip = process.env['PIM_TESTS_WITH_DB'] !== '1' || !process.env['DATABASE_URL'];

describe('quality-promoter', { skip: shouldSkip }, () => {
  let pool: ReturnType<typeof getDbPool> | null = null;
  const createdProductIds: string[] = [];

  const requirePool = () => {
    if (!pool) {
      throw new Error('missing_pool');
    }
    return pool;
  };

  const createProduct = async (
    level: 'bronze' | 'silver' | 'golden' | 'review_needed' = 'bronze'
  ) => {
    const db = requirePool();
    const result = await db.query<{ id: string }>(
      `INSERT INTO prod_master (internal_sku, canonical_title, data_quality_level, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       RETURNING id`,
      [`test-sku-${randomUUID()}`, `Quality Promoter ${level}`, level]
    );
    const productId = result.rows[0]?.id;
    if (!productId) {
      throw new Error('missing_product_id');
    }
    createdProductIds.push(productId);
    return productId;
  };

  const fetchMaster = async (productId: string) => {
    const db = requirePool();
    const result = await db.query<{
      data_quality_level: string;
      promoted_to_silver_at: string | null;
      promoted_to_golden_at: string | null;
      quality_score: number | null;
    }>(
      `SELECT data_quality_level, promoted_to_silver_at, promoted_to_golden_at, quality_score
         FROM prod_master
        WHERE id = $1`,
      [productId]
    );
    return result.rows[0];
  };

  const fetchLatestEvent = async (productId: string) => {
    const db = requirePool();
    const result = await db.query<{
      event_type: string;
      previous_level: string | null;
      new_level: string;
      quality_score_before: number | null;
      quality_score_after: number | null;
      trigger_reason: string;
      trigger_details: Record<string, unknown> | null;
      webhook_sent: boolean;
    }>(
      `SELECT event_type,
              previous_level,
              new_level,
              quality_score_before,
              quality_score_after,
              trigger_reason,
              trigger_details,
              webhook_sent
         FROM prod_quality_events
        WHERE product_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [productId]
    );
    return result.rows[0];
  };

  beforeAll(() => {
    if (shouldSkip) {
      return;
    }
    pool = getDbPool();
  });

  afterAll(async () => {
    if (!pool) {
      return;
    }
    if (createdProductIds.length > 0) {
      await pool.query(`DELETE FROM prod_quality_events WHERE product_id = ANY($1::uuid[])`, [
        createdProductIds,
      ]);
      await pool.query(`DELETE FROM prod_specs_normalized WHERE product_id = ANY($1::uuid[])`, [
        createdProductIds,
      ]);
      await pool.query(`DELETE FROM prod_master WHERE id = ANY($1::uuid[])`, [createdProductIds]);
    }
  });

  it('promotes bronze -> silver', async () => {
    const productId = await createProduct('bronze');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.65,
      sourceCount: 2,
      consensusSpecs: { brand: 'X', category: 'Y' },
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(true);
    expect(result.newLevel).toBe('silver');
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('silver');
    expect(master?.promoted_to_silver_at).not.toBeNull();
  });

  it('promotes silver -> golden', async () => {
    const productId = await createProduct('silver');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.9,
      sourceCount: 3,
      consensusSpecs: { gtin: '123', brand: 'X', mpn: 'M', category: 'C', color: 'red' },
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(true);
    expect(result.newLevel).toBe('golden');
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('golden');
    expect(master?.promoted_to_golden_at).not.toBeNull();
  });

  it('promotes bronze -> golden directly when golden thresholds are met', async () => {
    const productId = await createProduct('bronze');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.9,
      sourceCount: 3,
      consensusSpecs: { gtin: '123', brand: 'X', mpn: 'M', category: 'C', color: 'red' },
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(true);
    expect(result.newLevel).toBe('golden');
    const master = await fetchMaster(productId);
    expect(master?.promoted_to_silver_at).not.toBeNull();
    expect(master?.promoted_to_golden_at).not.toBeNull();
  });

  it('does not promote without enough sources', async () => {
    const productId = await createProduct('bronze');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.9,
      sourceCount: 1,
      consensusSpecs: { gtin: '123', brand: 'X', mpn: 'M', category: 'C', color: 'red' },
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(false);
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('bronze');
  });

  it('does not promote without required fields', async () => {
    const productId = await createProduct('bronze');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.9,
      sourceCount: 3,
      consensusSpecs: { gtin: '123', mpn: 'M', category: 'C' },
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(false);
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('bronze');
  });

  it('does not promote from review_needed', async () => {
    const productId = await createProduct('review_needed');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.95,
      sourceCount: 3,
      consensusSpecs: { gtin: '123', brand: 'X', mpn: 'M', category: 'C', color: 'red' },
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(false);
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('review_needed');
  });

  it('demotes golden -> silver when golden thresholds are not met', async () => {
    const productId = await createProduct('golden');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.7,
      sourceCount: 2,
      consensusSpecs: { brand: 'X', category: 'Y' },
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(true);
    expect(result.newLevel).toBe('silver');
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('silver');
    expect(master?.promoted_to_golden_at).toBeNull();
  });

  it('demotes silver -> bronze when silver thresholds are not met', async () => {
    const productId = await createProduct('silver');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.4,
      sourceCount: 1,
      consensusSpecs: {},
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(true);
    expect(result.newLevel).toBe('bronze');
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('bronze');
    expect(master?.promoted_to_silver_at).toBeNull();
  });

  it('does not demote when silver thresholds are still met', async () => {
    const productId = await createProduct('silver');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.7,
      sourceCount: 2,
      consensusSpecs: { brand: 'X', category: 'Y' },
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(false);
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('silver');
  });

  it('does not demote bronze', async () => {
    const productId = await createProduct('bronze');
    const db = requirePool();
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.1,
      sourceCount: 1,
      consensusSpecs: {},
      trigger: 'match_confirmed',
    });
    expect(result.changed).toBe(false);
    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('bronze');
  });

  it('logs full quality event fields', async () => {
    const productId = await createProduct('bronze');
    const db = requirePool();
    await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.65,
      sourceCount: 2,
      consensusSpecs: { brand: 'X', category: 'Y' },
      trigger: 'match_confirmed',
    });
    const event = await fetchLatestEvent(productId);
    expect(event?.event_type).toBe('quality_promoted');
    expect(event?.previous_level).toBe('bronze');
    expect(event?.new_level).toBe('silver');
    expect(event?.quality_score_before).toBeNull();
    expect(event?.quality_score_after).toBeTruthy();
    expect(event?.trigger_reason).toBe('match_confirmed');
    expect(event?.trigger_details).toBeTruthy();
    expect(event?.webhook_sent).toBe(false);
  });

  it('rolls back update when event logging fails inside transaction', async () => {
    const db = requirePool();
    const productId = await createProduct('bronze');
    const client = await db.connect();
    await client.query('BEGIN');

    const wrappedClient: {
      query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
    } = {
      query: async <T = unknown>(sql: string, values?: readonly unknown[]) => {
        if (sql.includes('INSERT INTO prod_quality_events')) {
          throw new Error('forced_insert_failure');
        }
        return client.query(sql, (values ?? []) as unknown[]) as unknown as Promise<{ rows: T[] }>;
      },
    };

    try {
      await applyQualityLevelChange({
        client: wrappedClient,
        productId,
        qualityScore: 0.65,
        sourceCount: 2,
        consensusSpecs: { brand: 'X', category: 'Y' },
        trigger: 'match_confirmed',
      });
      throw new Error('expected_failure');
    } catch (_error) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const master = await fetchMaster(productId);
    expect(master?.data_quality_level).toBe('bronze');
  });

  it('logs milestone event at golden record milestone', async () => {
    const db = requirePool();
    const countRes = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count
         FROM prod_master
        WHERE data_quality_level = 'golden'`
    );
    const currentCount = Number(countRes.rows[0]?.count ?? 0);
    const target = GOLDEN_MILESTONES.find((m) => m > currentCount);
    if (!target) {
      return;
    }

    const needed = target - currentCount - 1;
    for (let i = 0; i < needed; i += 1) {
      await createProduct('golden');
    }

    const productId = await createProduct('bronze');
    await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.95,
      sourceCount: 3,
      consensusSpecs: { gtin: '123', brand: 'X', mpn: 'M', category: 'C', color: 'red' },
      trigger: 'match_confirmed',
    });

    const result = await db.query<{ event_type: string; trigger_details: Record<string, unknown> }>(
      `SELECT event_type, trigger_details
         FROM prod_quality_events
        WHERE product_id = $1
          AND event_type = 'milestone_reached'
        ORDER BY created_at DESC
        LIMIT 1`,
      [productId]
    );
    const event = result.rows[0];
    expect(event?.event_type).toBe('milestone_reached');
    expect(event?.trigger_details?.['milestone']).toBe(target);
  });

  it('calls onEventCreated callback after event is persisted', async () => {
    const productId = await createProduct('bronze');
    const db = requirePool();
    const captured: string[] = [];
    const result = await applyQualityLevelChange({
      client: db,
      productId,
      qualityScore: 0.65,
      sourceCount: 2,
      consensusSpecs: { brand: 'X', category: 'Y' },
      trigger: 'match_confirmed',
      shopId: '00000000-0000-0000-0000-000000000001',
      onEventCreated: (eventId) => {
        captured.push(eventId);
      },
    });

    expect(result.changed).toBe(true);
    expect(captured.length).toBe(1);
    expect(captured[0]).toBeTruthy();
  });
});
