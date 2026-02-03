import { z } from 'zod';

export const AIAuditResponseSchema = z.object({
  isSameProduct: z.enum(['yes', 'no', 'uncertain']),
  usableForEnrichment: z.enum(['yes', 'no', 'partial']),
  criticalDiscrepancies: z.array(z.string()).default([]),
  recommendation: z.enum(['approve', 'reject', 'escalate_to_human']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
});

export type AIAuditResponse = z.infer<typeof AIAuditResponseSchema>;
