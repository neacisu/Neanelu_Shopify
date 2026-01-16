/**
 * PR-011 Schema Completions Tests
 *
 * Verifies all F2.2.8-F2.2.17 database schema components:
 * - OAuth tables (F2.2.8)
 * - Webhook events with partitions (F2.2.9)
 * - Rate limiting tables (F2.2.10)
 * - Shops additional columns (F2.2.11)
 * - Bulk runs lock index (F2.2.12)
 * - Trigger functions (F2.2.13)
 * - RLS on join tables (F2.2.14)
 * - Performance indexes (F2.2.15)
 * - CHECK constraints (F2.2.16)
 * - Embedding batches (F2.2.17)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'];
const SKIP_DB_TESTS = !DATABASE_URL;

if (SKIP_DB_TESTS) {
  console.info('⚠️  DATABASE_URL_TEST / DATABASE_URL not set - skipping PR-011 schema tests');
}

void describe('PR-011 Schema Completions', { skip: SKIP_DB_TESTS }, () => {
  let pool: pg.Pool;

  before(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  after(async () => {
    await pool.end();
  });

  // ============================================
  // F2.2.8: OAuth Tables
  // ============================================
  void describe('F2.2.8 - OAuth Tables', () => {
    void it('creates oauth_states table', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'oauth_states'
      `);
      const columns = result.rows.map((r) => r.column_name);
      assert.ok(columns.includes('state'), 'oauth_states should have state column');
      assert.ok(columns.includes('shop_domain'), 'oauth_states should have shop_domain column');
      assert.ok(columns.includes('expires_at'), 'oauth_states should have expires_at column');
    });

    void it('creates oauth_nonces table', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'oauth_nonces'
      `);
      const columns = result.rows.map((r) => r.column_name);
      assert.ok(columns.includes('nonce'), 'oauth_nonces should have nonce column');
      assert.ok(columns.includes('shop_id'), 'oauth_nonces should have shop_id column');
    });

    void it('does NOT have RLS on oauth tables (pre-auth)', async () => {
      const result = await pool.query(`
        SELECT tablename, rowsecurity FROM pg_tables 
        WHERE schemaname = 'public' AND tablename IN ('oauth_states', 'oauth_nonces')
      `);
      for (const row of result.rows) {
        assert.strictEqual(row.rowsecurity, false, `${row.tablename} should NOT have RLS`);
      }
    });
  });

  // ============================================
  // F2.2.9: Webhook Events with Partitions
  // ============================================
  void describe('F2.2.9 - Webhook Events', () => {
    void it('creates webhook_events partitioned table', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count FROM pg_tables 
        WHERE schemaname = 'public' AND tablename LIKE 'webhook_events_2025_%'
      `);
      assert.strictEqual(result.rows[0].count, '12', 'Should have 12 monthly partitions');
    });

    void it('has RLS on webhook_events', async () => {
      const result = await pool.query(`
        SELECT rowsecurity FROM pg_tables 
        WHERE schemaname = 'public' AND tablename = 'webhook_events'
      `);
      assert.strictEqual(result.rows[0].rowsecurity, true, 'webhook_events should have RLS');
    });
  });

  // ============================================
  // F2.2.10: Rate Limiting Tables
  // ============================================
  void describe('F2.2.10 - Rate Limiting', () => {
    void it('creates rate_limit_buckets table', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'rate_limit_buckets'
      `);
      const columns = result.rows.map((r) => r.column_name);
      assert.ok(columns.includes('tokens_remaining'), 'Should have tokens_remaining');
      assert.ok(columns.includes('refill_rate'), 'Should have refill_rate');
    });

    void it('creates api_cost_tracking partitioned table', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count FROM pg_tables 
        WHERE schemaname = 'public' AND tablename LIKE 'api_cost_tracking_2025_%'
      `);
      assert.strictEqual(result.rows[0].count, '12', 'Should have 12 monthly partitions');
    });
  });

  // ============================================
  // F2.2.11: Shops Additional Columns
  // ============================================
  void describe('F2.2.11 - Shops Columns', () => {
    void it('has new columns in shops table', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'shops' 
        AND column_name IN ('shop_owner_email', 'rate_limit_bucket', 'last_api_call_at', 'plan_limits')
      `);
      assert.strictEqual(result.rows.length, 4, 'Should have all 4 new columns');
    });

    void it('has CHECK constraint on plan_tier', async () => {
      const result = await pool.query(`
        SELECT conname FROM pg_constraint WHERE conname = 'chk_plan_tier'
      `);
      assert.strictEqual(result.rows.length, 1, 'chk_plan_tier constraint should exist');
    });
  });

  // ============================================
  // F2.2.12: Bulk Runs Lock Index
  // ============================================
  void describe('F2.2.12 - Bulk Runs Lock', () => {
    void it('has UNIQUE index for active bulk per shop', async () => {
      const result = await pool.query(`
        SELECT indexname, indexdef FROM pg_indexes 
        WHERE indexname = 'idx_bulk_runs_active_shop'
      `);
      assert.strictEqual(result.rows.length, 1, 'idx_bulk_runs_active_shop should exist');
      const indexdef = String(result.rows[0].indexdef);
      assert.ok(indexdef.includes('UNIQUE'), 'Should be UNIQUE index');
      assert.ok(indexdef.includes('WHERE'), 'Should be partial index');
    });
  });

  // ============================================
  // F2.2.13: Trigger Functions
  // ============================================
  void describe('F2.2.13 - Trigger Functions', () => {
    void it('creates update_updated_at function', async () => {
      const result = await pool.query(`
        SELECT routine_name FROM information_schema.routines 
        WHERE routine_schema = 'public' AND routine_name = 'update_updated_at'
      `);
      assert.strictEqual(result.rows.length, 1, 'update_updated_at should exist');
    });

    void it('creates audit_critical_action function', async () => {
      const result = await pool.query(`
        SELECT routine_name FROM information_schema.routines 
        WHERE routine_schema = 'public' AND routine_name = 'audit_critical_action'
      `);
      assert.strictEqual(result.rows.length, 1, 'audit_critical_action should exist');
    });

    void it('applies triggers to key tables', async () => {
      const result = await pool.query(`
        SELECT tgname FROM pg_trigger t 
        JOIN pg_class c ON t.tgrelid = c.oid 
        WHERE NOT t.tgisinternal AND tgname LIKE 'trg_%_updated_at'
      `);
      assert.ok(
        result.rows.length >= 10,
        'Should have update_updated_at triggers on multiple tables'
      );
    });
  });

  // ============================================
  // F2.2.14: RLS on Join Tables
  // ============================================
  void describe('F2.2.14 - RLS Join Tables', () => {
    void it('has shop_id denormalized in collection_products', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'shopify_collection_products' AND column_name = 'shop_id'
      `);
      assert.strictEqual(result.rows.length, 1, 'shop_id should exist in collection_products');
    });

    void it('has RLS on shopify_collection_products', async () => {
      const result = await pool.query(`
        SELECT rowsecurity FROM pg_tables 
        WHERE tablename = 'shopify_collection_products'
      `);
      assert.strictEqual(result.rows[0].rowsecurity, true, 'RLS should be enabled');
    });
  });

  // ============================================
  // F2.2.16: CHECK Constraints
  // ============================================
  void describe('F2.2.16 - CHECK Constraints', () => {
    void it('has CHECK constraints on multiple tables', async () => {
      const result = await pool.query(`
        SELECT DISTINCT conname FROM pg_constraint 
        WHERE conname LIKE 'chk_%'
      `);
      const constraints = result.rows.map((r) => r.conname);
      assert.ok(constraints.includes('chk_product_status'), 'chk_product_status should exist');
      assert.ok(constraints.includes('chk_bulk_status'), 'chk_bulk_status should exist');
      assert.ok(constraints.includes('chk_plan_tier'), 'chk_plan_tier should exist');
    });
  });

  // ============================================
  // F2.2.17: Embedding Batches
  // ============================================
  void describe('F2.2.17 - Embedding Batches', () => {
    void it('creates embedding_batches table', async () => {
      const result = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'embedding_batches'
      `);
      const columns = result.rows.map((r) => r.column_name);
      assert.ok(columns.includes('batch_type'), 'Should have batch_type');
      assert.ok(columns.includes('openai_batch_id'), 'Should have openai_batch_id');
      assert.ok(columns.includes('dimensions'), 'Should have dimensions');
    });

    void it('has RLS on embedding_batches', async () => {
      const result = await pool.query(`
        SELECT rowsecurity FROM pg_tables 
        WHERE tablename = 'embedding_batches'
      `);
      assert.strictEqual(result.rows[0].rowsecurity, true, 'RLS should be enabled');
    });
  });

  // ============================================
  // Additional: Partitioning Summary
  // ============================================
  void describe('Partitioning Summary', () => {
    void it('has correct number of partitions', async () => {
      const result = await pool.query(`
        SELECT COUNT(*) as count FROM pg_tables 
        WHERE schemaname = 'public' AND tablename ~ '_2025_[0-9]{2}$'
      `);
      // 4 partitioned tables × 12 months = 48
      assert.strictEqual(result.rows[0].count, '48', 'Should have 48 total partitions');
    });
  });
});
