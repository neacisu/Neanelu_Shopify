import { createMatch } from '../repositories/similarity-matches.js';
import type { ExternalProductSearchResult } from '../types/external-search.js';

export const SIMILARITY_THRESHOLDS = {
  AUTO_APPROVE: 0.98,
  AI_AUDIT: 0.94,
  HITL_REQUIRED: 0.9,
  MINIMUM: 0.9,
} as const;

export type TriageDecision = 'auto_approve' | 'ai_audit' | 'hitl_required' | 'rejected';

export type SimilarityScoreBreakdown = Readonly<{
  gtinMatch?: number;
  titleSimilarity?: number;
  brandMatch?: number;
  priceProximity?: number;
}>;

export type LocalProductSnapshot = Readonly<{
  id: string;
  title: string;
  brand?: string | null;
  gtin?: string | null;
  price?: number | null;
  currency?: string | null;
}>;

export type CreateMatchInput = Readonly<{
  productId: string;
  sourceUrl: string;
  sourceTitle?: string | null;
  sourceGtin?: string | null;
  sourceBrand?: string | null;
  sourceProductId?: string | null;
  sourcePrice?: number | null;
  sourceCurrency?: string | null;
  sourceData?: Record<string, unknown> | null;
  similarityScore: number;
  matchMethod: string;
  scoresBreakdown?: SimilarityScoreBreakdown;
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

export class SimilarityMatchService {
  determineTriageAction(similarityScore: number): TriageDecision {
    if (similarityScore >= SIMILARITY_THRESHOLDS.AUTO_APPROVE) return 'auto_approve';
    if (similarityScore >= SIMILARITY_THRESHOLDS.AI_AUDIT) return 'ai_audit';
    if (similarityScore >= SIMILARITY_THRESHOLDS.HITL_REQUIRED) return 'hitl_required';
    return 'rejected';
  }

  async createMatchWithTriage(data: CreateMatchInput): Promise<CreateMatchResult> {
    const triageDecision = this.determineTriageAction(data.similarityScore);
    if (triageDecision === 'rejected') {
      return { success: false, triageDecision, reason: 'below_minimum_threshold' };
    }

    const nowIso = new Date().toISOString();
    const matchDetails: Record<string, unknown> = {
      triage_decision: triageDecision,
      triage_timestamp: nowIso,
      scores_breakdown: data.scoresBreakdown ?? undefined,
    };

    let matchConfidence: 'pending' | 'confirmed' | 'rejected' | 'uncertain' = 'pending';
    let requiresHumanReview = false;
    let aiAuditScheduled = false;

    if (triageDecision === 'auto_approve') {
      matchConfidence = 'confirmed';
      matchDetails['auto_approved'] = true;
      matchDetails['auto_approve_reason'] = 'similarity_score >= 0.98';
    } else if (triageDecision === 'ai_audit') {
      matchDetails['ai_audit_scheduled_at'] = nowIso;
      aiAuditScheduled = true;
    } else if (triageDecision === 'hitl_required') {
      matchDetails['requires_human_review'] = true;
      matchDetails['human_review_reason'] = 'similarity_score between 0.90 and 0.94';
      requiresHumanReview = true;
    }

    const created = await createMatch({
      productId: data.productId,
      sourceUrl: data.sourceUrl,
      sourceTitle: data.sourceTitle ?? null,
      sourceGtin: data.sourceGtin ?? null,
      sourceBrand: data.sourceBrand ?? null,
      sourceProductId: data.sourceProductId ?? null,
      sourcePrice:
        data.sourcePrice !== null && data.sourcePrice !== undefined
          ? String(data.sourcePrice)
          : null,
      sourceCurrency: data.sourceCurrency ?? null,
      sourceData: data.sourceData ?? null,
      matchDetails,
      similarityScore: data.similarityScore,
      matchMethod: data.matchMethod,
      matchConfidence,
    });

    return {
      success: true,
      matchId: created.id,
      triageDecision,
      requiresHumanReview,
      aiAuditScheduled,
    };
  }

  async processSerperResults(params: {
    product: LocalProductSnapshot;
    results: ExternalProductSearchResult[];
    matchMethod: string;
  }): Promise<ProcessedMatchesResult> {
    let createdCount = 0;
    let autoApproved = 0;
    let sentToAIAudit = 0;
    let sentToHITL = 0;
    let rejected = 0;
    let duplicates = 0;

    for (const result of params.results) {
      const { score, breakdown } = this.calculateSimilarityScore(params.product, result);
      const triage = this.determineTriageAction(score);
      if (triage === 'rejected') {
        rejected += 1;
        continue;
      }

      try {
        const created = await this.createMatchWithTriage({
          productId: params.product.id,
          sourceUrl: result.url,
          sourceTitle: result.title,
          sourceGtin: result.structuredData?.gtin ?? null,
          sourceBrand: result.structuredData?.brand ?? null,
          sourcePrice: result.structuredData?.price
            ? Number(result.structuredData.price.replace(/[^\d.]/g, ''))
            : null,
          sourceCurrency: result.structuredData?.currency ?? null,
          sourceData: result as unknown as Record<string, unknown>,
          similarityScore: score,
          matchMethod: params.matchMethod,
          scoresBreakdown: breakdown,
        });

        if (created.success) {
          createdCount += 1;
          if (created.triageDecision === 'auto_approve') autoApproved += 1;
          if (created.triageDecision === 'ai_audit') sentToAIAudit += 1;
          if (created.triageDecision === 'hitl_required') sentToHITL += 1;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Duplicate match')) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }

    return {
      created: createdCount,
      autoApproved,
      sentToAIAudit,
      sentToHITL,
      rejected,
      duplicates,
    };
  }

  calculateSimilarityScore(
    localProduct: LocalProductSnapshot,
    externalResult: ExternalProductSearchResult
  ): { score: number; breakdown: SimilarityScoreBreakdown } {
    const gtinMatch =
      localProduct.gtin && externalResult.structuredData?.gtin
        ? localProduct.gtin.trim() === externalResult.structuredData.gtin.trim()
          ? 1
          : 0
        : undefined;

    const titleSimilarity = computeTokenSimilarity(localProduct.title, externalResult.title);

    const brandMatch =
      localProduct.brand && externalResult.structuredData?.brand
        ? normalizeToken(localProduct.brand) === normalizeToken(externalResult.structuredData.brand)
          ? 1
          : 0
        : undefined;

    const priceProximity =
      localProduct.price && externalResult.structuredData?.price
        ? computePriceProximity(localProduct.price, externalResult.structuredData.price)
        : undefined;

    const weights = {
      gtinMatch: 0.5,
      titleSimilarity: 0.25,
      brandMatch: 0.15,
      priceProximity: 0.1,
    };

    const weighted = [
      gtinMatch !== undefined ? gtinMatch * weights.gtinMatch : null,
      titleSimilarity !== undefined ? titleSimilarity * weights.titleSimilarity : null,
      brandMatch !== undefined ? brandMatch * weights.brandMatch : null,
      priceProximity !== undefined ? priceProximity * weights.priceProximity : null,
    ].filter((value): value is number => value !== null);

    const totalWeight = [
      gtinMatch !== undefined ? weights.gtinMatch : 0,
      titleSimilarity !== undefined ? weights.titleSimilarity : 0,
      brandMatch !== undefined ? weights.brandMatch : 0,
      priceProximity !== undefined ? weights.priceProximity : 0,
    ].reduce((sum, value) => sum + value, 0);

    const score =
      totalWeight > 0 ? weighted.reduce((sum, value) => sum + value, 0) / totalWeight : 0;

    const breakdown: {
      gtinMatch?: number;
      titleSimilarity?: number;
      brandMatch?: number;
      priceProximity?: number;
    } = {};
    if (gtinMatch !== undefined) breakdown.gtinMatch = gtinMatch;
    if (titleSimilarity !== undefined) breakdown.titleSimilarity = titleSimilarity;
    if (brandMatch !== undefined) breakdown.brandMatch = brandMatch;
    if (priceProximity !== undefined) breakdown.priceProximity = priceProximity;

    return {
      score: clamp(score, 0, 1),
      breakdown,
    };
  }

  validateConfidenceTransition(currentConfidence: string, newConfidence: string): boolean {
    if (currentConfidence === newConfidence) return true;
    const allowed: Record<string, Set<string>> = {
      pending: new Set(['confirmed', 'rejected', 'uncertain']),
      uncertain: new Set(['confirmed', 'rejected']),
      confirmed: new Set([]),
      rejected: new Set([]),
    };
    return allowed[currentConfidence]?.has(newConfidence) ?? false;
  }

  canBePrimary(match: { matchConfidence: string | null }): boolean {
    return match.matchConfidence === 'confirmed';
  }
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function computeTokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(normalizeToken(a).split(' ').filter(Boolean));
  const bTokens = new Set(normalizeToken(b).split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function computePriceProximity(localPrice: number, externalPriceRaw: string): number {
  const numeric = Number(externalPriceRaw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0 || localPrice <= 0) return 0;
  const diff = Math.abs(localPrice - numeric);
  const max = Math.max(localPrice, numeric);
  return clamp(1 - diff / max, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
