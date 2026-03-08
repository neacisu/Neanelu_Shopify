import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (request: { session?: { shopId: string } }) => {
      request.session = { shopId: 'shop-1' };
      return Promise.resolve();
    },
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      callback: (client: {
        query: (sql: string) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string) => {
          const normalized = sql.toLowerCase();
          if (normalized.includes('from shopify_collections sc')) {
            return Promise.resolve({
              rows: [
                {
                  title: 'Robineti irigatii',
                  description: 'Descriere',
                  titleEn: 'Irrigation Valves',
                  parentTitle: 'Fitinguri',
                  menuLevel: 2,
                  menuPath: 'Sisteme de Irigatii > Fitinguri > Robineti irigatii',
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return await callback(client);
    },
    pool: { query: () => Promise.resolve({ rows: [] }) },
    createSecondaryPool: () => ({
      pool: { query: () => Promise.resolve({ rows: [] }), end: () => Promise.resolve() },
      close: () => Promise.resolve(),
    }),
    decryptAesGcm: () => Buffer.from(''),
    createManagedRedis: () => ({
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      setex: () => Promise.resolve('OK'),
      del: () => Promise.resolve(1),
      quit: () => Promise.resolve('OK'),
      on: () => undefined,
    }),
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: () => ({ redisUrl: 'redis://localhost:6379' }),
    createQueue: () => ({
      getJob: () => Promise.resolve(null),
      close: () => Promise.resolve(undefined),
    }),
  },
});

const enginePath = new URL('../../services/menu-assignment-engine.js', import.meta.url).href;
void mock.module(enginePath, {
  namedExports: {
    getMenuAssignmentStatus: () =>
      Promise.resolve({
        activeAssignments: [],
        proposedAssignments: [
          {
            id: 'assign-1',
            menuItemId: null,
            menuItemTitle: 'Propunere AI',
            menuItemPath: 'Sisteme de Irigatii > Fitinguri > Robineti',
            menuItemLevel: null,
            assignmentSource: 'ai',
            isPrimary: false,
            confidence: 0.72,
            reasoning: 'Potrivire bună pe domeniu.',
            translatedQuery: 'Irrigation Valves',
            proposedPath: 'Sisteme de Irigatii > Fitinguri > Robineti',
            status: 'proposed',
            createdAt: new Date().toISOString(),
            approvedAt: null,
          },
        ],
        rejectedAssignments: [],
        primaryAssignment: null,
        collectionMenuPath: null,
        canRunAi: true,
      }),
    executeMenuAssignmentForCollection: (_params: unknown) =>
      Promise.resolve({
        status: 'proposed',
        assignments: [],
        reviewRequired: true,
        primaryCount: 1,
        secondaryCount: 1,
        proposedCount: 1,
        missingPathProposal: null,
        message: '1 primară, 1 secundară',
        consensusMethod: 'majority',
        consensusScore: 0.75,
      }),
    approveMenuAssignment: () => Promise.resolve(true),
    rejectMenuAssignment: () => Promise.resolve(true),
    setPrimaryMenuAssignment: () => Promise.resolve(true),
    deleteMenuAssignment: () => Promise.resolve(true),
  },
});

const menuAiPath = new URL('../../services/menu-ai.js', import.meta.url).href;
void mock.module(menuAiPath, {
  namedExports: {
    syncMenuItemEmbeddings: () =>
      Promise.resolve({
        embedded: 4,
        completed: 4,
        total: 4,
        errors: 0,
        model: 'selfhosted:qwen3-embedding-8b-q5km',
        dimensions: 2000,
      }),
  },
});

const noopAsync = () => Promise.resolve(undefined);

void mock.module('../../runtime/openai-config.js', {
  namedExports: {
    getShopOpenAiConfig: () =>
      Promise.resolve({
        enabled: true,
        openAiApiKey: 'test-key',
        openAiBaseUrl: 'https://api.openai.com',
      }),
  },
});

void mock.module('../../services/ai-provider-routing.js', {
  namedExports: {
    resolveChatTaskCredentials: () => Promise.resolve(null),
    resolveEmbeddingsProvider: () =>
      Promise.resolve({
        kind: 'selfhosted',
        model: { name: 'model', dimensions: 2000 },
        isAvailable: () => true,
        embedTexts: () => Promise.resolve([[0.1, 0.2]]),
      }),
  },
});

void mock.module('../../services/guardrails.js', {
  namedExports: {
    scanInput: () => Promise.resolve({ isValid: true, sanitizedText: 'ok', detectedScanners: [] }),
    scanOutput: () => Promise.resolve({ isValid: true, sanitizedText: 'ok', detectedScanners: [] }),
  },
});

void mock.module('../../services/consensus-engine.js', {
  namedExports: {
    consensusChatCompletion: () =>
      Promise.resolve({
        result: { selectedId: 'tax-1', categoryEn: 'Irrigation Valves' },
        rawResponses: [],
        method: 'majority',
        consensusScore: 0.75,
        participantCount: 4,
        models: ['QwQ', 'Qwen'],
        durationMs: 10,
      }),
  },
});

void mock.module('../../queue/collections-sync-queue.js', {
  namedExports: {
    enqueueCollectionsSyncJob: () => Promise.resolve('job-1'),
    PIM_COLLECTIONS_SYNC_QUEUE_NAME: 'collections-sync',
  },
});

void mock.module('../../queue/collection-metafield-push-queue.js', {
  namedExports: {
    enqueueCollectionMetafieldPushJob: () => Promise.resolve('job-2'),
  },
});

void mock.module('../../services/collection-metafields-delete.js', {
  namedExports: {
    deleteCollectionMetafieldsForTaxonomy: noopAsync,
  },
});

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as const;

const env = {
  nodeEnv: 'test',
  logLevel: 'info',
  redisUrl: 'redis://localhost:6379',
  bullmqProToken: 'token',
  encryptionKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  openAiTimeoutMs: 30_000,
} as const;

void describe('collections menu AI routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { collectionsRoutes } = await import('../collections.js');
    app = Fastify();
    await app.register(collectionsRoutes, {
      env: env as never,
      logger: logger as never,
      sessionConfig: {} as never,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  void it('returns menu assignment status envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/collections/col-1/menu-assignment-status',
    });

    assert.equal(response.statusCode, 200);
    const body: {
      success: boolean;
      data: { canRunAi: boolean; proposedAssignments: unknown[] };
    } = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.canRunAi, true);
    assert.equal(body.data.proposedAssignments.length, 1);
  });

  void it('streams NDJSON events for single AI assignment', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/collections/col-1/assign-menu-ai',
    });

    assert.equal(response.statusCode, 200);
    const events = response.body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string });
    assert.ok(events.some((event) => event.type === 'menu_assign_start'));
    assert.ok(events.some((event) => event.type === 'menu_assign_collection_start'));
    assert.ok(events.some((event) => event.type === 'menu_assign_collection_result'));
    assert.ok(events.some((event) => event.type === 'menu_assign_done'));
  });

  void it('supports review actions and embedding regeneration endpoints', async () => {
    const approve = await app.inject({
      method: 'POST',
      url: '/collections/col-1/menu-assignments/assign-1/approve',
    });
    const reject = await app.inject({
      method: 'POST',
      url: '/collections/col-1/menu-assignments/assign-1/reject',
    });
    const primary = await app.inject({
      method: 'PATCH',
      url: '/collections/col-1/menu-assignments/assign-1/primary',
      payload: {},
    });
    const remove = await app.inject({
      method: 'DELETE',
      url: '/collections/col-1/menu-assignments/assign-1',
    });
    const regenerate = await app.inject({
      method: 'POST',
      url: '/collections/menu-items/regenerate-embeddings',
      payload: {},
    });

    assert.equal(approve.statusCode, 200);
    assert.equal(reject.statusCode, 200);
    assert.equal(primary.statusCode, 200);
    assert.equal(remove.statusCode, 200);
    assert.equal(regenerate.statusCode, 200);
    const regenerateBody: {
      success: boolean;
      data: { embedded: number; total: number; errors: number };
    } = regenerate.json();
    assert.equal(regenerateBody.data.embedded, 4);
    assert.equal(regenerateBody.data.total, 4);
    assert.equal(regenerateBody.data.errors, 0);
  });
});
