/**
 * RLS Tenant Isolation Integration Tests
 *
 * Tests actual tenant isolation behavior by:
 * - Inserting data for multiple tenants
 * - Verifying cross-tenant access is blocked
 * - Testing context reset behavior
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import type pg from 'pg';
import {
  getPool,
  closePool,
  shouldSkipDbTests,
  setTenantContext,
  clearTenantContext,
  TEST_SHOP_A,
  TEST_SHOP_B,
} from '../helpers/test-utils.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// TEST SETUP
// ============================================

void describe('RLS Tenant Isolation Integration', { skip: SKIP }, () => {
  let pool: pg.Pool;

  before(async () => {
    pool = getPool();

    // Setup: Create test shops and test data
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create test_rls role if not exists
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_rls') THEN
            CREATE ROLE test_rls;
          END IF;
        END $$;
      `);

      // Create test shops
      await client.query(
        `
        INSERT INTO shops (id, shopify_domain, access_token_ciphertext, access_token_iv, access_token_tag, scopes)
        VALUES 
          ($1, 'test-shop-a.myshopify.com', '\\x00', '\\x00', '\\x00', '{}'),
          ($2, 'test-shop-b.myshopify.com', '\\x00', '\\x00', '\\x00', '{}')
        ON CONFLICT (shopify_domain) DO NOTHING
      `,
        [TEST_SHOP_A, TEST_SHOP_B]
      );

      // Grant permissions
      await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON shopify_products TO test_rls');

      // Insert test products
      await setTenantContext(client, TEST_SHOP_A);
      await client.query(
        `
        INSERT INTO shopify_products (id, shop_id, shopify_gid, legacy_resource_id, title, handle, status)
        VALUES (uuidv7(), $1, 'gid://shopify/Product/test-a', 10001, 'Test Product A', 'test-a', 'ACTIVE')
        ON CONFLICT DO NOTHING
      `,
        [TEST_SHOP_A]
      );

      await setTenantContext(client, TEST_SHOP_B);
      await client.query(
        `
        INSERT INTO shopify_products (id, shop_id, shopify_gid, legacy_resource_id, title, handle, status)
        VALUES (uuidv7(), $1, 'gid://shopify/Product/test-b', 10002, 'Test Product B', 'test-b', 'ACTIVE')
        ON CONFLICT DO NOTHING
      `,
        [TEST_SHOP_B]
      );

      await client.query('COMMIT');
    } catch (_e) {
      await client.query('ROLLBACK');
      throw _e;
    } finally {
      client.release();
    }
  });

  after(async () => {
    // Cleanup
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM shopify_products WHERE shop_id IN ($1, $2)', [
        TEST_SHOP_A,
        TEST_SHOP_B,
      ]);
      await client.query('DELETE FROM shops WHERE id IN ($1, $2)', [TEST_SHOP_A, TEST_SHOP_B]);
      await client.query('COMMIT');
    } catch (_e) {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    await closePool();
  });

  // ============================================
  // TC-RLS-001: Basic Tenant Isolation
  // ============================================

  void it('TC-RLS-001: returns zero rows without tenant context', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');

      // Without context, should return no rows
      const result = await client.query('SELECT * FROM shopify_products');

      await client.query('COMMIT');

      assert.strictEqual(result.rows.length, 0, 'Should return 0 rows without context');
    } finally {
      client.release();
    }
  });

  // ============================================
  // TC-RLS-002: Cross-Tenant Access Prevention
  // ============================================

  void it('TC-RLS-002: Shop A cannot see Shop B data', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');
      await setTenantContext(client, TEST_SHOP_A);

      const result = await client.query('SELECT * FROM shopify_products');

      await client.query('COMMIT');

      // Should only see Shop A's products
      assert.ok(result.rows.length >= 1, 'Should see at least 1 product');
      for (const row of result.rows) {
        assert.strictEqual(row.shop_id, TEST_SHOP_A, 'All rows should belong to Shop A');
      }
    } finally {
      client.release();
    }
  });

  void it('TC-RLS-002: Shop B cannot see Shop A data', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');
      await setTenantContext(client, TEST_SHOP_B);

      const result = await client.query('SELECT * FROM shopify_products');

      await client.query('COMMIT');

      // Should only see Shop B's products
      assert.ok(result.rows.length >= 1, 'Should see at least 1 product');
      for (const row of result.rows) {
        assert.strictEqual(row.shop_id, TEST_SHOP_B, 'All rows should belong to Shop B');
      }
    } finally {
      client.release();
    }
  });

  // ============================================
  // TC-RLS-003: Context Reset
  // ============================================

  void it('TC-RLS-003: Clearing context resets isolation', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');

      // Set context to Shop A
      await setTenantContext(client, TEST_SHOP_A);
      const resultA = await client.query('SELECT COUNT(*) as count FROM shopify_products');

      // Clear context
      await clearTenantContext(client);
      const resultClear = await client.query('SELECT COUNT(*) as count FROM shopify_products');

      await client.query('COMMIT');

      assert.ok(parseInt(String(resultA.rows[0].count)) >= 1, 'Should see products with context');
      assert.strictEqual(
        parseInt(String(resultClear.rows[0].count)),
        0,
        'Should see 0 products without context'
      );
    } finally {
      client.release();
    }
  });

  // ============================================
  // TC-RLS-004: UPDATE Isolation
  // ============================================

  void it('TC-RLS-004: Cannot UPDATE other tenant data', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');
      await setTenantContext(client, TEST_SHOP_A);

      // Try to update Shop B's product (should affect 0 rows)
      const result = await client.query(
        `
        UPDATE shopify_products 
        SET title = 'Hacked!' 
        WHERE shop_id = $1
        RETURNING *
      `,
        [TEST_SHOP_B]
      );

      await client.query('ROLLBACK');

      assert.strictEqual(result.rows.length, 0, 'Should not update any rows from other tenant');
    } finally {
      client.release();
    }
  });

  // ============================================
  // TC-RLS-005: DELETE Isolation
  // ============================================

  void it('TC-RLS-005: Cannot DELETE other tenant data', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');
      await setTenantContext(client, TEST_SHOP_A);

      // Try to delete Shop B's product (should affect 0 rows)
      const result = await client.query(
        `
        DELETE FROM shopify_products 
        WHERE shop_id = $1
        RETURNING *
      `,
        [TEST_SHOP_B]
      );

      await client.query('ROLLBACK');

      assert.strictEqual(result.rows.length, 0, 'Should not delete any rows from other tenant');
    } finally {
      client.release();
    }
  });

  // ============================================
  // TC-RLS-006: INSERT Validation
  // ============================================

  void it('TC-RLS-006: Can INSERT for own tenant', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');
      await setTenantContext(client, TEST_SHOP_A);

      // Insert for own shop should work
      const result = await client.query(
        `
        INSERT INTO shopify_products (id, shop_id, shopify_gid, legacy_resource_id, title, handle, status)
        VALUES (uuidv7(), $1, 'gid://shopify/Product/insert-test', 99999, 'Insert Test', 'insert-test', 'DRAFT')
        RETURNING *
      `,
        [TEST_SHOP_A]
      );

      await client.query('ROLLBACK');

      assert.strictEqual(result.rows.length, 1, 'Should insert 1 row for own tenant');
    } finally {
      client.release();
    }
  });
});
