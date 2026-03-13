import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const addCalls: { jobId: string | undefined; trigger: string }[] = [];
const removedJobIds: string[] = [];
const jobs = new Map<
  string,
  { id: string; state: string; getState: () => Promise<string>; remove: () => Promise<void> }
>();

function seedJob(id: string, state: string) {
  jobs.set(id, {
    id,
    state,
    getState: () => Promise.resolve(state),
    remove: () => {
      removedJobIds.push(id);
      jobs.delete(id);
      return Promise.resolve();
    },
  });
}

void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({
      redisUrl: 'redis://localhost:6379',
      bullmqProToken: 'x',
      maxActivePerShop: 1,
      maxGlobalConcurrency: 1,
      starvationTimeoutMs: 1000,
    }),
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: () => ({}),
    createQueue: (_ctx: unknown, _opts: unknown) => ({
      getJob: (jobId: string) => Promise.resolve(jobs.get(jobId) ?? null),
      add: (_name: string, data: { trigger: string }, opts?: { jobId?: string }) => {
        const jobId = opts?.jobId;
        if (!jobId) {
          throw new Error('jobId_required_for_test');
        }
        addCalls.push({ jobId, trigger: data.trigger });
        seedJob(jobId, 'waiting');
        return Promise.resolve({ id: jobId });
      },
      close: () => Promise.resolve(),
    }),
  },
});

const { buildConsensusJobId, buildConsensusLaneJobId, enqueueConsensusJob } =
  await import('../consensus-queue.js');

void describe('consensus queue dedupe', () => {
  beforeEach(() => {
    addCalls.length = 0;
    removedJobIds.length = 0;
    jobs.clear();
  });

  void it('deduplicates post-automation consensus jobs per product settlement lane', async () => {
    const firstJobId = await enqueueConsensusJob({
      shopId: 'shop-1',
      productId: 'product-1',
      trigger: 'extraction_complete',
    });
    const secondJobId = await enqueueConsensusJob({
      shopId: 'shop-1',
      productId: 'product-1',
      trigger: 'ai_audit_complete',
    });

    assert.equal(firstJobId, buildConsensusLaneJobId('product-1', 'settlement'));
    assert.equal(secondJobId, firstJobId);
    assert.equal(addCalls.length, 1);
    assert.deepEqual(
      addCalls.map((call) => call.trigger),
      ['extraction_complete']
    );
  });

  void it('keeps bootstrap and settlement consensus lanes separate for the same product', async () => {
    const bootstrapJobId = await enqueueConsensusJob({
      shopId: 'shop-1',
      productId: 'product-1',
      trigger: 'direct_sync',
    });
    const settlementJobId = await enqueueConsensusJob({
      shopId: 'shop-1',
      productId: 'product-1',
      trigger: 'extraction_complete',
    });

    assert.equal(bootstrapJobId, buildConsensusLaneJobId('product-1', 'bootstrap'));
    assert.equal(settlementJobId, buildConsensusLaneJobId('product-1', 'settlement'));
    assert.equal(addCalls.length, 2);
    assert.deepEqual(
      addCalls.map((call) => call.jobId),
      [bootstrapJobId, settlementJobId]
    );
  });

  void it('removes completed jobs before re-enqueueing the same consensus lane', async () => {
    const jobId = buildConsensusJobId({
      productId: 'product-1',
      trigger: 'similarity_complete',
    });
    seedJob(jobId, 'completed');

    const requeuedJobId = await enqueueConsensusJob({
      shopId: 'shop-1',
      productId: 'product-1',
      trigger: 'similarity_complete',
    });

    assert.equal(requeuedJobId, jobId);
    assert.deepEqual(removedJobIds, [jobId]);
    assert.equal(addCalls.length, 1);
  });
});
