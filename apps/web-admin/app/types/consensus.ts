export type ConsensusStats = Readonly<{
  productsWithConsensus: number;
  pendingConsensus: number;
  productsWithConflicts: number;
  resolvedToday: number;
  avgSourcesPerProduct: number;
  avgQualityScore: number;
}>;

export type ConsensusProductItem = Readonly<{
  productId: string;
  title: string;
  sourceCount: number;
  consensusStatus: 'pending' | 'computed' | 'conflicts' | 'manual_review';
  qualityScore: number | null;
  conflictsCount: number;
  lastComputedAt: string | null;
}>;

export type ConflictDetails = Readonly<{
  attributeName: string;
  weightDifference: number;
  requiresHumanReview: boolean;
  reason: string;
  autoResolveDisabled: boolean;
  values: readonly {
    value: unknown;
    sourceName: string;
    trustScore: number;
    similarityScore: number;
  }[];
}>;

export type ConsensusVote = Readonly<{
  value: unknown;
  attributeName: string;
  sourceName: string;
  trustScore: number;
  similarityScore: number;
  matchId: string;
}>;

export type ConsensusDetail = Readonly<{
  productId: string;
  qualityScore: number;
  qualityBreakdown: {
    completeness: number;
    accuracy: number;
    consistency: number;
    sourceWeight: number;
  };
  conflictsCount: number;
  sources: Readonly<{
    sourceName: string;
    trustScore: number;
    similarityScore: number;
    status: string;
  }>[];
  results: Readonly<{
    attribute: string;
    value: string;
    sourcesCount: number;
    confidence: number;
  }>[];
  conflicts: ConflictDetails[];
  provenance: Readonly<{
    attributeName: string;
    sourceName: string;
    resolvedAt: string;
  }>[];
  votesByAttribute: Readonly<Record<string, ConsensusVote[]>>;
}>;
