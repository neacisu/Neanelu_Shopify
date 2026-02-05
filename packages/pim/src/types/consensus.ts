export type AttributeVote = Readonly<{
  value: unknown;
  attributeName: string;
  sourceId: string;
  sourceName: string;
  trustScore: number;
  similarityScore: number;
  matchId: string;
  extractedAt: Date;
  confidence?: number;
}>;

export type AttributeProvenance = Readonly<{
  attributeName: string;
  value: unknown;
  sourceId: string;
  sourceName: string;
  trustScore: number;
  similarityScore: number;
  matchId: string;
  weight: number;
  resolvedAt: string;
  alternates: AttributeVote[];
  conflictDetected: boolean;
}>;

export type ConflictItem = Readonly<{
  attributeName: string;
  values: AttributeVote[];
  weightDifference: number;
  requiresHumanReview: boolean;
  reason: string;
}>;

export type QualityBreakdown = Readonly<{
  completeness: number;
  accuracy: number;
  consistency: number;
  sourceWeight: number;
}>;

export type ConsensuResult = Readonly<{
  consensusSpecs: Record<string, unknown>;
  provenance: Record<string, AttributeProvenance>;
  qualityScore: number;
  qualityBreakdown: QualityBreakdown;
  sourceCount: number;
  conflicts: ConflictItem[];
  needsReview: boolean;
  skippedDueToManualCorrection: string[];
}>;

export type MatchWithSource = Readonly<{
  matchId: string;
  productId: string;
  sourceId: string | null;
  sourceName: string | null;
  sourceUrl: string;
  similarityScore: number;
  specsExtracted: Record<string, unknown> | null;
  trustScore: number;
  extractionSessionId: string | null;
  matchConfidence: string;
  createdAt: string;
}>;
