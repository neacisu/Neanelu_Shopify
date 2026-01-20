import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const databasePath = '@app/database';
const orchestratorPath = new URL('../orchestrator.js', import.meta.url).href;

const scheduleRows = [
  {
    id: 'sched-1',
    cron: '*/5 * * * *',
    timezone: 'UTC',
    next_run_at: null,
  },
];

const updates: { id: string }[] = [];
const enqueueCalls: Record<string, unknown>[] = [];

void mock.module(databasePath, {
  namedExports: {
    pool: {
      query: (_sql: string) => Promise.resolve({ rows: [{ id: 'shop-1' }] }),
    },
    withTenantContext: (
      _shopId: string,
      fn: (client: {
        query: (sql: string, params?: unknown[]) => Promise<unknown>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string, params?: unknown[]) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bulk_schedules')) {
            return Promise.resolve({ rows: scheduleRows });
          }
          if (lower.includes('update bulk_schedules')) {
            const idParam = params?.[2];
            updates.push({ id: typeof idParam === 'string' ? idParam : '' });
            return Promise.resolve({ rowCount: 1 });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return fn(client);
    },
  },
});

void mock.module(orchestratorPath, {
  namedExports: {
    startBulkQueryFromContract: (_shopId: string, options: Record<string, unknown>) => {
      enqueueCalls.push(options);
      return Promise.resolve();
    },
  },
});

const { runBulkScheduleTick } = await import('../schedule.worker.js');

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};

void describe('bulk schedule worker', () => {
  void it('enqueues a bulk run for due schedules and updates next_run_at', async () => {
    updates.length = 0;
    enqueueCalls.length = 0;

    await runBulkScheduleTick(logger as never);

    assert.equal(enqueueCalls.length, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.id, 'sched-1');
  });
});
