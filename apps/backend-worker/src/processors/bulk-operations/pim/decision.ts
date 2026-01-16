export type SimilarMatch = Readonly<{
  productId: string;
  similarity: number;
  title?: string | null;
  brand?: string | null;
}>;

export type DedupeThresholds = Readonly<{
  highConfidence: number;
  suspicious: number;
}>;

export type PimTargetDecision =
  | Readonly<{ kind: 'use_existing'; productId: string; needsReview: boolean; reason: string }>
  | Readonly<{ kind: 'create_new'; needsReview: boolean; reason: string }>;

export function decidePimTarget(params: {
  existingChannelMappingProductId: string | null;
  gtinExactMatchProductId: string | null;
  semanticMatches: readonly SimilarMatch[];
  thresholds: DedupeThresholds;
}): PimTargetDecision {
  if (params.existingChannelMappingProductId) {
    return {
      kind: 'use_existing',
      productId: params.existingChannelMappingProductId,
      needsReview: false,
      reason: 'channel_mapping_exists',
    };
  }

  if (params.gtinExactMatchProductId) {
    return {
      kind: 'use_existing',
      productId: params.gtinExactMatchProductId,
      needsReview: false,
      reason: 'gtin_exact_match',
    };
  }

  const sorted = [...params.semanticMatches].sort((a, b) => b.similarity - a.similarity);
  const best = sorted[0];
  if (best && best.similarity >= params.thresholds.highConfidence) {
    return {
      kind: 'use_existing',
      productId: best.productId,
      needsReview: false,
      reason: `semantic_high_confidence:${best.similarity.toFixed(4)}`,
    };
  }

  if (best && best.similarity >= params.thresholds.suspicious) {
    return {
      kind: 'create_new',
      needsReview: true,
      reason: `semantic_suspicious:${best.similarity.toFixed(4)}`,
    };
  }

  return { kind: 'create_new', needsReview: false, reason: 'no_match' };
}
