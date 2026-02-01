import { z } from 'zod';

export const QueueConfigSchema = z.object({
  queueName: z.string().min(1, 'Queue name is required'),
  concurrency: z.number().int().min(1).max(50).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  backoffType: z.enum(['exponential', 'fixed']).optional(),
  backoffDelayMs: z.number().int().min(0).optional(),
  dlqRetentionDays: z.number().int().min(7).max(90).optional(),
});

export type QueueConfigInput = z.infer<typeof QueueConfigSchema>;
