import { beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert';

const workerRegistryPath = new URL('../../runtime/worker-registry.js', import.meta.url).href;
const metricsPath = new URL('../../otel/metrics.js', import.meta.url).href;

const queueCounts = new Map<
  string,
  { waiting: number; active: number; delayed: number; failed: number; completed: number }
>([
  ['lex.extract.fragments', { waiting: 2, active: 1, delayed: 0, failed: 0, completed: 5 }],
  ['lex.extract.fragments-dlq', { waiting: 0, active: 0, delayed: 0, failed: 1, completed: 0 }],
  ['lex.publish', { waiting: 1, active: 0, delayed: 0, failed: 0, completed: 3 }],
  ['lex.publish-dlq', { waiting: 2, active: 0, delayed: 0, failed: 0, completed: 0 }],
]);

const metricsState = {
  latestSnapshot: null as Record<string, unknown> | null,
  workersOnline: -1,
};

mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: <TRow extends Record<string, unknown>>() => Promise<{ rows: TRow[] }>;
      }) => Promise<unknown>
    ) =>
      await fn({
        query: <TRow extends Record<string, unknown>>(): Promise<{ rows: TRow[] }> =>
          Promise.resolve({
            rows: [
              {
                runsTotal: '8',
                termsTotal: '120',
                clustersTotal: '33',
                glossaryTotal: '14',
                reviewPending: '5',
                reviewBacklog: '7',
                localizationsApproved: '11',
                publicationsPending: '4',
                runsActive: '2',
                runsPaused: '1',
                shardsFailed: '3',
                publicationsFailed: '2',
                publishConflicts: '1',
                staleCheckpoints: '2',
                retentionLag: '90061',
                aiBatchBacklog: '6',
                tmHits: '12',
                tmMisses: '4',
                tmAverageSimilarity: '0.931',
              } as unknown as TRow,
            ],
          }),
      }),
  },
});

mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: () => ({}),
    createQueue: (_ctx: unknown, opts: { name: string }) => ({
      getJobCounts: () =>
        queueCounts.get(opts.name) ?? {
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 0,
        },
      close: () => undefined,
    }),
    toDlqQueueName: (name: string) => `${name}-dlq`,
  },
});

mock.module(workerRegistryPath, {
  namedExports: {
    getWorkerReadiness: () => ({
      lexExtractFragmentsWorkerOk: true,
      lexExtractEntitiesWorkerOk: true,
      lexMineTermsWorkerOk: true,
      lexAggregateStatsWorkerOk: true,
      lexBuildContextsWorkerOk: true,
      lexEmbedContextsWorkerOk: true,
      lexClusterSensesWorkerOk: true,
      lexResolveAttributesWorkerOk: true,
      lexTranslateCandidatesWorkerOk: true,
      lexComposeLocalizationsWorkerOk: true,
      lexReviewEnqueueWorkerOk: true,
      lexPublishWorkerOk: false,
      lexScheduleWorkerOk: true,
      lexRetentionWorkerOk: true,
    }),
    getWorkerCurrentJob: (workerId: string) =>
      workerId === 'lex-extract-fragments-worker'
        ? {
            jobId: 'job-1',
            jobName: 'lex.shard.process',
            startedAtIso: '2026-03-15T10:00:00.000Z',
            progressPct: 42,
          }
        : null,
  },
});

mock.module(metricsPath, {
  namedExports: {
    setLexMetricsSnapshot: (shopId: string, snapshot: Record<string, unknown>) => {
      metricsState.latestSnapshot = { shopId, ...snapshot };
    },
    setLexWorkersOnline: (value: number) => {
      metricsState.workersOnline = value;
    },
  },
});

await describe('lex-ops service', async () => {
  beforeEach(() => {
    metricsState.latestSnapshot = null;
    metricsState.workersOnline = -1;
  });

  await test('collectLexMetrics returns operator health, queue links, and alerts', async () => {
    const { collectLexMetrics } = await import('../lex-ops.js');

    const metrics = await collectLexMetrics({
      shopId: '019ce225-d348-7611-8791-92fdf068cb2d',
      env: { redisUrl: 'redis://localhost:6379' } as never,
    });

    assert.strictEqual(metrics.runsPaused, 1);
    assert.strictEqual(metrics.aiBatchBacklog, 6);
    assert.strictEqual(metrics.tmHits, 12);
    assert.strictEqual(metrics.tmMisses, 4);
    assert.strictEqual(metrics.tmHitRatePercent, 75);
    assert.strictEqual(metrics.tmMissRatePercent, 25);
    assert.ok(
      metrics.tmAverageSimilarity != null && Math.abs(metrics.tmAverageSimilarity - 0.931) < 0.0001
    );
    assert.strictEqual(metrics.dlqEntries, 3);
    assert.strictEqual(metrics.workersTotal, 14);
    assert.strictEqual(metrics.workersOnline, 13);
    assert.ok(metrics.queues.some((queue) => queue.name === 'lex.publish'));
    assert.ok(metrics.queues.some((queue) => queue.dlqEntries > 0));
    assert.ok(metrics.alerts.some((alert) => alert.key === 'lex-dlq-present'));
    assert.ok(metrics.alerts.some((alert) => alert.key === 'stale-checkpoints'));
    assert.ok(metrics.alerts.some((alert) => alert.key === 'worker-offline:lex-publish-worker'));
    assert.ok(metricsState.latestSnapshot);
    assert.strictEqual(metricsState.workersOnline, 13);
  });

  await test('buildLexPublicationQueueLinks points to generic queue monitor', async () => {
    const { buildLexPublicationQueueLinks } = await import('../lex-ops.js');

    const links = buildLexPublicationQueueLinks();

    assert.strictEqual(links.queueName, 'lex.publish');
    assert.strictEqual(links.dlqQueueName, 'lex.publish-dlq');
    assert.match(links.queueUrl, /queue=lex\.publish/);
    assert.match(links.dlqUrl, /queue=lex\.publish-dlq/);
  });
});
