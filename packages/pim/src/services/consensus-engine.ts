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

export function computeWinner(
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
      },
    };
  }

  return { winner: top.votes[0] ?? null, conflict: null };
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
  const masterResult = await client.query<{
    needs_review: boolean;
    review_notes: string | null;
  }>('SELECT needs_review, review_notes FROM prod_master WHERE id = $1 LIMIT 1', [productId]);
  const master = masterResult.rows[0];
  if (!master?.needs_review || !master.review_notes) {
    return new Set();
  }
  const specsResult = await client.query<{ specs: Record<string, unknown> }>(
    'SELECT specs FROM prod_specs_normalized WHERE product_id = $1 AND is_current = true LIMIT 1',
    [productId]
  );
  const specs = specsResult.rows[0]?.specs ?? {};
  return new Set(Object.keys(specs));
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
    const result = computeWinner(attributeName, votes, {
      minVotes: isCritical ? CONSENSUS_CONFIG.MIN_VOTES : 1,
      conflictThreshold: CONSENSUS_CONFIG.CONFLICT_THRESHOLD,
    });
    if (result.winner) {
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
    skippedDueToManualCorrection: [],
  };
}
