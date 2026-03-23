import type { PoolClient } from 'pg';

import { withTenantContext } from '@app/database';

import { enqueueLexPublishJob } from '../queue/lex-queues.js';

function isPublishConflictFailedTarget(params: {
  status: string;
  errorMessage: string | null;
}): boolean {
  if (params.status !== 'failed') return false;
  const em = params.errorMessage?.toLowerCase() ?? '';
  return em.includes('publish_conflict');
}

/**
 * Rezolvă publicarea eșuată din cauza conflictului manual vs Lex (prod_translations):
 * - accept_lex: scoate blocajul (is_approved=false), repune target în pending, închide review-ul ca aprobat, enfilează publish.
 * - keep_manual: anulează target-ul, închide review-ul ca respins.
 */
export async function resolveLexPublicationPublishConflict(params: {
  shopId: string;
  publicationTargetId: string;
  resolution: 'accept_lex' | 'keep_manual';
  actorId: string | null;
}): Promise<
  | { ok: true; queueJobId: string | null }
  | { ok: false; code: 'NOT_FOUND' | 'BAD_STATE' | 'UNSUPPORTED'; message: string }
> {
  const step = await withTenantContext(
    params.shopId,
    async (
      client: PoolClient
    ): Promise<
      | { ok: false; code: 'NOT_FOUND' | 'BAD_STATE' | 'UNSUPPORTED'; message: string }
      | { ok: true; outcome: 'accept' | 'keep' }
    > => {
      const targetRes = await client.query<{
        id: string;
        status: string;
        errorMessage: string | null;
        targetType: string;
        payload: Record<string, unknown> | null;
      }>(
        `SELECT
           id,
           status,
           error_message AS "errorMessage",
           target_type AS "targetType",
           payload
         FROM lex_publication_targets
         WHERE shop_id = $1
           AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [params.shopId, params.publicationTargetId]
      );
      const target = targetRes.rows[0];
      if (!target) {
        return { ok: false, code: 'NOT_FOUND', message: 'Publication target not found' };
      }

      if (!isPublishConflictFailedTarget(target)) {
        return {
          ok: false,
          code: 'BAD_STATE',
          message: 'Target is not a failed publish_conflict publication',
        };
      }

      if (target.targetType !== 'prod_translations') {
        return {
          ok: false,
          code: 'UNSUPPORTED',
          message: 'Conflict resolution is only implemented for prod_translations targets',
        };
      }

      const payload = target.payload ?? {};
      const productId = typeof payload['productId'] === 'string' ? payload['productId'] : null;
      const localeRaw = typeof payload['locale'] === 'string' ? payload['locale'].trim() : '';
      const locale = localeRaw.length > 0 ? localeRaw : 'en';
      if (!productId) {
        return {
          ok: false,
          code: 'BAD_STATE',
          message: 'Publication payload is missing productId',
        };
      }

      const reviewRes = await client.query<{
        id: string;
        entityType: string;
        entityId: string;
        evidence: Record<string, unknown> | null;
      }>(
        `SELECT
           id,
           entity_type AS "entityType",
           entity_id AS "entityId",
           evidence
         FROM lex_review_items
         WHERE shop_id = $1
           AND review_reason = 'publish_conflict'
           AND entity_id = $2::uuid
           AND status IN ('pending', 'in_review')
         LIMIT 1
         FOR UPDATE`,
        [params.shopId, productId]
      );
      const review = reviewRes.rows[0];

      const closeReview = async (
        decisionType: 'approve' | 'reject',
        notes: string
      ): Promise<void> => {
        if (!review) return;
        const nextStatus = decisionType === 'approve' ? 'approved' : 'rejected';
        await client.query(
          `UPDATE lex_review_items
           SET status = $3,
               notes = COALESCE($4, notes),
               version = version + 1,
               resolved_at = now(),
               updated_at = now()
           WHERE id = $1
             AND shop_id = $2`,
          [review.id, params.shopId, nextStatus, notes]
        );
        await client.query(
          `INSERT INTO lex_decisions
             (review_item_id, shop_id, entity_type, entity_id, decision_type, old_value, new_value, decided_by, decision_notes, created_at)
           VALUES
             ($1, $2, $3, $4::uuid, $5, $6::jsonb, $7::jsonb, $8, $9, now())`,
          [
            review.id,
            params.shopId,
            review.entityType,
            review.entityId,
            decisionType,
            JSON.stringify(review.evidence ?? {}),
            JSON.stringify({ resolution: params.resolution }),
            params.actorId,
            notes,
          ]
        );
      };

      if (params.resolution === 'accept_lex') {
        await client.query(
          `UPDATE prod_translations
           SET is_approved = false,
               updated_at = now()
           WHERE product_id = $1::uuid
             AND locale = $2`,
          [productId, locale]
        );
        await client.query(
          `UPDATE lex_publication_targets
           SET status = 'pending',
               error_message = NULL,
               updated_at = now()
           WHERE id = $1
             AND shop_id = $2`,
          [params.publicationTargetId, params.shopId]
        );
        await closeReview(
          'approve',
          'Operator accepted Lex translation (publications conflict resolution).'
        );
        return { ok: true, outcome: 'accept' };
      }

      await client.query(
        `UPDATE lex_publication_targets
         SET status = 'cancelled',
             error_message = NULL,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2`,
        [params.publicationTargetId, params.shopId]
      );
      await closeReview(
        'reject',
        'Operator kept current storefront translation (publications conflict resolution).'
      );
      return { ok: true, outcome: 'keep' };
    }
  );

  if (!step.ok) {
    return step;
  }

  if (step.outcome === 'accept') {
    const queueJobId = await enqueueLexPublishJob({
      shopId: params.shopId,
      requestedAt: Date.now(),
      targetIds: [params.publicationTargetId],
      publicationTargetType: 'prod_translations',
    });
    return { ok: true, queueJobId };
  }

  return { ok: true, queueJobId: null };
}
