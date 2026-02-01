import { trace } from '@opentelemetry/api';

export const AI_EVENTS = {
  BATCH_SUBMITTED: 'ai.batch.submitted',
  BATCH_COMPLETED: 'ai.batch.completed',
  BATCH_FAILED: 'ai.batch.failed',
  DLQ_MOVE: 'ai.dlq.move',
  ERROR_CLASSIFIED: 'ai.error.classified',
  EMBEDDING_RETRY: 'ai.embedding.retry',
} as const;

export function addAiEvent(
  eventName: (typeof AI_EVENTS)[keyof typeof AI_EVENTS],
  attributes?: Record<string, string | number | boolean>
): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.addEvent(eventName, attributes);
}
