import type { Logger } from '@app/logger';
import type { LexPublishJobPayload } from '@app/types';
import { validateLexPublishJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';

import { LEX_PUBLISH_JOB_NAME, LEX_PUBLISH_QUEUE_NAME } from '../../queue/lex-queues.js';
import { publishLexPublicationTarget } from '../../services/lex-localizations.js';
import { createLexWorker, type LexWorkerHandle } from './worker-toolkit.js';

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

      const targets = await withTenantContext(payload.shopId, async (client) => {
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
           LIMIT 100`,
          values
        );

        return result.rows;
      });

      let publishedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      for (const target of targets) {
        const outcome = await publishLexPublicationTarget({
          shopId: payload.shopId,
          publicationTargetId: target.id,
        });
        if (outcome === 'published') {
          publishedCount += 1;
        } else if (outcome === 'failed') {
          failedCount += 1;
        } else {
          skippedCount += 1;
        }
      }

      return {
        publishedCount,
        failedCount,
        skippedCount,
        targetGroupCount: targets.length,
      };
    },
  });
}
