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
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';

type TechnicalMatch = Readonly<{
  entityType: string;
  text: string;
  normalizedValue: string | null;
  unit: string | null;
  start: number;
  end: number;
  confidence: number;
}>;

const ENTITY_PATTERNS: readonly {
  entityType: string;
  regex: RegExp;
  normalize?: (value: string) => { normalizedValue: string | null; unit: string | null };
}[] = [
  {
    entityType: 'technical_code',
    regex: /\b(?:DN|PN|IP)\d{1,4}\b/g,
    normalize: (value) => ({ normalizedValue: value.toUpperCase(), unit: null }),
  },
  {
    entityType: 'voltage',
    regex: /\b\d{1,4}\s?V\b/gi,
    normalize: (value) => ({ normalizedValue: value.replace(/\s+/g, '').toUpperCase(), unit: 'V' }),
  },
  {
    entityType: 'frequency',
    regex: /\b\d{1,4}\s?Hz\b/gi,
    normalize: (value) => ({
      normalizedValue: value.replace(/\s+/g, '').toUpperCase(),
      unit: 'Hz',
    }),
  },
  {
    entityType: 'fraction',
    regex: /\b\d+\/\d+(?:"|”)?\b/g,
    normalize: (value) => ({ normalizedValue: value.replace(/[”"]/g, '"'), unit: '"' }),
  },
  {
    entityType: 'measurement',
    regex: /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|m|kg|g|l|ml)\b/gi,
    normalize: (value) => {
      const match = /(\d+(?:[.,]\d+)?)(?:\s?)(mm|cm|m|kg|g|l|ml)/i.exec(value);
      const numericPart = match?.[1] ?? value;
      const unitPart = match?.[2]?.toLowerCase() ?? null;
      return {
        normalizedValue: unitPart ? `${numericPart}${unitPart}` : value,
        unit: unitPart,
      };
    },
  },
  {
    entityType: 'sku_like',
    regex: /\b[A-Z0-9]{3,}(?:-[A-Z0-9]{2,})+\b/g,
    normalize: (value) => ({ normalizedValue: value.toUpperCase(), unit: null }),
  },
] as const;

function detectTechnicalEntities(text: string): TechnicalMatch[] {
  const matches: TechnicalMatch[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const value = match[0];
      if (!value) continue;
      const normalized = pattern.normalize?.(value) ?? { normalizedValue: value, unit: null };
      matches.push({
        entityType: pattern.entityType,
        text: value,
        normalizedValue: normalized.normalizedValue,
        unit: normalized.unit,
        start: match.index ?? 0,
        end: (match.index ?? 0) + value.length,
        confidence: 0.99,
      });
    }
  }
  return matches;
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
          const sourceRecordIds = Array.isArray(shard.metadata['sourceRecordIds'])
            ? shard.metadata['sourceRecordIds'].filter(
                (value): value is string => typeof value === 'string' && value.trim().length > 0
              )
            : [];

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

          let entitiesWritten = 0;
          for (const fragment of fragments.rows) {
            const entities = detectTechnicalEntities(fragment.cleanText);
            for (const entity of entities) {
              await client.query(
                `INSERT INTO lex_fragment_entities
                   (fragment_id, shop_id, entity_type, entity_text, canonical_entity_text,
                    normalized_value, unit, span_start, span_end, confidence_score, metadata, created_at)
                 VALUES
                   ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'::jsonb, now())`,
                [
                  fragment.id,
                  payload.shopId,
                  entity.entityType,
                  entity.text,
                  entity.text.toUpperCase(),
                  entity.normalizedValue,
                  entity.unit,
                  entity.start,
                  entity.end,
                  entity.confidence,
                ]
              );
              entitiesWritten += 1;
            }

            if (fragment.vendorHint) {
              await client.query(
                `INSERT INTO lex_fragment_annotations
                   (fragment_id, shop_id, annotation_type, annotation_value, source, confidence_score, created_at)
                 VALUES
                   ($1, $2, 'domain_hint', $3::jsonb, 'system', 0.7000, now())`,
                [fragment.id, payload.shopId, JSON.stringify({ vendor: fragment.vendorHint })]
              );
            }
            if (fragment.productTypeHint) {
              await client.query(
                `INSERT INTO lex_fragment_annotations
                   (fragment_id, shop_id, annotation_type, annotation_value, source, confidence_score, created_at)
                 VALUES
                   ($1, $2, 'taxonomy_hint', $3::jsonb, 'system', 0.7000, now())`,
                [
                  fragment.id,
                  payload.shopId,
                  JSON.stringify({ productType: fragment.productTypeHint }),
                ]
              );
            }
          }

          return {
            fragmentsProcessed: fragments.rows.length,
            entitiesWritten,
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
            status: 'completed',
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.fragmentsProcessed,
          recordsWritten: result.entitiesWritten,
        });

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
