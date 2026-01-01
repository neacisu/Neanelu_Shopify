/**
 * PIM Schema Tests
 *
 * PR-010: F2.2.5-F2.2.7 - PIM Schema & pgvector Embeddings
 *
 * Testează:
 * 1. Migrațiile creează tabelele PIM corect
 * 2. Indexurile HNSW sunt create
 * 3. Tabelele PIM NU au RLS (date globale)
 * 4. shop_product_embeddings ARE RLS
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../db.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle/migrations');

interface TableRow {
  table_name: string;
}

interface IndexRow {
  indexname: string;
  indexdef: string;
}

interface RlsRow {
  tablename: string;
  rowsecurity: boolean;
}

interface FunctionRow {
  routine_name: string;
}

void describe('PIM Schema (F2.2.5)', () => {
  before(async () => {
    // Bootstrap extensions și funcții necesare
    const bootstrap = await pool.connect();
    try {
      await bootstrap.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
      await bootstrap.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
      await bootstrap.query(`CREATE EXTENSION IF NOT EXISTS "vector";`);
      await bootstrap.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm";`);
      await bootstrap.query(`
      DO $$
      BEGIN
        BEGIN
          PERFORM uuid_generate_v7();
          EXECUTE 'CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $f$ SELECT uuid_generate_v7(); $f$ LANGUAGE SQL IMMUTABLE;';
        EXCEPTION WHEN undefined_function THEN
          EXECUTE 'CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $f$ SELECT gen_random_uuid(); $f$ LANGUAGE SQL IMMUTABLE;';
        END;
      END $$;`);
    } finally {
      bootstrap.release();
    }

    await migrate(db, { migrationsFolder });
  });

  after(async () => {
    // Don't close pool here - shared with other tests when --experimental-test-isolation=none
    // Pool will be closed when process exits
  });

  void it('should create all 8 PIM tables', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<TableRow>(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN (
          'prod_taxonomy', 'prod_sources', 'prod_raw_harvest',
          'prod_extraction_sessions', 'prod_master', 'prod_specs_normalized',
          'prod_semantics', 'prod_channel_mappings'
        )
        ORDER BY table_name
      `);

      assert.strictEqual(result.rows.length, 8, `Expected 8 PIM tables, got ${result.rows.length}`);

      const tableNames = result.rows.map((r) => r.table_name);
      assert.ok(tableNames.includes('prod_taxonomy'), 'prod_taxonomy table missing');
      assert.ok(tableNames.includes('prod_master'), 'prod_master table missing');
      assert.ok(
        tableNames.includes('prod_embeddings') === false,
        'prod_embeddings should be in vectors schema'
      );
    } finally {
      client.release();
    }
  });

  void it('should create prod_taxonomy with correct indexes', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<IndexRow>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'prod_taxonomy'
      `);

      const indexNames = result.rows.map((r) => r.indexname);
      assert.ok(indexNames.includes('idx_taxonomy_parent'), 'Parent index missing');
      assert.ok(indexNames.includes('idx_taxonomy_slug'), 'Slug index missing');
    } finally {
      client.release();
    }
  });

  void it('should NOT have RLS on PIM tables (global data)', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<RlsRow>(`
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename LIKE 'prod_%'
        AND tablename NOT IN ('shop_product_embeddings', 'prod_channel_mappings')
      `);

      for (const row of result.rows) {
        assert.strictEqual(
          row.rowsecurity,
          false,
          `Table ${row.tablename} should NOT have RLS enabled`
        );
      }
    } finally {
      client.release();
    }
  });
});

void describe('pgvector Embeddings Schema (F2.2.7)', () => {
  void it('should create all 4 vector tables', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<TableRow>(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN (
          'prod_attr_definitions', 'prod_attr_synonyms',
          'prod_embeddings', 'shop_product_embeddings'
        )
        ORDER BY table_name
      `);

      assert.strictEqual(
        result.rows.length,
        4,
        `Expected 4 vector tables, got ${result.rows.length}`
      );
    } finally {
      client.release();
    }
  });

  void it('should create HNSW indexes for vector columns', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<IndexRow>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE indexdef LIKE '%hnsw%'
      `);

      assert.ok(
        result.rows.length >= 3,
        `Expected at least 3 HNSW indexes, got ${result.rows.length}`
      );

      const indexNames = result.rows.map((r) => r.indexname);
      assert.ok(
        indexNames.includes('idx_attr_embedding'),
        'Attribute embedding HNSW index missing'
      );
      assert.ok(
        indexNames.includes('idx_embeddings_vector'),
        'Product embeddings HNSW index missing'
      );
      assert.ok(
        indexNames.includes('idx_shop_embeddings_vector'),
        'Shop embeddings HNSW index missing'
      );
    } finally {
      client.release();
    }
  });

  void it('should create trigram index for synonyms', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<IndexRow>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'prod_attr_synonyms'
        AND indexdef LIKE '%gin_trgm_ops%'
      `);

      assert.ok(result.rows.length >= 1, 'Trigram index on synonyms missing');
    } finally {
      client.release();
    }
  });

  void it('should have RLS on shop_product_embeddings only', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<RlsRow>(`
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = 'shop_product_embeddings'
      `);

      assert.strictEqual(result.rows.length, 1, 'shop_product_embeddings table not found');
      assert.strictEqual(
        result.rows[0]?.rowsecurity,
        true,
        'RLS should be enabled on shop_product_embeddings'
      );
    } finally {
      client.release();
    }
  });

  void it('should create find_similar_products helper function', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<FunctionRow>(`
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'public'
        AND routine_name = 'find_similar_products'
      `);

      assert.strictEqual(result.rows.length, 1, 'find_similar_products function not found');
    } finally {
      client.release();
    }
  });
});
