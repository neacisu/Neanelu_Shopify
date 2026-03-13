import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

type MockJobState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';

type MockQueueJob = Readonly<{
  state: MockJobState;
  progress?: number | null;
  processedOn?: number | null;
  finishedOn?: number | null;
  attemptsMade?: number;
  failedReason?: string;
  data?: unknown;
}>;

const queueJobLookup = new Map<string, MockQueueJob>();

function setQueueJob(queueName: string, jobId: string, job: MockQueueJob): void {
  queueJobLookup.set(`${queueName}:${jobId}`, job);
}

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (req: unknown) => {
      (req as { session?: { shopId: string } }).session = { shopId: 'shop-1' };
      return Promise.resolve();
    },
    getSessionFromRequest: () => ({ shopId: 'shop-1' }),
  },
});

void mock.module('@app/database', {
  namedExports: {
    decryptAesGcm: () => Buffer.from('test-openai-key', 'utf8'),
    createSecondaryPool: () => ({
      pool: {
        query: () => Promise.resolve({ rows: [] }),
        connect: () =>
          Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => undefined }),
      },
      rotate: () => Promise.resolve(),
      close: () => Promise.resolve(),
      getCurrentConnectionString: () => 'postgresql://test',
    }),
    createManagedRedis: () => ({
      on: () => undefined,
      get: () => Promise.resolve(null),
      setex: () => Promise.resolve('OK'),
      quit: () => Promise.resolve('OK'),
      disconnect: () => undefined,
    }),
    pool: {
      query: () => Promise.resolve({ rows: [] }),
      connect: () =>
        Promise.resolve({ query: () => Promise.resolve({ rows: [] }), release: () => undefined }),
    },
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string): Promise<{ rows: unknown[]; rowCount?: number }> => {
          if (sql.includes('COUNT(*)')) {
            return Promise.resolve({ rows: [{ total: 1 }] });
          }
          if (sql.includes('FROM shopify_products') && sql.includes('LEFT JOIN prod_semantics')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'prod-1',
                  title: 'Product 1',
                  handle: 'product-1',
                  description: null,
                  descriptionHtml: null,
                  vendor: 'Vendor',
                  status: 'ACTIVE',
                  productType: 'Seeds',
                  tags: [],
                  featuredImageUrl: null,
                  categoryId: null,
                  priceRange: null,
                  metafields: {},
                  syncedAt: null,
                  createdAtShopify: null,
                  updatedAtShopify: null,
                  pimMasterId: 'pim-1',
                  pimTaxonomyId: null,
                  pimQualityLevel: 'bronze',
                  pimQualityScore: '0.5',
                  pimQualityScoreBreakdown: { completeness: 0.5, accuracy: 0.6, consistency: 0.4 },
                  pimBrand: null,
                  pimManufacturer: null,
                  pimGtin: null,
                  pimMpn: null,
                  pimNeedsReview: false,
                  pimPromotedToSilverAt: null,
                  pimPromotedToGoldenAt: null,
                  pimTitleMaster: 'Product 1',
                  pimDescriptionMaster: null,
                  pimDescriptionShort: null,
                },
              ],
            });
          }
          if (
            sql.includes('FROM shopify_products p') &&
            sql.includes('LEFT JOIN prod_channel_mappings')
          ) {
            return Promise.resolve({
              rows: [
                {
                  id: 'prod-1',
                  title: 'Product 1',
                  vendor: 'Vendor',
                  status: 'ACTIVE',
                  productType: 'Seeds',
                  featuredImageUrl: null,
                  priceRange: null,
                  qualityLevel: 'bronze',
                  qualityScore: '0.5',
                  taxonomyId: null,
                  gtin: null,
                  mpn: null,
                  titleMaster: 'Product 1',
                  descriptionShort: null,
                },
              ],
            });
          }
          if (sql.includes('FROM shopify_variants')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'var-1',
                  sku: 'SKU-1',
                  title: 'Variant',
                  barcode: null,
                  price: '10.00',
                  compareAtPrice: '10.00',
                  inventoryQuantity: 5,
                  imageUrl: null,
                  selectedOptions: [],
                },
              ],
            });
          }
          if (sql.includes('FROM prod_channel_mappings')) {
            return Promise.resolve({ rows: [{ product_id: 'pim-1' }] });
          }
          if (sql.includes('FROM prod_master pm') && sql.includes('pim_metafield_push_log')) {
            return Promise.resolve({
              rows: [
                {
                  data_quality_level: 'bronze',
                  metafield_status: null,
                  metafield_error_message: null,
                  metafield_pushed_at_ms: null,
                },
              ],
            });
          }
          if (sql.includes('FROM shopify_collections')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'col-1',
                  title: 'Collection 1',
                  collectionType: 'MANUAL',
                  productsCount: 10,
                },
              ],
            });
          }
          if (sql.includes('INSERT INTO shopify_collection_products')) {
            return Promise.resolve({ rows: [], rowCount: 1 });
          }
          if (sql.includes('UPDATE shopify_products') && sql.includes('category_id')) {
            return Promise.resolve({ rows: [{ updated: 1 }] });
          }
          if (sql.includes('UPDATE prod_master') && sql.includes('needs_review')) {
            return Promise.resolve({ rows: [{ updated: 1 }] });
          }
          if (sql.includes('FROM shopify_products')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'prod-1',
                  title: 'Product 1',
                  vendor: 'Vendor',
                  status: 'ACTIVE',
                  productType: 'Seeds',
                  featuredImageUrl: null,
                  categoryId: null,
                  syncedAt: null,
                  updatedAtShopify: null,
                  variantsCount: 1,
                  syncStatus: 'synced',
                  qualityLevel: 'bronze',
                  qualityScore: '0.5',
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return fn(client);
    },
  },
});

const enrichmentEnqueueMock = mock.fn(() => Promise.resolve());
void mock.module('@app/queue-manager', {
  namedExports: {
    createRedisConnection: () => {
      return {
        set: () => Promise.resolve(undefined),
        get: () => Promise.resolve(null),
        on: () => undefined,
        quit: () => Promise.resolve(undefined),
      };
    },
    configFromEnv: (env: { redisUrl?: string; bullmqProToken?: string }) => ({
      redisUrl: env.redisUrl ?? 'redis://localhost:6379',
      bullmqProToken: env.bullmqProToken ?? 'test-token',
    }),
    createQueue: (_config: unknown, options: { name: string }) => ({
      add: () => Promise.resolve({ id: 'test-job' }),
      getJob: (jobId: string) => {
        const job = queueJobLookup.get(`${options.name}:${jobId}`);
        if (!job) return Promise.resolve(null);
        return Promise.resolve({
          progress: job.progress ?? null,
          processedOn: job.processedOn ?? null,
          finishedOn: job.finishedOn ?? null,
          attemptsMade: job.attemptsMade ?? 0,
          failedReason: job.failedReason,
          data: job.data,
          getState: () => Promise.resolve(job.state),
        });
      },
      close: () => Promise.resolve(),
    }),
    createWorker: () => ({
      worker: {
        close: () => Promise.resolve(),
        isRunning: () => true,
      },
    }),
    withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => await fn(),
    checkAndConsumeCost: () =>
      Promise.resolve({ allowed: true, delayMs: 0, tokensRemaining: 100, tokensNow: 100 }),
    enqueueBulkOrchestratorJob: () => Promise.resolve(),
    enqueueEnrichmentJob: enrichmentEnqueueMock,
  },
});

void describe('products routes', () => {
  void it('returns products list', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({ method: 'GET', url: '/products' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { items?: unknown[]; total?: number };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.items?.length, 1);
    assert.equal(body.data?.total, 1);
  });

  void it('returns product detail', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/products/prod-1?includeVariants=true',
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: { id?: string; variants?: unknown[] };
    };
    assert.equal(body.success, true);
    assert.equal(body.data?.id, 'prod-1');
    assert.equal(body.data?.variants?.length, 1);
  });

  void it('updates PIM data', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/products/prod-1/pim',
      payload: { titleMaster: 'New Title' },
    });
    assert.equal(response.statusCode, 200);
  });

  void it('valideaza GTIN checksum la update PIM', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const bad = await app.inject({
      method: 'PUT',
      url: '/products/prod-1/pim',
      payload: { gtin: '4006381333932' }, // checksum invalid (vezi gtin-validator.test.ts)
    });
    assert.equal(bad.statusCode, 400);

    const good = await app.inject({
      method: 'PUT',
      url: '/products/prod-1/pim',
      payload: { gtin: '4006381333931' }, // checksum valid
    });
    assert.equal(good.statusCode, 200);
  });

  void it('queues bulk sync', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/products/bulk-sync',
      payload: { productIds: ['prod-1'] },
    });
    assert.equal(response.statusCode, 202);
  });

  void it('validates bulk sync limit', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/products/bulk-sync',
      payload: { productIds: Array.from({ length: 101 }, (_, idx) => `prod-${idx}`) },
    });
    assert.equal(response.statusCode, 400);
  });

  void it('compares products in bulk', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/products/bulk-compare',
      payload: { productIds: ['prod-1'] },
    });
    assert.equal(response.statusCode, 200);
  });

  void it('assigns category in bulk', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/products/bulk-assign-category',
      payload: { productIds: ['prod-1'], categoryId: 'cat-1' },
    });
    assert.equal(response.statusCode, 200);
  });

  void it('adds to collection in bulk', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/products/bulk-add-to-collection',
      payload: { productIds: ['prod-1'], collectionId: 'col-1' },
    });
    assert.equal(response.statusCode, 200);
  });

  void it('requests enrichment in bulk', async () => {
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/products/bulk-request-enrichment',
      payload: { productIds: ['prod-1'] },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(enrichmentEnqueueMock.mock.callCount(), 1);
  });

  void it('falls back to needs_review when enqueue fails', async () => {
    enrichmentEnqueueMock.mock.mockImplementationOnce(() =>
      Promise.reject(new Error('enqueue_failed'))
    );
    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/products/bulk-request-enrichment',
      payload: { productIds: ['prod-1'] },
    });
    assert.equal(response.statusCode, 202);
  });

  void it('lists collections', async () => {
    const { productsRoutes } = await import('../products.js');
    const { collectionsRoutes } = await import('../collections.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });
    await app.register(collectionsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({ method: 'GET', url: '/collections' });
    assert.equal(response.statusCode, 200);
  });

  void it('marks metafield push as skipped when bronze consensus completes without a push job', async () => {
    queueJobLookup.clear();
    setQueueJob('pim-consensus', 'consensus:pim-1:123', {
      state: 'completed',
      progress: 100,
      processedOn: 1010,
      finishedOn: 1100,
      attemptsMade: 1,
    });
    setQueueJob('pim-category-classifier', 'pim-category-pim-1-consensus', {
      state: 'completed',
      progress: 100,
      processedOn: 1101,
      finishedOn: 1200,
      attemptsMade: 1,
    });
    setQueueJob('pim-description-generator', 'pim-description-pim-1-consensus', {
      state: 'completed',
      progress: 100,
      processedOn: 1201,
      finishedOn: 1300,
      attemptsMade: 1,
    });

    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/products/prod-1/sync-status?masterId=pim-1&consensusJobId=consensus:pim-1:123&sinceMs=1000',
    });
    assert.equal(response.statusCode, 200);

    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: {
        allTerminal?: boolean;
        anyFailed?: boolean;
        steps?: { id?: string; status?: string; progress?: number | null }[];
      };
    };

    assert.equal(body.success, true);
    assert.equal(body.data?.allTerminal, true);
    assert.equal(body.data?.anyFailed, false);
    assert.deepEqual(
      body.data?.steps?.map((step) => ({
        id: step.id,
        status: step.status,
        progress: step.progress,
      })),
      [
        { id: 'consensus', status: 'completed', progress: 100 },
        { id: 'category', status: 'completed', progress: 100 },
        { id: 'description', status: 'completed', progress: 100 },
        { id: 'metafield', status: 'skipped', progress: 100 },
      ]
    );
  });

  void it('treats DLQ-backed description failures as terminal sync-status failures', async () => {
    queueJobLookup.clear();
    setQueueJob('pim-consensus', 'consensus:pim-1:bootstrap', {
      state: 'completed',
      progress: 100,
      processedOn: 1010,
      finishedOn: 1100,
      attemptsMade: 1,
    });
    setQueueJob('pim-consensus', 'consensus:pim-1:settlement', {
      state: 'completed',
      progress: 100,
      processedOn: 1110,
      finishedOn: 1200,
      attemptsMade: 1,
    });
    setQueueJob('pim-category-classifier', 'pim-category-pim-1-consensus', {
      state: 'completed',
      progress: 100,
      processedOn: 1201,
      finishedOn: 1300,
      attemptsMade: 1,
    });
    setQueueJob(
      'pim-description-generator-dlq',
      'pim-description-generator__pim-description-pim-1-consensus',
      {
        state: 'waiting',
        attemptsMade: 3,
        data: {
          originalQueue: 'pim-description-generator',
          originalJobId: 'pim-description-pim-1-consensus',
          attemptsMade: 3,
          failedReason: 'description_generation_invalid_json',
          occurredAt: '2026-03-13T13:00:37.053Z',
        },
      }
    );

    const { productsRoutes } = await import('../products.js');
    const app = Fastify();
    await app.register(productsRoutes as unknown as Parameters<typeof app.register>[0], {
      env: {
        encryptionKeyHex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        appHost: new URL('https://example.com'),
        redisUrl: 'redis://localhost:6379',
      },
      logger: console,
      sessionConfig: { secret: 'test', cookieName: 'neanelu_session', maxAge: 10 },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/products/prod-1/sync-status?masterId=pim-1&sinceMs=1000',
    });
    assert.equal(response.statusCode, 200);

    const body = JSON.parse(response.body) as {
      success?: boolean;
      data?: {
        allTerminal?: boolean;
        anyFailed?: boolean;
        steps?: { id?: string; status?: string; progress?: number | null; failedReason?: string }[];
      };
    };

    assert.equal(body.success, true);
    assert.equal(body.data?.allTerminal, true);
    assert.equal(body.data?.anyFailed, true);
    assert.deepEqual(
      body.data?.steps?.map((step) => ({
        id: step.id,
        status: step.status,
        progress: step.progress,
        failedReason: step.failedReason ?? null,
      })),
      [
        { id: 'consensus', status: 'completed', progress: 100, failedReason: null },
        { id: 'category', status: 'completed', progress: 100, failedReason: null },
        {
          id: 'description',
          status: 'failed',
          progress: 100,
          failedReason: 'description_generation_invalid_json',
        },
        { id: 'metafield', status: 'skipped', progress: 100, failedReason: null },
      ]
    );
  });
});
