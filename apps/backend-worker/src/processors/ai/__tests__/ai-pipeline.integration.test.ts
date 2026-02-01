import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Pool } from 'pg';
import { Redis as IORedis, type Redis as RedisClient } from 'ioredis';
import nock from 'nock';

import { createEmbeddingsProvider } from '@app/ai-engine';
import type { Logger } from '@app/logger';
import { generateQueryEmbedding } from '../search.js';
import { getCachedSearchResult, setCachedSearchResult } from '../cache.js';

function logStep(message: string): void {
  console.info(`[ai-pipeline] ${new Date().toISOString()} ${message}`);
}

const MIGRATIONS_DIR = join(
  process.cwd(),
  '..',
  '..',
  'packages',
  'database',
  'drizzle',
  'migrations'
);

async function runSqlFile(pool: Pool, fileName: string): Promise<void> {
  logStep(`migration:start ${fileName}`);
  const sql = await readFile(join(MIGRATIONS_DIR, fileName), 'utf8');
  await pool.query(sql);
  logStep(`migration:done ${fileName}`);
}

async function runAllMigrations(pool: Pool): Promise<void> {
  const fileNames = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();

  logStep(`migrations:count ${fileNames.length}`);
  for (const fileName of fileNames) {
    await runSqlFile(pool, fileName);
  }
  logStep('migrations:done');
}

void describe('AI Pipeline Integration (Testcontainers)', { timeout: 120_000 }, () => {
  const noopLogger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => noopLogger,
  };
  const useExternalServices = Boolean(
    process.env['CI'] === 'true' && process.env['DATABASE_URL'] && process.env['REDIS_URL']
  );

  let pgContainer: StartedPostgreSqlContainer | undefined;
  let redisContainer: StartedRedisContainer | undefined;
  let pool: Pool;
  let redis: RedisClient;

  before(async () => {
    logStep('before:start');
    if (useExternalServices) {
      logStep('using:external-services');
      pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
      redis = new IORedis(process.env['REDIS_URL'] ?? '');
    } else {
      logStep('starting:testcontainers');
      pgContainer = await new PostgreSqlContainer('pgvector/pgvector:0.8.1-pg18-trixie').start();
      logStep('postgres:started');
      redisContainer = await new RedisContainer('redis:8.4-alpine').start();
      logStep('redis:started');

      pool = new Pool({ connectionString: pgContainer.getConnectionUri() });
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await pool.query(
        `CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
         SELECT gen_random_uuid();
         $$ LANGUAGE SQL;`
      );

      await runAllMigrations(pool);
      redis = new IORedis(redisContainer.getConnectionUrl());
    }

    logStep('db:grant-roles');
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user;
        END IF;
      END $$;
    `);
    await pool.query(`GRANT USAGE ON SCHEMA public TO app_user`);
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`
    );
    logStep('before:done');
  });

  after(async () => {
    logStep('after:start');
    await redis?.quit().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await pgContainer?.stop().catch(() => undefined);
    await redisContainer?.stop().catch(() => undefined);
    nock.cleanAll();
    logStep('after:done');
  });

  void it('enforces RLS isolation for shop_product_embeddings', async () => {
    logStep('test:rls:start');
    const client = await pool.connect();
    const shop1Id = randomUUID();
    const shop2Id = randomUUID();
    const product1Id = randomUUID();

    try {
      await client.query(
        `INSERT INTO shops (id, shopify_domain, access_token_ciphertext, access_token_iv, access_token_tag)
         VALUES ($1, $3, $5, $7, $9),
                ($2, $4, $6, $8, $10)`,
        [
          shop1Id,
          shop2Id,
          'shop-1.myshopify.com',
          'shop-2.myshopify.com',
          'cipher-1',
          'cipher-2',
          'iv-1',
          'iv-2',
          'tag-1',
          'tag-2',
        ]
      );
      await client.query(
        `INSERT INTO shopify_products (
          id,
          shop_id,
          shopify_gid,
          legacy_resource_id,
          title,
          handle,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          product1Id,
          shop1Id,
          `gid://shopify/Product/${Math.floor(Math.random() * 1_000_000)}`,
          Math.floor(Math.random() * 1_000_000),
          'Produs 1',
          `produs-${product1Id.slice(0, 8)}`,
          'ACTIVE',
        ]
      );

      const embedding = Array(2000).fill(0.1);
      await client.query(`SELECT set_config('app.current_shop_id', $1, false)`, [shop1Id]);
      await client.query(
        `INSERT INTO shop_product_embeddings (
           shop_id,
           product_id,
           embedding_type,
           embedding,
           content_hash,
           model_version,
           dimensions,
           status
         )
         VALUES ($1, $2, 'combined', $3::vector(2000), 'hash1', 'test', 2000, 'ready')`,
        [shop1Id, product1Id, `[${embedding.join(',')}]`]
      );

      await client.query(`SET ROLE app_user`);
      await client.query(`SELECT set_config('app.current_shop_id', $1, false)`, [shop2Id]);
      const result = await client.query(`SELECT * FROM shop_product_embeddings`);
      await client.query(`RESET ROLE`);
      assert.equal(result.rowCount, 0);
    } finally {
      logStep('test:rls:release-client');
      client.release();
    }
    logStep('test:rls:done');
  });

  void it('supports vector KNN search per shop', async () => {
    logStep('test:knn:start');
    const client = await pool.connect();
    const shopId = randomUUID();
    const product1Id = randomUUID();
    const product2Id = randomUUID();

    try {
      await client.query(
        `INSERT INTO shops (id, shopify_domain, access_token_ciphertext, access_token_iv, access_token_tag)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [shopId, 'shop-3.myshopify.com', 'cipher-3', 'iv-3', 'tag-3']
      );
      await client.query(
        `INSERT INTO shopify_products (
          id,
          shop_id,
          shopify_gid,
          legacy_resource_id,
          title,
          handle,
          status
        ) VALUES
          ($1, $2, $3, $4, $5, $6, $7),
          ($8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT DO NOTHING`,
        [
          product1Id,
          shopId,
          `gid://shopify/Product/${Math.floor(Math.random() * 1_000_000)}`,
          Math.floor(Math.random() * 1_000_000),
          'Produs Similar',
          `produs-${product1Id.slice(0, 8)}`,
          'ACTIVE',
          product2Id,
          shopId,
          `gid://shopify/Product/${Math.floor(Math.random() * 1_000_000)}`,
          Math.floor(Math.random() * 1_000_000),
          'Produs Diferit',
          `produs-${product2Id.slice(0, 8)}`,
          'ACTIVE',
        ]
      );

      const similarEmbedding = Array(2000).fill(0.5);
      const differentEmbedding = Array(2000).fill(-0.5);
      await client.query(`SELECT set_config('app.current_shop_id', $1, false)`, [shopId]);
      await client.query(
        `INSERT INTO shop_product_embeddings (
           shop_id,
           product_id,
           embedding_type,
           embedding,
           content_hash,
           model_version,
           dimensions,
           status
         )
         VALUES
           ($1, $2, 'combined', $3::vector(2000), 'hash-sim', 'test', 2000, 'ready'),
           ($1, $4, 'combined', $5::vector(2000), 'hash-diff', 'test', 2000, 'ready')`,
        [
          shopId,
          product1Id,
          `[${similarEmbedding.join(',')}]`,
          product2Id,
          `[${differentEmbedding.join(',')}]`,
        ]
      );

      const queryEmbedding = `[${Array(2000).fill(0.5).join(',')}]`;
      await client.query(`SET ROLE app_user`);
      await client.query(`SELECT set_config('app.current_shop_id', $1, false)`, [shopId]);
      const result = await client.query(
        `SELECT product_id
           FROM find_similar_shop_products($1, $2::vector(2000), 0.1, 10)
          ORDER BY similarity DESC`,
        [shopId, queryEmbedding]
      );
      await client.query(`RESET ROLE`);

      assert.ok(result.rowCount && result.rowCount > 0);
      assert.equal(result.rows[0]?.product_id, product1Id);
    } finally {
      logStep('test:knn:release-client');
      client.release();
    }
    logStep('test:knn:done');
  });

  void it('uses Redis cache for search results', async () => {
    logStep('test:cache:start');
    const shopId = randomUUID();
    const queryText = 'test query';
    const results = [{ id: 'p1', title: 'Produs', similarity: 0.9 }];

    logStep('cache:set:start');
    await setCachedSearchResult({
      redis,
      shopId,
      queryText,
      result: results,
      vectorSearchTimeMs: 42,
      totalCount: results.length,
    });
    logStep('cache:set:done');

    logStep('cache:get:start');
    const cached = await getCachedSearchResult({ redis, shopId, queryText });
    logStep('cache:get:done');
    assert.ok(cached);
    assert.equal(cached?.results.length, 1);
    assert.equal(cached?.results[0]?.id, 'p1');
    logStep('test:cache:done');
  });

  void it('mocks OpenAI embedding provider', async () => {
    logStep('test:embedding:start');
    nock('https://api.openai.com')
      .post('/v1/embeddings')
      .reply(200, {
        data: [{ embedding: Array(2000).fill(0.123) }],
      });

    logStep('embedding:provider:create');
    const provider = createEmbeddingsProvider({
      openAiApiKey: 'test-key',
      openAiEmbeddingsModel: 'text-embedding-3-large',
    });

    logStep('embedding:generate:start');
    const embedding = await generateQueryEmbedding({
      text: 'test query',
      provider,
      logger: noopLogger,
    });
    logStep('embedding:generate:done');

    assert.equal(embedding.length, 2000);
    logStep('test:embedding:done');
  });
});
