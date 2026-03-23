import type pg from 'pg';

const XLIFF_EXPORT_MAX_ROWS = 25_000;

export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function buildLexXliffExport(params: {
  client: pg.PoolClient;
  shopId: string;
  targetLang: string;
  status?: string;
  sourceLang?: string;
}): Promise<{ xml: string; unitCount: number }> {
  const { client, shopId, targetLang, status, sourceLang = 'ro' } = params;

  const conditions = ['tr.target_lang = $2', '(tr.shop_id = $1 OR tr.shop_id IS NULL)'];
  const values: unknown[] = [shopId, targetLang];

  if (status) {
    values.push(status);
    conditions.push(`tr.publication_status = $${values.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const result = await client.query<{
    termId: string;
    sourceText: string;
    translationText: string;
    qualityScore: string | null;
    candidateSource: string | null;
    sourceLang: string;
    targetLang: string;
  }>(
    `SELECT
       tr.term_id AS "termId",
       tm.canonical_text AS "sourceText",
       tr.translation_text AS "translationText",
       tr.quality_score::text AS "qualityScore",
       tc.candidate_source AS "candidateSource",
       tr.source_lang AS "sourceLang",
       tr.target_lang AS "targetLang"
     FROM lex_translations tr
     LEFT JOIN lex_terms tm
       ON tm.id = tr.term_id
      AND (tm.shop_id = $1 OR tm.shop_id IS NULL)
     LEFT JOIN lex_translation_candidates tc
       ON tc.id = tr.source_candidate_id
     WHERE ${whereClause}
     ORDER BY tm.canonical_text ASC NULLS LAST, tr.id
     LIMIT ${XLIFF_EXPORT_MAX_ROWS}`,
    values
  );

  const units = result.rows
    .filter((r) => r.sourceText && r.translationText)
    .map((r) => {
      const notes: string[] = [];
      if (r.qualityScore) {
        notes.push(`      <note category="confidence">${escapeXml(r.qualityScore)}</note>`);
      }
      if (r.candidateSource) {
        notes.push(`      <note category="source">${escapeXml(r.candidateSource)}</note>`);
      }

      const notesBlock = notes.length > 0 ? `\n    <notes>\n${notes.join('\n')}\n    </notes>` : '';

      return `  <unit id="${escapeXml(r.termId)}">
    <segment>
      <source>${escapeXml(r.sourceText)}</source>
      <target>${escapeXml(r.translationText)}</target>
    </segment>${notesBlock}
  </unit>`;
    });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="${escapeXml(sourceLang)}" trgLang="${escapeXml(targetLang)}">
<file id="lex-translations">
${units.join('\n')}
</file>
</xliff>`;

  return { xml, unitCount: units.length };
}

export interface XliffUnit {
  id: string;
  source: string;
  target: string;
}

export function parseXliffUnits(xmlBody: string): XliffUnit[] {
  const units: XliffUnit[] = [];
  const unitRegex = /<unit\s[^>]*id\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/unit>/gi;
  let unitMatch: RegExpExecArray | null;

  while ((unitMatch = unitRegex.exec(xmlBody)) !== null) {
    const id = unitMatch[1];
    const inner = unitMatch[2];
    if (inner === undefined) {
      continue;
    }

    const sourceMatch = /<source>([\s\S]*?)<\/source>/i.exec(inner);
    const targetMatch = /<target>([\s\S]*?)<\/target>/i.exec(inner);
    const sourceText = sourceMatch?.[1];
    const targetText = targetMatch?.[1];

    if (id && sourceText !== undefined && targetText !== undefined) {
      units.push({
        id,
        source: unescapeXml(sourceText),
        target: unescapeXml(targetText),
      });
    }
  }

  return units;
}

export function unescapeXml(text: string): string {
  return text
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

export async function importXliffUnits(params: {
  client: pg.PoolClient;
  shopId: string;
  units: XliffUnit[];
  sourceLang: string;
  targetLang: string;
}): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const { client, shopId, units, sourceLang, targetLang } = params;
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const unit of units) {
    try {
      if (!unit.target.trim()) {
        skipped += 1;
        continue;
      }

      const termResult = await client.query<{ id: string }>(
        `SELECT id FROM lex_terms
         WHERE (shop_id = $1 OR shop_id IS NULL)
           AND (id::text = $2 OR canonical_text = $3)
           AND status <> 'merged'
         ORDER BY CASE WHEN id::text = $2 THEN 0 ELSE 1 END
         LIMIT 1`,
        [shopId, unit.id, unit.source]
      );

      if (termResult.rows.length === 0) {
        skipped += 1;
        errors.push(`Term not found for unit id="${unit.id}" source="${unit.source.slice(0, 60)}"`);
        continue;
      }

      const termId = termResult.rows[0]?.id;
      if (!termId) {
        skipped += 1;
        errors.push(`Term row missing id for unit id="${unit.id}"`);
        continue;
      }

      await client.query(
        `INSERT INTO lex_translations
           (shop_id, term_id, source_lang, target_lang, translation_text,
            translation_kind, version, publication_status)
         VALUES ($1, $2, $3, $4, $5, 'xliff_import', 1, 'draft')
         ON CONFLICT (shop_id, term_id, cluster_id, source_lang, target_lang)
         DO UPDATE SET
           translation_text = EXCLUDED.translation_text,
           translation_kind = 'xliff_import',
           version = lex_translations.version + 1,
           updated_at = NOW()`,
        [shopId, termId, sourceLang, targetLang, unit.target]
      );

      imported += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Error importing unit id="${unit.id}": ${msg.slice(0, 200)}`);
    }
  }

  return { imported, skipped, errors };
}
