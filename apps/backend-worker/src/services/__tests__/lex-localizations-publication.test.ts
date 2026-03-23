import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert';

import type { LexPublicationPublishClient } from '../lex-localizations.js';

interface QueryResult {
  rows: unknown[];
  rowCount?: number;
}

interface RecordedSqlCall {
  sql: string;
  values?: readonly unknown[];
}

function recordSqlCall(calls: RecordedSqlCall[], sql: string, values?: readonly unknown[]): void {
  if (values === undefined) {
    calls.push({ sql });
  } else {
    calls.push({ sql, values });
  }
}

let tenantClientFactory: (() => LexPublicationPublishClient) | undefined;

mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: LexPublicationPublishClient) => Promise<unknown>
    ) => {
      if (tenantClientFactory === undefined) {
        throw new Error('withTenantContext called without tenantClientFactory set');
      }
      return await fn(tenantClientFactory());
    },
  },
});

const lexModule = await import('../lex-localizations.js');
const { publishLexPublicationTargetWithClient, rollbackLexPublicationTarget } = lexModule;

function createPublicationTargetSelectRow(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: 'pt-1',
    status: 'pending',
    localizationId: null,
    targetType: 'lex_unknown_future_target',
    targetRecordId: 'prod-1',
    targetPath: null,
    payload: {},
    entityType: 'product',
    entityId: 'prod-1',
    targetLang: 'en',
    titleText: null,
    descriptionText: null,
    descriptionShort: null,
    seoTitle: null,
    seoDescription: null,
    keywords: null,
    qualityScore: null,
    ...overrides,
  };
}

function createSequentialQueryClient(sequence: QueryResult[]): LexPublicationPublishClient {
  let index = 0;
  return {
    query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
      _sql: string,
      _values?: readonly unknown[]
    ) => {
      const next = sequence[index] ?? sequence.at(-1) ?? { rows: [] };
      index += 1;
      return Promise.resolve({
        rows: next.rows as TRow[],
        rowCount: next.rowCount ?? 0,
      });
    },
  };
}

await describe('lex-localizations publication / rollback', async () => {
  afterEach(() => {
    tenantClientFactory = undefined;
  });

  await describe('publishLexPublicationTargetWithClient', async () => {
    await test('returns skipped when publication target row is missing', async () => {
      const client = createSequentialQueryClient([{ rows: [] }]);
      const outcome = await publishLexPublicationTargetWithClient(client, {
        shopId: 'shop-1',
        publicationTargetId: 'pt-missing',
      });
      assert.strictEqual(outcome, 'skipped');
    });

    await test('returns skipped when target status is not pending', async () => {
      const client = createSequentialQueryClient([
        { rows: [createPublicationTargetSelectRow({ status: 'published' })] },
      ]);
      const outcome = await publishLexPublicationTargetWithClient(client, {
        shopId: 'shop-1',
        publicationTargetId: 'pt-1',
      });
      assert.strictEqual(outcome, 'skipped');
    });

    await test('returns skipped and marks target when targetRecordId is missing for non–attr-synonym types', async () => {
      const calls: RecordedSqlCall[] = [];
      const client: LexPublicationPublishClient = {
        query: (sql: string, values?: readonly unknown[]) => {
          recordSqlCall(calls, sql, values);
          if (sql.includes('FROM lex_publication_targets pt')) {
            return Promise.resolve({
              rows: [
                createPublicationTargetSelectRow({
                  targetType: 'prod_translations',
                  targetRecordId: null,
                  entityId: null,
                }) as never,
              ],
              rowCount: 1,
            });
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        },
      };
      const outcome = await publishLexPublicationTargetWithClient(client, {
        shopId: 'shop-1',
        publicationTargetId: 'pt-1',
      });
      assert.strictEqual(outcome, 'skipped');
      assert.ok(
        calls.some(
          (c) =>
            c.sql.includes('UPDATE lex_publication_targets') &&
            c.sql.includes('attempt_count') &&
            Array.isArray(c.values) &&
            c.values.includes('missing_target_record')
        )
      );
    });

    await test('unsupported targetType marks skip and returns skipped', async () => {
      const calls: RecordedSqlCall[] = [];
      const client: LexPublicationPublishClient = {
        query: (sql: string, values?: readonly unknown[]) => {
          recordSqlCall(calls, sql, values);
          if (sql.includes('FROM lex_publication_targets pt')) {
            return Promise.resolve({
              rows: [createPublicationTargetSelectRow() as never],
              rowCount: 1,
            });
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        },
      };
      const outcome = await publishLexPublicationTargetWithClient(client, {
        shopId: 'shop-1',
        publicationTargetId: 'pt-1',
      });
      assert.strictEqual(outcome, 'skipped');
      const eventInsert = calls.find((c) => c.sql.includes('INSERT INTO lex_publish_events'));
      assert.ok(eventInsert, 'expected lex_publish_events insert');
      assert.ok(
        JSON.stringify(eventInsert.values).includes('publish_target_not_supported_yet'),
        'expected unsupported reason in publish event payload'
      );
    });
  });

  await describe('rollbackLexPublicationTarget', async () => {
    await test('returns skipped when target row is missing', async () => {
      tenantClientFactory = () => createSequentialQueryClient([{ rows: [] }]);
      const outcome = await rollbackLexPublicationTarget({
        shopId: 'shop-1',
        publicationTargetId: 'missing',
      });
      assert.strictEqual(outcome, 'skipped');
    });

    await test('returns failed when rollback is not allowed (unsupported target type)', async () => {
      tenantClientFactory = () =>
        createSequentialQueryClient([
          {
            rows: [
              {
                id: 'pt-1',
                targetType: 'unknown_rollback_type',
                targetRecordId: 'x',
                targetPath: null,
                previousSnapshot: {},
                payload: {},
              },
            ],
          },
          { rows: [], rowCount: 1 },
          { rows: [], rowCount: 1 },
        ]);
      const outcome = await rollbackLexPublicationTarget({
        shopId: 'shop-1',
        publicationTargetId: 'pt-1',
      });
      assert.strictEqual(outcome, 'failed');
    });

    await test('rolls back shopify_collections.title_en and marks rolled_back', async () => {
      const calls: RecordedSqlCall[] = [];
      tenantClientFactory = (): LexPublicationPublishClient => ({
        query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          values?: readonly unknown[]
        ) => {
          recordSqlCall(calls, sql, values);
          if (sql.includes('FROM lex_publication_targets') && sql.includes('FOR UPDATE')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'pt-1',
                  targetType: 'shopify_collections.title_en',
                  targetRecordId: 'coll-1',
                  targetPath: null,
                  previousSnapshot: { value: 'Previous title' },
                  payload: {},
                },
              ] as unknown as TRow[],
              rowCount: 1,
            });
          }
          return Promise.resolve({ rows: [] as TRow[], rowCount: 1 });
        },
      });
      const outcome = await rollbackLexPublicationTarget({
        shopId: 'shop-1',
        publicationTargetId: 'pt-1',
      });
      assert.strictEqual(outcome, 'rolled_back');
      assert.ok(calls.some((c) => c.sql.includes('UPDATE shopify_collections')));
      assert.ok(
        calls.some(
          (c) =>
            c.sql.includes('UPDATE lex_publication_targets') &&
            c.sql.includes("status = 'rolled_back'")
        )
      );
      assert.ok(calls.some((c) => c.sql.includes('INSERT INTO lex_publish_events')));
    });
  });
});
