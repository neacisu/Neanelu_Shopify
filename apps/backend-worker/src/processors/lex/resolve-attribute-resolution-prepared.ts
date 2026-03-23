import { normalizeLexeme } from './pipeline-utils.js';

export type LexAttributeResolutionInputRow = Readonly<{
  termId: string;
  clusterId: string | null;
  canonicalText: string;
  normalizedKey: string;
}>;

export type LexAttributePreparedResolutionRow = Readonly<{
  termId: string;
  clusterId: string | null;
  canonicalText: string;
  normalizedKey: string;
  definitionId: string | null;
  confidence: number;
  status: string;
  evidenceJson: string;
  publication: null | Readonly<{
    targetPath: string;
    idempotencyKey: string;
    targetSnapshotHash: string;
    payloadJson: string;
  }>;
}>;

/**
 * Assembles one candidate row after `prod_attr_definitions` / `prod_attr_synonyms` lookups.
 * Side-effect free — suitable for unit tests without loading the worker module graph.
 */
export function buildPreparedLexAttributeResolutionRow(
  row: LexAttributeResolutionInputRow,
  targetLang: string,
  defLookup: ReadonlyMap<string, string>,
  synLookup: ReadonlyMap<string, string>
): LexAttributePreparedResolutionRow {
  const key = row.canonicalText.toLowerCase();
  const definitionId = defLookup.get(key) ?? synLookup.get(key) ?? null;
  const confidence = definitionId ? 0.98 : 0.41;
  const status = definitionId ? 'approved' : 'pending';
  const evidenceJson = JSON.stringify({
    sourceText: row.canonicalText,
    normalizedKey: row.normalizedKey,
    strategy: definitionId ? 'exact_match' : 'review_required',
  });

  let publication: LexAttributePreparedResolutionRow['publication'] = null;
  if (definitionId) {
    const targetSnapshotHash = normalizeLexeme(
      `${definitionId}:${row.canonicalText}:${targetLang}`
    );
    publication = {
      targetPath: `locale:${targetLang}`,
      idempotencyKey: `lex-target:prod_attr_synonyms:${definitionId}:${targetSnapshotHash}`,
      targetSnapshotHash,
      payloadJson: JSON.stringify({
        definitionId,
        synonymText: row.canonicalText,
        locale: targetLang,
        source: 'lex_module',
        confidenceScore: confidence,
      }),
    };
  }

  return {
    termId: row.termId,
    clusterId: row.clusterId,
    canonicalText: row.canonicalText,
    normalizedKey: row.normalizedKey,
    definitionId,
    confidence,
    status,
    evidenceJson,
    publication,
  };
}
