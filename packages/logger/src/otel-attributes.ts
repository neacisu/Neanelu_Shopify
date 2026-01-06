export const OTEL_ATTR = {
  REQUEST_ID: 'http.request_id',

  QUEUE_NAME: 'queue.name',
  QUEUE_JOB_ID: 'queue.job.id',
  QUEUE_JOB_NAME: 'queue.job.name',
  QUEUE_GROUP_ID: 'queue.group.id',
  QUEUE_ATTEMPTS_MADE: 'queue.attempts_made',
  QUEUE_MAX_ATTEMPTS: 'queue.max_attempts',
  QUEUE_BACKOFF_MS: 'queue.backoff_ms',
  QUEUE_DELAY_MS: 'queue.delay_ms',

  SHOP_ID: 'shop.id',
  SHOP_DOMAIN: 'shop.domain',

  WEBHOOK_TOPIC: 'webhook.topic',
  WEBHOOK_ID: 'webhook.id',
} as const;

export type OtelAttrKey = (typeof OTEL_ATTR)[keyof typeof OTEL_ATTR];
