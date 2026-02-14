import { z } from 'zod';

export const SimilarityMatchCreateSchema = z
  .object({
    productId: z.string().min(1),
    sourceUrl: z.string().url(),
    sourceTitle: z.string().min(1).optional(),
    sourceGtin: z.string().min(1).optional(),
    sourceBrand: z.string().min(1).optional(),
    sourceProductId: z.string().min(1).optional(),
    sourcePrice: z.union([z.number(), z.string()]).optional(),
    sourceCurrency: z.string().min(1).optional(),
    sourceData: z.record(z.string(), z.unknown()).optional(),
    similarityScore: z.number().finite(),
    matchMethod: z.string().min(1),
  })
  .strict();

export const SimilarityMatchConfidenceSchema = z
  .object({
    confidence: z.enum(['pending', 'confirmed', 'rejected', 'uncertain']),
    rejectionReason: z.string().min(1).optional(),
  })
  .strict();

export const PimBudgetsUpdateSchema = z
  .object({
    serperDailyBudget: z.number().min(0).max(100000).optional(),
    serperBudgetAlertThreshold: z.number().min(0.5).max(0.99).optional(),
    xaiDailyBudget: z.number().min(0).max(100000).optional(),
    xaiBudgetAlertThreshold: z.number().min(0.5).max(0.99).optional(),
    openaiDailyBudget: z.number().min(0).max(100000).optional(),
    openaiBudgetAlertThreshold: z.number().min(0.5).max(0.99).optional(),
    openaiItemsDailyBudget: z.number().min(0).max(100000).optional(),
  })
  .strict();

export const QualityWebhookConfigUpdateSchema = z
  .object({
    url: z.string().url().optional(),
    secret: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    subscribedEvents: z
      .array(
        z.enum(['quality_promoted', 'quality_demoted', 'review_requested', 'milestone_reached'])
      )
      .min(1)
      .optional(),
    regenerateSecret: z.boolean().optional(),
  })
  .strict();

export type SimilarityMatchCreateInput = z.infer<typeof SimilarityMatchCreateSchema>;
export type SimilarityMatchConfidenceInput = z.infer<typeof SimilarityMatchConfidenceSchema>;
export type PimBudgetsUpdateInput = z.infer<typeof PimBudgetsUpdateSchema>;
export type QualityWebhookConfigUpdateInput = z.infer<typeof QualityWebhookConfigUpdateSchema>;
