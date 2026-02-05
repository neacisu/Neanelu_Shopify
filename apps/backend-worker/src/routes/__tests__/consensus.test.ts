import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

const logger = {
  debug: (_context: Record<string, unknown>, _message: string) => undefined,
  info: (_context: Record<string, unknown>, _message: string) => undefined,
  warn: (_context: Record<string, unknown>, _message: string) => undefined,
  error: (_context: Record<string, unknown>, _message: string) => undefined,
  fatal: (_context: Record<string, unknown>, _message: string) => undefined,
  child: (_context: Record<string, unknown>) => logger,
};

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession:
      () => (request: { session?: { shopId: string } }, _reply: unknown, done?: () => void) => {
        request.session = { shopId: 'shop-1' };
        if (done) done();
      },
    getSessionFromRequest: () => ({ shopId: 'shop-1' }),
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string): Promise<{ rows: unknown[] }> => {
          if (sql.includes('WITH source_counts AS')) {
            return Promise.resolve({
              rows: [
                {
                  product_id: 'prod-1',
                  title: 'Product One',
                  source_count: '2',
                  quality_score: 0.88,
                  conflicts_count: '1',
                  last_computed_at: new Date().toISOString(),
                  consensus_status: 'conflicts',
                },
              ],
            });
          }
          if (
            sql.includes('FROM prod_similarity_matches') &&
            sql.includes('psm.id as match_id') &&
            sql.includes('specs_extracted')
          ) {
            return Promise.resolve({
              rows: [
                {
                  match_id: 'match-1',
                  source_id: 'source-1',
                  source_name: 'Source One',
                  source_url: 'https://example.com',
                  similarity_score: 0.8,
                  trust_score: 0.9,
                  match_confidence: 'confirmed',
                  specs_extracted: { color: { value: 'red' } },
                  created_at: new Date().toISOString(),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return await fn(client);
    },
  },
});

void mock.module('@app/pim', {
  namedExports: {
    PROMOTION_THRESHOLDS: {
      bronze_to_silver: {
        minQualityScore: 0.6,
        minSources: 2,
        requiredFields: ['brand', 'category'],
      },
      silver_to_golden: {
        minQualityScore: 0.85,
        minSources: 3,
        requiredFields: ['gtin', 'brand', 'mpn', 'category'],
        minSpecsCount: 5,
      },
    },
    computeConsensus: () =>
      Promise.resolve({
        consensusSpecs: { color: 'red' },
        provenance: {
          color: {
            attributeName: 'color',
            sourceName: 'Source One',
            resolvedAt: new Date().toISOString(),
          },
        },
        qualityScore: 0.88,
        qualityBreakdown: {
          completeness: 0.9,
          accuracy: 0.85,
          consistency: 0.8,
          sourceWeight: 0.95,
        },
        sourceCount: 2,
        conflicts: [
          {
            attributeName: 'color',
            weightDifference: 0.1,
            requiresHumanReview: true,
            reason: 'Close match',
            autoResolveDisabled: true,
            values: [
              {
                value: 'red',
                sourceName: 'Source One',
                trustScore: 0.9,
                similarityScore: 0.8,
              },
            ],
          },
        ],
        needsReview: true,
        skippedDueToManualCorrection: [],
      }),
    computeMissingRequirements: () => [],
    evaluatePromotion: () => ({
      eligible: false,
      targetLevel: 'bronze',
      reason: 'requirements_not_met',
    }),
    getRecentEvents: () => Promise.resolve([]),
    logQualityEvent: () => Promise.resolve('event-1'),
    parseExtractedSpecs: (value: unknown) => {
      const input = value as Record<string, { value: unknown }>;
      const entries = Object.entries(input ?? {}).map(([key, spec]) => [key, spec] as const);
      return new Map(entries);
    },
  },
});

async function createApp() {
  const { consensusRoutes } = await import('../consensus.js');
  const app = Fastify();
  app.register(consensusRoutes, {
    env: {} as never,
    logger,
    sessionConfig: {
      secret: 'test',
      cookieName: 'session',
      maxAge: 3600,
    },
  });
  return app;
}

void describe('consensus routes', () => {
  void it('returns consensus products list', async () => {
    const app = await createApp();

    const response = await app.inject({ method: 'GET', url: '/pim/consensus/products' });
    assert.equal(response.statusCode, 200);
    const payload: unknown = response.json();
    const data = payload as {
      success: boolean;
      data: { items: { productId: string }[] };
    };
    assert.equal(data.success, true);
    assert.equal(data.data.items[0]?.productId, 'prod-1');
  });

  void it('returns consensus details and export', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/products/prod-1/consensus/details',
    });
    assert.equal(response.statusCode, 200);
    const payload: unknown = response.json();
    const data = payload as {
      success: boolean;
      data: { productId: string; conflictsCount: number };
    };
    assert.equal(data.success, true);
    assert.equal(data.data.productId, 'prod-1');
    assert.equal(data.data.conflictsCount, 1);

    const exportResponse = await app.inject({
      method: 'GET',
      url: '/products/prod-1/consensus/export?format=csv',
    });
    assert.equal(exportResponse.statusCode, 200);
    assert.ok(exportResponse.body.includes('attribute,value,sourcesCount,confidence'));
  });
});
