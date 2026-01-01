/**
 * Module A RLS Tests: System Core
 *
 * Tests RLS policies for:
 * - staff_users
 * - app_sessions
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import type pg from 'pg';
import {
  getPool,
  closePool,
  shouldSkipDbTests,
  setTenantContext,
  TEST_SHOP_A,
  TEST_SHOP_B,
} from '../helpers/test-utils.ts';
import { getTablePolicies, getTableRlsStatus } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// RLS STATUS VERIFICATION
// ============================================

void describe('Module A RLS: Status Verification', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('staff_users has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('staff_users');
    assert.strictEqual(hasRls, true, 'staff_users should have RLS enabled');
  });

  void it('app_sessions has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('app_sessions');
    assert.strictEqual(hasRls, true, 'app_sessions should have RLS enabled');
  });

  void it('oauth_states does NOT have RLS (pre-auth)', async () => {
    const hasRls = await getTableRlsStatus('oauth_states');
    assert.strictEqual(hasRls, false, 'oauth_states should NOT have RLS');
  });

  void it('oauth_nonces does NOT have RLS (pre-auth)', async () => {
    const hasRls = await getTableRlsStatus('oauth_nonces');
    assert.strictEqual(hasRls, false, 'oauth_nonces should NOT have RLS');
  });
});

// ============================================
// POLICY VERIFICATION
// ============================================

void describe('Module A RLS: Policy Verification', { skip: SKIP }, () => {
  void it('staff_users has at least one policy', async () => {
    const policies = await getTablePolicies('staff_users');
    assert.ok(policies.length >= 1, 'staff_users should have at least one RLS policy');
  });

  void it('app_sessions has at least one policy', async () => {
    const policies = await getTablePolicies('app_sessions');
    assert.ok(policies.length >= 1, 'app_sessions should have at least one RLS policy');
  });

  void it('staff_users policy references shop_id', async () => {
    const policies = await getTablePolicies('staff_users');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'staff_users policy should reference shop_id');
  });
});

// ============================================
// TENANT ISOLATION TESTS
// ============================================

void describe('Module A RLS: Tenant Isolation', { skip: SKIP }, () => {
  let pool: pg.Pool;

  before(async () => {
    pool = getPool();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create test role if not exists
      await client.query(`
        DO $$ BEGIN
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
          ($1, 'rls-test-a.myshopify.com', '\\x00', '\\x00', '\\x00', '{}'),
          ($2, 'rls-test-b.myshopify.com', '\\x00', '\\x00', '\\x00', '{}')
        ON CONFLICT (shopify_domain) DO NOTHING
      `,
        [TEST_SHOP_A, TEST_SHOP_B]
      );

      // Grant permissions
      await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON staff_users TO test_rls');
      await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON app_sessions TO test_rls');

      // Create test staff users
      await setTenantContext(client, TEST_SHOP_A);
      await client.query(
        `
        INSERT INTO staff_users (id, shop_id, email, role, permissions)
        VALUES (uuidv7(), $1, 'admin-a@test.com', 'admin', '{}')
        ON CONFLICT DO NOTHING
      `,
        [TEST_SHOP_A]
      );

      await setTenantContext(client, TEST_SHOP_B);
      await client.query(
        `
        INSERT INTO staff_users (id, shop_id, email, role, permissions)
        VALUES (uuidv7(), $1, 'admin-b@test.com', 'admin', '{}')
        ON CONFLICT DO NOTHING
      `,
        [TEST_SHOP_B]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM app_sessions WHERE shop_id IN ($1, $2)', [
        TEST_SHOP_A,
        TEST_SHOP_B,
      ]);
      await client.query('DELETE FROM staff_users WHERE shop_id IN ($1, $2)', [
        TEST_SHOP_A,
        TEST_SHOP_B,
      ]);
      await client.query("DELETE FROM shops WHERE shopify_domain LIKE 'rls-test-%'");
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    await closePool();
  });

  void it('Shop A cannot see Shop B staff_users', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');
      await setTenantContext(client, TEST_SHOP_A);

      const result = await client.query('SELECT * FROM staff_users');

      await client.query('COMMIT');

      for (const row of result.rows) {
        assert.strictEqual(row.shop_id, TEST_SHOP_A, 'Should only see Shop A staff');
      }
    } finally {
      client.release();
    }
  });

  void it('Without context, staff_users returns empty', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');

      const result = await client.query('SELECT * FROM staff_users');

      await client.query('COMMIT');

      assert.strictEqual(result.rows.length, 0, 'Should return empty without context');
    } finally {
      client.release();
    }
  });
});
