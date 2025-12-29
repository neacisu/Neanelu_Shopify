/**
 * Database Connection Tests
 *
 * Testează conectivitatea la PostgreSQL și funcționalitatea pool-ului.
 * Rulează cu: pnpm --filter @app/database test
 *
 * NOTĂ: Necesită container PostgreSQL activ (pnpm db:up)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { pool, checkDatabaseConnection, closePool } from './db.ts';

// Typed query results
interface TestRow {
  test: number;
}

interface VersionRow {
  version: string;
}

interface UuidRow {
  uuid: string;
}

void describe('Database Connection', () => {
  before(() => {
    // Verifică că avem DATABASE_URL - setează default pentru test local
    process.env['DATABASE_URL'] ??=
      'postgresql://shopify:shopify_dev_password@localhost:65010/neanelu_shopify_dev';
  });

  after(async () => {
    // Cleanup - închide pool-ul
    await closePool();
  });

  void it('should connect to PostgreSQL and run SELECT 1', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<TestRow>('SELECT 1 as test');
      assert.strictEqual(result.rows[0]?.test, 1);
    } finally {
      client.release();
    }
  });

  void it('should pass health check', async () => {
    const isHealthy = await checkDatabaseConnection();
    assert.strictEqual(isHealthy, true);
  });

  void it('should verify PostgreSQL version is 18.x', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<VersionRow>('SELECT version()');
      const version = result.rows[0]?.version ?? '';
      assert.ok(version.includes('PostgreSQL 18'), `Expected PostgreSQL 18, got: ${version}`);
    } finally {
      client.release();
    }
  });

  void it('should verify uuidv7() function exists (PG18 native)', async () => {
    const client = await pool.connect();
    try {
      const result = await client.query<UuidRow>('SELECT uuidv7() as uuid');
      const uuid = result.rows[0]?.uuid ?? '';
      // UUIDv7 format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
      const uuidv7Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      assert.ok(uuidv7Regex.exec(uuid), `Expected UUIDv7 format, got: ${uuid}`);
    } finally {
      client.release();
    }
  });
});
