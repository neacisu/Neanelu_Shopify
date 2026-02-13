import { describe, mock, test } from 'node:test';
import assert from 'node:assert';

const addedJobs: { name: string; payload: unknown; options: unknown }[] = [];
const queryCalls: string[] = [];
let closeWorkerCalls = 0;
let closeQueueCalls = 0;

void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({}) as never,
  },
});

void mock.module('@app/database', {
  namedExports: {
    pool: {
      query: (sql: string) => {
        queryCalls.push(sql);
        return Promise.resolve({ rowCount: 1, rows: [] });
      },
    },
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: () => ({}) as never,
    createQueue: () => ({
      add: (name: string, payload: unknown, options: unknown) => {
        addedJobs.push({ name, payload, options });
        return Promise.resolve();
      },
      close: () => {
        closeQueueCalls += 1;
        return Promise.resolve();
      },
    }),
    createWorker: (
      _ctx: unknown,
      options: { processor: (job: { data?: unknown }) => Promise<unknown> }
    ) => ({
      worker: {
        close: () => {
          closeWorkerCalls += 1;
          return Promise.resolve();
        },
        isRunning: () => true,
      },
      __processor: options.processor,
    }),
    withJobTelemetryContext: async (
      job: { data?: unknown },
      runner: () => Promise<unknown>
    ): Promise<unknown> => {
      void job;
      return await runner();
    },
  },
});

void describe('mv-refresh.worker', () => {
  void test('schedules hourly and daily repeatable jobs', async () => {
    const { startMvRefreshScheduler, MV_REFRESH_DAILY_JOB, MV_REFRESH_HOURLY_JOB } =
      await import('../mv-refresh.worker.js');
    addedJobs.length = 0;
    const handle = startMvRefreshScheduler(console as never);
    await handle.close();

    const scheduledNames = addedJobs.map((job) => job.name);
    assert.equal(scheduledNames.includes(MV_REFRESH_HOURLY_JOB), true);
    assert.equal(scheduledNames.includes(MV_REFRESH_DAILY_JOB), true);
    const hourly = addedJobs.find((job) => job.name === MV_REFRESH_HOURLY_JOB);
    const daily = addedJobs.find((job) => job.name === MV_REFRESH_DAILY_JOB);
    assert.equal(
      (hourly?.options as { repeat?: { pattern?: string } })?.repeat?.pattern,
      '5 * * * *'
    );
    assert.equal(
      (daily?.options as { repeat?: { pattern?: string } })?.repeat?.pattern,
      '5 2 * * *'
    );
    assert.equal(closeWorkerCalls > 0, true);
    assert.equal(closeQueueCalls > 0, true);
  });

  void test('runs correct refresh function based on job type', async () => {
    const { runMvRefreshTick } = await import('../mv-refresh.worker.js');
    queryCalls.length = 0;

    const hourlyFn = await runMvRefreshTick({ type: 'hourly', logger: console as never });
    const dailyFn = await runMvRefreshTick({ type: 'daily', logger: console as never });

    assert.equal(hourlyFn, 'refresh_mv_hourly');
    assert.equal(dailyFn, 'refresh_mv_daily');
    assert.equal(queryCalls[0], 'SELECT refresh_mv_hourly()');
    assert.equal(queryCalls[1], 'SELECT refresh_mv_daily()');
  });
});
