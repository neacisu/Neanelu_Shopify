import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import { withTenantContext } from '@app/database';
import type { QualityLevel } from '@app/types';
import {
  computeConsensus,
  computeMissingRequirements,
  evaluatePromotion,
  getRecentEvents,
  logQualityEvent,
  parseExtractedSpecs,
  PROMOTION_THRESHOLDS,
} from '@app/pim';
import { enqueueConsensusBatchJob, enqueueConsensusJob } from '../queue/consensus-queue.js';
import { enqueueQualityWebhookJob } from '../queue/quality-webhook-queue.js';
import type { SessionConfig } from '../auth/session.js';
import { getSessionFromRequest, requireSession } from '../auth/session.js';

type ConsensusRoutesOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type DbClient = Readonly<{
  query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
}>;

type ConsensuResult = Readonly<{
  consensusSpecs: Record<string, unknown>;
  provenance: Record<string, ConsensusProvenance>;
  qualityScore: number;
  qualityBreakdown: {
    completeness?: number;
    accuracy?: number;
    consistency?: number;
    sourceWeight?: number;
  };
  sourceCount: number;
  conflicts: ConsensusConflict[];
  needsReview: boolean;
  skippedDueToManualCorrection: string[];
}>;

type ConsensusConflict = Readonly<{
  attributeName: string;
  weightDifference: number;
  requiresHumanReview: boolean;
  reason: string;
  autoResolveDisabled: boolean;
  values: Readonly<{
    value: unknown;
    sourceName: string;
    trustScore: number;
    similarityScore: number;
  }>[];
}>;

type ConsensusProvenance = Readonly<{
  attributeName: string;
  sourceName: string;
  resolvedAt: string;
}>;

type DetailSourceRow = Readonly<{
  match_id: string;
  source_id: string | null;
  source_name: string | null;
  source_url: string;
  similarity_score: number;
  trust_score: number;
  match_confidence: string;
  specs_extracted: Record<string, unknown> | null;
  created_at: string;
}>;

type AttributeVote = Readonly<{
  value: unknown;
  attributeName: string;
  sourceId: string;
  sourceName: string;
  trustScore: number;
  similarityScore: number;
  matchId: string;
  extractedAt: Date;
  confidence?: number;
}>;

async function buildConsensusDetails(params: { client: DbClient; productId: string }) {
  const consensus = await computeConsensusSafe({
    client: params.client,
    productId: params.productId,
  });

  const sourcesResult = await params.client.query<DetailSourceRow>(
    `SELECT
       psm.id as match_id,
       psm.source_id as source_id,
       ps.name as source_name,
       psm.source_url as source_url,
       psm.similarity_score::numeric as similarity_score,
       COALESCE(ps.trust_score, 0.5)::numeric as trust_score,
       psm.match_confidence as match_confidence,
       psm.specs_extracted as specs_extracted,
       psm.created_at as created_at
     FROM prod_similarity_matches psm
     LEFT JOIN prod_sources ps ON ps.id = psm.source_id
    WHERE psm.product_id = $1
      AND psm.match_confidence = 'confirmed'
      AND psm.specs_extracted IS NOT NULL
    ORDER BY psm.similarity_score DESC`,
    [params.productId]
  );

  const votesByAttribute = new Map<string, AttributeVote[]>();
  for (const row of sourcesResult.rows) {
    const parsed = parseExtractedSpecs(row.specs_extracted);
    for (const [attributeName, spec] of parsed.entries()) {
      const list = votesByAttribute.get(attributeName) ?? [];
      list.push({
        value: spec.value,
        attributeName,
        sourceId: row.source_id ?? 'unknown',
        sourceName: row.source_name ?? 'unknown',
        trustScore: Number(row.trust_score),
        similarityScore: Number(row.similarity_score),
        matchId: row.match_id,
        extractedAt: new Date(row.created_at),
      });
      votesByAttribute.set(attributeName, list);
    }
  }

  const results = Object.entries(consensus.consensusSpecs).map(([attribute, value]) => {
    const votes = votesByAttribute.get(attribute) ?? [];
    const confidenceVotes = votes.filter(
      (vote) => typeof vote.confidence === 'number'
    ) as (AttributeVote & { confidence: number })[];
    const confidence =
      confidenceVotes.length > 0
        ? confidenceVotes.reduce((sum, vote) => sum + vote.confidence, 0) / confidenceVotes.length
        : 0;
    const valueLabel = typeof value === 'string' ? value : JSON.stringify(value ?? null);

    return {
      attribute,
      value: valueLabel,
      sourcesCount: votes.length,
      confidence,
    };
  });

  const conflicts = consensus.conflicts.map((conflict) => ({
    attributeName: conflict.attributeName,
    weightDifference: conflict.weightDifference,
    requiresHumanReview: conflict.requiresHumanReview,
    reason: conflict.reason,
    autoResolveDisabled: conflict.autoResolveDisabled,
    values: conflict.values.map((vote) => ({
      value: vote.value,
      sourceName: vote.sourceName,
      trustScore: vote.trustScore,
      similarityScore: vote.similarityScore,
    })),
  }));

  const provenance = Object.values(consensus.provenance).map((entry) => ({
    attributeName: entry.attributeName,
    sourceName: entry.sourceName,
    resolvedAt: entry.resolvedAt,
  }));

  const sources = sourcesResult.rows.map((row) => ({
    sourceName: row.source_name ?? row.source_url,
    trustScore: Number(row.trust_score),
    similarityScore: Number(row.similarity_score),
    status: row.match_confidence,
  }));

  const votes = Object.fromEntries(
    Array.from(votesByAttribute.entries()).map(([attributeName, votesForAttr]) => [
      attributeName,
      votesForAttr.map((vote) => ({
        value: vote.value,
        attributeName: vote.attributeName,
        sourceName: vote.sourceName,
        trustScore: vote.trustScore,
        similarityScore: vote.similarityScore,
        matchId: vote.matchId,
      })),
    ])
  );

  return {
    productId: params.productId,
    qualityScore: consensus.qualityScore,
    qualityBreakdown: consensus.qualityBreakdown,
    conflictsCount: consensus.conflicts.length,
    sources,
    results,
    conflicts,
    provenance,
    votesByAttribute: votes,
  };
}

const computeConsensusSafe = computeConsensus as unknown as (params: {
  client: DbClient;
  productId: string;
}) => Promise<ConsensuResult>;

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: { code, message, status },
    meta: { request_id: requestId, timestamp: new Date().toISOString() },
  };
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: { request_id: requestId, timestamp: new Date().toISOString() },
  } as const;
}

export const consensusRoutes: FastifyPluginCallback<ConsensusRoutesOptions> = (
  fastify: FastifyInstance,
  opts
) => {
  const { sessionConfig } = opts;
  const requireAdminSession = { preHandler: requireSession(sessionConfig) } as const;

  fastify.get('/products/:id/consensus', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }
    const productId = String((request.params as { id: string }).id);
    const result = await withTenantContext(session.shopId, (client) =>
      computeConsensusSafe({ client, productId })
    );
    return reply.send(successEnvelope(request.id, result));
  });

  fastify.post('/products/:id/consensus', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }
    const productId = String((request.params as { id: string }).id);
    const jobId = await enqueueConsensusJob({
      shopId: session.shopId,
      productId,
      trigger: 'manual',
    });
    return reply.send(successEnvelope(request.id, { jobId }));
  });

  fastify.post('/products/:id/quality-level', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const productId = String((request.params as { id: string }).id);
    const body = (request.body ?? {}) as { level?: string; reason?: string };
    const allowedLevels: QualityLevel[] = ['bronze', 'silver', 'golden', 'review_needed'];

    if (!body.level || !allowedLevels.includes(body.level as QualityLevel)) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'invalid_quality_level'));
    }

    const result = await withTenantContext(session.shopId, async (client) => {
      const currentResult = await client.query<{
        data_quality_level: QualityLevel;
        quality_score: number | null;
      }>(
        `SELECT data_quality_level, quality_score
           FROM prod_master
          WHERE id = $1`,
        [productId]
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) {
        return null;
      }

      const currentLevel = currentRow.data_quality_level;
      const newLevel = body.level as QualityLevel;
      const levelOrder: Record<QualityLevel, number> = {
        review_needed: 0,
        bronze: 1,
        silver: 2,
        golden: 3,
      };

      if (newLevel === currentLevel) {
        return {
          changed: false,
          previousLevel: currentLevel,
          newLevel,
        };
      }

      await client.query(
        `UPDATE prod_master
           SET data_quality_level = $2,
               promoted_to_silver_at = CASE
                 WHEN $2 IN ('silver', 'golden') THEN COALESCE(promoted_to_silver_at, now())
                 ELSE NULL
               END,
               promoted_to_golden_at = CASE
                 WHEN $2 = 'golden' THEN COALESCE(promoted_to_golden_at, now())
                 ELSE NULL
               END,
               last_quality_check = now(),
               updated_at = now()
         WHERE id = $1`,
        [productId, newLevel]
      );

      const eventType =
        levelOrder[newLevel] >= levelOrder[currentLevel] ? 'quality_promoted' : 'quality_demoted';

      const eventId = await logQualityEvent({
        client,
        productId,
        eventType,
        previousLevel: currentLevel,
        newLevel,
        qualityScoreBefore: currentRow.quality_score,
        qualityScoreAfter: currentRow.quality_score ?? 0,
        triggerReason: body.reason ?? 'manual_override',
      });
      void enqueueQualityWebhookJob({ eventId, shopId: session.shopId }).catch(() => undefined);

      return {
        changed: true,
        previousLevel: currentLevel,
        newLevel,
      };
    });

    if (!result) {
      return reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'product_not_found'));
    }

    return reply.send(successEnvelope(request.id, result));
  });

  fastify.get('/products/:id/quality-level', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const productId = String((request.params as { id: string }).id);

    const result = await withTenantContext(session.shopId, async (client) => {
      const productResult = await client.query<{
        data_quality_level: QualityLevel;
        quality_score: number | null;
        quality_score_breakdown: Record<string, unknown> | null;
        needs_review: boolean;
        promoted_to_silver_at: string | null;
        promoted_to_golden_at: string | null;
      }>(
        `SELECT data_quality_level,
                quality_score,
                quality_score_breakdown,
                needs_review,
                promoted_to_silver_at,
                promoted_to_golden_at
           FROM prod_master
          WHERE id = $1`,
        [productId]
      );
      const product = productResult.rows[0];
      if (!product) {
        return null;
      }

      const sourceCountResult = await client.query<{ source_count: number }>(
        `SELECT COUNT(*)::int as source_count
           FROM prod_similarity_matches
          WHERE product_id = $1
            AND match_confidence = 'confirmed'
            AND specs_extracted IS NOT NULL`,
        [productId]
      );
      const sourceCount = sourceCountResult.rows[0]?.source_count ?? 0;

      const specsResult = await client.query<{ specs: Record<string, unknown> | null }>(
        `SELECT specs
           FROM prod_specs_normalized
          WHERE product_id = $1
            AND is_current = true
          LIMIT 1`,
        [productId]
      );
      const consensusSpecs = specsResult.rows[0]?.specs ?? {};
      const specsCount = Object.keys(consensusSpecs ?? {}).length;

      const promotion = evaluatePromotion({
        currentLevel: product.data_quality_level,
        qualityScore: product.quality_score ?? 0,
        sourceCount,
        consensusSpecs,
      });

      const missingRequirements = computeMissingRequirements({
        currentLevel: product.data_quality_level,
        qualityScore: product.quality_score ?? 0,
        sourceCount,
        consensusSpecs,
      });

      const nextLevel: QualityLevel | null =
        product.data_quality_level === 'bronze'
          ? 'silver'
          : product.data_quality_level === 'silver'
            ? 'golden'
            : null;
      const nextThreshold =
        nextLevel === 'silver'
          ? PROMOTION_THRESHOLDS.bronze_to_silver.minQualityScore
          : nextLevel === 'golden'
            ? PROMOTION_THRESHOLDS.silver_to_golden.minQualityScore
            : null;

      const recentEvents = await getRecentEvents(productId, 5, client);

      return {
        currentLevel: product.data_quality_level,
        qualityScore: product.quality_score,
        qualityScoreBreakdown: product.quality_score_breakdown,
        sourceCount,
        specsCount,
        eligibleForPromotion: promotion.eligible,
        nextLevel,
        nextThreshold,
        thresholds: {
          silver: PROMOTION_THRESHOLDS.bronze_to_silver.minQualityScore,
          golden: PROMOTION_THRESHOLDS.silver_to_golden.minQualityScore,
        },
        missingRequirements,
        promotedToSilverAt: product.promoted_to_silver_at,
        promotedToGoldenAt: product.promoted_to_golden_at,
        needsReview: product.needs_review,
        recentEvents,
      };
    });

    if (!result) {
      return reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'product_not_found'));
    }

    return reply.send(successEnvelope(request.id, result));
  });

  fastify.get('/products/:id/consensus/details', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const productId = String((request.params as { id: string }).id);

    const details = await withTenantContext(session.shopId, async (client) => {
      return await buildConsensusDetails({ client, productId });
    });

    return reply.send(successEnvelope(request.id, details));
  });

  fastify.get('/products/:id/consensus/export', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const productId = String((request.params as { id: string }).id);
    const format = String((request.query as { format?: string }).format ?? 'json').toLowerCase();

    const details = await withTenantContext(session.shopId, async (client) => {
      return await buildConsensusDetails({ client, productId });
    });

    if (format === 'csv') {
      const rows = details.results.map((row) => ({
        attribute: row.attribute,
        value: row.value,
        sourcesCount: row.sourcesCount,
        confidence: row.confidence,
      }));
      const header = 'attribute,value,sourcesCount,confidence';
      const body = rows
        .map(
          (row) =>
            `${row.attribute.replaceAll(',', ' ')},${String(row.value).replaceAll(',', ' ')},${
              row.sourcesCount
            },${row.confidence}`
        )
        .join('\n');
      reply.header('Content-Type', 'text/csv');
      return reply.send(`${header}\n${body}`);
    }

    return reply.send(successEnvelope(request.id, details));
  });

  fastify.get('/products/:id/conflicts', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }
    const productId = String((request.params as { id: string }).id);
    const result = await withTenantContext(session.shopId, (client) =>
      computeConsensusSafe({ client, productId })
    );
    return reply.send(successEnvelope(request.id, { conflicts: result.conflicts }));
  });

  fastify.post(
    '/products/:id/conflicts/:field/resolve',
    requireAdminSession,
    async (request, reply) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      }
      const productId = String((request.params as { id: string }).id);
      const field = String((request.params as { field: string }).field);
      const body = (request.body ?? {}) as { value?: unknown };
      if (typeof body.value === 'undefined') {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'missing_value'));
      }

      try {
        await withTenantContext(session.shopId, async (client) => {
          const consensus = await computeConsensusSafe({ client, productId });
          const targetConflict = consensus.conflicts.find(
            (conflict) => conflict.attributeName === field
          );
          if (!targetConflict) {
            throw new Error(`no_conflict_for_field:${field}`);
          }
          const conflictValues = new Set(
            targetConflict.values.map((vote) => JSON.stringify(vote.value ?? null))
          );
          if (!conflictValues.has(JSON.stringify(body.value ?? null))) {
            throw new Error(`invalid_conflict_value:${field}`);
          }

          const current = await client.query<{
            specs: Record<string, unknown>;
            provenance: unknown;
          }>(
            `SELECT specs, provenance
             FROM prod_specs_normalized
            WHERE product_id = $1
              AND is_current = true
            LIMIT 1`,
            [productId]
          );
          const currentSpecs = current.rows[0]?.specs ?? {};
          const currentProvenance =
            current.rows[0]?.provenance && typeof current.rows[0]?.provenance === 'object'
              ? (current.rows[0]?.provenance as Record<string, Record<string, unknown>>)
              : {};
          const nextSpecs = { ...currentSpecs, [field]: body.value };
          const existingProvenance = currentProvenance[field] ?? {};
          const nextProvenance = {
            ...currentProvenance,
            [field]: {
              ...(typeof existingProvenance === 'object' && existingProvenance !== null
                ? existingProvenance
                : {}),
              manuallyEdited: true,
              resolvedAt: new Date().toISOString(),
            },
          };

          const versionRes = await client.query<{ id: string; version: number }>(
            `SELECT id, version
           FROM prod_specs_normalized
          WHERE product_id = $1
            AND is_current = true
          LIMIT 1`,
            [productId]
          );
          const currentId = versionRes.rows[0]?.id ?? null;
          const currentVersion = Number(versionRes.rows[0]?.version ?? 0);
          const nextVersion = currentVersion > 0 ? currentVersion + 1 : 1;

          if (currentId) {
            await client.query(
              `UPDATE prod_specs_normalized
              SET is_current = false, updated_at = now()
            WHERE id = $1`,
              [currentId]
            );
          }

          await client.query(
            `INSERT INTO prod_specs_normalized (
             product_id,
             specs,
             raw_specs,
             provenance,
             version,
             is_current,
             needs_review,
             review_reason,
             created_at,
             updated_at
           )
           VALUES ($1, $2::jsonb, NULL, $3::jsonb, $4, true, false, $5, now(), now())`,
            [
              productId,
              JSON.stringify(nextSpecs),
              JSON.stringify(nextProvenance),
              nextVersion,
              'manual_resolution',
            ]
          );
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'conflict_resolution_failed';
        if (message.startsWith('no_conflict_for_field')) {
          return reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', message));
        }
        if (message.startsWith('invalid_conflict_value')) {
          return reply.status(400).send(errorEnvelope(request.id, 400, 'BAD_REQUEST', message));
        }
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_ERROR', 'resolve_failed'));
      }

      return reply.send(successEnvelope(request.id, { resolved: true }));
    }
  );

  fastify.post('/consensus/batch', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }
    const body = (request.body ?? {}) as { productIds?: string[] };
    if (!body.productIds?.length) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'missing_product_ids'));
    }
    const jobId = await enqueueConsensusBatchJob({
      shopId: session.shopId,
      productIds: body.productIds,
    });
    return reply.send(successEnvelope(request.id, { jobId }));
  });

  fastify.get('/pim/stats/consensus', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }
    const stats = await withTenantContext(session.shopId, async (client) => {
      const [consensusCount, conflictCount, avgQuality, pendingCount, avgSources, resolvedToday] =
        await Promise.all([
          client.query<{ count: string }>(
            `SELECT COUNT(DISTINCT product_id) as count
             FROM prod_specs_normalized
            WHERE is_current = true`
          ),
          client.query<{ count: string }>(
            `SELECT COUNT(*) as count
             FROM prod_specs_normalized
            WHERE is_current = true
              AND needs_review = true`
          ),
          client.query<{ avg: string | null }>(
            `SELECT AVG(quality_score) as avg
             FROM prod_master
            WHERE quality_score IS NOT NULL`
          ),
          client.query<{ count: string }>(
            `SELECT COUNT(DISTINCT psm.product_id) as count
             FROM prod_similarity_matches psm
             LEFT JOIN prod_specs_normalized psn
               ON psn.product_id = psm.product_id AND psn.is_current = true
            WHERE psm.match_confidence = 'confirmed'
              AND psm.specs_extracted IS NOT NULL
              AND psn.id IS NULL`
          ),
          client.query<{ avg: string | null }>(
            `SELECT AVG(source_count)::text as avg
             FROM (
               SELECT COUNT(*) as source_count
                 FROM prod_similarity_matches
                WHERE match_confidence = 'confirmed'
                GROUP BY product_id
             ) as counts`
          ),
          client.query<{ count: string }>(
            `SELECT COUNT(*) as count
             FROM prod_specs_normalized
            WHERE is_current = true
              AND needs_review = false
              AND created_at::date = CURRENT_DATE`
          ),
        ]);

      return {
        productsWithConsensus: Number(consensusCount.rows[0]?.count ?? 0),
        pendingConsensus: Number(pendingCount.rows[0]?.count ?? 0),
        productsWithConflicts: Number(conflictCount.rows[0]?.count ?? 0),
        resolvedToday: Number(resolvedToday.rows[0]?.count ?? 0),
        avgSourcesPerProduct: Number(avgSources.rows[0]?.avg ?? 0),
        avgQualityScore: Number(avgQuality.rows[0]?.avg ?? 0),
      };
    });
    return reply.send(successEnvelope(request.id, stats));
  });

  fastify.get('/pim/consensus/products', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }

    const query = request.query as { status?: string | null; page?: string; limit?: string };
    const status = String(query.status ?? 'all').toLowerCase();
    const page = Number(query.page ?? '1');
    const limit = Math.min(Math.max(Number(query.limit ?? '50'), 1), 200);
    const offset = (Number.isFinite(page) && page > 0 ? page - 1 : 0) * limit;

    const items = await withTenantContext(session.shopId, async (client) => {
      const rows = await client.query<{
        product_id: string;
        title: string | null;
        source_count: string;
        quality_score: number | null;
        conflicts_count: string | null;
        last_computed_at: string | null;
        consensus_status: string;
        total_count: string;
      }>(
        `WITH source_counts AS (
           SELECT product_id, COUNT(*)::text as source_count
             FROM prod_similarity_matches
            WHERE match_confidence = 'confirmed'
              AND specs_extracted IS NOT NULL
            GROUP BY product_id
         ),
         current_specs AS (
           SELECT product_id, needs_review, provenance, updated_at
             FROM prod_specs_normalized
            WHERE is_current = true
         ),
         conflicts AS (
           SELECT cs.product_id,
                  COALESCE(
                    (
                      SELECT COUNT(*)
                        FROM jsonb_each(COALESCE(cs.provenance, '{}'::jsonb)) AS entries
                       WHERE (entries.value->>'conflictDetected')::boolean = true
                    ),
                    0
                  )::text as conflicts_count
             FROM current_specs cs
         ),
         base AS (
           SELECT
             pm.id as product_id,
             pm.canonical_title as title,
             COALESCE(sc.source_count, '0') as source_count,
             pm.quality_score as quality_score,
             COALESCE(cf.conflicts_count, '0') as conflicts_count,
             cs.updated_at as last_computed_at,
             CASE
               WHEN cs.product_id IS NULL AND COALESCE(sc.source_count, '0') <> '0' THEN 'pending'
               WHEN cs.product_id IS NULL THEN 'pending'
               WHEN cs.needs_review = true THEN 'conflicts'
               WHEN pm.needs_review = true THEN 'manual_review'
               ELSE 'computed'
             END as consensus_status
           FROM prod_master pm
           LEFT JOIN source_counts sc ON sc.product_id = pm.id
           LEFT JOIN current_specs cs ON cs.product_id = pm.id
           LEFT JOIN conflicts cf ON cf.product_id = pm.id
           WHERE sc.product_id IS NOT NULL OR cs.product_id IS NOT NULL
         )
        SELECT *, COUNT(*) OVER()::text as total_count
          FROM base
         WHERE ($1 = 'all' OR consensus_status = $1)
         ORDER BY last_computed_at DESC NULLS LAST, source_count::int DESC, title ASC
         LIMIT $2 OFFSET $3`,
        [status, limit, offset]
      );

      const mapped = rows.rows.map((row) => ({
        productId: row.product_id,
        title: row.title ?? 'Untitled product',
        sourceCount: Number(row.source_count ?? 0),
        consensusStatus: row.consensus_status as
          | 'pending'
          | 'computed'
          | 'conflicts'
          | 'manual_review',
        qualityScore: row.quality_score,
        conflictsCount: Number(row.conflicts_count ?? 0),
        lastComputedAt: row.last_computed_at,
      }));
      const total = rows.rows[0]?.total_count ? Number(rows.rows[0].total_count) : 0;

      return {
        items: mapped,
        total,
        page,
        limit,
      };
    });

    return reply.send(successEnvelope(request.id, items));
  });

  fastify.get('/pim/consensus/stream', requireAdminSession, async (request, reply) => {
    const session = getSessionFromRequest(request, sessionConfig);
    if (!session) {
      return reply
        .status(401)
        .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();

    let lastSeen = new Date();
    const sendEvent = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('consensus.init', { timestamp: new Date().toISOString() });

    const interval = setInterval(() => {
      void withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          event_type: string;
          product_id: string;
          new_level: string;
          created_at: string;
        }>(
          `SELECT id, event_type, product_id, new_level, created_at
             FROM prod_quality_events
            WHERE created_at > $1
            ORDER BY created_at ASC
            LIMIT 50`,
          [lastSeen.toISOString()]
        );
        if (result.rows.length > 0) {
          lastSeen = new Date(result.rows[result.rows.length - 1]?.created_at ?? lastSeen);
          for (const row of result.rows) {
            sendEvent('consensus.event', row);
          }
        } else {
          sendEvent('consensus.heartbeat', { timestamp: new Date().toISOString() });
        }
      });
    }, 5000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });

    return reply;
  });
};
