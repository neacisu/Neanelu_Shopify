import { sha256 } from './pipeline-utils.js';

/** Row shape from `lex_term_contexts` used for sense clustering. */
export type LexClusterSenseContextRow = Readonly<{
  id: string;
  termId: string;
  representativeText: string;
  fieldKind: string | null;
  domainCode: string | null;
  taxonomyId: string | null;
  occurrencesCount: string;
}>;

export type LexClusterSenseTermLabelRow = Readonly<{
  id: string;
  displayTextRo: string | null;
  canonicalText: string;
}>;

export type LexPreparedClusterSenseGroup = Readonly<{
  termId: string;
  clusterKey: string;
  representative: LexClusterSenseContextRow;
  members: readonly LexClusterSenseContextRow[];
  labelRo: string | null;
  confidence: number;
  needsReview: boolean;
  isApproved: boolean;
}>;

/** Heuristic bucket: domain + taxonomy + field kind (mirrors legacy `cluster-senses` SQL grouping intent). */
export function buildClusterSenseGroupingKey(context: LexClusterSenseContextRow): string {
  return [
    context.domainCode ?? 'domain:none',
    context.taxonomyId ?? 'taxonomy:none',
    context.fieldKind ?? 'field:none',
  ].join('|');
}

/**
 * Groups contexts per term by `buildClusterSenseGroupingKey`, picks representative by occurrences,
 * derives `clusterKey` and review flags. Pure — no I/O; safe for unit tests without worker/env.
 */
export function buildPreparedClusterSenseGroups(
  termIds: readonly string[],
  contextsByTerm: ReadonlyMap<string, readonly LexClusterSenseContextRow[]>,
  termMap: ReadonlyMap<string, LexClusterSenseTermLabelRow>
): LexPreparedClusterSenseGroup[] {
  const preparedGroups: LexPreparedClusterSenseGroup[] = [];

  for (const termId of termIds) {
    const termContexts = contextsByTerm.get(termId) ?? [];
    if (termContexts.length === 0) continue;

    const groups = new Map<string, LexClusterSenseContextRow[]>();
    for (const context of termContexts) {
      const key = buildClusterSenseGroupingKey(context);
      const bucket = groups.get(key) ?? [];
      bucket.push(context);
      groups.set(key, bucket);
    }

    const termLabel = termMap.get(termId);
    const labelRo = termLabel?.displayTextRo ?? termLabel?.canonicalText ?? null;
    const multiBucket = groups.size > 1;

    for (const [groupKey, members] of groups.entries()) {
      const representative = [...members].sort(
        (left, right) => Number(right.occurrencesCount || 0) - Number(left.occurrencesCount || 0)
      )[0]!;
      const groupHash = sha256(`${termId}:${groupKey}`).slice(0, 16);
      const clusterKey = `auto:${groupHash}`;
      preparedGroups.push({
        termId,
        clusterKey,
        representative,
        members,
        labelRo,
        confidence: multiBucket ? 0.72 : 0.96,
        needsReview: multiBucket,
        isApproved: !multiBucket,
      });
    }
  }

  return preparedGroups;
}
