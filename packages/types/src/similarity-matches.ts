export type MatchConfidence = 'pending' | 'confirmed' | 'rejected' | 'uncertain';
export type MatchMethod = 'gtin_exact' | 'vector_semantic' | 'title_fuzzy' | 'mpn_exact';

export const SIMILARITY_THRESHOLDS = {
  AUTO_APPROVE: 0.98,
  AI_AUDIT: 0.94,
  HITL_REQUIRED: 0.9,
  MINIMUM: 0.9,
} as const;

export type TriageDecision = 'auto_approve' | 'ai_audit' | 'hitl_required' | 'rejected';

export type AIAuditDecision = 'approve' | 'reject' | 'escalate_to_human';
export type ProductSamenessVerdict = 'yes' | 'no' | 'uncertain';
export type EnrichmentUsability = 'yes' | 'no' | 'partial';

export type AIAuditResult = Readonly<{
  decision: AIAuditDecision;
  confidence: number;
  reasoning: string;
  isSameProduct: ProductSamenessVerdict;
  usableForEnrichment: EnrichmentUsability;
  criticalDiscrepancies: string[];
  auditedAt: string;
  modelUsed: string;
}>;

export type MatchDetailsSchema = Readonly<{
  triage_decision: TriageDecision;
  triage_timestamp: string;
  auto_approved?: boolean;
  auto_approve_reason?: string;
  ai_audit_result?: AIAuditResult;
  ai_audit_scheduled_at?: string;
  ai_audit_completed_at?: string;
  requires_human_review?: boolean;
  human_review_deadline?: string;
  human_review_priority?: 'low' | 'medium' | 'high';
  scores_breakdown?: {
    gtin_match?: number;
    title_similarity?: number;
    brand_match?: number;
    price_proximity?: number;
    category_match?: number;
  };
}>;

export type CreateMatchInput = Readonly<{
  productId: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourceGtin?: string;
  sourceBrand?: string;
  sourceProductId?: string;
  sourcePrice?: number;
  sourceCurrency?: string;
  similarityScore: number;
  matchMethod: MatchMethod;
  sourceData?: Record<string, unknown>;
}>;

export type CreateMatchResult = Readonly<{
  success: boolean;
  matchId?: string;
  triageDecision: TriageDecision;
  reason?: string;
  requiresHumanReview?: boolean;
  aiAuditScheduled?: boolean;
}>;

export type ProcessedMatchesResult = Readonly<{
  created: number;
  autoApproved: number;
  sentToAIAudit: number;
  sentToHITL: number;
  rejected: number;
  duplicates: number;
}>;
