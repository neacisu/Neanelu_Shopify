/**
 * Snapshot determinist pentru glosar + reguli de traducere (PIM Lex).
 * Folosit la crearea run-ului și verificat per shard în faza translate.candidates.
 */
import { createHash } from 'node:crypto';
import stringify from 'fast-json-stable-stringify';

import type { TenantClient } from '../processors/lex/pipeline-types.js';

type GlossarySnapshotRow = Readonly<{
  id: string;
  shop_id: string;
  domain_code: string;
  source_lang: string;
  target_lang: string;
  source_text: string;
  normalized_source_text: string;
  sense_hint: string;
  target_text: string;
  translation_kind: string;
  priority: number | null;
  version: number | null;
  is_locked: boolean;
  is_active: boolean;
  source: string;
  confidence_score: string;
  notes: string;
  updated_at: string;
}>;

type RuleSnapshotRow = Readonly<{
  id: string;
  shop_id: string;
  rule_name: string;
  source_lang: string;
  target_lang: string;
  match_term: string;
  domain_code: string;
  required_neighbors: unknown;
  forbidden_neighbors: unknown;
  required_field_kinds: unknown;
  target_translation: string;
  priority: number | null;
  version: number | null;
  is_active: boolean;
  updated_at: string;
}>;

/**
 * SHA-256 hex peste payload canonic (chei sortate, array-uri în ordinea din DB).
 */
export async function computeLexGlossaryRulesSnapshotHash(
  client: TenantClient,
  shopId: string
): Promise<string> {
  const [glossaryRes, rulesRes] = await Promise.all([
    client.query<GlossarySnapshotRow>(
      `SELECT
         id::text,
         COALESCE(shop_id::text, '') AS shop_id,
         COALESCE(domain_code, '') AS domain_code,
         source_lang,
         target_lang,
         source_text,
         normalized_source_text,
         COALESCE(sense_hint, '') AS sense_hint,
         target_text,
         translation_kind,
         priority,
         version,
         COALESCE(is_locked, false) AS is_locked,
         COALESCE(is_active, false) AS is_active,
         COALESCE(source, '') AS source,
         COALESCE(confidence_score::text, '') AS confidence_score,
         COALESCE(notes, '') AS notes,
         updated_at::text AS updated_at
       FROM lex_glossary_entries
       WHERE COALESCE(is_active, false) = true
         AND (shop_id = $1::uuid OR shop_id IS NULL)
       ORDER BY id`,
      [shopId]
    ),
    client.query<RuleSnapshotRow>(
      `SELECT
         id::text,
         COALESCE(shop_id::text, '') AS shop_id,
         rule_name,
         source_lang,
         target_lang,
         match_term,
         COALESCE(domain_code, '') AS domain_code,
         COALESCE(required_neighbors, '[]'::jsonb) AS required_neighbors,
         COALESCE(forbidden_neighbors, '[]'::jsonb) AS forbidden_neighbors,
         COALESCE(required_field_kinds, '[]'::jsonb) AS required_field_kinds,
         target_translation,
         priority,
         version,
         COALESCE(is_active, false) AS is_active,
         updated_at::text AS updated_at
       FROM lex_translation_rules
       WHERE COALESCE(is_active, false) = true
         AND (shop_id = $1::uuid OR shop_id IS NULL)
       ORDER BY id`,
      [shopId]
    ),
  ]);

  const payload = {
    glossary: glossaryRes.rows,
    rules: rulesRes.rows,
  };

  return createHash('sha256').update(stringify(payload)).digest('hex');
}

export function readGlossaryRulesSnapshotHashFromRunMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const raw = (metadata as Record<string, unknown>)['glossary_rules_snapshot_hash'];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  return raw.trim();
}
