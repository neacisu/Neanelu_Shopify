import { z } from 'zod';

/**
 * Zod shapes for Lex LLM translation / audit payloads.
 * Lives in a dedicated module (no `lex-guardrails` import) so consumers like
 * `lex-guardrails` can depend on these schemas without a circular import with `ai-batches`.
 */
export const lexTranslationBatchItemSchema = z.object({
  clusterId: z.uuid(),
  translation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
});

export type LexTranslationBatchItem = z.infer<typeof lexTranslationBatchItemSchema>;

export const lexTranslationLlmEnvelopeSchema = z.object({
  items: z.array(lexTranslationBatchItemSchema).min(1),
});

export type LexTranslationLlmEnvelope = z.infer<typeof lexTranslationLlmEnvelopeSchema>;

/** QwQ-32B batch quality audit — one row per translation reviewed. */
export const lexTranslationAuditItemSchema = z.object({
  termId: z.uuid(),
  clusterId: z.uuid(),
  valid: z.boolean(),
  issues: z.array(z.string()).default([]),
  suggestedFix: z.string().optional(),
  consistencyScore: z.number().min(0).max(1),
});

export type LexTranslationAuditItem = z.infer<typeof lexTranslationAuditItemSchema>;

export const lexTranslationAuditEnvelopeSchema = z.object({
  items: z.array(lexTranslationAuditItemSchema).min(1),
});

export type LexTranslationAuditInput = Readonly<{
  termId: string;
  clusterId: string;
  translationId: string;
  sourceText: string;
  translatedText: string;
  domainCode: string | null;
}>;
