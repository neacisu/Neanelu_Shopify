import { beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

const lexQueuesPath = new URL('../../../queue/lex-queues.js', import.meta.url).href;
const advisoryLocksPath = new URL('../advisory-locks.js', import.meta.url).href;

/** Scenariu pentru lanțul de query-uri din recoverLexRun + loadLexCheckpoint (nested withTenantContext). */
interface RecoveryQueryScenario {
  lexRunRow: { status: string; currentPhase: string | null } | null;
  completedShardsRows: { id: string; phaseName: string; completedAt: string | null }[];
  remainingRows: { id: string; phaseName: string; status: string }[];
}

let scenario: RecoveryQueryScenario = {
  lexRunRow: null,
  completedShardsRows: [],
  remainingRows: [],
};

let forceEnqueueCalls = 0;

mock.module(lexQueuesPath, {
  namedExports: {
    forceEnqueueLexShardJob: () => {
      forceEnqueueCalls += 1;
      return Promise.resolve();
    },
    lexRunTypePriority: () => 0,
    LEX_EXTRACT_FRAGMENTS_QUEUE_NAME: 'lex-extract-fragments',
    LEX_EXTRACT_ENTITIES_QUEUE_NAME: 'lex-extract-entities',
    LEX_MINE_TERMS_QUEUE_NAME: 'lex-mine-terms',
    LEX_AGGREGATE_STATS_QUEUE_NAME: 'lex-aggregate-stats',
    LEX_BUILD_CONTEXTS_QUEUE_NAME: 'lex-build-contexts',
    LEX_EMBED_CONTEXTS_QUEUE_NAME: 'lex-embed-contexts',
    LEX_CLUSTER_SENSES_QUEUE_NAME: 'lex-cluster-senses',
    LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME: 'lex-resolve-attributes',
    LEX_TRANSLATE_CANDIDATES_QUEUE_NAME: 'lex-translate-candidates',
    LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME: 'lex-compose-localizations',
    LEX_REVIEW_ENQUEUE_QUEUE_NAME: 'lex-review-enqueue',
    LEX_PUBLISH_QUEUE_NAME: 'lex-publish',
  },
});

mock.module(advisoryLocksPath, {
  namedExports: {
    withLexAdvisoryLock: async <T>(opts: { fn: (client: unknown) => Promise<T> }): Promise<T> =>
      opts.fn({
        query: () => Promise.resolve({ rows: [] }),
      }),
  },
});

mock.module('@app/database', {
  namedExports: {
    logAuditEvent: () => Promise.resolve(undefined),
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (
          sql: string,
          values?: unknown[]
        ) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string) => {
          if (sql.includes('FROM lex_runs') && sql.includes('current_phase')) {
            return Promise.resolve({
              rows: scenario.lexRunRow ? [scenario.lexRunRow] : [],
              rowCount: scenario.lexRunRow ? 1 : 0,
            });
          }
          if (sql.includes("status = 'completed'") && sql.includes('lex_run_shards')) {
            return Promise.resolve({
              rows: scenario.completedShardsRows,
              rowCount: scenario.completedShardsRows.length,
            });
          }
          if (sql.includes("IN ('pending', 'running', 'retrying', 'failed')")) {
            return Promise.resolve({
              rows: scenario.remainingRows,
              rowCount: scenario.remainingRows.length,
            });
          }
          if (sql.startsWith('UPDATE lex_runs') && sql.includes('paused')) {
            return Promise.resolve({ rows: [], rowCount: 1 });
          }
          if (sql.startsWith('UPDATE lex_run_shards')) {
            return Promise.resolve({ rows: [], rowCount: 0 });
          }
          if (sql.includes('COUNT(*)::text AS c')) {
            return Promise.resolve({ rows: [{ c: '0' }], rowCount: 1 });
          }
          if (
            sql.includes('FROM lex_run_shards') &&
            sql.includes('pending') &&
            sql.includes('SELECT id')
          ) {
            return Promise.resolve({ rows: [], rowCount: 0 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
      };
      return fn(client);
    },
  },
});

const { recoverLexRun } = await import('../run-lifecycle.js');

function createTestLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };
  return logger;
}

void describe('recoverLexRun', () => {
  beforeEach(() => {
    forceEnqueueCalls = 0;
    scenario = {
      lexRunRow: null,
      completedShardsRows: [],
      remainingRows: [],
    };
  });

  void test('returnează run_not_found când nu există rând în lex_runs', async () => {
    scenario.lexRunRow = null;
    const out = await recoverLexRun({
      shopId: 's1',
      runId: 'r1',
      logger: createTestLogger(),
    });
    assert.deepEqual(out, { recovered: false, reason: 'run_not_found' });
    assert.equal(forceEnqueueCalls, 0);
  });

  void test('returnează run_already_terminal pentru run finalizat', async () => {
    scenario.lexRunRow = { status: 'completed', currentPhase: 'extract.fragments' };
    const out = await recoverLexRun({
      shopId: 's1',
      runId: 'r1',
      logger: createTestLogger(),
    });
    assert.deepEqual(out, { recovered: false, reason: 'run_already_terminal:completed' });
    assert.equal(forceEnqueueCalls, 0);
  });

  void test('returnează unknown_phase pentru current_phase invalid', async () => {
    scenario.lexRunRow = { status: 'running', currentPhase: 'not-a-real-phase' };
    const out = await recoverLexRun({
      shopId: 's1',
      runId: 'r1',
      logger: createTestLogger(),
    });
    assert.equal(out.recovered, false);
    assert.ok(out.reason.startsWith('unknown_phase:'));
    assert.equal(forceEnqueueCalls, 0);
  });
});
