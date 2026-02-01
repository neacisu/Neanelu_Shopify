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
  const sql = await readFile(join(MIGRATIONS_DIR, fileName), 'utf8');
  await pool.query(sql);
}

async function runAllMigrations(pool: Pool): Promise<void> {
  const fileNames = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();

  for (const fileName of fileNames) {
    await runSqlFile(pool, fileName);
  }
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
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let pool: Pool;
  let redis: RedisClient;

  before(async () => {
    pgContainer = await new PostgreSqlContainer('pgvector/pgvector:0.8.1-pg18-trixie').start();
    redisContainer = await new RedisContainer('redis:8.4-alpine').start();

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

    redis = new IORedis(redisContainer.getConnectionUrl());
  });

  after(async () => {
    await redis?.quit().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await pgContainer?.stop().catch(() => undefined);
    await redisContainer?.stop().catch(() => undefined);
    nock.cleanAll();
  });

  void it('enforces RLS isolation for shop_product_embeddings', async () => {
    const client = await pool.connect();
    const shop1Id = '11111111-1111-1111-1111-111111111111';
    const shop2Id = '22222222-2222-2222-2222-222222222222';
    const product1Id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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
        [product1Id, shop1Id, 'gid://shopify/Product/1', 1, 'Produs 1', 'produs-1', 'ACTIVE']
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
      client.release();
    }
  });

  void it('supports vector KNN search per shop', async () => {
    const client = await pool.connect();
    const shopId = '33333333-3333-3333-3333-333333333333';
    const product1Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const product2Id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

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
          'gid://shopify/Product/2',
          2,
          'Produs Similar',
          'produs-similar',
          'ACTIVE',
          product2Id,
          shopId,
          'gid://shopify/Product/3',
          3,
          'Produs Diferit',
          'produs-diferit',
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
      client.release();
    }
  });

  void it('uses Redis cache for search results', async () => {
    const shopId = '44444444-4444-4444-4444-444444444444';
    const queryText = 'test query';
    const results = [{ id: 'p1', title: 'Produs', similarity: 0.9 }];

    await setCachedSearchResult({
      redis,
      shopId,
      queryText,
      result: results,
      vectorSearchTimeMs: 42,
    });

    const cached = await getCachedSearchResult({ redis, shopId, queryText });
    assert.ok(cached);
    assert.equal(cached?.results.length, 1);
    assert.equal(cached?.results[0]?.id, 'p1');
  });

  void it('mocks OpenAI embedding provider', async () => {
    nock('https://api.openai.com')
      .post('/v1/embeddings')
      .reply(200, {
        data: [{ embedding: Array(2000).fill(0.123) }],
      });

    const provider = createEmbeddingsProvider({
      openAiApiKey: 'test-key',
      openAiEmbeddingsModel: 'text-embedding-3-large',
    });

    const embedding = await generateQueryEmbedding({
      text: 'test query',
      provider,
      logger: noopLogger,
    });

    assert.equal(embedding.length, 2000);
  });
});
