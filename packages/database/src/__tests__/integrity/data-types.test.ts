/**
 * Data Types Integrity Tests
 *
 * Verifies correct data types for all ~1121 columns across 67 tables.
 * Ensures consistency between schema and documentation.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTableColumns, getAllTables } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Expected data types for critical columns (verified from migrations + canonical decisions)
const CRITICAL_COLUMN_TYPES: Record<string, Record<string, string>> = {
  shops: {
    id: 'uuid',
    shopify_domain: 'citext',
    access_token_ciphertext: 'bytea',
    access_token_iv: 'bytea',
    access_token_tag: 'bytea',
    scopes: 'ARRAY',
    plan_tier: 'varchar',
    settings: 'jsonb',
    created_at: 'timestamptz',
    updated_at: 'timestamptz',
  },
  shopify_products: {
    id: 'uuid',
    shop_id: 'uuid',
    shopify_gid: 'varchar',
    legacy_resource_id: 'int8',
    title: 'text',
    handle: 'varchar',
    status: 'varchar',
    metafields: 'jsonb',
    tags: 'ARRAY',
  },
  shopify_variants: {
    id: 'uuid',
    shop_id: 'uuid',
    product_id: 'uuid',
    price: 'numeric',
    compare_at_price: 'numeric',
    inventory_quantity: 'int4',
  },
  prod_master: {
    id: 'uuid',
    quality_score: 'numeric',
  },
  prod_embeddings: {
    id: 'uuid',
    embedding: 'vector',
  },
  shop_product_embeddings: {
    id: 'uuid',
    shop_id: 'uuid',
    embedding: 'vector',
  },
  bulk_runs: {
    id: 'uuid',
    shop_id: 'uuid',
    operation_type: 'varchar',
    status: 'varchar',
  },
  audit_logs: {
    id: 'uuid',
    shop_id: 'uuid',
    details: 'jsonb',
  },
};

// ============================================
// DATA TYPES SUMMARY
// ============================================

void describe('Data Types: Summary', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('all tables have at least one column', async () => {
    const tables = await getAllTables();

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      assert.ok(columns.length > 0, `${table.table_name} should have at least one column`);
    }
  });

  void it('total column count is approximately 1121', async () => {
    const tables = await getAllTables();
    let totalColumns = 0;

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      totalColumns += columns.length;
    }

    // Allow variance as schema evolves; exclude partitions are already filtered in helpers
    assert.ok(
      totalColumns >= 1100 && totalColumns <= 1150,
      `Total columns ${totalColumns} should be in range 1100-1150`
    );
  });
});

// ============================================
// UUID COLUMNS
// ============================================

void describe('Data Types: UUID Columns', { skip: SKIP }, () => {
  void it('all id columns are UUID type', async () => {
    const tables = await getAllTables();

    // Known non-UUID ids (intentional)
    const ID_TYPE_EXCEPTIONS: Record<string, string> = {
      app_sessions: 'varchar',
    };

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      const idColumn = columns.find((c) => c.column_name === 'id');

      if (idColumn) {
        const expected = ID_TYPE_EXCEPTIONS[table.table_name];
        if (expected) {
          assert.strictEqual(
            idColumn.udt_name,
            expected,
            `${table.table_name}.id should be ${expected}, got ${idColumn.udt_name}`
          );
          continue;
        }

        assert.strictEqual(
          idColumn.udt_name,
          'uuid',
          `${table.table_name}.id should be uuid, got ${idColumn.udt_name}`
        );
      }
    }
  });

  void it('all shop_id columns are UUID type', async () => {
    const tables = await getAllTables();

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      const shopIdColumn = columns.find((c) => c.column_name === 'shop_id');

      if (shopIdColumn) {
        assert.strictEqual(
          shopIdColumn.udt_name,
          'uuid',
          `${table.table_name}.shop_id should be uuid, got ${shopIdColumn.udt_name}`
        );
      }
    }
  });
});

// ============================================
// TIMESTAMP COLUMNS
// ============================================

void describe('Data Types: Timestamp Columns', { skip: SKIP }, () => {
  void it('created_at columns are timestamptz', async () => {
    const tables = await getAllTables();

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      const createdAt = columns.find((c) => c.column_name === 'created_at');

      if (createdAt) {
        assert.strictEqual(
          createdAt.data_type,
          'timestamp with time zone',
          `${table.table_name}.created_at should be timestamptz`
        );
      }
    }
  });

  void it('updated_at columns are timestamptz', async () => {
    const tables = await getAllTables();

    for (const table of tables) {
      const columns = await getTableColumns(table.table_name);
      const updatedAt = columns.find((c) => c.column_name === 'updated_at');

      if (updatedAt) {
        assert.strictEqual(
          updatedAt.data_type,
          'timestamp with time zone',
          `${table.table_name}.updated_at should be timestamptz`
        );
      }
    }
  });
});

// ============================================
// JSONB COLUMNS
// ============================================

void describe('Data Types: JSONB Columns', { skip: SKIP }, () => {
  // Actual JSONB columns from the database
  const EXPECTED_JSONB_COLUMNS = [
    { table: 'shops', column: 'plan_limits' },
    { table: 'shops', column: 'settings' },
    { table: 'shopify_products', column: 'metafields' },
    { table: 'shopify_variants', column: 'metafields' },
    { table: 'shopify_metaobjects', column: 'fields' },
    { table: 'staging_products', column: 'raw_data' },
    { table: 'staging_products', column: 'options' },
    { table: 'staging_products', column: 'seo' },
    { table: 'staging_variants', column: 'raw_data' },
    { table: 'staging_variants', column: 'selected_options' },
    { table: 'audit_logs', column: 'details' },
    { table: 'prod_proposals', column: 'proposed_value' },
    { table: 'prod_raw_harvest', column: 'raw_json' },
    { table: 'scheduled_tasks', column: 'job_data' },
    { table: 'scraper_configs', column: 'selectors' },
    { table: 'scraper_configs', column: 'rate_limit' },
  ];

  for (const { table, column } of EXPECTED_JSONB_COLUMNS) {
    void it(`${table}.${column} is JSONB type`, async () => {
      const columns = await getTableColumns(table);
      const col = columns.find((c) => c.column_name === column);

      assert.ok(col, `${table}.${column} should exist`);
      assert.strictEqual(
        col?.udt_name,
        'jsonb',
        `${table}.${column} should be jsonb, got ${col?.udt_name}`
      );
    });
  }
});

// ============================================
// VECTOR COLUMNS
// ============================================

void describe('Data Types: Vector Columns (pgvector)', { skip: SKIP }, () => {
  const VECTOR_TABLES = [
    { table: 'prod_embeddings', column: 'embedding' },
    { table: 'shop_product_embeddings', column: 'embedding' },
    { table: 'prod_attr_definitions', column: 'embedding' },
  ];

  for (const { table, column } of VECTOR_TABLES) {
    void it(`${table}.${column} is vector type`, async () => {
      const columns = await getTableColumns(table);
      const col = columns.find((c) => c.column_name === column);

      assert.ok(col, `${table}.${column} should exist`);
      assert.strictEqual(
        col?.udt_name,
        'vector',
        `${table}.${column} should be vector, got ${col?.udt_name}`
      );
    });
  }
});

// ============================================
// ARRAY COLUMNS
// ============================================

void describe('Data Types: Array Columns', { skip: SKIP }, () => {
  void it('shopify_products.tags is text array', async () => {
    const columns = await getTableColumns('shopify_products');
    const tags = columns.find((c) => c.column_name === 'tags');

    assert.ok(tags, 'tags column should exist');
    assert.strictEqual(tags?.data_type, 'ARRAY', 'tags should be array');
  });

  void it('shops.scopes is text array', async () => {
    const columns = await getTableColumns('shops');
    const scopes = columns.find((c) => c.column_name === 'scopes');

    assert.ok(scopes, 'scopes column should exist');
    assert.strictEqual(scopes?.data_type, 'ARRAY', 'scopes should be array');
  });
});

// ============================================
// CRITICAL COLUMN TYPES VERIFICATION
// ============================================

void describe('Data Types: Critical Columns', { skip: SKIP }, () => {
  for (const [tableName, columns] of Object.entries(CRITICAL_COLUMN_TYPES)) {
    for (const [columnName, expectedType] of Object.entries(columns)) {
      void it(`${tableName}.${columnName} is ${expectedType}`, async () => {
        const tableColumns = await getTableColumns(tableName);
        const col = tableColumns.find((c) => c.column_name === columnName);

        assert.ok(col, `${tableName}.${columnName} should exist`);

        // Check either data_type or udt_name
        const actualType = col?.data_type === expectedType || col?.udt_name === expectedType;
        assert.ok(
          actualType,
          `${tableName}.${columnName} should be ${expectedType}, got ${col?.data_type}/${col?.udt_name}`
        );
      });
    }
  }
});

// ============================================
// TEXT COLUMNS (ENCRYPTION - stored as text per migration)
// ============================================

void describe('Data Types: Encrypted Token Columns', { skip: SKIP }, () => {
  void it('shops has bytea columns for encrypted tokens', async () => {
    const columns = await getTableColumns('shops');

    const ciphertext = columns.find((c) => c.column_name === 'access_token_ciphertext');
    const iv = columns.find((c) => c.column_name === 'access_token_iv');
    const tag = columns.find((c) => c.column_name === 'access_token_tag');

    assert.ok(ciphertext?.udt_name === 'bytea', 'ciphertext should be bytea');
    assert.ok(iv?.udt_name === 'bytea', 'iv should be bytea');
    assert.ok(tag?.udt_name === 'bytea', 'tag should be bytea');
  });
});

// ============================================
// NUMERIC/DECIMAL COLUMNS
// ============================================

void describe('Data Types: Numeric Columns', { skip: SKIP }, () => {
  void it('price columns are numeric type', async () => {
    const columns = await getTableColumns('shopify_variants');

    const price = columns.find((c) => c.column_name === 'price');
    const compareAt = columns.find((c) => c.column_name === 'compare_at_price');

    assert.ok(price?.udt_name === 'numeric', 'price should be numeric');
    assert.ok(compareAt?.udt_name === 'numeric', 'compare_at_price should be numeric');
  });

  void it('cost columns are numeric type', async () => {
    const columns = await getTableColumns('ai_batches');
    const cost = columns.find((c) => c.column_name === 'cost_usd');

    if (cost) {
      assert.strictEqual(cost.udt_name, 'numeric', 'cost_usd should be numeric');
    }
  });
});

// ============================================
// TSVECTOR COLUMNS
// ============================================

void describe('Data Types: TSVector Columns', { skip: SKIP }, () => {
  void it('prod_semantics.search_vector is tsvector', async () => {
    const columns = await getTableColumns('prod_semantics');
    const searchVector = columns.find((c) => c.column_name === 'search_vector');

    assert.ok(searchVector, 'search_vector should exist');
    assert.strictEqual(searchVector?.udt_name, 'tsvector', 'should be tsvector');
  });
});

// ============================================
// DOMAIN COLUMN TYPE
// ============================================

void describe('Data Types: Text Columns', { skip: SKIP }, () => {
  void it('shops.shopify_domain is citext', async () => {
    const columns = await getTableColumns('shops');
    const domain = columns.find((c) => c.column_name === 'shopify_domain');

    assert.ok(domain, 'shopify_domain should exist');
    assert.strictEqual(domain?.udt_name, 'citext', 'should be citext type');
  });
});
