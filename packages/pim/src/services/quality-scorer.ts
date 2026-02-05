import { CONSENSUS_CONFIG } from './consensus-config.js';
import type { AttributeVote, QualityBreakdown } from '../types/consensus.js';
import { getDbPool } from '../db.js';

type DbClient = Readonly<{
  query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
}>;

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function calculateQualityScore(breakdown: QualityBreakdown): number {
  const weights = CONSENSUS_CONFIG.QUALITY_WEIGHTS;
  const score =
    weights.completeness * breakdown.completeness +
    weights.accuracy * breakdown.accuracy +
    weights.consistency * breakdown.consistency +
    weights.sourceWeight * breakdown.sourceWeight;
  return clamp01(score);
}

export function computeQualityBreakdown(params: {
  consensusSpecs: Record<string, unknown>;
  attributeVotes: Map<string, AttributeVote[]>;
  requiredFields: string[];
  sourceCount: number;
}): QualityBreakdown {
  const { consensusSpecs, attributeVotes, requiredFields } = params;
  const requiredNormalized = requiredFields.map((field) => normalizeKey(field));
  const consensusKeys = new Set(Object.keys(consensusSpecs).map((key) => normalizeKey(key)));

  const totalRequired = requiredNormalized.length;
  const requiredPresent = totalRequired
    ? requiredNormalized.filter((field) => consensusKeys.has(field)).length
    : 0;
  const completeness = totalRequired === 0 ? 1 : requiredPresent / totalRequired;

  let confidenceTotal = 0;
  let confidenceCount = 0;
  let trustTotal = 0;
  let trustCount = 0;
  let conflictCount = 0;

  for (const votes of attributeVotes.values()) {
    if (votes.length > 0) {
      const valueSet = new Set(
        votes.map((vote) => {
          if (typeof vote.value === 'string') return normalizeKey(vote.value);
          try {
            return JSON.stringify(vote.value);
          } catch {
            return String(vote.value);
          }
        })
      );
      if (valueSet.size > 1) {
        conflictCount += 1;
      }
    }

    for (const vote of votes) {
      if (typeof vote.confidence === 'number') {
        confidenceTotal += vote.confidence;
        confidenceCount += 1;
      }
      if (typeof vote.trustScore === 'number') {
        trustTotal += vote.trustScore;
        trustCount += 1;
      }
    }
  }

  const accuracy = confidenceCount === 0 ? 0 : confidenceTotal / confidenceCount;
  const totalAttributes = attributeVotes.size;
  const consistency = totalAttributes === 0 ? 1 : 1 - Math.min(conflictCount / totalAttributes, 1);
  const sourceWeight = trustCount === 0 ? 0 : trustTotal / trustCount;

  return {
    completeness: clamp01(completeness),
    accuracy: clamp01(accuracy),
    consistency: clamp01(consistency),
    sourceWeight: clamp01(sourceWeight),
  };
}

export async function getRequiredFieldsForTaxonomy(params: {
  client?: DbClient;
  taxonomyId: string | null;
}): Promise<string[]> {
  if (!params.taxonomyId) {
    return [...CONSENSUS_CONFIG.DEFAULT_REQUIRED_FIELDS];
  }
  const pool = params.client ?? getDbPool();
  const result = await pool.query<{ attribute_schema: unknown }>(
    'SELECT attribute_schema FROM prod_taxonomy WHERE id = $1 LIMIT 1',
    [params.taxonomyId]
  );
  const schema = result.rows[0]?.attribute_schema;
  if (!schema || typeof schema !== 'object') {
    return [...CONSENSUS_CONFIG.DEFAULT_REQUIRED_FIELDS];
  }
  const attributes = (schema as { attributes?: unknown }).attributes;
  if (!Array.isArray(attributes) || attributes.length === 0) {
    return [...CONSENSUS_CONFIG.DEFAULT_REQUIRED_FIELDS];
  }
  const fields = attributes
    .map((attr) => {
      if (!attr || typeof attr !== 'object') return null;
      const handle = (attr as { handle?: unknown }).handle;
      const name = (attr as { name?: unknown }).name;
      if (typeof handle === 'string' && handle.trim()) return handle.trim();
      if (typeof name === 'string' && name.trim()) return name.trim();
      return null;
    })
    .filter((value): value is string => Boolean(value));
  return fields.length > 0 ? fields : [...CONSENSUS_CONFIG.DEFAULT_REQUIRED_FIELDS];
}
