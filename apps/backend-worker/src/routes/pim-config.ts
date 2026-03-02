import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { enqueueDescriptionGeneratorJob } from '../queue/description-generator-queue.js';
import { enqueueMetafieldPushJob } from '../queue/metafield-push-queue.js';

interface PimConfigRoutesOptions {
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}

interface RequestWithSession {
  session?: { shopId: string };
}

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: { request_id: requestId, timestamp: nowIso() },
  } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: { code, message },
    meta: { request_id: requestId, timestamp: nowIso() },
    status,
  } as const;
}

export const pimConfigRoutes: FastifyPluginAsync<PimConfigRoutesOptions> = (
  server: FastifyInstance,
  options
) => {
  const requireAdminSession = requireSession(options.sessionConfig);

  server.get(
    '/pim/metafield-mappings',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const rows = await withTenantContext(session.shopId, async (client) => {
        const res = await client.query<{
          id: string;
          shop_id: string | null;
          attr_code: string;
          shopify_namespace: string;
          shopify_key: string;
          shopify_type: string;
          is_active: boolean;
          updated_at: string;
        }>(
          `SELECT id, shop_id, attr_code, shopify_namespace, shopify_key, shopify_type, is_active, updated_at::text
         FROM pim_metafield_mappings
         WHERE shop_id = $1 OR shop_id IS NULL
         ORDER BY (shop_id IS NULL) ASC, attr_code ASC`,
          [session.shopId]
        );
        return res.rows;
      });

      return reply.send(successEnvelope(request.id, { mappings: rows }));
    }
  );

  server.post(
    '/pim/metafield-mappings',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as {
        id?: unknown;
        attrCode?: unknown;
        shopifyNamespace?: unknown;
        shopifyKey?: unknown;
        shopifyType?: unknown;
        isActive?: unknown;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const attrCode = typeof body.attrCode === 'string' ? body.attrCode.trim() : '';
      const shopifyNamespace =
        typeof body.shopifyNamespace === 'string' ? body.shopifyNamespace.trim() : '';
      const shopifyKey = typeof body.shopifyKey === 'string' ? body.shopifyKey.trim() : '';
      const shopifyType = typeof body.shopifyType === 'string' ? body.shopifyType.trim() : '';
      const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
      if (!attrCode || !shopifyNamespace || !shopifyKey || !shopifyType) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid payload'));
      }

      await withTenantContext(session.shopId, async (client) => {
        await client.query(
          `INSERT INTO pim_metafield_mappings
           (shop_id, attr_code, shopify_namespace, shopify_key, shopify_type, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (shop_id, attr_code) DO UPDATE SET
           shopify_namespace = EXCLUDED.shopify_namespace,
           shopify_key = EXCLUDED.shopify_key,
           shopify_type = EXCLUDED.shopify_type,
           is_active = EXCLUDED.is_active,
           updated_at = now()`,
          [session.shopId, attrCode, shopifyNamespace, shopifyKey, shopifyType, isActive]
        );
      });

      return reply.send(successEnvelope(request.id, { saved: true }));
    }
  );

  server.delete(
    '/pim/metafield-mappings/:id',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const id = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!id) {
        return reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      }

      await withTenantContext(session.shopId, async (client) => {
        await client.query(`DELETE FROM pim_metafield_mappings WHERE id = $1 AND shop_id = $2`, [
          id,
          session.shopId,
        ]);
      });
      return reply.send(successEnvelope(request.id, { deleted: true }));
    }
  );

  server.get(
    '/pim/description-templates',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const rows = await withTenantContext(session.shopId, async (client) => {
        const res = await client.query<{
          id: string;
          shop_id: string | null;
          name: string;
          locale: string;
          min_chars: number;
          max_chars: number;
          required_sections: string[] | null;
          tone: string | null;
          prompt_template: string;
          is_active: boolean;
        }>(
          `SELECT id, shop_id, name, locale, min_chars, max_chars, required_sections, tone, prompt_template, is_active
         FROM pim_description_templates
         WHERE shop_id = $1 OR shop_id IS NULL
         ORDER BY (shop_id IS NULL) ASC, updated_at DESC`,
          [session.shopId]
        );
        return res.rows;
      });
      return reply.send(successEnvelope(request.id, { templates: rows }));
    }
  );

  server.post(
    '/pim/description-templates',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as {
        name?: unknown;
        locale?: unknown;
        minChars?: unknown;
        maxChars?: unknown;
        requiredSections?: unknown;
        tone?: unknown;
        promptTemplate?: unknown;
        isActive?: unknown;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const locale = typeof body.locale === 'string' ? body.locale.trim() : 'ro';
      const promptTemplate =
        typeof body.promptTemplate === 'string' ? body.promptTemplate.trim() : '';
      const minChars = Math.max(50, Math.min(5000, Number(body.minChars ?? 200)));
      const maxChars = Math.max(minChars, Math.min(10000, Number(body.maxChars ?? 2000)));
      const requiredSections = Array.isArray(body.requiredSections)
        ? body.requiredSections.map((v) => String(v)).filter((v) => v.trim().length > 0)
        : ['introducere', 'caracteristici', 'utilizare'];
      const tone = typeof body.tone === 'string' ? body.tone.trim() : 'professional';
      const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
      if (!name || !promptTemplate) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid payload'));
      }

      await withTenantContext(session.shopId, async (client) => {
        await client.query(
          `INSERT INTO pim_description_templates
           (shop_id, name, locale, min_chars, max_chars, required_sections, tone, prompt_template, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, now())`,
          [
            session.shopId,
            name,
            locale,
            minChars,
            maxChars,
            requiredSections,
            tone,
            promptTemplate,
            isActive,
          ]
        );
      });
      return reply.send(successEnvelope(request.id, { saved: true }));
    }
  );

  server.get(
    '/pim/taxonomy-metafield-schema',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const taxonomyId = (request.query as { taxonomyId?: string }).taxonomyId ?? null;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!taxonomyId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing taxonomyId'));
      }

      const rows = await withTenantContext(session.shopId, async (client) => {
        const res = await client.query<{
          id: string;
          taxonomy_id: string;
          attr_code: string;
          shopify_namespace: string;
          shopify_key: string;
          shopify_type: string;
          is_required: boolean;
          display_name: string | null;
        }>(
          `SELECT id, taxonomy_id, attr_code, shopify_namespace, shopify_key, shopify_type, is_required, display_name
         FROM pim_taxonomy_metafield_schema
         WHERE taxonomy_id = $1
         ORDER BY attr_code ASC`,
          [taxonomyId]
        );
        return res.rows;
      });
      return reply.send(successEnvelope(request.id, { schema: rows }));
    }
  );

  server.post(
    '/pim/taxonomy-metafield-schema',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as {
        taxonomyId?: unknown;
        attrCode?: unknown;
        shopifyNamespace?: unknown;
        shopifyKey?: unknown;
        shopifyType?: unknown;
        isRequired?: unknown;
        displayName?: unknown;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const taxonomyId = typeof body.taxonomyId === 'string' ? body.taxonomyId.trim() : '';
      const attrCode = typeof body.attrCode === 'string' ? body.attrCode.trim() : '';
      const shopifyNamespace =
        typeof body.shopifyNamespace === 'string' ? body.shopifyNamespace.trim() : '';
      const shopifyKey = typeof body.shopifyKey === 'string' ? body.shopifyKey.trim() : '';
      const shopifyType = typeof body.shopifyType === 'string' ? body.shopifyType.trim() : '';
      const isRequired = Boolean(body.isRequired ?? false);
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : null;
      if (!taxonomyId || !attrCode || !shopifyNamespace || !shopifyKey || !shopifyType) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid payload'));
      }

      await withTenantContext(session.shopId, async (client) => {
        await client.query(
          `INSERT INTO pim_taxonomy_metafield_schema
           (taxonomy_id, attr_code, shopify_namespace, shopify_key, shopify_type, is_required, display_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (taxonomy_id, attr_code) DO UPDATE SET
           shopify_namespace = EXCLUDED.shopify_namespace,
           shopify_key = EXCLUDED.shopify_key,
           shopify_type = EXCLUDED.shopify_type,
           is_required = EXCLUDED.is_required,
           display_name = EXCLUDED.display_name`,
          [taxonomyId, attrCode, shopifyNamespace, shopifyKey, shopifyType, isRequired, displayName]
        );
      });
      return reply.send(successEnvelope(request.id, { saved: true }));
    }
  );

  server.delete(
    '/pim/taxonomy-metafield-schema/:id',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const id = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!id) {
        return reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      }
      await withTenantContext(session.shopId, async (client) => {
        await client.query(`DELETE FROM pim_taxonomy_metafield_schema WHERE id = $1`, [id]);
      });
      return reply.send(successEnvelope(request.id, { deleted: true }));
    }
  );

  server.get(
    '/pim/categories/stats',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const row = await withTenantContext(session.shopId, async (client) => {
        const res = await client.query<{
          total: string;
          pending: string;
          approved: string;
          rejected: string;
          manual: string;
          high_confidence: string;
        }>(
          `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE taxonomy_ai_status = 'pending')::text AS pending,
           COUNT(*) FILTER (WHERE taxonomy_ai_status = 'approved')::text AS approved,
           COUNT(*) FILTER (WHERE taxonomy_ai_status = 'rejected')::text AS rejected,
           COUNT(*) FILTER (WHERE taxonomy_ai_status = 'manual')::text AS manual,
           COUNT(*) FILTER (WHERE taxonomy_ai_confidence >= 0.85)::text AS high_confidence
         FROM prod_master`
        );
        return res.rows[0] ?? null;
      });
      return reply.send(
        successEnvelope(request.id, {
          total: Number(row?.total ?? 0),
          pending: Number(row?.pending ?? 0),
          approved: Number(row?.approved ?? 0),
          rejected: Number(row?.rejected ?? 0),
          manual: Number(row?.manual ?? 0),
          highConfidence: Number(row?.high_confidence ?? 0),
        })
      );
    }
  );

  server.get(
    '/pim/categories/assignments',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const q = request.query as {
        status?: string;
        minConfidence?: string;
        limit?: string;
        offset?: string;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const status = typeof q.status === 'string' && q.status.trim() ? q.status.trim() : null;
      const minConfidence = Math.max(0, Math.min(1, Number(q.minConfidence ?? 0)));
      const limit = Math.max(1, Math.min(500, Number(q.limit ?? 50)));
      const offset = Math.max(0, Number(q.offset ?? 0));

      const rows = await withTenantContext(session.shopId, async (client) => {
        const res = await client.query<{
          product_id: string;
          canonical_title: string;
          taxonomy_id: string | null;
          taxonomy_name: string | null;
          taxonomy_ai_confidence: string | null;
          taxonomy_ai_status: string | null;
          taxonomy_ai_method: string | null;
        }>(
          `SELECT pm.id AS product_id,
                pm.canonical_title,
                pm.taxonomy_id,
                pt.name AS taxonomy_name,
                pm.taxonomy_ai_confidence::text,
                pm.taxonomy_ai_status,
                pm.taxonomy_ai_method
         FROM prod_master pm
         LEFT JOIN prod_taxonomy pt ON pt.id = pm.taxonomy_id
         WHERE ($1::text IS NULL OR pm.taxonomy_ai_status = $1)
           AND COALESCE(pm.taxonomy_ai_confidence, 0) >= $2
         ORDER BY pm.updated_at DESC
         LIMIT $3 OFFSET $4`,
          [status, minConfidence, limit, offset]
        );
        return res.rows;
      });
      return reply.send(successEnvelope(request.id, { assignments: rows }));
    }
  );

  server.post(
    '/pim/categories/assignments/:id/approve',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const productId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!productId)
        return reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      await withTenantContext(session.shopId, async (client) => {
        await client.query(
          `UPDATE prod_master SET taxonomy_ai_status = 'approved', updated_at = now() WHERE id = $1`,
          [productId]
        );
      });
      return reply.send(successEnvelope(request.id, { approved: true }));
    }
  );

  server.post(
    '/pim/categories/assignments/:id/reject',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const productId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!productId)
        return reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id'));
      await withTenantContext(session.shopId, async (client) => {
        await client.query(
          `UPDATE prod_master
         SET taxonomy_ai_status = 'rejected', taxonomy_id = NULL, updated_at = now()
         WHERE id = $1`,
          [productId]
        );
      });
      return reply.send(successEnvelope(request.id, { rejected: true }));
    }
  );

  server.post(
    '/pim/categories/assignments/:id/reassign',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const productId = (request.params as { id?: string }).id;
      const taxonomyId = (request.body as { taxonomyId?: string } | null)?.taxonomyId ?? null;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!productId || !taxonomyId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing id/taxonomyId'));
      }
      await withTenantContext(session.shopId, async (client) => {
        await client.query(
          `UPDATE prod_master
         SET taxonomy_id = $2, taxonomy_ai_status = 'manual', taxonomy_ai_method = 'manual', updated_at = now()
         WHERE id = $1`,
          [productId, taxonomyId]
        );
      });
      return reply.send(successEnvelope(request.id, { reassigned: true }));
    }
  );

  server.post(
    '/pim/categories/assignments/bulk-approve-high-confidence',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const thresholdRaw = (request.body as { threshold?: number } | null)?.threshold;
      const threshold = Math.max(0, Math.min(1, Number(thresholdRaw ?? 0.85)));
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const count = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query(
          `WITH updated AS (
           UPDATE prod_master
           SET taxonomy_ai_status = 'approved', updated_at = now()
           WHERE taxonomy_ai_status = 'pending'
             AND COALESCE(taxonomy_ai_confidence, 0) >= $1
           RETURNING id
         )
         SELECT COUNT(*)::int AS count FROM updated`,
          [threshold]
        );
        return Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0);
      });
      return reply.send(successEnvelope(request.id, { updated: count }));
    }
  );

  server.post(
    '/pim/description-generator/run/:productId',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const productId = (request.params as { productId?: string }).productId;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!productId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing productId'));
      }
      const jobId = await enqueueDescriptionGeneratorJob({
        shopId: session.shopId,
        productId,
        trigger: 'manual',
      });
      return reply.status(202).send(successEnvelope(request.id, { queued: true, jobId }));
    }
  );

  server.post(
    '/pim/metafield-push/run/:productId',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const productId = (request.params as { productId?: string }).productId;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!productId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing productId'));
      }
      const jobId = await enqueueMetafieldPushJob({
        shopId: session.shopId,
        productId,
        trigger: 'manual',
      });
      return reply.status(202).send(successEnvelope(request.id, { queued: true, jobId }));
    }
  );

  server.get(
    '/pim/metafield-push/logs/:productId',
    { preHandler: [requireAdminSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const productId = (request.params as { productId?: string }).productId;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!productId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing productId'));
      }
      const rows = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          pushed_at: string;
          metafields_count: number | null;
          status: string;
          error_message: string | null;
        }>(
          `SELECT id, pushed_at::text, metafields_count, status, error_message
         FROM pim_metafield_push_log
         WHERE shop_id = $1
           AND product_id = $2
         ORDER BY pushed_at DESC
         LIMIT 20`,
          [session.shopId, productId]
        );
        return result.rows;
      });
      return reply.send(successEnvelope(request.id, { logs: rows }));
    }
  );

  return Promise.resolve();
};
