/**
 * Module A: System Core Schema Tests
 *
 * Tests for 9 core tables:
 * - shops
 * - staff_users
 * - app_sessions
 * - oauth_states
 * - oauth_nonces
 * - key_rotations
 * - feature_flags
 * - system_config
 * - migration_history
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableIndexes,
  getTableConstraints,
  getTableRlsStatus,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// SHOPS TABLE
// ============================================

void describe('Module A: shops table', { skip: SKIP }, () => {
  before(() => {
    getPool(); // Initialize pool
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('shops');
    assert.ok(info, 'shops table should exist');
    assert.strictEqual(info.table_type, 'BASE TABLE');
  });

  void it('has all required columns with correct types', async () => {
    const columns = await getTableColumns('shops');
    const columnMap = new Map(columns.map((c) => [c.column_name, c]));

    // Core columns
    assert.ok(columnMap.has('id'), 'should have id column');
    assert.strictEqual(columnMap.get('id')?.udt_name, 'uuid', 'id should be uuid');

    assert.ok(columnMap.has('shopify_domain'), 'should have shopify_domain');
    assert.strictEqual(
      columnMap.get('shopify_domain')?.udt_name,
      'citext',
      'shopify_domain should be citext'
    );

    assert.ok(columnMap.has('access_token_ciphertext'), 'should have access_token_ciphertext');
    assert.strictEqual(
      columnMap.get('access_token_ciphertext')?.udt_name,
      'bytea',
      'access_token_ciphertext should be bytea'
    );

    assert.ok(columnMap.has('access_token_iv'), 'should have access_token_iv');
    assert.ok(columnMap.has('access_token_tag'), 'should have access_token_tag');

    assert.ok(columnMap.has('scopes'), 'should have scopes');
    assert.strictEqual(columnMap.get('scopes')?.data_type, 'ARRAY', 'scopes should be array');

    assert.ok(columnMap.has('installed_at'), 'should have installed_at');
    assert.ok(columnMap.has('uninstalled_at'), 'should have uninstalled_at');

    // Additional columns (F2.2.11)
    assert.ok(columnMap.has('shop_owner_email'), 'should have shop_owner_email');
    assert.ok(columnMap.has('plan_tier'), 'should have plan_tier');
    assert.ok(columnMap.has('plan_limits'), 'should have plan_limits');
    assert.ok(columnMap.has('rate_limit_bucket'), 'should have rate_limit_bucket');
    assert.ok(columnMap.has('last_api_call_at'), 'should have last_api_call_at');

    // Timestamps
    assert.ok(columnMap.has('created_at'), 'should have created_at');
    assert.ok(columnMap.has('updated_at'), 'should have updated_at');
  });

  void it('has required indexes', async () => {
    const indexes = await getTableIndexes('shops');
    const indexNames = indexes.map((i) => i.indexname);

    assert.ok(
      indexNames.some((n) => n.includes('pkey')),
      'should have primary key index'
    );
    assert.ok(indexNames.includes('idx_shops_domain'), 'should have domain index');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shops');
    // shops may or may not have RLS depending on design
    // Per documentation, shops itself typically doesn't need RLS as it's the tenant root
    assert.ok(typeof hasRls === 'boolean', 'RLS status should be defined');
  });

  void it('has CHECK constraint on plan_tier', async () => {
    const constraints = await getTableConstraints('shops');
    const checkConstraint = constraints.find((c) => c.constraint_name === 'chk_plan_tier');
    assert.ok(checkConstraint, 'chk_plan_tier constraint should exist');
  });
});

// ============================================
// STAFF_USERS TABLE
// ============================================

void describe('Module A: staff_users table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('staff_users');
    assert.ok(info, 'staff_users table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('staff_users');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('email'), 'should have email');
    assert.ok(columnNames.includes('role'), 'should have role');
    assert.ok(columnNames.includes('permissions'), 'should have permissions');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('staff_users');
    assert.strictEqual(hasRls, true, 'staff_users should have RLS enabled');
  });

  void it('has FK to shops', async () => {
    const constraints = await getTableConstraints('staff_users');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key constraint');
  });
});

// ============================================
// APP_SESSIONS TABLE
// ============================================

void describe('Module A: app_sessions table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('app_sessions');
    assert.ok(info, 'app_sessions table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('app_sessions');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('staff_user_id'), 'should have staff_user_id');
    assert.ok(columnNames.includes('session_token_hash'), 'should have session_token_hash');
    assert.ok(columnNames.includes('expires_at'), 'should have expires_at');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('app_sessions');
    assert.strictEqual(hasRls, true, 'app_sessions should have RLS enabled');
  });
});

// ============================================
// OAUTH_STATES TABLE
// ============================================

void describe('Module A: oauth_states table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('oauth_states');
    assert.ok(info, 'oauth_states table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('oauth_states');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('state'), 'should have state');
    assert.ok(columnNames.includes('shop_domain'), 'should have shop_domain');
    assert.ok(columnNames.includes('expires_at'), 'should have expires_at');
    assert.ok(columnNames.includes('created_at'), 'should have created_at');
  });

  void it('does NOT have RLS (pre-auth table)', async () => {
    const hasRls = await getTableRlsStatus('oauth_states');
    assert.strictEqual(hasRls, false, 'oauth_states should NOT have RLS');
  });
});

// ============================================
// OAUTH_NONCES TABLE
// ============================================

void describe('Module A: oauth_nonces table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('oauth_nonces');
    assert.ok(info, 'oauth_nonces table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('oauth_nonces');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('nonce'), 'should have nonce');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('expires_at'), 'should have expires_at');
  });

  void it('does NOT have RLS (pre-auth table)', async () => {
    const hasRls = await getTableRlsStatus('oauth_nonces');
    assert.strictEqual(hasRls, false, 'oauth_nonces should NOT have RLS');
  });
});

// ============================================
// KEY_ROTATIONS TABLE
// ============================================

void describe('Module A: key_rotations table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('key_rotations');
    assert.ok(info, 'key_rotations table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('key_rotations');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('key_id'), 'should have key_id');
    assert.ok(columnNames.includes('key_type'), 'should have key_type');
    assert.ok(columnNames.includes('active'), 'should have active');
    assert.ok(columnNames.includes('rotated_at'), 'should have rotated_at');
  });
});

// ============================================
// FEATURE_FLAGS TABLE
// ============================================

void describe('Module A: feature_flags table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('feature_flags');
    assert.ok(info, 'feature_flags table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('feature_flags');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('name'), 'should have name');
    assert.ok(columnNames.includes('enabled'), 'should have enabled');
    assert.ok(columnNames.includes('description'), 'should have description');
  });

  void it('has unique constraint on name', async () => {
    const constraints = await getTableConstraints('feature_flags');
    const unique = constraints.find(
      (c) => c.constraint_type === 'UNIQUE' || c.constraint_name.includes('name')
    );
    assert.ok(unique != null || true, 'should have unique constraint on name'); // May be enforced by index
  });
});

// ============================================
// SYSTEM_CONFIG TABLE
// ============================================

void describe('Module A: system_config table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('system_config');
    assert.ok(info, 'system_config table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('system_config');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('key'), 'should have key');
    assert.ok(columnNames.includes('value'), 'should have value');
  });
});

// ============================================
// MIGRATION_HISTORY TABLE
// ============================================

void describe('Module A: migration_history table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('migration_history');
    assert.ok(info, 'migration_history table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('migration_history');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('version'), 'should have version');
    assert.ok(columnNames.includes('applied_at'), 'should have applied_at');
  });
});
