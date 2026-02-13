import type { Logger } from '@app/logger';
import {
  type CostSensitiveQueueName,
  COST_SENSITIVE_QUEUE_NAMES,
  createQueue,
  type QueueManagerConfig,
} from '@app/queue-manager';
import { recordPimQueuePaused, recordPimQueueResumed } from '../../otel/metrics.js';

export type QueuePauseResumeTrigger = 'manual' | 'budget_enforcement' | 'scheduler';

export type QueueControlResult = Readonly<{
  queueName: CostSensitiveQueueName;
  changed: boolean;
  paused: boolean;
  error?: string;
}>;

export async function pauseCostSensitiveQueues(params: {
  config: QueueManagerConfig;
  trigger: QueuePauseResumeTrigger;
  logger: Logger;
}): Promise<readonly QueueControlResult[]> {
  const results: QueueControlResult[] = [];
  for (const queueName of COST_SENSITIVE_QUEUE_NAMES) {
    const queue = createQueue({ config: params.config }, { name: queueName });
    try {
      const paused = await queue.isPaused();
      if (!paused) {
        await queue.pause();
        recordPimQueuePaused(params.trigger, queueName);
        params.logger.info(
          { queueName, trigger: params.trigger },
          'Queue paused by budget governance'
        );
        results.push({ queueName, changed: true, paused: true });
      } else {
        results.push({ queueName, changed: false, paused: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.warn(
        { queueName, trigger: params.trigger, error: message },
        'Failed to pause queue in budget governance'
      );
      results.push({ queueName, changed: false, paused: false, error: message });
    } finally {
      await queue.close().catch(() => undefined);
    }
  }
  return results;
}

export async function resumeCostSensitiveQueues(params: {
  config: QueueManagerConfig;
  trigger: QueuePauseResumeTrigger;
  logger: Logger;
}): Promise<readonly QueueControlResult[]> {
  const results: QueueControlResult[] = [];
  for (const queueName of COST_SENSITIVE_QUEUE_NAMES) {
    const queue = createQueue({ config: params.config }, { name: queueName });
    try {
      const paused = await queue.isPaused();
      if (paused) {
        await queue.resume();
        recordPimQueueResumed(params.trigger, queueName);
        params.logger.info(
          { queueName, trigger: params.trigger },
          'Queue resumed by budget governance'
        );
        results.push({ queueName, changed: true, paused: false });
      } else {
        results.push({ queueName, changed: false, paused: false });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.warn(
        { queueName, trigger: params.trigger, error: message },
        'Failed to resume queue in budget governance'
      );
      results.push({ queueName, changed: false, paused: true, error: message });
    } finally {
      await queue.close().catch(() => undefined);
    }
  }
  return results;
}

export async function readCostSensitiveQueueStatus(
  config: QueueManagerConfig
): Promise<readonly { queueName: CostSensitiveQueueName; paused: boolean; error?: string }[]> {
  const statuses: { queueName: CostSensitiveQueueName; paused: boolean; error?: string }[] = [];
  for (const queueName of COST_SENSITIVE_QUEUE_NAMES) {
    const queue = createQueue({ config }, { name: queueName });
    try {
      const paused = await queue.isPaused();
      statuses.push({ queueName, paused });
    } catch (error) {
      statuses.push({
        queueName,
        paused: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await queue.close().catch(() => undefined);
    }
  }
  return statuses;
}
