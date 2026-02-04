export type EnrichmentPriority = 1 | 2 | 3;

export const PRIORITY_CONFIG = {
  P1_GOLDEN_CANDIDATE: 1,
  P2_SILVER_POTENTIAL: 2,
  P3_BRONZE: 3,
} as const;

export function calculateProductPriority(product: {
  qualityScore?: number | null;
  gtin?: string | null;
  dataQualityLevel?: string | null;
}): EnrichmentPriority {
  const score = product.qualityScore ?? 0;

  if (score >= 0.7 && product.gtin) {
    return PRIORITY_CONFIG.P1_GOLDEN_CANDIDATE;
  }

  if (score >= 0.5 || product.dataQualityLevel === 'silver') {
    return PRIORITY_CONFIG.P2_SILVER_POTENTIAL;
  }

  return PRIORITY_CONFIG.P3_BRONZE;
}

export function toBullMQPriority(priority: EnrichmentPriority): number {
  return priority * 10;
}
