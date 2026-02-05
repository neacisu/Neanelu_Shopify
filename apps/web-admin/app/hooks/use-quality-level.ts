import type { QualityLevel } from '@app/types';

import { useApiClient, useApiRequest } from './use-api';

type QualityLevelResponse = Readonly<{
  currentLevel: QualityLevel;
  qualityScore: number | null;
  qualityScoreBreakdown: Record<string, unknown> | null;
  sourceCount: number;
  specsCount: number;
  eligibleForPromotion: boolean;
  nextLevel: QualityLevel | null;
  nextThreshold: number | null;
  thresholds: { silver: number; golden: number };
  missingRequirements: string[];
  promotedToSilverAt: string | null;
  promotedToGoldenAt: string | null;
  needsReview: boolean;
  recentEvents: Record<string, unknown>[];
}>;

export function useQualityLevel(productId: string | null) {
  const api = useApiClient();
  const request = useApiRequest(() => {
    if (!productId) {
      return Promise.reject(new Error('missing_product_id'));
    }
    return api.getApi<QualityLevelResponse>(`/products/${productId}/quality-level`);
  });

  return { ...request, refetch: request.run };
}
