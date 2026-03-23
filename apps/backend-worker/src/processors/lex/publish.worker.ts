import type { Logger } from '@app/logger';
import type { LexPublishJobPayload } from '@app/types';
import { validateLexPublishJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import {
  enqueueLexPublishJob,
  LEX_PUBLISH_JOB_NAME,
  LEX_PUBLISH_QUEUE_NAME,
} from '../../queue/lex-queues.js';
import {
  markLexPublicationTargetUnexpectedFailure,
  publishLexPublicationTargetWithClient,
} from '../../services/lex-localizations.js';
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';
import { syncPublishedTargetsToShopify } from '../../services/lex-shopify-sync-bridge.js';

const PUBLISH_BATCH_SIZE = 50;
/** Fetch one extra row to detect whether another job should continue the backlog. */
const PUBLISH_FETCH_LIMIT = PUBLISH_BATCH_SIZE + 1;

function buildPublicationTargetQueryParts(payload: LexPublishJobPayload): {
  filters: string[];
  values: unknown[];
} {
  const filters: string[] = [`pt.shop_id = $1`];
  const values: unknown[] = [payload.shopId];
  let idx = values.length + 1;

  if (payload.retryOnly) {
    filters.push(`pt.status IN ('pending', 'failed')`);
  } else {
    filters.push(`pt.status = 'pending'`);
  }
  if (payload.publicationTargetType) {
    filters.push(`pt.target_type = $${idx}`);
    values.push(payload.publicationTargetType);
    idx += 1;
  }
  if (payload.targetIds && payload.targetIds.length > 0) {
    filters.push(`pt.id = ANY($${idx}::uuid[])`);
    values.push(payload.targetIds);
  }

  return { filters, values };
}

export function startLexPublishWorker(logger: Logger): LexWorkerHandle {
  return createLexWorker({
    logger,
    queueName: LEX_PUBLISH_QUEUE_NAME,
    workerId: 'lex-publish-worker',
    processor: async (job) => {
      if (job.name !== LEX_PUBLISH_JOB_NAME) {
        throw new Error(`unknown_lex_publish_job:${job.name}`);
      }

      const payload = job.data as LexPublishJobPayload;
      if (!validateLexPublishJobPayload(payload)) {
        throw new Error('invalid_lex_publish_payload');
      }

      const { filters, values } = buildPublicationTargetQueryParts(payload);

      const listValues = [...values, PUBLISH_FETCH_LIMIT];
      const limitParamIndex = values.length + 1;

      const targets = await withTenantContext(payload.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          targetType: string;
        }>(
          `SELECT
             pt.id,
             pt.target_type AS "targetType"
           FROM lex_publication_targets pt
           WHERE ${filters.join(' AND ')}
           ORDER BY pt.updated_at DESC
           LIMIT $${limitParamIndex}`,
          listValues
        );

        return result.rows;
      });

      const hasMoreAfterThisBatch = targets.length > PUBLISH_BATCH_SIZE;
      const batch = targets.slice(0, PUBLISH_BATCH_SIZE);

      let publishedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      if (batch.length > 0) {
        await withTenantContext(payload.shopId, async (client) => {
          for (let i = 0; i < batch.length; i += 1) {
            const target = batch[i]!;
            const savepoint = `lex_pub_sp_${i}`;
            await client.query(`SAVEPOINT ${savepoint}`);
            try {
              const outcome = await publishLexPublicationTargetWithClient(client, {
                shopId: payload.shopId,
                publicationTargetId: target.id,
                logger,
              });
              if (outcome === 'published') {
                publishedCount += 1;
              } else if (outcome === 'failed') {
                failedCount += 1;
              } else {
                skippedCount += 1;
              }
            } catch (error) {
              await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
              failedCount += 1;
              logger.warn(
                {
                  err: error,
                  shopId: payload.shopId,
                  publicationTargetId: target.id,
                  workerId: 'lex-publish-worker',
                },
                'lex_publish_target_unexpected_error'
              );
              await markLexPublicationTargetUnexpectedFailure({
                client,
                shopId: payload.shopId,
                publicationTargetId: target.id,
                error,
              });
            }
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          }
        });
      }

      if (publishedCount > 0) {
        const publishedTargetIds = batch
          .filter((_, i) => i < publishedCount + skippedCount)
          .map((t) => t.id);
        await syncPublishedTargetsToShopify({
          shopId: payload.shopId,
          publishedTargetIds,
          logger,
        }).catch((err) => {
          logger.warn(
            { err, shopId: payload.shopId, workerId: 'lex-publish-worker' },
            'lex_shopify_sync_best_effort_failed'
          );
        });
      }

      let continuationEnqueued = false;
      if (hasMoreAfterThisBatch) {
        const continuation: LexPublishJobPayload = {
          shopId: payload.shopId,
          requestedAt: Date.now(),
        };
        if (payload.targetIds !== undefined) {
          continuation.targetIds = payload.targetIds;
        }
        if (payload.publicationTargetType !== undefined) {
          continuation.publicationTargetType = payload.publicationTargetType;
        }
        if (payload.retryOnly !== undefined) {
          continuation.retryOnly = payload.retryOnly;
        }
        await enqueueLexPublishJob(continuation);
        continuationEnqueued = true;
      }

      return {
        publishedCount,
        failedCount,
        skippedCount,
        targetGroupCount: batch.length,
        continuationEnqueued,
      };
    },
  });
}
