import type { BulkPollerJobPayload } from '@app/types';
import {
  enqueueBulkPollerJob,
  BULK_POLLER_QUEUE_NAME,
  configFromEnv,
  createQueue,
} from '@app/queue-manager';
import { loadEnv } from '@app/config';

let pollerQueue: ReturnType<typeof createQueue> | null = null;

function getQueue() {
  if (!pollerQueue) {
    const env = loadEnv();
    pollerQueue = createQueue({ config: configFromEnv(env) }, { name: BULK_POLLER_QUEUE_NAME });
  }
  return pollerQueue;
}

/**
 * Remove any existing completed/failed poller job for this bulkRunId,
 * then enqueue a fresh one. Required for retry because BullMQ ignores
 * queue.add() when a job with the same ID already exists.
 */
export async function enqueueBulkPollerJobWithUniqueId(
  payload: BulkPollerJobPayload
): Promise<void> {
  const queue = getQueue();
  const oldJobId = `bulk-poller__${payload.bulkRunId}`;

  const existingJob = await queue.getJob(oldJobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'completed' || state === 'failed') {
      await existingJob.remove();
    }
  }

  await enqueueBulkPollerJob(payload);
}
