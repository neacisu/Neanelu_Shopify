export const CONSENSUS_CONFIG = {
  MIN_VOTES: 2,
  CRITICAL_FIELDS: ['gtin', 'brand'] as const,
  CONFLICT_THRESHOLD: 0.2,
  DEFAULT_TRUST_SCORE: 0.5,
  QUALITY_WEIGHTS: {
    completeness: 0.4,
    accuracy: 0.3,
    consistency: 0.2,
    sourceWeight: 0.1,
  },
  DEFAULT_REQUIRED_FIELDS: ['gtin', 'brand', 'category', 'title'] as const,
} as const;
