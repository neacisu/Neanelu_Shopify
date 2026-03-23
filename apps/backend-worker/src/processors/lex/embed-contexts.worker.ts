import { loadEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { LexShardJobPayload } from '@app/types';
import { validateLexShardJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  LEX_EMBED_CONTEXTS_QUEUE_NAME,
  LEX_SHARD_PROCESS_JOB_NAME,
} from '../../queue/lex-queues.js';
import {
  advanceLexRunPhaseIfComplete,
  loadLexShard,
  markLexRunPaused,
  markLexShardActive,
  markLexShardCompleted,
  markLexShardFailed,
  recordLexPhaseEvent,
} from './run-lifecycle.js';
import { saveLexCheckpoint } from './checkpoints.js';
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';
import { parseTouchedIds } from './pipeline-utils.js';
import { BudgetExceededError, processLexEmbeddingBatch } from './ai-batches.js';

type ContextRow = Readonly<{
  id: string;
  representativeText: string;
  fieldKind: string | null;
  vendorHint: string | null;
  productTypeHint: string | null;
  domainCode: string | null;
}>;

export function startLexEmbedContextsWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_EMBED_CONTEXTS_QUEUE_NAME,
    workerId: 'lex-embed-contexts-worker',
    processor: async (job) => {
      if (job.name !== LEX_SHARD_PROCESS_JOB_NAME) {
        throw new Error(`unknown_lex_embed_contexts_job:${job.name}`);
      }

      const payload = job.data as LexShardJobPayload;
      if (!validateLexShardJobPayload(payload) || payload.queuePhase !== 'embed.contexts') {
        throw new Error('invalid_lex_embed_contexts_shard_payload');
      }

      const shard = await loadLexShard({
        shopId: payload.shopId,
        runId: payload.runId,
        shardId: payload.shardId,
      });
      if (shard?.phaseName !== 'embed.contexts') {
        return { contextsProcessed: 0, embeddingsWritten: 0, embeddedContextIds: [] };
      }

      await markLexShardActive({
        shopId: payload.shopId,
        shardId: payload.shardId,
        workerName: 'lex-embed-contexts-worker',
      });

      try {
        const env = loadEnv();
        const result = await withTenantContext(payload.shopId, async (client) => {
          const contextIds = parseTouchedIds(shard.metadata, 'contextIdsTouched');
          if (contextIds.length === 0) {
            return { contextsProcessed: 0, embeddingsWritten: 0, embeddedContextIds: [] };
          }

          const contexts = await client.query<ContextRow>(
            `SELECT
               id,
               representative_text AS "representativeText",
               field_kind AS "fieldKind",
               vendor_hint AS "vendorHint",
               product_type_hint AS "productTypeHint",
               domain_code AS "domainCode"
             FROM lex_term_contexts
             WHERE shop_id = $1
               AND id = ANY($2::uuid[])`,
            [payload.shopId, contextIds]
          );

          const batch = await processLexEmbeddingBatch({
            shopId: payload.shopId,
            runId: payload.runId,
            env,
            logger,
            contexts: contexts.rows,
          });

          return {
            contextsProcessed: batch.contextsProcessed,
            embeddingsWritten: batch.embeddingsWritten,
            embeddedContextIds: contexts.rows.map((context) => context.id),
            aiBatchId: batch.batchId,
          };
        });

        await saveLexCheckpoint({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          workerName: 'lex-embed-contexts-worker',
          checkpointType: 'phase_marker',
          checkpointValue: {
            phase: 'embed.contexts',
            status: 'completed',
            contextsProcessed: result.contextsProcessed,
            embeddingsWritten: result.embeddingsWritten,
          },
        });

        await markLexShardCompleted({
          shopId: payload.shopId,
          shardId: payload.shardId,
          recordsRead: result.contextsProcessed,
          recordsWritten: result.embeddingsWritten,
          metadataPatch: {
            embeddedContextIds: result.embeddedContextIds,
          },
        }).catch(() => undefined);

        await recordLexPhaseEvent({
          shopId: payload.shopId,
          runId: payload.runId,
          shardId: payload.shardId,
          phaseName: 'embed.contexts',
          eventType: 'shard_completed',
          details: result,
        });

        await advanceLexRunPhaseIfComplete({
          shopId: payload.shopId,
          runId: payload.runId,
          phaseName: 'embed.contexts',
          logger,
        });

        return result;
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          await markLexRunPaused({
            shopId: payload.shopId,
            runId: payload.runId,
            pauseReason: 'budget_blocked',
            errorMessage: error.message,
          }).catch(() => undefined);
        }
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
