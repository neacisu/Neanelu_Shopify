import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_EXTRACT_ENTITIES_QUEUE_NAME,
  LEX_SHARD_PROCESS_JOB_NAME,
} from '../../queue/lex-queues.js';
import {
  advanceLexRunPhaseIfComplete,
  loadLexShard,
  markLexShardActive,
  markLexShardCompleted,
  markLexShardFailed,
  recordLexPhaseEvent,
} from './run-lifecycle.js';
import { saveLexCheckpoint } from './checkpoints.js';
import { parseShardSourceRecordIds } from './pipeline-utils.js';
import { detectTechnicalEntities } from './extract-entities-pure.js';
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';

const SQL_INJECTION_PATTERNS: readonly RegExp[] = [
  /'\s*;\s*DROP\b/i,
  /'\s*;\s*DELETE\b/i,
  /'\s*;\s*INSERT\b/i,
  /'\s*;\s*UPDATE\b/i,
  /'\s*;\s*ALTER\b/i,
  /'\s*;\s*TRUNCATE\b/i,
  /UNION\s+SELECT\b/i,
  /'\s*OR\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,
  /--\s*$/,
  /\/\*.*\*\//,
];

function isSuspiciousEntityText(text: string): { suspicious: boolean; pattern?: string } {
  for (const re of SQL_INJECTION_PATTERNS) {
    if (re.test(text)) {
      return { suspicious: true, pattern: re.source };
    }
  }
  return { suspicious: false };
}

/** PostgreSQL-compatible UUID (8-4-4-4-12 hex), lowercase/uppercase. */
const LEX_UUID_V4_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function filterValidLexSourceRecordUuids(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (LEX_UUID_V4_LIKE.test(id)) out.push(id);
  }
  return out;
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Keeps multi-row INSERT parameter counts safely below Postgres limits. */
const LEX_FRAGMENT_ENTITY_INSERT_CHUNK = 400;
const LEX_FRAGMENT_ANNOTATION_INSERT_CHUNK = 800;

interface LexFragmentEntityInsertRow {
  readonly fragmentId: string;
  readonly shopId: string;
  readonly entityType: string;
  readonly entityText: string;
  readonly canonicalEntityText: string;
  readonly normalizedValue: string | null;
  readonly unit: string | null;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly confidence: number;
}

interface LexFragmentAnnotationInsertRow {
  readonly fragmentId: string;
  readonly shopId: string;
  readonly annotationType: string;
  readonly annotationJson: string;
}

interface LexSqlClient {
  query(
    sql: string,
    values?: readonly unknown[]
  ): Promise<{ rowCount: number | null; rows: unknown[] }>;
}

async function insertLexFragmentEntitiesBatchChunks(params: {
  client: LexSqlClient;
  rows: readonly LexFragmentEntityInsertRow[];
}): Promise<number> {
  let entitiesWritten = 0;
  for (const chunk of chunkArray(params.rows, LEX_FRAGMENT_ENTITY_INSERT_CHUNK)) {
    if (chunk.length === 0) continue;
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const r of chunk) {
      placeholders.push(
        `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, '{}'::jsonb, now())`
      );
      values.push(
        r.fragmentId,
        r.shopId,
        r.entityType,
        r.entityText,
        r.canonicalEntityText,
        r.normalizedValue,
        r.unit,
        r.spanStart,
        r.spanEnd,
        r.confidence
      );
      p += 10;
    }
    try {
      // No ON CONFLICT target: only PK(id); fragment scope is cleared by DELETE above.
      const insertRes = await params.client.query(
        `INSERT INTO lex_fragment_entities
           (fragment_id, shop_id, entity_type, entity_text, canonical_entity_text,
            normalized_value, unit, span_start, span_end, confidence_score, metadata, created_at)
         VALUES
           ${placeholders.join(', ')}`,
        values
      );
      entitiesWritten += insertRes.rowCount ?? chunk.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`lex_fragment_entities_batch_insert_failed:${message}`, {
        cause: err,
      });
    }
  }
  return entitiesWritten;
}

async function insertLexFragmentAnnotationsBatchChunks(params: {
  client: LexSqlClient;
  rows: readonly LexFragmentAnnotationInsertRow[];
}): Promise<void> {
  for (const chunk of chunkArray(params.rows, LEX_FRAGMENT_ANNOTATION_INSERT_CHUNK)) {
    if (chunk.length === 0) continue;
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const r of chunk) {
      placeholders.push(`($${p}, $${p + 1}, $${p + 2}, $${p + 3}::jsonb, 'system', 0.7000, now())`);
      values.push(r.fragmentId, r.shopId, r.annotationType, r.annotationJson);
      p += 4;
    }
    try {
      // No ON CONFLICT target: only PK(id); fragment scope is cleared by DELETE above.
      await params.client.query(
        `INSERT INTO lex_fragment_annotations
           (fragment_id, shop_id, annotation_type, annotation_value, source, confidence_score, created_at)
         VALUES
           ${placeholders.join(', ')}`,
        values
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`lex_fragment_annotations_batch_insert_failed:${message}`, {
        cause: err,
      });
    }
  }
}

export function startLexExtractEntitiesWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_EXTRACT_ENTITIES_QUEUE_NAME,
    workerId: 'lex-extract-entities-worker',
    processor: async (job) => {
      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_extract_entities_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'extract.entities') {
        throw new Error('invalid_lex_extract_entities_shard_payload');
      }

      const shard = await loadLexShard({
        shopId: payload.shopId,
        runId: payload.runId,
        shardId: payload.shardId,
      });
      if (shard?.phaseName !== 'extract.entities') {
        return { fragmentsProcessed: 0, entitiesWritten: 0 };
      }

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-extract-entities-worker',
      });

      try {
        const result = await withTenantContext(payload.shopId, async (client) => {
          const sourceRecordIds = filterValidLexSourceRecordUuids(
            parseShardSourceRecordIds(shard.metadata)
          );

          if (sourceRecordIds.length === 0) {
            return { fragmentsProcessed: 0, entitiesWritten: 0 };
          }

          const fragments = await client.query<{
            id: string;
            cleanText: string;
            canonicalText: string;
            fieldKind: string;
            vendorHint: string | null;
            productTypeHint: string | null;
          }>(
            `SELECT
               id,
               clean_text AS "cleanText",
               canonical_text AS "canonicalText",
               field_kind AS "fieldKind",
               vendor_hint AS "vendorHint",
               product_type_hint AS "productTypeHint"
             FROM lex_fragments
             WHERE run_id = $1
               AND shop_id = $2
               AND source_table = $3
               AND source_record_id = ANY($4::uuid[])`,
            [payload.runId, payload.shopId, shard.sourceTable, sourceRecordIds]
          );

          const fragmentIds = fragments.rows.map((fragment) => fragment.id);
          if (fragmentIds.length > 0) {
            await client.query(
              `DELETE FROM lex_fragment_entities
               WHERE shop_id = $1
                 AND fragment_id = ANY($2::uuid[])`,
              [payload.shopId, fragmentIds]
            );
            await client.query(
              `DELETE FROM lex_fragment_annotations
               WHERE shop_id = $1
                 AND fragment_id = ANY($2::uuid[])`,
              [payload.shopId, fragmentIds]
            );
          }

          const entityRows: LexFragmentEntityInsertRow[] = [];
          const annotationRows: LexFragmentAnnotationInsertRow[] = [];
          let guardrailsBlocked = 0;

          for (const fragment of fragments.rows) {
            const entities = detectTechnicalEntities(fragment.cleanText);
            for (const entity of entities) {
              if (!entity.text || entity.text.trim().length === 0) continue;
              const sqliCheck = isSuspiciousEntityText(entity.text);
              if (sqliCheck.suspicious) {
                logger.warn(
                  {
                    shopId: payload.shopId,
                    runId: payload.runId,
                    fragmentId: fragment.id,
                    entityText: entity.text.slice(0, 100),
                    pattern: sqliCheck.pattern,
                  },
                  'lex_extract_entities_guardrail_blocked'
                );
                guardrailsBlocked += 1;
                continue;
              }
              entityRows.push({
                fragmentId: fragment.id,
                shopId: payload.shopId,
                entityType: entity.entityType,
                entityText: entity.text,
                canonicalEntityText: entity.text.toUpperCase(),
                normalizedValue: entity.normalizedValue,
                unit: entity.unit,
                spanStart: entity.start,
                spanEnd: entity.end,
                confidence: entity.confidence,
              });
            }

            const vendor = fragment.vendorHint?.trim();
            if (vendor) {
              annotationRows.push({
                fragmentId: fragment.id,
                shopId: payload.shopId,
                annotationType: 'domain_hint',
                annotationJson: JSON.stringify({ vendor }),
              });
            }
            const productType = fragment.productTypeHint?.trim();
            if (productType) {
              annotationRows.push({
                fragmentId: fragment.id,
                shopId: payload.shopId,
                annotationType: 'taxonomy_hint',
                annotationJson: JSON.stringify({ productType }),
              });
            }
          }

          const entitiesWritten = await insertLexFragmentEntitiesBatchChunks({
            client,
            rows: entityRows,
          });
          await insertLexFragmentAnnotationsBatchChunks({ client, rows: annotationRows });

          return {
            fragmentsProcessed: fragments.rows.length,
            entitiesWritten,
            guardrailsBlocked,
          };
        });

        await saveLexCheckpoint({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          workerName: 'lex-extract-entities-worker',
          checkpointType: 'phase_marker',
          checkpointValue: {
            phase: 'extract.entities',
            fragmentsProcessed: result.fragmentsProcessed,
            entitiesWritten: result.entitiesWritten,
            guardrailsBlocked: result.guardrailsBlocked,
            status: 'completed',
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.fragmentsProcessed,
          recordsWritten: result.entitiesWritten,
        }).catch(() => undefined);

        await recordLexPhaseEvent({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'extract.entities',
          eventType: 'shard_completed',
          details: result,
        });

        await advanceLexRunPhaseIfComplete({
          shopId: payload.shopId,
          runId: payload.runId,
          phaseName: 'extract.entities',
          logger,
        });

        return result;
      } catch (error) {
        await markLexShardFailed({
          shopId: payload.shopId,
          shardId: payload.shardId,
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
        throw error;
      }
    },
  });
}
