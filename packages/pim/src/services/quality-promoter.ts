import type { QualityLevel } from '../content/embedding-types.js';

import { logQualityEvent } from '../repositories/quality-events.js';

type DbClient = Readonly<{
  query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
}>;

export type PromotionEvaluation = Readonly<{
  eligible: boolean;
  targetLevel: QualityLevel;
  reason: string;
}>;

export type DemotionEvaluation = Readonly<{
  shouldDemote: boolean;
  targetLevel: QualityLevel;
  reason: string;
}>;

export type QualityLevelChangeResult = Readonly<{
  changed: boolean;
  previousLevel: QualityLevel;
  newLevel: QualityLevel;
  qualityScore: number;
  eventId: string | null;
}>;

export const PROMOTION_THRESHOLDS = {
  bronze_to_silver: {
    minQualityScore: 0.6,
    minSources: 2,
    requiredFields: ['brand', 'category'],
  },
  silver_to_golden: {
    minQualityScore: 0.85,
    minSources: 3,
    requiredFields: ['gtin', 'brand', 'mpn', 'category'],
    minSpecsCount: 5,
  },
} as const;

export const GOLDEN_MILESTONES = [100, 1000, 10000] as const;

type PromotionContext = Readonly<{
  currentLevel: QualityLevel;
  qualityScore: number | null;
  sourceCount: number;
  consensusSpecs: Record<string, unknown>;
}>;

function normalizeScore(score: number | null): number {
  return Number.isFinite(score) ? score! : 0;
}

function hasRequiredFields(
  specs: Record<string, unknown>,
  fields: readonly string[]
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const field of fields) {
    const value = specs[field];
    if (value === null || value === undefined || value === '') {
      missing.push(field);
    }
  }
  return { ok: missing.length === 0, missing };
}

function qualifiesForSilver(ctx: PromotionContext): boolean {
  const score = normalizeScore(ctx.qualityScore);
  if (score < PROMOTION_THRESHOLDS.bronze_to_silver.minQualityScore) return false;
  if (ctx.sourceCount < PROMOTION_THRESHOLDS.bronze_to_silver.minSources) return false;
  const fields = hasRequiredFields(
    ctx.consensusSpecs,
    PROMOTION_THRESHOLDS.bronze_to_silver.requiredFields
  );
  return fields.ok;
}

function qualifiesForGolden(ctx: PromotionContext): boolean {
  const score = normalizeScore(ctx.qualityScore);
  if (score < PROMOTION_THRESHOLDS.silver_to_golden.minQualityScore) return false;
  if (ctx.sourceCount < PROMOTION_THRESHOLDS.silver_to_golden.minSources) return false;
  const fields = hasRequiredFields(
    ctx.consensusSpecs,
    PROMOTION_THRESHOLDS.silver_to_golden.requiredFields
  );
  if (!fields.ok) return false;
  const specsCount = Object.keys(ctx.consensusSpecs ?? {}).length;
  return specsCount >= PROMOTION_THRESHOLDS.silver_to_golden.minSpecsCount;
}

export function evaluatePromotion(params: PromotionContext): PromotionEvaluation {
  if (params.currentLevel === 'review_needed') {
    return {
      eligible: false,
      targetLevel: 'review_needed',
      reason: 'review_needed_blocks_promotion',
    };
  }

  if (qualifiesForGolden(params)) {
    if (params.currentLevel === 'golden') {
      return { eligible: false, targetLevel: 'golden', reason: 'already_golden' };
    }
    return { eligible: true, targetLevel: 'golden', reason: 'meets_golden_requirements' };
  }

  if (qualifiesForSilver(params)) {
    if (params.currentLevel === 'silver' || params.currentLevel === 'golden') {
      return {
        eligible: false,
        targetLevel: params.currentLevel,
        reason: 'already_at_or_above_target',
      };
    }
    return { eligible: true, targetLevel: 'silver', reason: 'meets_silver_requirements' };
  }

  return { eligible: false, targetLevel: params.currentLevel, reason: 'requirements_not_met' };
}

export function evaluateDemotion(params: PromotionContext): DemotionEvaluation {
  if (params.currentLevel === 'bronze' || params.currentLevel === 'review_needed') {
    return {
      shouldDemote: false,
      targetLevel: params.currentLevel,
      reason: 'no_demotion_possible',
    };
  }

  if (params.currentLevel === 'golden') {
    if (qualifiesForGolden(params)) {
      return { shouldDemote: false, targetLevel: 'golden', reason: 'still_golden' };
    }
    if (qualifiesForSilver(params)) {
      return { shouldDemote: true, targetLevel: 'silver', reason: 'demote_to_silver' };
    }
    return { shouldDemote: true, targetLevel: 'bronze', reason: 'demote_to_bronze' };
  }

  if (params.currentLevel === 'silver') {
    if (qualifiesForSilver(params)) {
      return { shouldDemote: false, targetLevel: 'silver', reason: 'still_silver' };
    }
    return { shouldDemote: true, targetLevel: 'bronze', reason: 'demote_to_bronze' };
  }

  return { shouldDemote: false, targetLevel: params.currentLevel, reason: 'no_demotion' };
}

export function computeMissingRequirements(params: PromotionContext): string[] {
  if (params.currentLevel === 'golden') return [];

  const missing: string[] = [];
  const score = normalizeScore(params.qualityScore);

  if (params.currentLevel === 'silver') {
    const thresholds = PROMOTION_THRESHOLDS.silver_to_golden;
    if (score < thresholds.minQualityScore) {
      missing.push(`Quality score ${score} < ${thresholds.minQualityScore} required for golden`);
    }

    if (params.sourceCount < thresholds.minSources) {
      missing.push(`Sources: ${params.sourceCount}/${thresholds.minSources} required for golden`);
    }

    const fields = hasRequiredFields(params.consensusSpecs, thresholds.requiredFields);
    for (const field of fields.missing) {
      missing.push(`Missing field: ${field}`);
    }

    const specsCount = Object.keys(params.consensusSpecs ?? {}).length;
    if (specsCount < thresholds.minSpecsCount) {
      missing.push(`Specs: ${specsCount}/${thresholds.minSpecsCount} required for golden`);
    }
  } else {
    const thresholds = PROMOTION_THRESHOLDS.bronze_to_silver;
    if (score < thresholds.minQualityScore) {
      missing.push(`Quality score ${score} < ${thresholds.minQualityScore} required for silver`);
    }

    if (params.sourceCount < thresholds.minSources) {
      missing.push(`Sources: ${params.sourceCount}/${thresholds.minSources} required for silver`);
    }

    const fields = hasRequiredFields(params.consensusSpecs, thresholds.requiredFields);
    for (const field of fields.missing) {
      missing.push(`Missing field: ${field}`);
    }
  }

  return missing;
}

export async function applyQualityLevelChange(params: {
  client: DbClient;
  productId: string;
  qualityScore: number;
  sourceCount: number;
  consensusSpecs: Record<string, unknown>;
  trigger: string;
  jobId?: string;
}): Promise<QualityLevelChangeResult> {
  const { client, productId, qualityScore, sourceCount, consensusSpecs, trigger, jobId } = params;

  const currentResult = await client.query<{
    data_quality_level: QualityLevel;
    quality_score: number | null;
  }>(
    `SELECT data_quality_level, quality_score
       FROM prod_master
      WHERE id = $1`,
    [productId]
  );
  const currentRow = currentResult.rows[0];
  if (!currentRow) {
    throw new Error(`prod_master row not found for product ${productId}`);
  }

  const currentLevel = currentRow.data_quality_level;
  const promotion = evaluatePromotion({ currentLevel, qualityScore, sourceCount, consensusSpecs });
  const demotion = evaluateDemotion({ currentLevel, qualityScore, sourceCount, consensusSpecs });

  let newLevel: QualityLevel = currentLevel;
  let eventType: 'quality_promoted' | 'quality_demoted' | null = null;
  let reason = 'no_change';

  if (promotion.eligible) {
    newLevel = promotion.targetLevel;
    eventType = 'quality_promoted';
    reason = promotion.reason;
  } else if (demotion.shouldDemote) {
    newLevel = demotion.targetLevel;
    eventType = 'quality_demoted';
    reason = demotion.reason;
  }

  if (newLevel === currentLevel) {
    return {
      changed: false,
      previousLevel: currentLevel,
      newLevel: currentLevel,
      qualityScore,
      eventId: null,
    };
  }

  await client.query(
    `UPDATE prod_master
       SET data_quality_level = $2::text,
           promoted_to_silver_at = CASE
             WHEN $2::text IN ('silver', 'golden') THEN COALESCE(promoted_to_silver_at, now())
             ELSE NULL
           END,
           promoted_to_golden_at = CASE
             WHEN $2::text = 'golden' THEN COALESCE(promoted_to_golden_at, now())
             ELSE NULL
           END,
           last_quality_check = now(),
           updated_at = now()
     WHERE id = $1`,
    [productId, newLevel]
  );

  const eventId = await logQualityEvent({
    client,
    productId,
    eventType: eventType ?? 'quality_promoted',
    previousLevel: currentLevel,
    newLevel,
    qualityScoreBefore: currentRow.quality_score,
    qualityScoreAfter: qualityScore,
    triggerReason: trigger,
    triggerDetails: { reason },
    ...(jobId ? { jobId } : {}),
  });

  if (newLevel === 'golden') {
    await checkAndLogMilestone({ client, productId });
  }

  return {
    changed: true,
    previousLevel: currentLevel,
    newLevel,
    qualityScore,
    eventId,
  };
}

export async function checkAndLogMilestone(params: {
  client: DbClient;
  productId: string;
}): Promise<void> {
  const { client, productId } = params;
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text as count
       FROM prod_master
      WHERE data_quality_level = 'golden'`
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (!GOLDEN_MILESTONES.includes(count as (typeof GOLDEN_MILESTONES)[number])) {
    return;
  }

  const scoreResult = await client.query<{ quality_score: number | null }>(
    `SELECT quality_score
       FROM prod_master
      WHERE id = $1`,
    [productId]
  );
  const qualityScore = normalizeScore(scoreResult.rows[0]?.quality_score ?? 0);

  await logQualityEvent({
    client,
    productId,
    eventType: 'milestone_reached',
    previousLevel: null,
    newLevel: 'golden',
    qualityScoreBefore: null,
    qualityScoreAfter: qualityScore,
    triggerReason: 'golden_milestone',
    triggerDetails: { milestone: count, triggeringProductId: productId },
  });
}
