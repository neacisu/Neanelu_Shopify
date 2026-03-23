import { beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

const featureFlagsPath = new URL(
  '../../processors/bulk-operations/feature-flags.js',
  import.meta.url
).href;
const requireAdminPath = new URL('../require-admin.js', import.meta.url).href;
type QueryRow = Record<string, unknown>;

let lexSettingsRows: QueryRow[] = [];

mock.module(featureFlagsPath, {
  namedExports: {
    isFeatureFlagEnabled: () => Promise.resolve(true),
  },
});

mock.module(requireAdminPath, {
  namedExports: {
    hasAdminAccess: () => Promise.resolve(true),
  },
});

mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (sql: string, params: unknown[]) => Promise<{ rows: QueryRow[] }>;
      }) => Promise<unknown>
    ) =>
      fn({
        query: () => Promise.resolve({ rows: lexSettingsRows }),
      }),
  },
});

const { resolveLexBootstrap, normalizeLexShopSettingsRow } =
  await import('../require-lex-access.js');

void describe('normalizeLexShopSettingsRow', () => {
  void test('maps invalid guardrailsLexMode to warn and keeps known counters', () => {
    const shopId = 'acme.myshopify.com';
    const out = normalizeLexShopSettingsRow(
      {
        shopId,
        version: 1,
        enabled: true,
        sourceLang: 'ro',
        targetLangs: ['en'],
        extractScope: {},
        shardSize: 10_000,
        thresholds: {},
        retentionDaysFragments: 90,
        retentionDaysOccurrences: 90,
        retentionDaysContexts: 180,
        autoPublishProducts: false,
        autoPublishAttributes: false,
        autoPublishCollections: false,
        translationMode: 'auto',
        consensusEscalationThreshold: 0.8,
        translationAutoApproveThreshold: 0.93,
        localizationAutoApproveThreshold: 0.85,
        tmEnabled: true,
        tmSimilarityThreshold: 0.92,
        qualityAuditEnabled: true,
        qualityAuditMinBatchSize: 50,
        maxTermsPerLlmBatch: 10,
        guardrailsLexMode: 'not-a-mode' as 'warn',
        guardrailsWarnThreshold: 500,
        guardrailsWarnCount: 2,
        guardrailsBlockCount: 1,
        guardrailsFalsePositiveCount: 0,
        guardrailsLastEvaluatedAt: null,
      },
      shopId
    );

    assert.equal(out.guardrailsLexMode, 'warn');
    assert.equal(out.guardrailsWarnThreshold, 500);
    assert.equal(out.guardrailsWarnCount, 2);
    assert.equal(out.guardrailsBlockCount, 1);
  });

  void test('parses enforce mode and coerces last evaluated timestamp from Date', () => {
    const shopId = 'acme.myshopify.com';
    const t = new Date('2026-03-01T12:00:00.000Z');
    const out = normalizeLexShopSettingsRow(
      {
        shopId,
        version: 1,
        enabled: true,
        sourceLang: 'ro',
        targetLangs: ['en'],
        extractScope: {},
        shardSize: 10_000,
        thresholds: {},
        retentionDaysFragments: 90,
        retentionDaysOccurrences: 90,
        retentionDaysContexts: 180,
        autoPublishProducts: false,
        autoPublishAttributes: false,
        autoPublishCollections: false,
        translationMode: 'auto',
        consensusEscalationThreshold: 0.8,
        translationAutoApproveThreshold: 0.93,
        localizationAutoApproveThreshold: 0.85,
        tmEnabled: true,
        tmSimilarityThreshold: 0.92,
        qualityAuditEnabled: true,
        qualityAuditMinBatchSize: 50,
        maxTermsPerLlmBatch: 10,
        guardrailsLexMode: 'enforce',
        guardrailsWarnThreshold: 1000,
        guardrailsWarnCount: 0,
        guardrailsBlockCount: 0,
        guardrailsFalsePositiveCount: 0,
        guardrailsLastEvaluatedAt: t as unknown as string | null,
      },
      shopId
    );

    assert.equal(out.guardrailsLexMode, 'enforce');
    assert.equal(out.guardrailsLastEvaluatedAt, '2026-03-01T12:00:00.000Z');
  });
});

void describe('resolveLexBootstrap / lex_shop_settings DTO', () => {
  beforeEach(() => {
    lexSettingsRows = [];
  });

  void test('uses defaults when no settings row exists (shop disabled)', async () => {
    const bootstrap = await resolveLexBootstrap({
      shopId: 'acme.myshopify.com',
      staffUserId: '1',
    } as never);

    assert.equal(bootstrap.shopEnabled, false);
    assert.equal(bootstrap.permissions.canView, false);
  });

  void test('loads enabled shop when row is returned from DB', async () => {
    lexSettingsRows = [
      {
        shopId: 'acme.myshopify.com',
        version: 1,
        enabled: true,
        sourceLang: 'ro',
        targetLangs: ['en'],
        extractScope: {},
        shardSize: 10000,
        thresholds: {},
        retentionDaysFragments: 90,
        retentionDaysOccurrences: 90,
        retentionDaysContexts: 180,
        autoPublishProducts: false,
        autoPublishAttributes: false,
        autoPublishCollections: false,
        translationMode: 'auto',
        consensusEscalationThreshold: 0.8,
        translationAutoApproveThreshold: 0.93,
        localizationAutoApproveThreshold: 0.85,
        tmEnabled: true,
        tmSimilarityThreshold: 0.92,
        qualityAuditEnabled: true,
        qualityAuditMinBatchSize: 50,
        maxTermsPerLlmBatch: 10,
        guardrailsLexMode: 'progressive',
        guardrailsWarnThreshold: 1000,
        guardrailsWarnCount: 0,
        guardrailsBlockCount: 0,
        guardrailsFalsePositiveCount: 0,
        guardrailsLastEvaluatedAt: null,
      },
    ];

    const bootstrap = await resolveLexBootstrap({
      shopId: 'acme.myshopify.com',
      staffUserId: '1',
    } as never);

    assert.equal(bootstrap.shopEnabled, true);
    assert.equal(bootstrap.permissions.canView, true);
  });
});
