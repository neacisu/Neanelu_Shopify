import { EventEmitter } from 'node:events';

export type QueueStreamEvent =
  | {
      type: 'job.started';
      queueName: string;
      jobId: string;
      jobName: string;
      attemptsMade: number | null;
      maxAttempts: number | null;
      timestamp: string;
    }
  | {
      type: 'job.completed';
      queueName: string;
      jobId: string;
      jobName: string;
      durationMs: number | null;
      timestamp: string;
    }
  | {
      type: 'job.failed';
      queueName: string;
      jobId: string;
      jobName: string;
      attemptsMade: number | null;
      maxAttempts: number | null;
      exhausted: boolean;
      errorMessage: string | null;
      timestamp: string;
    }
  | {
      type: 'worker.online' | 'worker.offline';
      workerId: string;
      timestamp: string;
    };

const emitter = new EventEmitter();

export function emitQueueStreamEvent(event: QueueStreamEvent): void {
  emitter.emit('event', event);
}

export function onQueueStreamEvent(handler: (event: QueueStreamEvent) => void): () => void {
  emitter.on('event', handler);
  return () => emitter.off('event', handler);
}
