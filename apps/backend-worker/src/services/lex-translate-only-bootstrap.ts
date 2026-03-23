import type { TenantClient } from '../processors/lex/pipeline-types.js';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

/**
 * Găsește ultimul run completat care are fragmente persistate pentru tabelele sursă cerute.
 * Necesar pentru `translate_only`: compose citește `lex_fragments` după `run_id`.
 */
export async function findLexReuseFragmentsRunId(
  client: TenantClient,
  shopId: string,
  sourceTables: readonly string[]
): Promise<string | null> {
  if (sourceTables.length === 0) {
    return null;
  }

  const result = await client.query<{ id: string }>(
    `SELECT r.id
     FROM lex_runs r
     WHERE r.shop_id = $1
       AND r.status = 'completed'
       AND EXISTS (
         SELECT 1
         FROM lex_fragments f
         WHERE f.run_id = r.id
           AND f.shop_id = r.shop_id
           AND f.source_table = ANY($2::text[])
       )
     ORDER BY r.completed_at DESC NULLS LAST, r.created_at DESC
     LIMIT 1`,
    [shopId, sourceTables]
  );

  return result.rows[0]?.id ?? null;
}

/**
 * Construiește metadata pentru shard-ul `translate.candidates`:
 * - `termIdsTouched` / `sourceRecordIds` propagate din run-ul de bază (faza resolve.attributes),
 *   sau derivate din fragmente + clustere dacă lipsește shard-ul resolve.
 */
export async function buildTranslateOnlyShardMetadata(params: {
  client: TenantClient;
  shopId: string;
  reuseFragmentsRunId: string;
  sourceTable: string;
}): Promise<Record<string, unknown>> {
  const { client, shopId, reuseFragmentsRunId, sourceTable } = params;

  const shardRow = await client.query<{ metadata: Record<string, unknown> | null }>(
    `SELECT metadata
     FROM lex_run_shards
     WHERE run_id = $1
       AND shop_id = $2
       AND phase_name = 'resolve.attributes'
       AND source_table = $3
       AND status = 'completed'
     ORDER BY completed_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [reuseFragmentsRunId, shopId, sourceTable]
  );

  const base = shardRow.rows[0]?.metadata ?? {};
  let termIds = asStringArray(base['termIdsTouched']);
  let sourceRecordIds = asStringArray(base['sourceRecordIds']);

  if (sourceRecordIds.length === 0) {
    const records = await client.query<{ sid: string }>(
      `SELECT DISTINCT source_record_id::text AS sid
       FROM lex_fragments
       WHERE run_id = $1
         AND shop_id = $2
         AND source_table = $3`,
      [reuseFragmentsRunId, shopId, sourceTable]
    );
    sourceRecordIds = records.rows.map((row) => row.sid).filter((id) => id.length > 0);
  }

  if (termIds.length === 0) {
    const terms = await client.query<{ termId: string }>(
      `SELECT DISTINCT o.term_id::text AS "termId"
       FROM lex_term_occurrences o
       INNER JOIN lex_fragments f ON f.id = o.fragment_id
       INNER JOIN lex_sense_clusters c ON c.term_id = o.term_id
              AND (c.shop_id = $2 OR c.shop_id IS NULL)
       WHERE o.run_id = $1
         AND o.shop_id = $2
         AND f.source_table = $3`,
      [reuseFragmentsRunId, shopId, sourceTable]
    );
    termIds = terms.rows.map((row) => row.termId).filter((id) => id.length > 0);
  }

  return {
    ...base,
    termIdsTouched: termIds,
    sourceRecordIds,
    translate_only_bootstrap: true,
    reuse_fragments_run_id: reuseFragmentsRunId,
  };
}

export async function insertTranslateOnlyRunShards(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  reuseFragmentsRunId: string;
  sourceTables: readonly string[];
  extraShardMetadata?: Record<string, unknown>;
}): Promise<void> {
  const { client, shopId, runId, reuseFragmentsRunId, sourceTables, extraShardMetadata } = params;

  for (const sourceTable of sourceTables) {
    const metadata = await buildTranslateOnlyShardMetadata({
      client,
      shopId,
      reuseFragmentsRunId,
      sourceTable,
    });
    const merged = extraShardMetadata ? { ...metadata, ...extraShardMetadata } : metadata;

    await client.query(
      `INSERT INTO lex_run_shards
         (run_id, shop_id, shard_key, phase_name, source_table, status, metadata, created_at)
       VALUES
         ($1, $2, $3, 'translate.candidates', $4, 'pending', $5::jsonb, now())`,
      [runId, shopId, `${sourceTable}:all`, sourceTable, JSON.stringify(merged)]
    );
  }
}
