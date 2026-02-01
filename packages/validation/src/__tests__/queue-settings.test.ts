import { describe, expect, it } from 'vitest';

import { QueueConfigSchema } from '../queue-settings.js';

describe('QueueConfigSchema', () => {
  it('accepts valid config', () => {
    const result = QueueConfigSchema.safeParse({
      queueName: 'webhook-queue',
      concurrency: 10,
      maxAttempts: 3,
      dlqRetentionDays: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid concurrency', () => {
    const result = QueueConfigSchema.safeParse({
      queueName: 'webhook-queue',
      concurrency: 0,
    });
    expect(result.success).toBe(false);
  });
});
