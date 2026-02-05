import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import { withTenantContext } from '@app/database';
import type { SessionConfig } from '../auth/session.js';
import { getSessionFromRequest, requireSession } from '../auth/session.js';
import { SimilarityMatchService } from '@app/pim';
import {
  enqueueAIAuditJob,
  enqueueExtractionJob,
  enqueueSimilaritySearchJob,
} from '../queue/similarity-queues.js';
import { enqueueConsensusJob } from '../queue/consensus-queue.js';

type SimilarityMatchesPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

interface CreateMatchBody {
  productId: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourceGtin?: string;
  sourceBrand?: string;
  sourceProductId?: string;
  sourcePrice?: string | number;
  sourceCurrency?: string;
  sourceData?: Record<string, unknown>;
  similarityScore: number;
  matchMethod: string;
}

interface MatchQuery {
  status?: string;
  limit?: string;
  includeCount?: string;
  offset?: string;
  productId?: string;
  matchMethod?: string;
  triageDecision?: string;
  similarityMin?: string;
  similarityMax?: string;
  requiresHumanReview?: string;
  hasAIAudit?: string;
  search?: string;
  sourceType?: string;
  createdFrom?: string;
  createdTo?: string;
}

interface ConfidenceBody {
  confidence?: string;
  rejectionReason?: string;
}

interface IdParams {
  id?: string;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function parseCreateMatchBody(value: unknown): CreateMatchBody | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const productId = getString(body['productId']);
  const sourceUrl = getString(body['sourceUrl']);
  const matchMethod = getString(body['matchMethod']);
  const similarityScore =
    typeof body['similarityScore'] === 'number' ? body['similarityScore'] : Number.NaN;
  if (!productId || !sourceUrl || !matchMethod || !Number.isFinite(similarityScore)) return null;

  const result: CreateMatchBody = {
    productId,
    sourceUrl,
    matchMethod,
    similarityScore,
  };

  const sourceTitle = getString(body['sourceTitle']);
  if (sourceTitle) result.sourceTitle = sourceTitle;
  const sourceGtin = getString(body['sourceGtin']);
  if (sourceGtin) result.sourceGtin = sourceGtin;
  const sourceBrand = getString(body['sourceBrand']);
  if (sourceBrand) result.sourceBrand = sourceBrand;
  const sourceProductId = getString(body['sourceProductId']);
  if (sourceProductId) result.sourceProductId = sourceProductId;
  const sourcePrice =
    typeof body['sourcePrice'] === 'number' || typeof body['sourcePrice'] === 'string'
      ? body['sourcePrice']
      : undefined;
  if (sourcePrice !== undefined) result.sourcePrice = sourcePrice;
  const sourceCurrency = getString(body['sourceCurrency']);
  if (sourceCurrency) result.sourceCurrency = sourceCurrency;
  const sourceData = body['sourceData'];
  if (sourceData && typeof sourceData === 'object') {
    result.sourceData = sourceData as Record<string, unknown>;
  }

  return result;
}

function parseMatchQuery(value: unknown): MatchQuery {
  if (!value || typeof value !== 'object') return {};
  const query = value as Record<string, unknown>;
  const result: MatchQuery = {};
  const status = getString(query['status']);
  if (status) result.status = status;
  const limit = getString(query['limit']);
  if (limit) result.limit = limit;
  const offset = getString(query['offset']);
  if (offset) result.offset = offset;
  const includeCount = getString(query['includeCount']);
  if (includeCount) result.includeCount = includeCount;
  const productId = getString(query['productId']);
  if (productId) result.productId = productId;
  const matchMethod = getString(query['matchMethod']);
  if (matchMethod) result.matchMethod = matchMethod;
  const triageDecision = getString(query['triageDecision']);
  if (triageDecision) result.triageDecision = triageDecision;
  const similarityMin = getString(query['similarityMin']);
  if (similarityMin) result.similarityMin = similarityMin;
  const similarityMax = getString(query['similarityMax']);
  if (similarityMax) result.similarityMax = similarityMax;
  const sourceType = getString(query['sourceType']);
  if (sourceType) result.sourceType = sourceType;
  const createdFrom = getString(query['createdFrom']);
  if (createdFrom) result.createdFrom = createdFrom;
  const createdTo = getString(query['createdTo']);
  if (createdTo) result.createdTo = createdTo;
  const requiresHumanReview = getString(query['requiresHumanReview']);
  if (requiresHumanReview) result.requiresHumanReview = requiresHumanReview;
  const hasAIAudit = getString(query['hasAIAudit']);
  if (hasAIAudit) result.hasAIAudit = hasAIAudit;
  const search = getString(query['search']);
  if (search) result.search = search;
  return result;
}

function parseConfidenceBody(value: unknown): ConfidenceBody {
  if (!value || typeof value !== 'object') return {};
  const body = value as Record<string, unknown>;
  const result: ConfidenceBody = {};
  const confidence = getString(body['confidence']);
  if (confidence) result.confidence = confidence;
  const rejectionReason = getString(body['rejectionReason']);
  if (rejectionReason) result.rejectionReason = rejectionReason;
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
  } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
    status,
  } as const;
}

async function resolvePimProductId(
  shopId: string,
  shopifyProductId: string
): Promise<string | null> {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<{ product_id: string }>(
      `SELECT pcm.product_id
         FROM prod_channel_mappings pcm
         JOIN shopify_products sp
           ON sp.shopify_gid = pcm.external_id
          AND sp.shop_id = $1
        WHERE pcm.channel = 'shopify'
          AND pcm.shop_id = $1
          AND sp.id = $2`,
      [shopId, shopifyProductId]
    );
    return result.rows[0]?.product_id ?? null;
  });
}

export const similarityMatchesRoutes: FastifyPluginCallback<SimilarityMatchesPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { sessionConfig } = options;
  const requireAdminSession = { preHandler: requireSession(sessionConfig) } as const;

  server.post('/similarity-matches', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const body = parseCreateMatchBody(request.body);
    if (!body) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing required fields'));
    }

    const pimProductId = await resolvePimProductId(session.shopId, body.productId);
    if (!pimProductId) {
      return reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Product not found'));
    }

    const service = new SimilarityMatchService();
    const created = await service.createMatchWithTriage({
      productId: pimProductId,
      sourceUrl: body.sourceUrl,
      sourceTitle: body.sourceTitle ?? null,
      sourceGtin: body.sourceGtin ?? null,
      sourceBrand: body.sourceBrand ?? null,
      sourceProductId: body.sourceProductId ?? null,
      sourcePrice: body.sourcePrice ? Number(body.sourcePrice) : null,
      sourceCurrency: body.sourceCurrency ?? null,
      sourceData: body.sourceData ?? null,
      similarityScore: body.similarityScore,
      matchMethod: body.matchMethod,
    });

    if (created.success && created.aiAuditScheduled && created.matchId) {
      await enqueueAIAuditJob({ shopId: session.shopId, matchId: created.matchId });
    }

    return reply.status(200).send(successEnvelope(request.id, created));
  });

  server.get('/similarity-matches', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const query = parseMatchQuery(request.query);
    const limit = Math.min(Math.max(Number(query.limit ?? 100), 1), 250);
    const offset = Math.max(Number(query.offset ?? 0), 0);
    const status = query.status?.trim();
    const includeCount = query.includeCount === 'true' || query.includeCount === '1';
    const productId = query.productId?.trim();
    const matchMethod = query.matchMethod?.trim();
    const triageDecision = query.triageDecision?.trim();
    const similarityMin = Number(query.similarityMin ?? NaN);
    const similarityMax = Number(query.similarityMax ?? NaN);
    const sourceType = query.sourceType?.trim();
    const createdFrom = query.createdFrom?.trim();
    const createdTo = query.createdTo?.trim();
    const requiresHumanReview =
      query.requiresHumanReview === 'true' || query.requiresHumanReview === '1';
    const hasAIAudit = query.hasAIAudit === 'true' || query.hasAIAudit === '1';
    const search = query.search?.trim();

    const matches = await withTenantContext(session.shopId, async (client) => {
      const params: (string | number)[] = [session.shopId];
      const where: string[] = [];
      if (status) {
        params.push(status);
        where.push(`m.match_confidence = $${params.length}`);
      }
      if (productId) {
        params.push(productId);
        where.push(`m.product_id = $${params.length}`);
      }
      if (matchMethod) {
        params.push(matchMethod);
        where.push(`m.match_method = $${params.length}`);
      }
      if (triageDecision) {
        params.push(triageDecision);
        where.push(`(m.match_details ->> 'triage_decision') = $${params.length}`);
      }
      if (Number.isFinite(similarityMin)) {
        params.push(similarityMin);
        where.push(`m.similarity_score >= $${params.length}`);
      }
      if (Number.isFinite(similarityMax)) {
        params.push(similarityMax);
        where.push(`m.similarity_score <= $${params.length}`);
      }
      if (sourceType) {
        params.push(sourceType);
        where.push(`(m.source_data ->> 'source') = $${params.length}`);
      }
      if (createdFrom) {
        params.push(createdFrom);
        where.push(`m.created_at >= $${params.length}`);
      }
      if (createdTo) {
        params.push(createdTo);
        where.push(`m.created_at <= $${params.length}`);
      }
      if (query.requiresHumanReview) {
        params.push(String(requiresHumanReview));
        where.push(`(m.match_details ->> 'requires_human_review') = $${params.length}`);
      }
      if (query.hasAIAudit) {
        where.push(
          hasAIAudit
            ? `m.match_details ? 'ai_audit_result'`
            : `NOT (m.match_details ? 'ai_audit_result')`
        );
      }
      if (search) {
        params.push(`%${search}%`);
        where.push(
          `(sp.title ILIKE $${params.length} OR m.source_title ILIKE $${params.length} OR m.source_url ILIKE $${params.length})`
        );
      }
      const whereClause = where.length ? `AND ${where.join(' AND ')}` : '';

      const result = await client.query<{
        id: string;
        product_id: string;
        source_url: string;
        source_title: string | null;
        source_brand: string | null;
        source_gtin: string | null;
        source_price: string | null;
        source_currency: string | null;
        source_data: Record<string, unknown> | null;
        similarity_score: string;
        match_method: string;
        match_confidence: string;
        is_primary_source: boolean | null;
        match_details: Record<string, unknown> | null;
        specs_extracted: Record<string, unknown> | null;
        extraction_session_id: string | null;
        scraped_at: string | null;
        created_at: string;
        product_title: string;
        product_image: string | null;
      }>(
        `SELECT m.id,
                m.product_id,
                m.source_url,
                m.source_title,
                m.source_brand,
                m.source_gtin,
                m.source_price,
                m.source_currency,
                m.source_data,
                m.similarity_score,
                m.match_method,
                m.match_confidence,
                m.is_primary_source,
                m.match_details,
               m.specs_extracted,
               m.extraction_session_id,
               m.scraped_at,
                m.created_at,
                sp.title as product_title,
                sp.featured_image_url as product_image
           FROM prod_similarity_matches m
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = m.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products sp
             ON sp.shopify_gid = pcm.external_id
            AND sp.shop_id = $1
          WHERE 1=1 ${whereClause}
          ORDER BY m.created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}`,
        params
      );
      return result.rows;
    });

    let totalCount: number | undefined;
    if (includeCount) {
      totalCount = await withTenantContext(session.shopId, async (client) => {
        const params: (string | number)[] = [session.shopId];
        const where: string[] = [];
        if (status) {
          params.push(status);
          where.push(`m.match_confidence = $${params.length}`);
        }
        if (productId) {
          params.push(productId);
          where.push(`m.product_id = $${params.length}`);
        }
        if (matchMethod) {
          params.push(matchMethod);
          where.push(`m.match_method = $${params.length}`);
        }
        if (triageDecision) {
          params.push(triageDecision);
          where.push(`(m.match_details ->> 'triage_decision') = $${params.length}`);
        }
        if (Number.isFinite(similarityMin)) {
          params.push(similarityMin);
          where.push(`m.similarity_score >= $${params.length}`);
        }
        if (Number.isFinite(similarityMax)) {
          params.push(similarityMax);
          where.push(`m.similarity_score <= $${params.length}`);
        }
        if (sourceType) {
          params.push(sourceType);
          where.push(`(m.source_data ->> 'source') = $${params.length}`);
        }
        if (createdFrom) {
          params.push(createdFrom);
          where.push(`m.created_at >= $${params.length}`);
        }
        if (createdTo) {
          params.push(createdTo);
          where.push(`m.created_at <= $${params.length}`);
        }
        if (query.requiresHumanReview) {
          params.push(String(requiresHumanReview));
          where.push(`(m.match_details ->> 'requires_human_review') = $${params.length}`);
        }
        if (query.hasAIAudit) {
          where.push(
            hasAIAudit
              ? `m.match_details ? 'ai_audit_result'`
              : `NOT (m.match_details ? 'ai_audit_result')`
          );
        }
        if (search) {
          params.push(`%${search}%`);
          where.push(
            `(sp.title ILIKE $${params.length} OR m.source_title ILIKE $${params.length} OR m.source_url ILIKE $${params.length})`
          );
        }
        const whereClause = where.length ? `AND ${where.join(' AND ')}` : '';
        const result = await client.query<{ count: string }>(
          `SELECT COUNT(*) as count
             FROM prod_similarity_matches m
             JOIN prod_channel_mappings pcm
               ON pcm.product_id = m.product_id
              AND pcm.channel = 'shopify'
              AND pcm.shop_id = $1
             JOIN shopify_products sp
               ON sp.shopify_gid = pcm.external_id
              AND sp.shop_id = $1
            WHERE 1=1 ${whereClause}`,
          params
        );
        return Number(result.rows[0]?.count ?? 0);
      });
    }

    return reply.status(200).send(successEnvelope(request.id, { matches, totalCount }));
  });

  server.get('/similarity-matches/:id', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const matchId = (request.params as IdParams).id;
    if (!matchId) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing match id'));
    }

    const match = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT m.*
           FROM prod_similarity_matches m
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = m.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products sp
             ON sp.shopify_gid = pcm.external_id
            AND sp.shop_id = $1
          WHERE m.id = $2`,
        [session.shopId, matchId]
      );
      return result.rows[0] ?? null;
    });

    if (!match) {
      return reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Match not found'));
    }

    return reply.status(200).send(successEnvelope(request.id, { match }));
  });

  server.delete('/similarity-matches/:id', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const matchId = (request.params as IdParams).id;
    if (!matchId) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing match id'));
    }

    await withTenantContext(session.shopId, async (client) => {
      await client.query(
        `DELETE FROM prod_similarity_matches
          WHERE id = $1
            AND product_id IN (
              SELECT pcm.product_id
              FROM prod_channel_mappings pcm
              JOIN shopify_products sp
                ON sp.shopify_gid = pcm.external_id
               AND sp.shop_id = $2
             WHERE pcm.shop_id = $2
               AND pcm.channel = 'shopify'
            )`,
        [matchId, session.shopId]
      );
    });

    return reply.status(200).send(successEnvelope(request.id, { deleted: true }));
  });

  server.patch(
    '/similarity-matches/:id/confidence',
    requireAdminSession,
    async (request, reply) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      }

      const matchId = (request.params as IdParams).id;
      const body = parseConfidenceBody(request.body);
      if (!matchId || !body.confidence) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing match id or confidence'));
      }

      const allowed = new Set(['pending', 'confirmed', 'rejected', 'uncertain']);
      if (!allowed.has(body.confidence)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid confidence value'));
      }

      const service = new SimilarityMatchService();
      const current = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ match_confidence: string }>(
          `SELECT m.match_confidence
           FROM prod_similarity_matches m
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = m.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products sp
             ON sp.shopify_gid = pcm.external_id
            AND sp.shop_id = $1
          WHERE m.id = $2`,
          [session.shopId, matchId]
        );
        return result.rows[0] ?? null;
      });

      if (!current) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Match not found'));
      }

      if (!service.validateConfidenceTransition(current.match_confidence, body.confidence)) {
        return reply
          .status(409)
          .send(errorEnvelope(request.id, 409, 'INVALID_STATE', 'Invalid confidence transition'));
      }

      const productId = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ product_id: string }>(
          `UPDATE prod_similarity_matches
            SET match_confidence = $1,
                rejection_reason = $2,
                verified_at = now(),
                updated_at = now()
          WHERE id = $3
            AND product_id IN (
              SELECT pcm.product_id
              FROM prod_channel_mappings pcm
              JOIN shopify_products sp
                ON sp.shopify_gid = pcm.external_id
               AND sp.shop_id = $4
             WHERE pcm.shop_id = $4
               AND pcm.channel = 'shopify'
            )
          RETURNING product_id`,
          [body.confidence, body.rejectionReason ?? null, matchId, session.shopId]
        );
        return result.rows[0]?.product_id ?? null;
      });

      if (body.confidence === 'confirmed' && productId) {
        await enqueueConsensusJob({
          shopId: session.shopId,
          productId,
          trigger: 'match_confirmed',
        });
      }

      return reply.status(200).send(successEnvelope(request.id, { updated: true }));
    }
  );

  server.patch('/similarity-matches/:id/primary', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const matchId = (request.params as IdParams).id;
    if (!matchId) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing match id'));
    }

    try {
      await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ product_id: string; match_confidence: string }>(
          `SELECT product_id, match_confidence
             FROM prod_similarity_matches
            WHERE id = $1`,
          [matchId]
        );
        const row = result.rows[0];
        if (!row) {
          throw new Error('match_not_found');
        }
        if (row.match_confidence !== 'confirmed') {
          throw new Error('match_not_confirmed');
        }

        await client.query(
          `UPDATE prod_similarity_matches
              SET is_primary_source = false,
              updated_at = now()
            WHERE product_id = $1`,
          [row.product_id]
        );

        await client.query(
          `UPDATE prod_similarity_matches
              SET is_primary_source = true,
                  updated_at = now()
            WHERE id = $1
              AND product_id IN (
                SELECT pcm.product_id
                FROM prod_channel_mappings pcm
                JOIN shopify_products sp
                  ON sp.shopify_gid = pcm.external_id
                 AND sp.shop_id = $2
               WHERE pcm.shop_id = $2
                 AND pcm.channel = 'shopify'
              )`,
          [matchId, session.shopId]
        );
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'match_not_found') {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Match not found'));
      }
      if (error instanceof Error && error.message === 'match_not_confirmed') {
        return reply
          .status(409)
          .send(errorEnvelope(request.id, 409, 'INVALID_STATE', 'Match must be confirmed first'));
      }
      throw error;
    }

    return reply.status(200).send(successEnvelope(request.id, { updated: true }));
  });

  server.post('/products/:id/search-external', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const productId = (request.params as IdParams).id;
    if (!productId) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing product id'));
    }

    const product = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        product_id: string;
        title: string;
        brand: string | null;
        gtin: string | null;
        mpn: string | null;
      }>(
        `SELECT pcm.product_id,
                sp.title,
                pm.brand,
                pm.gtin,
                pm.mpn
           FROM prod_channel_mappings pcm
           JOIN shopify_products sp
             ON sp.shopify_gid = pcm.external_id
            AND sp.shop_id = $1
           JOIN prod_master pm
             ON pm.id = pcm.product_id
          WHERE pcm.channel = 'shopify'
            AND pcm.shop_id = $1
            AND sp.id = $2`,
        [session.shopId, productId]
      );
      return result.rows[0] ?? null;
    });

    if (!product) {
      return reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Product not found'));
    }

    const jobId = await enqueueSimilaritySearchJob({
      shopId: session.shopId,
      productId,
    });

    return reply.status(202).send(successEnvelope(request.id, { queued: true, jobId }));
  });

  server.post('/similarity-matches/:id/extract', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const matchId = (request.params as IdParams).id;
    if (!matchId) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing match id'));
    }

    const matchExists = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT m.id
           FROM prod_similarity_matches m
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = m.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products sp
             ON sp.shopify_gid = pcm.external_id
            AND sp.shop_id = $1
          WHERE m.id = $2`,
        [session.shopId, matchId]
      );
      return Boolean(result.rows[0]?.id);
    });

    if (!matchExists) {
      return reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Match not found'));
    }

    const jobId = await enqueueExtractionJob({ shopId: session.shopId, matchId });
    return reply.status(202).send(successEnvelope(request.id, { queued: true, jobId }));
  });
};
