import { CONSENSUS_CONFIG } from './consensus-config.js';
import {
  calculateQualityScore,
  computeQualityBreakdown,
  getRequiredFieldsForTaxonomy,
} from './quality-scorer.js';
import { parseExtractedSpecs } from './specs-parser.js';
import type {
  AttributeProvenance,
  AttributeVote,
  ConflictItem,
  ConsensuResult,
  MatchWithSource,
} from '../types/consensus.js';
import { getDbPool } from '../db.js';
import { getConfirmedMatchesWithSources } from '../repositories/similarity-matches.js';

type DbClient = Readonly<{
  query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
}>;

function valueKey(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLowerCase();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function voteWeight(vote: AttributeVote): number {
  return vote.trustScore * vote.similarityScore;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    if (!cleaned.trim()) return null;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isNumericValue(value: unknown): boolean {
  return parseNumericValue(value) !== null;
}

export function groupSpecsByAttribute(matches: MatchWithSource[]): Map<string, AttributeVote[]> {
  const grouped = new Map<string, AttributeVote[]>();
  for (const match of matches) {
    const parsed = parseExtractedSpecs(match.specsExtracted);
    for (const [attributeName, spec] of parsed.entries()) {
      const list = grouped.get(attributeName) ?? [];
      list.push({
        value: spec.value,
        attributeName,
        sourceId: match.sourceId ?? 'unknown',
        sourceName: match.sourceName ?? 'unknown',
        trustScore: match.trustScore,
        similarityScore: match.similarityScore,
        matchId: match.matchId,
        extractedAt: new Date(match.createdAt),
      });
      grouped.set(attributeName, list);
    }
  }
  return grouped;
}

function computeNumericWinner(
  attributeName: string,
  votes: AttributeVote[],
  options: { minVotes: number; conflictThreshold: number }
): { winner: AttributeVote | null; conflict: ConflictItem | null } {
  const numericVotes = votes
    .map((vote) => {
      const numericValue = parseNumericValue(vote.value);
      return numericValue === null ? null : { vote, numericValue };
    })
    .filter((entry): entry is { vote: AttributeVote; numericValue: number } => Boolean(entry));

  if (numericVotes.length < options.minVotes) {
    return {
      winner: null,
      conflict: {
        attributeName,
        values: votes,
        weightDifference: 0,
        requiresHumanReview: true,
        reason: 'insufficient_sources',
        autoResolveDisabled: true,
      },
    };
  }

  let weightedSum = 0;
  let totalWeight = 0;
  for (const entry of numericVotes) {
    const weight = voteWeight(entry.vote);
    weightedSum += entry.numericValue * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return {
      winner: null,
      conflict: {
        attributeName,
        values: votes,
        weightDifference: 0,
        requiresHumanReview: true,
        reason: 'zero_weight',
        autoResolveDisabled: true,
      },
    };
  }

  const averageValue = weightedSum / totalWeight;
  const sortedByWeight = [...numericVotes].sort((a, b) => voteWeight(b.vote) - voteWeight(a.vote));
  const top = sortedByWeight[0]?.vote ?? null;
  const runner = sortedByWeight[1]?.vote ?? null;
  const topWeight = top ? voteWeight(top) : 0;
  const runnerWeight = runner ? voteWeight(runner) : 0;
  const weightDifference = topWeight - runnerWeight;

  const maxAbsDiff = Math.max(
    ...numericVotes.map((entry) => Math.abs(entry.numericValue - averageValue))
  );
  const denominator = Math.max(Math.abs(averageValue), 1);
  const diffRatio = maxAbsDiff / denominator;

  if (diffRatio > options.conflictThreshold) {
    return {
      winner: top ? { ...top, value: averageValue } : null,
      conflict: {
        attributeName,
        values: votes,
        weightDifference,
        requiresHumanReview: true,
        reason: 'numeric_spread',
        autoResolveDisabled: true,
      },
    };
  }

  return {
    winner: top ? { ...top, value: averageValue } : null,
    conflict: null,
  };
}

function computeCategoricWinner(
  attributeName: string,
  votes: AttributeVote[],
  options: { minVotes: number; conflictThreshold: number }
): { winner: AttributeVote | null; conflict: ConflictItem | null } {
  if (votes.length === 0) {
    return {
      winner: null,
      conflict: {
        attributeName,
        values: [],
        weightDifference: 0,
        requiresHumanReview: true,
        reason: 'no_votes',
        autoResolveDisabled: true,
      },
    };
  }

  const grouped = new Map<string, { votes: AttributeVote[]; weight: number }>();
  for (const vote of votes) {
    const key = valueKey(vote.value);
    const entry = grouped.get(key) ?? { votes: [], weight: 0 };
    entry.votes.push(vote);
    entry.weight += voteWeight(vote);
    grouped.set(key, entry);
  }

  const ranked = Array.from(grouped.values()).sort((a, b) => b.weight - a.weight);
  const top = ranked[0];
  const runnerUp = ranked[1];
  const topCount = top?.votes.length ?? 0;

  if (!top || topCount < options.minVotes) {
    return {
      winner: null,
      conflict: {
        attributeName,
        values: votes,
        weightDifference: 0,
        requiresHumanReview: true,
        reason: 'insufficient_sources',
        autoResolveDisabled: true,
      },
    };
  }

  const topWeight = top.weight;
  const runnerWeight = runnerUp?.weight ?? 0;
  const weightDifference = topWeight - runnerWeight;
  const diffRatio = topWeight === 0 ? 0 : weightDifference / topWeight;

  if (runnerUp && diffRatio < options.conflictThreshold) {
    return {
      winner: top.votes[0] ?? null,
      conflict: {
        attributeName,
        values: votes,
        weightDifference,
        requiresHumanReview: true,
        reason: 'close_vote',
        autoResolveDisabled: true,
      },
    };
  }

  return { winner: top.votes[0] ?? null, conflict: null };
}

export function computeWinner(
  attributeName: string,
  votes: AttributeVote[],
  options: { minVotes: number; conflictThreshold: number }
): { winner: AttributeVote | null; conflict: ConflictItem | null } {
  const hasOnlyNumeric = votes.length > 0 && votes.every((vote) => isNumericValue(vote.value));
  if (hasOnlyNumeric) {
    return computeNumericWinner(attributeName, votes, options);
  }
  return computeCategoricWinner(attributeName, votes, options);
}

export function detectConflicts(attributeVotes: Map<string, AttributeVote[]>): ConflictItem[] {
  const conflicts: ConflictItem[] = [];
  for (const [attributeName, votes] of attributeVotes.entries()) {
    const result = computeWinner(attributeName, votes, {
      minVotes: 1,
      conflictThreshold: CONSENSUS_CONFIG.CONFLICT_THRESHOLD,
    });
    if (result.conflict) {
      conflicts.push(result.conflict);
    }
  }
  return conflicts;
}

export async function checkManualCorrections(params: {
  client: DbClient;
  productId: string;
}): Promise<Set<string>> {
  const { client, productId } = params;
  const provenanceResult = await client.query<{
    provenance: Record<string, { manuallyEdited?: boolean }> | null;
  }>(
    'SELECT provenance FROM prod_specs_normalized WHERE product_id = $1 AND is_current = true LIMIT 1',
    [productId]
  );
  const provenance = provenanceResult.rows[0]?.provenance;
  if (!provenance || typeof provenance !== 'object') {
    return new Set();
  }
  const manualFields = new Set<string>();
  for (const [field, meta] of Object.entries(provenance)) {
    if (meta && typeof meta === 'object' && meta.manuallyEdited === true) {
      manualFields.add(field);
    }
  }
  return manualFields;
}

export async function mergeWithExistingSpecs(params: {
  client: DbClient;
  productId: string;
  consensusSpecs: Record<string, unknown>;
  provenance: Record<string, AttributeProvenance>;
}): Promise<{ merged: Record<string, unknown>; skipped: string[] }> {
  const { client, productId, consensusSpecs } = params;
  const manualCorrections = await checkManualCorrections({ client, productId });
  const currentResult = await client.query<{ specs: Record<string, unknown> }>(
    'SELECT specs FROM prod_specs_normalized WHERE product_id = $1 AND is_current = true LIMIT 1',
    [productId]
  );
  const currentSpecs = currentResult.rows[0]?.specs ?? {};
  const merged: Record<string, unknown> = { ...currentSpecs };
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(consensusSpecs)) {
    if (manualCorrections.has(key)) {
      skipped.push(key);
      continue;
    }
    merged[key] = value;
  }

  return { merged, skipped };
}

export async function computeConsensus(params: {
  client?: DbClient;
  productId: string;
}): Promise<ConsensuResult> {
  const client = params.client ?? getDbPool();
  const fetchConfirmedMatches = getConfirmedMatchesWithSources as unknown as (
    productId: string
  ) => Promise<MatchWithSource[]>;
  const matches = await fetchConfirmedMatches(params.productId);
  const attributeVotes = groupSpecsByAttribute(matches);
  const conflicts: ConflictItem[] = [];
  const consensusSpecs: Record<string, unknown> = {};
  const provenance: Record<string, AttributeProvenance> = {};

  for (const [attributeName, votes] of attributeVotes.entries()) {
    const isCritical = CONSENSUS_CONFIG.CRITICAL_FIELDS.includes(
      attributeName as (typeof CONSENSUS_CONFIG.CRITICAL_FIELDS)[number]
    );
    if (isCritical && votes.length < CONSENSUS_CONFIG.MIN_VOTES) {
      conflicts.push({
        attributeName,
        values: votes,
        weightDifference: 0,
        requiresHumanReview: true,
        reason: 'single_source_critical_field',
        autoResolveDisabled: true,
      });
      continue;
    }
    const result = computeWinner(attributeName, votes, {
      minVotes: CONSENSUS_CONFIG.MIN_VOTES,
      conflictThreshold: CONSENSUS_CONFIG.CONFLICT_THRESHOLD,
    });
    if (result.winner && !result.conflict) {
      consensusSpecs[attributeName] = result.winner.value;
      provenance[attributeName] = {
        attributeName,
        value: result.winner.value,
        sourceId: result.winner.sourceId,
        sourceName: result.winner.sourceName,
        trustScore: result.winner.trustScore,
        similarityScore: result.winner.similarityScore,
        matchId: result.winner.matchId,
        weight: voteWeight(result.winner),
        resolvedAt: new Date().toISOString(),
        alternates: votes.filter((vote) => vote.matchId !== result.winner?.matchId),
        conflictDetected: Boolean(result.conflict),
      };
    }
    if (result.conflict) {
      conflicts.push(result.conflict);
    }
  }

  const manualCorrections = await checkManualCorrections({ client, productId: params.productId });
  const skippedDueToManualCorrection: string[] = [];
  for (const field of manualCorrections) {
    if (Object.prototype.hasOwnProperty.call(consensusSpecs, field)) {
      delete consensusSpecs[field];
      delete provenance[field];
      skippedDueToManualCorrection.push(field);
    }
  }

  const productResult = await client.query<{ taxonomy_id: string | null }>(
    'SELECT taxonomy_id FROM prod_master WHERE id = $1 LIMIT 1',
    [params.productId]
  );
  const taxonomyId = productResult.rows[0]?.taxonomy_id ?? null;
  const requiredFields = await getRequiredFieldsForTaxonomy({ client, taxonomyId });
  const breakdown = computeQualityBreakdown({
    consensusSpecs,
    attributeVotes,
    requiredFields,
    sourceCount: matches.length,
  });
  const qualityScore = calculateQualityScore(breakdown);

  return {
    consensusSpecs,
    provenance,
    qualityScore,
    qualityBreakdown: breakdown,
    sourceCount: matches.length,
    conflicts,
    needsReview: conflicts.length > 0,
    skippedDueToManualCorrection,
  };
}
