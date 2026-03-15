import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { logAuditEvent, withTenantContext } from '@app/database';
import type {
  LexBootstrapDto,
  LexClusterDetail,
  LexCursorPage,
  LexDomainProfileDto,
  LexGovernanceApprovalRequest,
  LexGovernanceRequestDetailDto,
  LexGovernanceApplyRequest,
  LexGovernanceEntityType,
  LexGlossaryEntryDto,
  LexAssignReviewRequest,
  LexLocalizationDetail,
  LexLocalizationDetailDto,
  LexLocalizationEvidenceDto,
  LexPublicationDetailDto,
  LexPublicationEventDto,
  LexMetricsDto,
  LexPublicationTargetDto,
  LexReviewDetailDto,
  LexReviewDecisionDto,
  LexReviewDecisionRequest,
  LexReviewItemDetail,
  LexRunSummary,
  LexShopSettingsDto,
  LexStopwordDto,
  LexTermDetail,
  LexTranslationRuleDto,
} from '@app/types';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';

import {
  requireLexModuleAccess,
  requireLexPublishAccess,
  requireLexReviewAccess,
  resolveLexBootstrap,
} from '../auth/require-lex-access.js';
import type { SessionConfig, SessionData } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { enqueueLexPublishJob, enqueueLexRunRequestedJob } from '../queue/lex-queues.js';
import { reconcileLexScheduledTasks } from '../processors/lex/scheduled-tasks.js';
import {
  approveLexGovernanceRequest,
  applyLexGovernanceRequest,
  createLexGovernanceRequest,
  getLexGovernanceRequest,
  listLexGovernanceRequests,
  rejectLexGovernanceRequest,
  submitLexGovernanceRequest,
} from '../services/lex-governance.js';
import {
  getLexPublicationRollbackStatus,
  rollbackLexPublicationTarget,
} from '../services/lex-localizations.js';
import { buildLexPublicationQueueLinks, collectLexMetrics } from '../services/lex-ops.js';
import { assignLexReviewItem, decideLexReviewItem } from '../services/lex-review-actions.js';

interface PimLexRoutesOptions {
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}

interface RequestWithSession {
  session?: SessionData;
  lexAccess?: LexBootstrapDto;
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

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  return toNumber(value, Number.NaN);
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function defaultLexSettings(shopId: string): LexShopSettingsDto {
  return {
    shopId,
    version: 0,
    enabled: false,
    sourceLang: 'ro',
    targetLangs: ['en'],
    extractScope: {},
    shardSize: 10_000,
    thresholds: {},
    retentionDaysFragments: 90,
    retentionDaysOccurrences: 90,
    retentionDaysContexts: 180,
    autoPublishProducts: false,
    autoPublishAttributes: false,
    autoPublishCollections: false,
  };
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parsePageLimit(value: unknown, fallback = 50, max = 100): number {
  const parsed = toNumber(value, fallback);
  return Math.max(1, Math.min(max, parsed));
}

function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function makeCursorPage<T>(items: T[], nextCursor: string | null): LexCursorPage<T> {
  return {
    items,
    nextCursor,
  };
}

function deriveSourceTables(sourceScope: Record<string, unknown>): string[] {
  const entityTypes = parseStringArray(sourceScope['entityTypes'], [
    'product',
    'variant',
    'collection',
  ]);
  const map = new Map<string, string>([
    ['product', 'shopify_products'],
    ['variant', 'shopify_variants'],
    ['collection', 'shopify_collections'],
    ['master_product', 'prod_master'],
  ]);

  const sourceTables = entityTypes
    .map((entityType) => map.get(entityType))
    .filter((tableName): tableName is string => typeof tableName === 'string');

  return sourceTables.length > 0 ? [...new Set(sourceTables)] : ['shopify_products'];
}

async function buildSourceSnapshotHash(params: {
  shopId: string;
  sourceTables: string[];
}): Promise<string> {
  const allowedTables = new Set([
    'shopify_products',
    'shopify_variants',
    'shopify_collections',
    'shopify_collection_products',
    'prod_master',
  ]);

  return await withTenantContext(params.shopId, async (client) => {
    const snapshots: Record<string, unknown>[] = [];

    for (const sourceTable of params.sourceTables) {
      if (!allowedTables.has(sourceTable)) continue;

      const result = await client.query<{ maxUpdatedAt: string | null; rowCount: string }>(
        `SELECT
           COALESCE(MAX(updated_at)::text, NULL) AS "maxUpdatedAt",
           COUNT(*)::text AS "rowCount"
         FROM ${sourceTable}
         WHERE shop_id = $1`,
        [params.shopId]
      );

      snapshots.push({
        sourceTable,
        maxUpdatedAt: result.rows[0]?.maxUpdatedAt ?? null,
        rowCount: toNumber(result.rows[0]?.rowCount ?? '0'),
      });
    }

    return sha256Json(snapshots);
  });
}

export const pimLexRoutes: FastifyPluginAsync<PimLexRoutesOptions> = (
  server: FastifyInstance,
  options
) => {
  const requireAuthenticatedSession = requireSession(options.sessionConfig);
  const requireLexSession = [requireAuthenticatedSession, requireLexModuleAccess()];
  const requireLexReviewSession = [requireAuthenticatedSession, requireLexReviewAccess()];
  const requireLexPublishSession = [requireAuthenticatedSession, requireLexPublishAccess()];

  server.get(
    '/pim/lex/bootstrap',
    { preHandler: [requireAuthenticatedSession] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const bootstrap = await resolveLexBootstrap(session);
      return reply.send(successEnvelope(request.id, { bootstrap }));
    }
  );

  server.get('/pim/lex/settings', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const settings = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        shopId: string;
        version: number;
        enabled: boolean;
        sourceLang: string;
        targetLangs: string[] | null;
        extractScope: Record<string, unknown> | null;
        shardSize: number;
        thresholds: Record<string, unknown> | null;
        retentionDaysFragments: number;
        retentionDaysOccurrences: number;
        retentionDaysContexts: number;
        autoPublishProducts: boolean;
        autoPublishAttributes: boolean;
        autoPublishCollections: boolean;
      }>(
        `SELECT
           shop_id AS "shopId",
           version,
           enabled,
           source_lang AS "sourceLang",
           target_langs AS "targetLangs",
           extract_scope AS "extractScope",
           shard_size AS "shardSize",
           thresholds,
           retention_days_fragments AS "retentionDaysFragments",
           retention_days_occurrences AS "retentionDaysOccurrences",
           retention_days_contexts AS "retentionDaysContexts",
           auto_publish_products AS "autoPublishProducts",
           auto_publish_attributes AS "autoPublishAttributes",
           auto_publish_collections AS "autoPublishCollections"
         FROM lex_shop_settings
         WHERE shop_id = $1
         LIMIT 1`,
        [session.shopId]
      );

      return result.rows[0] ?? null;
    });

    return reply.send(
      successEnvelope(request.id, { settings: settings ?? defaultLexSettings(session.shopId) })
    );
  });

  server.put('/pim/lex/settings', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const body = (request.body ?? {}) as Partial<LexShopSettingsDto>;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const merged = {
      ...defaultLexSettings(session.shopId),
      ...body,
      shopId: session.shopId,
      targetLangs: parseStringArray(body.targetLangs, ['en']),
      extractScope: toJsonObject(body.extractScope),
      thresholds: toJsonObject(body.thresholds),
      shardSize: Math.max(100, Math.min(100_000, toNumber(body.shardSize, 10_000))),
      retentionDaysFragments: Math.max(1, Math.min(365, toNumber(body.retentionDaysFragments, 90))),
      retentionDaysOccurrences: Math.max(
        1,
        Math.min(365, toNumber(body.retentionDaysOccurrences, 90))
      ),
      retentionDaysContexts: Math.max(1, Math.min(730, toNumber(body.retentionDaysContexts, 180))),
      enabled: Boolean(body.enabled),
      autoPublishProducts: Boolean(body.autoPublishProducts),
      autoPublishAttributes: Boolean(body.autoPublishAttributes),
      autoPublishCollections: Boolean(body.autoPublishCollections),
      sourceLang:
        typeof body.sourceLang === 'string' && body.sourceLang.trim()
          ? body.sourceLang.trim()
          : 'ro',
    };

    const expectedVersion = Math.max(0, toNumber(body.version, 0));

    const saved = await withTenantContext(session.shopId, async (client) => {
      const current = await client.query<{ version: number }>(
        `SELECT version
         FROM lex_shop_settings
         WHERE shop_id = $1
         LIMIT 1`,
        [session.shopId]
      );

      const currentVersion = current.rows[0]?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        return null;
      }

      if (currentVersion === 0) {
        const inserted = await client.query<{ version: number }>(
          `INSERT INTO lex_shop_settings
             (shop_id, version, enabled, source_lang, target_langs, extract_scope, shard_size, thresholds,
              retention_days_fragments, retention_days_occurrences, retention_days_contexts,
              auto_publish_products, auto_publish_attributes, auto_publish_collections, updated_at)
           VALUES
             ($1, 1, $2, $3, $4::text[], $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, now())
           RETURNING version`,
          [
            session.shopId,
            merged.enabled,
            merged.sourceLang,
            merged.targetLangs,
            JSON.stringify(merged.extractScope),
            merged.shardSize,
            JSON.stringify(merged.thresholds),
            merged.retentionDaysFragments,
            merged.retentionDaysOccurrences,
            merged.retentionDaysContexts,
            merged.autoPublishProducts,
            merged.autoPublishAttributes,
            merged.autoPublishCollections,
          ]
        );
        return { ...merged, version: inserted.rows[0]?.version ?? 1 };
      }

      const updated = await client.query<{ version: number }>(
        `UPDATE lex_shop_settings
         SET enabled = $2,
             source_lang = $3,
             target_langs = $4::text[],
             extract_scope = $5::jsonb,
             shard_size = $6,
             thresholds = $7::jsonb,
             retention_days_fragments = $8,
             retention_days_occurrences = $9,
             retention_days_contexts = $10,
             auto_publish_products = $11,
             auto_publish_attributes = $12,
             auto_publish_collections = $13,
             version = version + 1,
             updated_at = now()
         WHERE shop_id = $1
           AND version = $14
         RETURNING version`,
        [
          session.shopId,
          merged.enabled,
          merged.sourceLang,
          merged.targetLangs,
          JSON.stringify(merged.extractScope),
          merged.shardSize,
          JSON.stringify(merged.thresholds),
          merged.retentionDaysFragments,
          merged.retentionDaysOccurrences,
          merged.retentionDaysContexts,
          merged.autoPublishProducts,
          merged.autoPublishAttributes,
          merged.autoPublishCollections,
          expectedVersion,
        ]
      );

      if (!updated.rows[0]) {
        return null;
      }

      return { ...merged, version: updated.rows[0].version };
    });

    if (!saved) {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            request.id,
            409,
            'VERSION_CONFLICT',
            'Lexical settings changed since you loaded them'
          )
        );
    }

    await logAuditEvent('lex_settings_updated', {
      actorType: 'user',
      actorId: session.staffUserId ?? null,
      shopId: session.shopId,
      resourceType: 'lex_shop_settings',
      resourceId: session.shopId,
      details: {
        previousVersion: expectedVersion,
        nextVersion: saved.version,
      },
    });

    await reconcileLexScheduledTasks({
      shopId: session.shopId,
      enabled: saved.enabled,
    }).catch(() => undefined);

    return reply.send(successEnvelope(request.id, { settings: saved }));
  });

  server.get('/pim/lex/runs', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { limit?: string; cursor?: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const limit = parsePageLimit(query.limit, 50, 100);
    const cursor = decodeCursor(query.cursor);
    const cursorCreatedAt =
      typeof cursor?.['createdAt'] === 'string' ? String(cursor['createdAt']) : null;
    const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;

    const page = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        shopId: string;
        runType: LexRunSummary['runType'];
        status: LexRunSummary['status'];
        currentPhase: string | null;
        startedAt: string | null;
        completedAt: string | null;
        fragmentsCount: string | number | null;
        occurrencesCount: string | number | null;
        termsCount: string | number | null;
        contextsCount: string | number | null;
        senseClustersCount: string | number | null;
        translationsCount: string | number | null;
        aiBatchesCount: number | null;
        errorMessage: string | null;
        metadata: Record<string, unknown> | null;
        createdAt: string;
      }>(
        `SELECT
           id,
           shop_id AS "shopId",
           run_type AS "runType",
           status,
           current_phase AS "currentPhase",
           started_at::text AS "startedAt",
           completed_at::text AS "completedAt",
           fragments_count AS "fragmentsCount",
           occurrences_count AS "occurrencesCount",
           terms_count AS "termsCount",
           contexts_count AS "contextsCount",
           sense_clusters_count AS "senseClustersCount",
           translations_count AS "translationsCount",
           ai_batches_count AS "aiBatchesCount",
           error_message AS "errorMessage",
           metadata,
           created_at::text AS "createdAt"
         FROM lex_runs
         WHERE shop_id = $1
           AND (
             $2::timestamptz IS NULL
             OR created_at < $2::timestamptz
             OR (created_at = $2::timestamptz AND id < $3::uuid)
           )
         ORDER BY created_at DESC
         LIMIT $4`,
        [session.shopId, cursorCreatedAt, cursorId, limit + 1]
      );

      const pageRows = result.rows.slice(0, limit);
      const items = pageRows.map(
        (row): LexRunSummary => ({
          id: row.id,
          shopId: row.shopId,
          runType: row.runType,
          status: row.status,
          currentPhase: row.currentPhase,
          startedAt: row.startedAt,
          completedAt: row.completedAt,
          fragmentsCount: toNumber(row.fragmentsCount),
          occurrencesCount: toNumber(row.occurrencesCount),
          termsCount: toNumber(row.termsCount),
          contextsCount: toNumber(row.contextsCount),
          senseClustersCount: toNumber(row.senseClustersCount),
          translationsCount: toNumber(row.translationsCount),
          aiBatchesCount: row.aiBatchesCount ?? 0,
          errorMessage: row.errorMessage,
          metadata: row.metadata ?? {},
        })
      );

      const last = pageRows.at(-1);

      return makeCursorPage(
        items,
        result.rows.length > limit && last
          ? encodeCursor({
              id: last.id,
              createdAt: last.createdAt,
            })
          : null
      );
    });

    return reply.send(successEnvelope(request.id, { runs: page.items, page }));
  });

  server.post('/pim/lex/runs', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const body = (request.body ?? {}) as {
      runType?: string;
      sourceScope?: unknown;
    };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const runType =
      body.runType === 'full_rebuild' ||
      body.runType === 'delta_rebuild' ||
      body.runType === 'context_rebuild' ||
      body.runType === 'translate_only' ||
      body.runType === 'publish_only'
        ? body.runType
        : 'delta_rebuild';
    const sourceScope = toJsonObject(body.sourceScope);
    const sourceTables = deriveSourceTables(sourceScope);
    const sourceSnapshotHash = await buildSourceSnapshotHash({
      shopId: session.shopId,
      sourceTables,
    });

    const run = await withTenantContext(session.shopId, async (client) => {
      const activeRun = await client.query<{ id: string }>(
        `SELECT id
         FROM lex_runs
         WHERE shop_id = $1
           AND status IN ('pending', 'running', 'paused')
         ORDER BY created_at DESC
         LIMIT 1`,
        [session.shopId]
      );
      if (activeRun.rows[0]?.id) {
        return { conflictRunId: activeRun.rows[0].id } as const;
      }

      const inserted = await client.query<{ id: string; createdAt: string }>(
        `INSERT INTO lex_runs
           (shop_id, run_type, source_scope, source_snapshot_hash, current_phase, status, metadata, created_by, created_at, updated_at)
         VALUES
           ($1, $2, $3::jsonb, $4, 'extract.fragments', 'pending', '{"requested_via":"api"}'::jsonb, $5, now(), now())
         RETURNING id, created_at::text AS "createdAt"`,
        [
          session.shopId,
          runType,
          JSON.stringify(sourceScope),
          sourceSnapshotHash,
          session.staffUserId ?? null,
        ]
      );
      const row = inserted.rows[0]!;

      for (const sourceTable of sourceTables) {
        await client.query(
          `INSERT INTO lex_run_shards
             (run_id, shop_id, shard_key, phase_name, source_table, status, metadata, created_at)
           VALUES
             ($1, $2, $3, 'extract.fragments', $4, 'pending', $5::jsonb, now())`,
          [
            row.id,
            session.shopId,
            `${sourceTable}:all`,
            sourceTable,
            JSON.stringify({
              sourceSnapshotHash,
              sourceTable,
            }),
          ]
        );
      }

      return { ...row, conflictRunId: null } as const;
    });

    if ('conflictRunId' in run && run.conflictRunId) {
      return reply
        .status(409)
        .send(
          errorEnvelope(
            request.id,
            409,
            'ACTIVE_RUN_EXISTS',
            `An active lexical run already exists for this shop: ${run.conflictRunId}`
          )
        );
    }

    if (!('id' in run)) {
      return reply
        .status(500)
        .send(errorEnvelope(request.id, 500, 'RUN_CREATE_FAILED', 'Failed to create lexical run'));
    }

    const queueJobId = await enqueueLexRunRequestedJob({
      shopId: session.shopId,
      runId: run.id,
      runType,
      triggeredBy: 'manual',
      requestedAt: Date.now(),
      sourceScope,
    });

    await logAuditEvent('lex_run_requested', {
      actorType: 'user',
      actorId: session.staffUserId ?? null,
      shopId: session.shopId,
      resourceType: 'lex_runs',
      resourceId: run.id,
      details: {
        runType,
        sourceSnapshotHash,
        queueJobId,
      },
    });

    return reply.status(202).send(
      successEnvelope(request.id, {
        runId: run.id,
        queueJobId,
        status: 'pending',
      })
    );
  });

  server.get('/pim/lex/runs/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const runDetail = await withTenantContext(session.shopId, async (client) => {
      const runRes = await client.query<
        LexRunSummary & { sourceScope: Record<string, unknown> | null }
      >(
        `SELECT
           id,
           shop_id AS "shopId",
           run_type AS "runType",
           source_scope AS "sourceScope",
           status,
           current_phase AS "currentPhase",
           started_at::text AS "startedAt",
           completed_at::text AS "completedAt",
           fragments_count AS "fragmentsCount",
           occurrences_count AS "occurrencesCount",
           terms_count AS "termsCount",
           contexts_count AS "contextsCount",
           sense_clusters_count AS "senseClustersCount",
           translations_count AS "translationsCount",
           ai_batches_count AS "aiBatchesCount",
           error_message AS "errorMessage",
           metadata
         FROM lex_runs
         WHERE shop_id = $1
           AND id = $2
         LIMIT 1`,
        [session.shopId, id]
      );

      const shardsRes = await client.query<{
        id: string;
        shardKey: string;
        sourceTable: string;
        status: string;
        workerName: string | null;
        startedAt: string | null;
        completedAt: string | null;
        recordsRead: string;
        recordsWritten: string;
        errorMessage: string | null;
      }>(
        `SELECT
           id,
           shard_key AS "shardKey",
           source_table AS "sourceTable",
           status,
           worker_name AS "workerName",
           started_at::text AS "startedAt",
           completed_at::text AS "completedAt",
           records_read AS "recordsRead",
           records_written AS "recordsWritten",
           error_message AS "errorMessage"
         FROM lex_run_shards
         WHERE shop_id = $1
           AND run_id = $2
         ORDER BY created_at ASC`,
        [session.shopId, id]
      );

      return {
        run: runRes.rows[0] ?? null,
        shards: shardsRes.rows.map((row) => ({
          ...row,
          recordsRead: toNumber(row.recordsRead),
          recordsWritten: toNumber(row.recordsWritten),
        })),
      };
    });

    if (!runDetail.run) {
      return reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Run not found'));
    }

    return reply.send(successEnvelope(request.id, runDetail));
  });

  server.get('/pim/lex/terms', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const {
      q,
      limit: rawLimit,
      cursor: rawCursor,
    } = (request.query ?? {}) as {
      q?: string;
      limit?: string;
      cursor?: string;
    };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const limit = parsePageLimit(rawLimit, 50, 100);
    const cursor = decodeCursor(rawCursor);
    const cursorUpdatedAt =
      typeof cursor?.['updatedAt'] === 'string' ? String(cursor['updatedAt']) : null;
    const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;

    const page = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        canonicalText: string;
        normalizedKey: string;
        displayTextRo: string | null;
        ngramSize: number;
        termType: string;
        domainCode: string | null;
        isTechnical: boolean;
        isProtected: boolean;
        status: string;
        occurrencesTotal: string | number | null;
        scoreGlobal: string | null;
        updatedAt: string;
      }>(
        `SELECT
           t.id,
           t.canonical_text AS "canonicalText",
           t.normalized_key AS "normalizedKey",
           t.display_text_ro AS "displayTextRo",
           t.ngram_size AS "ngramSize",
           t.term_type AS "termType",
           t.domain_code AS "domainCode",
           t.is_technical AS "isTechnical",
           t.is_protected AS "isProtected",
           t.status,
           s.occurrences_total AS "occurrencesTotal",
           s.score_global AS "scoreGlobal",
           t.updated_at::text AS "updatedAt"
         FROM lex_effective_terms t
         LEFT JOIN lex_term_stats s
           ON s.term_id = t.id
          AND s.shop_id = $1
         WHERE ($2::text IS NULL OR t.canonical_text ILIKE $2 OR t.normalized_key ILIKE $2)
           AND (
             $3::timestamptz IS NULL
             OR t.updated_at < $3::timestamptz
             OR (t.updated_at = $3::timestamptz AND t.id < $4::uuid)
           )
         ORDER BY t.updated_at DESC, t.id DESC
         LIMIT $5`,
        [session.shopId, q?.trim() ? `%${q.trim()}%` : null, cursorUpdatedAt, cursorId, limit + 1]
      );

      const pageRows = result.rows.slice(0, limit);
      const items = pageRows.map((row) => ({
        ...row,
        occurrencesTotal: toNumber(row.occurrencesTotal),
        scoreGlobal: toNumberOrNull(row.scoreGlobal),
      }));

      return makeCursorPage(
        items,
        result.rows.length > limit && pageRows.at(-1)
          ? encodeCursor({
              id: pageRows.at(-1)!.id,
              updatedAt: pageRows.at(-1)!.updatedAt,
            })
          : null
      );
    });

    return reply.send(successEnvelope(request.id, { terms: page.items, page }));
  });

  server.get('/pim/lex/terms/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const detail = await withTenantContext(session.shopId, async (client) => {
      const termRes = await client.query<{
        id: string;
        shopId: string | null;
        canonicalText: string;
        normalizedKey: string;
        displayTextRo: string | null;
        ngramSize: number;
        termType: string;
        domainCode: string | null;
        isTechnical: boolean;
        isProtected: boolean;
        status: string;
      }>(
        `SELECT
           id,
           shop_id AS "shopId",
           canonical_text AS "canonicalText",
           normalized_key AS "normalizedKey",
           display_text_ro AS "displayTextRo",
           ngram_size AS "ngramSize",
           term_type AS "termType",
           domain_code AS "domainCode",
           is_technical AS "isTechnical",
           is_protected AS "isProtected",
           status
         FROM lex_effective_terms
         WHERE id = $1
         LIMIT 1`,
        [id]
      );

      const variantsRes = await client.query<LexTermDetail['variants'][number]>(
        `SELECT
           id,
           variant_text AS "variantText",
           locale,
           variant_type AS "variantType",
           is_preferred AS "isPreferred",
           is_approved AS "isApproved"
         FROM lex_term_variants
         WHERE term_id = $1
           AND (shop_id = $2 OR shop_id IS NULL)
         ORDER BY is_preferred DESC, occurrence_count DESC, variant_text ASC`,
        [id, session.shopId]
      );

      const clustersRes = await client.query<
        LexClusterDetail & { confidenceScoreRaw: string | null }
      >(
        `SELECT
           id,
           term_id AS "termId",
           cluster_key AS "clusterKey",
           cluster_method AS "clusterMethod",
           domain_code AS "domainCode",
           taxonomy_id AS "taxonomyId",
           label_ro AS "labelRo",
           label_en AS "labelEn",
           description,
           confidence_score AS "confidenceScoreRaw",
           needs_review AS "needsReview",
           is_approved AS "isApproved"
         FROM lex_sense_clusters
         WHERE term_id = $1
           AND (shop_id = $2 OR shop_id IS NULL)
         ORDER BY is_approved DESC, created_at DESC`,
        [id, session.shopId]
      );

      const term = termRes.rows[0];
      if (!term) return null;

      return {
        ...term,
        variants: variantsRes.rows,
        clusters: clustersRes.rows.map((cluster) => ({
          ...cluster,
          confidenceScore: toNumberOrNull(cluster.confidenceScoreRaw),
        })),
      } satisfies LexTermDetail;
    });

    if (!detail) {
      return reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Term not found'));
    }

    return reply.send(successEnvelope(request.id, { term: detail }));
  });

  server.get('/pim/lex/clusters/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const detail = await withTenantContext(session.shopId, async (client) => {
      const clusterRes = await client.query<LexClusterDetail & { canonicalText: string }>(
        `SELECT
           c.id,
           c.term_id AS "termId",
           c.cluster_key AS "clusterKey",
           c.cluster_method AS "clusterMethod",
           c.domain_code AS "domainCode",
           c.taxonomy_id AS "taxonomyId",
           c.label_ro AS "labelRo",
           c.label_en AS "labelEn",
           c.description,
           c.confidence_score AS "confidenceScore",
           c.needs_review AS "needsReview",
           c.is_approved AS "isApproved",
           t.canonical_text AS "canonicalText"
         FROM lex_sense_clusters c
         JOIN lex_terms t ON t.id = c.term_id
         WHERE c.id = $1
           AND (c.shop_id = $2 OR c.shop_id IS NULL)
         LIMIT 1`,
        [id, session.shopId]
      );

      const membersRes = await client.query<{
        contextId: string;
        similarityScore: string | null;
        isRepresentative: boolean;
        representativeText: string;
        fieldKind: string;
        domainCode: string | null;
      }>(
        `SELECT
           m.context_id AS "contextId",
           m.similarity_score AS "similarityScore",
           m.is_representative AS "isRepresentative",
           c.representative_text AS "representativeText",
           c.field_kind AS "fieldKind",
           c.domain_code AS "domainCode"
         FROM lex_sense_cluster_members m
         JOIN lex_term_contexts c ON c.id = m.context_id
         WHERE m.cluster_id = $1
         ORDER BY m.is_representative DESC, m.similarity_score DESC NULLS LAST, c.updated_at DESC
         LIMIT 50`,
        [id]
      );

      return {
        cluster: clusterRes.rows[0] ?? null,
        members: membersRes.rows.map((row) => ({
          ...row,
          similarityScore: toNumberOrNull(row.similarityScore),
        })),
      };
    });

    if (!detail.cluster) {
      return reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Cluster not found'));
    }

    return reply.send(successEnvelope(request.id, detail));
  });

  server.get(
    '/pim/lex/localizations',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const query = (request.query ?? {}) as {
        entityType?: string;
        status?: string;
        targetLang?: string;
        limit?: string;
        cursor?: string;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const limit = parsePageLimit(query.limit, 50, 100);
      const cursor = decodeCursor(query.cursor);
      const cursorUpdatedAt =
        typeof cursor?.['updatedAt'] === 'string' ? String(cursor['updatedAt']) : null;
      const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;

      const page = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          entityType: LexLocalizationDetail['entityType'];
          entityId: string;
          sourceLang: string;
          targetLang: string;
          titleText: string | null;
          descriptionText: string | null;
          descriptionShort: string | null;
          seoTitle: string | null;
          seoDescription: string | null;
          keywords: string[] | null;
          version: number;
          qualityScore: string | null;
          publicationStatus: string;
          approvedAt: string | null;
          updatedAt: string;
        }>(
          `SELECT
           id,
           entity_type AS "entityType",
           entity_id AS "entityId",
           source_lang AS "sourceLang",
           target_lang AS "targetLang",
           title_text AS "titleText",
           description_text AS "descriptionText",
           description_short AS "descriptionShort",
           seo_title AS "seoTitle",
           seo_description AS "seoDescription",
           keywords,
           version,
           quality_score AS "qualityScore",
           publication_status AS "publicationStatus",
           approved_at::text AS "approvedAt",
           updated_at::text AS "updatedAt"
         FROM lex_entity_localizations
         WHERE shop_id = $1
           AND ($2::text IS NULL OR entity_type = $2)
           AND ($3::text IS NULL OR publication_status = $3)
           AND ($4::text IS NULL OR target_lang = $4)
           AND (
             $5::timestamptz IS NULL
             OR updated_at < $5::timestamptz
             OR (updated_at = $5::timestamptz AND id < $6::uuid)
           )
         ORDER BY updated_at DESC
         LIMIT $7`,
          [
            session.shopId,
            query.entityType ?? null,
            query.status ?? null,
            query.targetLang ?? null,
            cursorUpdatedAt,
            cursorId,
            limit + 1,
          ]
        );

        const pageRows = result.rows.slice(0, limit);
        const items = pageRows.map(
          (row): LexLocalizationDetail => ({
            ...row,
            keywords: row.keywords ?? [],
            qualityScore: toNumberOrNull(row.qualityScore),
          })
        );

        return makeCursorPage(
          items,
          result.rows.length > limit && pageRows.at(-1)
            ? encodeCursor({
                id: pageRows.at(-1)!.id,
                updatedAt: pageRows.at(-1)!.updatedAt,
              })
            : null
        );
      });

      return reply.send(successEnvelope(request.id, { localizations: page.items, page }));
    }
  );

  server.get(
    '/pim/lex/localizations/:id',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const detail = await withTenantContext(session.shopId, async (client) => {
        const localizationRes = await client.query<{
          id: string;
          entityType: LexLocalizationDetail['entityType'];
          entityId: string;
          sourceLang: string;
          targetLang: string;
          titleText: string | null;
          descriptionText: string | null;
          descriptionShort: string | null;
          seoTitle: string | null;
          seoDescription: string | null;
          keywords: string[] | null;
          version: number;
          qualityScore: string | null;
          publicationStatus: string;
          approvedAt: string | null;
        }>(
          `SELECT
           id,
           entity_type AS "entityType",
           entity_id AS "entityId",
           source_lang AS "sourceLang",
           target_lang AS "targetLang",
           title_text AS "titleText",
           description_text AS "descriptionText",
           description_short AS "descriptionShort",
           seo_title AS "seoTitle",
           seo_description AS "seoDescription",
           keywords,
           version,
           quality_score AS "qualityScore",
           publication_status AS "publicationStatus",
           approved_at::text AS "approvedAt"
         FROM lex_entity_localizations
         WHERE shop_id = $1
           AND id = $2
         LIMIT 1`,
          [session.shopId, id]
        );

        const localization = localizationRes.rows[0];
        if (!localization) return null;

        const evidenceRes = await client.query<{
          id: string;
          fragmentId: string;
          sortOrder: number;
          evidenceLabel: string | null;
          metadata: Record<string, unknown> | null;
        }>(
          `SELECT
           id,
           fragment_id AS "fragmentId",
           order_index AS "sortOrder",
           evidence_label AS "evidenceLabel",
           metadata
         FROM lex_entity_localization_evidence
         WHERE shop_id = $1
           AND localization_id = $2
         ORDER BY order_index ASC, created_at ASC`,
          [session.shopId, id]
        );

        const publicationsRes = await client.query<{
          id: string;
          targetType: string;
          targetRecordId: string | null;
          targetPath: string | null;
          status: string;
          attemptCount: number | null;
          errorMessage: string | null;
          updatedAt: string | null;
        }>(
          `SELECT
           id,
           target_type AS "targetType",
           target_record_id AS "targetRecordId",
           target_path AS "targetPath",
           status,
           attempt_count AS "attemptCount",
           error_message AS "errorMessage",
           updated_at::text AS "updatedAt"
         FROM lex_publication_targets
         WHERE shop_id = $1
           AND localization_id = $2
         ORDER BY updated_at DESC`,
          [session.shopId, id]
        );

        return {
          localization: {
            ...localization,
            keywords: localization.keywords ?? [],
            qualityScore: toNumberOrNull(localization.qualityScore),
            evidence: evidenceRes.rows.map(
              (row): LexLocalizationEvidenceDto => ({
                ...row,
                metadata: row.metadata ?? {},
              })
            ),
            publications: publicationsRes.rows.map(
              (row): LexPublicationTargetDto => ({
                ...row,
                attemptCount: row.attemptCount ?? 0,
              })
            ),
          } satisfies LexLocalizationDetailDto,
        };
      });

      if (!detail) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Localization not found'));
      }

      return reply.send(successEnvelope(request.id, detail));
    }
  );

  server.get('/pim/lex/review', { preHandler: requireLexReviewSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { status?: string; limit?: string; cursor?: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const limit = parsePageLimit(query.limit, 50, 100);
    const cursor = decodeCursor(query.cursor);
    const cursorPriority = toNumber(cursor?.['priority'], Number.NaN);
    const cursorCreatedAt =
      typeof cursor?.['createdAt'] === 'string' ? String(cursor['createdAt']) : null;
    const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;

    const page = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        entityType: LexReviewItemDetail['entityType'];
        entityId: string;
        reviewReason: string;
        severity: string;
        priority: number;
        version: number;
        status: string;
        notes: string | null;
        evidence: Record<string, unknown> | null;
        createdAt: string;
      }>(
        `SELECT
           id,
           entity_type AS "entityType",
           entity_id AS "entityId",
           review_reason AS "reviewReason",
           severity,
           priority,
           version,
           status,
           notes,
           evidence,
           created_at::text AS "createdAt"
         FROM lex_review_items
         WHERE shop_id = $1
           AND ($2::text IS NULL OR status = $2)
           AND (
             $3::int IS NULL
             OR priority < $3
             OR (priority = $3 AND created_at < $4::timestamptz)
             OR (priority = $3 AND created_at = $4::timestamptz AND id < $5::uuid)
           )
         ORDER BY priority DESC, created_at DESC
         LIMIT $6`,
        [
          session.shopId,
          query.status ?? null,
          Number.isFinite(cursorPriority) ? cursorPriority : null,
          cursorCreatedAt,
          cursorId,
          limit + 1,
        ]
      );

      const pageRows = result.rows.slice(0, limit);
      const items = pageRows.map(
        (row): LexReviewItemDetail => ({
          ...row,
          evidence: row.evidence ?? {},
        })
      );

      return makeCursorPage(
        items,
        result.rows.length > limit && pageRows.at(-1)
          ? encodeCursor({
              id: pageRows.at(-1)!.id,
              priority: pageRows.at(-1)!.priority,
              createdAt: pageRows.at(-1)!.createdAt,
            })
          : null
      );
    });

    return reply.send(successEnvelope(request.id, { items: page.items, page }));
  });

  server.get(
    '/pim/lex/review/:id',
    { preHandler: requireLexReviewSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const detail = await withTenantContext(session.shopId, async (client) => {
        const itemRes = await client.query<{
          id: string;
          entityType: LexReviewItemDetail['entityType'];
          entityId: string;
          reviewReason: string;
          severity: string;
          priority: number;
          version: number;
          status: string;
          notes: string | null;
          evidence: Record<string, unknown> | null;
          assignedTo: string | null;
          createdAt: string | null;
          updatedAt: string | null;
        }>(
          `SELECT
           id,
           entity_type AS "entityType",
           entity_id AS "entityId",
           review_reason AS "reviewReason",
           severity,
           priority,
           version,
           status,
           notes,
           evidence,
           assigned_to AS "assignedTo",
           created_at::text AS "createdAt",
           updated_at::text AS "updatedAt"
         FROM lex_review_items
         WHERE shop_id = $1
           AND id = $2
         LIMIT 1`,
          [session.shopId, id]
        );

        const item = itemRes.rows[0];
        if (!item) return null;

        const decisionsRes = await client.query<{
          id: string;
          decisionType: string;
          decisionNotes: string | null;
          decidedBy: string | null;
          createdAt: string | null;
          oldValue: Record<string, unknown> | null;
          newValue: Record<string, unknown> | null;
        }>(
          `SELECT
           id,
           decision_type AS "decisionType",
           decision_notes AS "decisionNotes",
           decided_by AS "decidedBy",
           created_at::text AS "createdAt",
           old_value AS "oldValue",
           new_value AS "newValue"
         FROM lex_decisions
         WHERE review_item_id = $1
         ORDER BY created_at DESC`,
          [id]
        );

        const relatedLocalizationsRes = await client.query<{
          id: string;
          entityType: LexLocalizationDetail['entityType'];
          entityId: string;
          targetLang: string;
          publicationStatus: string;
          qualityScore: string | null;
        }>(
          `SELECT
           id,
           entity_type AS "entityType",
           entity_id AS "entityId",
           target_lang AS "targetLang",
           publication_status AS "publicationStatus",
           quality_score AS "qualityScore"
         FROM lex_entity_localizations
         WHERE shop_id = $1
           AND entity_id = $2
         ORDER BY updated_at DESC
         LIMIT 20`,
          [session.shopId, item.entityId]
        );

        const relatedPublicationsRes = await client.query<{
          id: string;
          targetType: string;
          targetRecordId: string | null;
          targetPath: string | null;
          status: string;
          attemptCount: number | null;
          errorMessage: string | null;
          updatedAt: string | null;
        }>(
          `SELECT
           id,
           target_type AS "targetType",
           target_record_id AS "targetRecordId",
           target_path AS "targetPath",
           status,
           attempt_count AS "attemptCount",
           error_message AS "errorMessage",
           updated_at::text AS "updatedAt"
         FROM lex_publication_targets
         WHERE shop_id = $1
           AND (target_record_id = $2 OR localization_id IN (
             SELECT id
             FROM lex_entity_localizations
             WHERE shop_id = $1
               AND entity_id = $2
           ))
         ORDER BY updated_at DESC
         LIMIT 20`,
          [session.shopId, item.entityId]
        );

        const decisions: LexReviewDecisionDto[] = decisionsRes.rows.map((row) => ({
          ...row,
          oldValue: row.oldValue ?? {},
          newValue: row.newValue ?? {},
        }));

        const timeline = decisions.map((decision) => ({
          id: decision.id,
          kind: 'decision' as const,
          action: decision.decisionType,
          status: null,
          actorId: decision.decidedBy,
          createdAt: decision.createdAt,
          details: {
            decisionNotes: decision.decisionNotes,
            newValue: decision.newValue,
          },
        }));

        const relatedPublications: LexPublicationTargetDto[] = relatedPublicationsRes.rows.map(
          (row) => ({
            ...row,
            attemptCount: row.attemptCount ?? 0,
          })
        );

        return {
          review: {
            ...item,
            evidence: item.evidence ?? {},
            decisions,
            timeline,
            relatedLocalizations: relatedLocalizationsRes.rows.map((row) => ({
              ...row,
              qualityScore: toNumberOrNull(row.qualityScore),
            })),
            relatedPublications,
          } satisfies LexReviewDetailDto,
        };
      });

      if (!detail) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Review item not found'));
      }

      return reply.send(successEnvelope(request.id, detail));
    }
  );

  server.post(
    '/pim/lex/review/:id/assign',
    { preHandler: requireLexReviewSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexAssignReviewRequest>;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }

      try {
        const assigned = await assignLexReviewItem({
          shopId: session.shopId,
          reviewItemId: id,
          body: {
            expectedVersion,
            assignedTo:
              typeof body.assignedTo === 'string' && body.assignedTo.trim()
                ? body.assignedTo
                : null,
            notes: typeof body.notes === 'string' ? body.notes : null,
          },
          actorId: session.staffUserId ?? null,
        });

        if (!assigned) {
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Review item not found'));
        }

        await logAuditEvent('lex_review_assigned', {
          actorType: 'user',
          actorId: session.staffUserId ?? null,
          shopId: session.shopId,
          resourceType: 'lex_review_items',
          resourceId: id,
          details: {
            assignedTo: body.assignedTo ?? null,
            nextVersion: assigned.nextVersion,
          },
        });

        return reply.send(successEnvelope(request.id, assigned));
      } catch (error) {
        if (error instanceof Error && error.message === 'version_conflict') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'VERSION_CONFLICT',
                'Review item changed since you loaded it'
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/review/:id/decision',
    { preHandler: requireLexReviewSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexReviewDecisionRequest>;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      if (
        body.decisionType !== 'approve' &&
        body.decisionType !== 'reject' &&
        body.decisionType !== 'merge_terms' &&
        body.decisionType !== 'split_cluster' &&
        body.decisionType !== 'lock_translation' &&
        body.decisionType !== 'publish'
      ) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid decision'));
      }

      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }

      let decision: Awaited<ReturnType<typeof decideLexReviewItem>>;
      try {
        decision = await decideLexReviewItem({
          shopId: session.shopId,
          reviewItemId: id,
          body: {
            decisionType: body.decisionType,
            expectedVersion,
            notes: typeof body.notes === 'string' ? body.notes : null,
            newValue: toJsonObject(body.newValue),
          },
          actorId: session.staffUserId ?? null,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'version_conflict') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'VERSION_CONFLICT',
                'Review item changed since you loaded it'
              )
            );
        }
        if (error instanceof Error && error.message.includes('requires')) {
          return reply
            .status(400)
            .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', error.message));
        }
        throw error;
      }

      if (!decision) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Review item not found'));
      }

      await logAuditEvent('lex_review_decision', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_review_items',
        resourceId: id,
        details: {
          decisionType: body.decisionType,
          nextVersion: decision.nextVersion,
          queueJobId: 'queueJobId' in decision ? (decision.queueJobId ?? null) : null,
        },
      });

      return reply.send(successEnvelope(request.id, decision));
    }
  );

  server.get('/pim/lex/glossary', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { q?: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const glossary = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        shopId: string | null;
        domainCode: string | null;
        sourceLang: string;
        targetLang: string;
        sourceText: string;
        targetText: string;
        translationKind: string;
        priority: number;
        version: number;
        isLocked: boolean;
        isActive: boolean;
      }>(
        `SELECT
           id,
           shop_id AS "shopId",
           domain_code AS "domainCode",
           source_lang AS "sourceLang",
           target_lang AS "targetLang",
           source_text AS "sourceText",
           target_text AS "targetText",
           translation_kind AS "translationKind",
           priority,
           version,
           is_locked AS "isLocked",
           is_active AS "isActive"
         FROM lex_effective_glossary_entries
         WHERE ($1::text IS NULL OR source_text ILIKE $1 OR target_text ILIKE $1)
         ORDER BY is_locked DESC, priority ASC, updated_at DESC
         LIMIT 200`,
        [query.q?.trim() ? `%${query.q.trim()}%` : null]
      );

      return result.rows satisfies LexGlossaryEntryDto[];
    });

    return reply.send(successEnvelope(request.id, { glossary }));
  });

  server.post('/pim/lex/glossary', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const body = (request.body ?? {}) as Partial<LexGlossaryEntryDto>;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    if (
      typeof body.sourceText !== 'string' ||
      typeof body.targetText !== 'string' ||
      !body.sourceText.trim() ||
      !body.targetText.trim()
    ) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid glossary payload'));
    }

    const sourceLang =
      typeof body.sourceLang === 'string' && body.sourceLang.trim() ? body.sourceLang.trim() : 'ro';
    const targetLang =
      typeof body.targetLang === 'string' && body.targetLang.trim() ? body.targetLang.trim() : 'en';
    const translationKind =
      typeof body.translationKind === 'string' && body.translationKind.trim()
        ? body.translationKind.trim()
        : 'canonical';
    const sourceText = body.sourceText.trim();
    const targetText = body.targetText.trim();

    const inserted = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ id: string; version: number }>(
        `INSERT INTO lex_glossary_entries
           (shop_id, domain_code, source_lang, target_lang, source_text, normalized_source_text,
            target_text, translation_kind, priority, is_locked, is_active, source, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, lower($5), $6, $7, $8, $9, $10, 'manual', now(), now())
         RETURNING id, version`,
        [
          session.shopId,
          body.domainCode ?? null,
          sourceLang,
          targetLang,
          sourceText,
          targetText,
          translationKind,
          Math.max(1, Math.min(1000, toNumber(body.priority, 100))),
          body.isLocked === true,
          body.isActive !== false,
        ]
      );
      return result.rows[0] ?? null;
    });

    if (!inserted?.id) {
      return reply
        .status(500)
        .send(errorEnvelope(request.id, 500, 'CREATE_FAILED', 'Failed to create glossary entry'));
    }

    await logAuditEvent('lex_glossary_created', {
      actorType: 'user',
      actorId: session.staffUserId ?? null,
      shopId: session.shopId,
      resourceType: 'lex_glossary_entries',
      resourceId: inserted.id,
      details: {
        sourceText,
        targetText,
        version: inserted.version,
      },
    });

    return reply.status(201).send(successEnvelope(request.id, inserted));
  });

  server.patch(
    '/pim/lex/glossary/:id',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGlossaryEntryDto> & {
        expectedVersion?: number;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }

      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ id: string; version: number }>(
          `UPDATE lex_glossary_entries
         SET target_text = COALESCE($3, target_text),
             translation_kind = COALESCE($4, translation_kind),
             priority = COALESCE($5, priority),
             is_locked = COALESCE($6, is_locked),
             is_active = COALESCE($7, is_active),
             version = version + 1,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
           AND version = $8
         RETURNING id, version`,
          [
            id,
            session.shopId,
            typeof body.targetText === 'string' ? body.targetText.trim() : null,
            typeof body.translationKind === 'string' ? body.translationKind.trim() : null,
            body.priority != null
              ? Math.max(1, Math.min(1000, toNumber(body.priority, 100)))
              : null,
            typeof body.isLocked === 'boolean' ? body.isLocked : null,
            typeof body.isActive === 'boolean' ? body.isActive : null,
            expectedVersion,
          ]
        );
        return result.rows[0] ?? null;
      });

      if (!updated) {
        return reply
          .status(409)
          .send(
            errorEnvelope(
              request.id,
              409,
              'VERSION_CONFLICT',
              'Glossary entry changed since you loaded it'
            )
          );
      }

      await logAuditEvent('lex_glossary_updated', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_glossary_entries',
        resourceId: id,
        details: { nextVersion: updated.version },
      });

      return reply.send(successEnvelope(request.id, updated));
    }
  );

  server.get('/pim/lex/rules', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));

    const rules = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<LexTranslationRuleDto>(
        `SELECT
           id,
           shop_id AS "shopId",
           rule_name AS "ruleName",
           source_lang AS "sourceLang",
           target_lang AS "targetLang",
           match_term AS "matchTerm",
           domain_code AS "domainCode",
           target_translation AS "targetTranslation",
           priority,
           version,
           is_active AS "isActive"
         FROM lex_translation_rules
         WHERE shop_id = $1 OR shop_id IS NULL
         ORDER BY shop_id DESC NULLS LAST, priority ASC, updated_at DESC
         LIMIT 200`,
        [session.shopId]
      );
      return result.rows;
    });

    return reply.send(successEnvelope(request.id, { rules }));
  });

  server.post('/pim/lex/rules', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const body = (request.body ?? {}) as Partial<LexTranslationRuleDto>;
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));

    const inserted = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ id: string; version: number }>(
        `INSERT INTO lex_translation_rules
           (shop_id, rule_name, source_lang, target_lang, match_term, domain_code, required_neighbors,
            forbidden_neighbors, required_field_kinds, target_translation, priority, version, is_active, created_by, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $7, $8, 1, $9, $10, now(), now())
         RETURNING id, version`,
        [
          session.shopId,
          body.ruleName ?? '',
          body.sourceLang ?? 'ro',
          body.targetLang ?? 'en',
          body.matchTerm ?? '',
          body.domainCode ?? null,
          body.targetTranslation ?? '',
          Math.max(1, Math.min(1000, toNumber(body.priority, 100))),
          body.isActive !== false,
          session.staffUserId ?? null,
        ]
      );
      return result.rows[0] ?? null;
    });

    return reply.status(201).send(successEnvelope(request.id, inserted));
  });

  server.patch('/pim/lex/rules/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Partial<LexTranslationRuleDto> & {
      expectedVersion?: number;
    };
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
    if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
    }

    const updated = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ id: string; version: number }>(
        `UPDATE lex_translation_rules
         SET rule_name = COALESCE($3, rule_name),
             match_term = COALESCE($4, match_term),
             domain_code = COALESCE($5, domain_code),
             target_translation = COALESCE($6, target_translation),
             priority = COALESCE($7, priority),
             is_active = COALESCE($8, is_active),
             version = version + 1,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
           AND version = $9
         RETURNING id, version`,
        [
          id,
          session.shopId,
          body.ruleName ?? null,
          body.matchTerm ?? null,
          body.domainCode ?? null,
          body.targetTranslation ?? null,
          body.priority ?? null,
          typeof body.isActive === 'boolean' ? body.isActive : null,
          expectedVersion,
        ]
      );
      return result.rows[0] ?? null;
    });
    if (!updated)
      return reply
        .status(409)
        .send(
          errorEnvelope(request.id, 409, 'VERSION_CONFLICT', 'Rule changed since you loaded it')
        );
    return reply.send(successEnvelope(request.id, updated));
  });

  server.get('/pim/lex/profiles', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const profiles = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<LexDomainProfileDto>(
        `SELECT
           id,
           shop_id AS "shopId",
           domain_code AS "domainCode",
           name_ro AS "nameRo",
           name_en AS "nameEn",
           description,
           version,
           is_active AS "isActive"
         FROM lex_domain_profiles
         WHERE shop_id = $1 OR shop_id IS NULL
         ORDER BY shop_id DESC NULLS LAST, updated_at DESC
         LIMIT 200`,
        [session.shopId]
      );
      return result.rows;
    });
    return reply.send(successEnvelope(request.id, { profiles }));
  });

  server.post('/pim/lex/profiles', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const body = (request.body ?? {}) as Partial<LexDomainProfileDto>;
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const inserted = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ id: string; version: number }>(
        `INSERT INTO lex_domain_profiles
           (shop_id, domain_code, name_ro, name_en, description, category_hints, protected_patterns,
            required_neighbor_terms, forbidden_neighbor_terms, allowed_translation_styles, metadata, version, is_active, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 1, $6, now(), now())
         RETURNING id, version`,
        [
          session.shopId,
          body.domainCode ?? '',
          body.nameRo ?? '',
          body.nameEn ?? null,
          body.description ?? null,
          body.isActive !== false,
        ]
      );
      return result.rows[0] ?? null;
    });
    return reply.status(201).send(successEnvelope(request.id, inserted));
  });

  server.patch(
    '/pim/lex/profiles/:id',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexDomainProfileDto> & {
        expectedVersion?: number;
      };
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }
      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ id: string; version: number }>(
          `UPDATE lex_domain_profiles
         SET name_ro = COALESCE($3, name_ro),
             name_en = COALESCE($4, name_en),
             description = COALESCE($5, description),
             is_active = COALESCE($6, is_active),
             version = version + 1,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
           AND version = $7
         RETURNING id, version`,
          [
            id,
            session.shopId,
            body.nameRo ?? null,
            body.nameEn ?? null,
            body.description ?? null,
            typeof body.isActive === 'boolean' ? body.isActive : null,
            expectedVersion,
          ]
        );
        return result.rows[0] ?? null;
      });
      if (!updated)
        return reply
          .status(409)
          .send(
            errorEnvelope(
              request.id,
              409,
              'VERSION_CONFLICT',
              'Profile changed since you loaded it'
            )
          );
      return reply.send(successEnvelope(request.id, updated));
    }
  );

  server.get('/pim/lex/stopwords', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const stopwords = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<LexStopwordDto>(
        `SELECT
           id,
           shop_id AS "shopId",
           locale,
           word,
           word_type AS "wordType",
           priority,
           version,
           is_active AS "isActive"
         FROM lex_stopwords
         WHERE shop_id = $1 OR shop_id IS NULL
         ORDER BY shop_id DESC NULLS LAST, priority ASC, word ASC
         LIMIT 200`,
        [session.shopId]
      );
      return result.rows;
    });
    return reply.send(successEnvelope(request.id, { stopwords }));
  });

  server.post('/pim/lex/stopwords', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const body = (request.body ?? {}) as Partial<LexStopwordDto>;
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const inserted = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{ id: string; version: number }>(
        `INSERT INTO lex_stopwords
           (shop_id, locale, word, word_type, priority, version, is_active, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, 1, $6, now(), now())
         RETURNING id, version`,
        [
          session.shopId,
          body.locale ?? 'ro',
          body.word ?? '',
          body.wordType ?? 'noise',
          Math.max(1, Math.min(1000, toNumber(body.priority, 100))),
          body.isActive !== false,
        ]
      );
      return result.rows[0] ?? null;
    });
    return reply.status(201).send(successEnvelope(request.id, inserted));
  });

  server.patch(
    '/pim/lex/stopwords/:id',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexStopwordDto> & { expectedVersion?: number };
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }
      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ id: string; version: number }>(
          `UPDATE lex_stopwords
         SET word = COALESCE($3, word),
             word_type = COALESCE($4, word_type),
             priority = COALESCE($5, priority),
             is_active = COALESCE($6, is_active),
             version = version + 1,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
           AND version = $7
         RETURNING id, version`,
          [
            id,
            session.shopId,
            body.word ?? null,
            body.wordType ?? null,
            body.priority ?? null,
            typeof body.isActive === 'boolean' ? body.isActive : null,
            expectedVersion,
          ]
        );
        return result.rows[0] ?? null;
      });
      if (!updated)
        return reply
          .status(409)
          .send(
            errorEnvelope(
              request.id,
              409,
              'VERSION_CONFLICT',
              'Stopword changed since you loaded it'
            )
          );
      return reply.send(successEnvelope(request.id, updated));
    }
  );

  server.get('/pim/lex/governance', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { status?: string };
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const requests = await listLexGovernanceRequests({
      shopId: session.shopId,
      status: query.status ?? null,
    });
    return reply.send(successEnvelope(request.id, { requests }));
  });

  server.get(
    '/pim/lex/governance/:id',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      const detail = await withTenantContext(session.shopId, async (client) => {
        const requestRow = await getLexGovernanceRequest({ shopId: session.shopId, requestId: id });
        if (!requestRow) return null;

        const events = await client.query<{
          id: string;
          action: string;
          actorId: string | null;
          fromStatus: string | null;
          toStatus: string | null;
          details: Record<string, unknown> | null;
          createdAt: string | null;
        }>(
          `SELECT
           id,
           action,
           actor_id AS "actorId",
           from_status AS "fromStatus",
           to_status AS "toStatus",
           details,
           created_at::text AS "createdAt"
         FROM lex_governance_request_events
         WHERE request_id = $1
         ORDER BY created_at DESC`,
          [id]
        );

        return {
          request: {
            ...requestRow,
            events: events.rows.map((row) => ({
              ...row,
              details: row.details ?? {},
            })),
          } satisfies LexGovernanceRequestDetailDto,
        };
      });

      if (!detail)
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
      return reply.send(successEnvelope(request.id, detail));
    }
  );

  server.post('/pim/lex/governance', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const body = (request.body ?? {}) as {
      entityType?: LexGovernanceEntityType;
      targetId?: string | null;
      title?: string | null;
      notes?: string | null;
      payload?: Record<string, unknown>;
    };
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    if (
      body.entityType !== 'glossary_entry' &&
      body.entityType !== 'translation_rule' &&
      body.entityType !== 'domain_profile' &&
      body.entityType !== 'stopword' &&
      body.entityType !== 'locked_translation' &&
      body.entityType !== 'attribute_resolution'
    ) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid governance entity type'));
    }
    const created = await createLexGovernanceRequest({
      shopId: session.shopId,
      entityType: body.entityType,
      targetId: body.targetId ?? null,
      payload: toJsonObject(body.payload),
      title: typeof body.title === 'string' ? body.title : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
      actorId: session.staffUserId ?? null,
    });
    await logAuditEvent('lex_governance_request_created', {
      actorType: 'user',
      actorId: session.staffUserId ?? null,
      shopId: session.shopId,
      resourceType: 'lex_governance_requests',
      resourceId: created.id,
      details: { entityType: body.entityType, status: created.status },
    });
    return reply.status(201).send(successEnvelope(request.id, created));
  });

  server.post(
    '/pim/lex/governance/:id/submit',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApprovalRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      try {
        const submitted = await submitLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: typeof body.notes === 'string' ? body.notes : null,
        });
        if (!submitted)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        return reply.send(successEnvelope(request.id, submitted));
      } catch (error) {
        if (error instanceof Error && error.message === 'version_conflict') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'VERSION_CONFLICT',
                'Governance request changed since you loaded it'
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/governance/:id/approve',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApprovalRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      try {
        const approved = await approveLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: typeof body.notes === 'string' ? body.notes : null,
        });
        if (!approved)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        return reply.send(successEnvelope(request.id, approved));
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'version_conflict' ||
            error.message === 'maker_checker_self_approval_blocked')
        ) {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                error.message === 'version_conflict' ? 'VERSION_CONFLICT' : 'SELF_APPROVAL_BLOCKED',
                error.message
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/governance/:id/reject',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApprovalRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      try {
        const rejected = await rejectLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: typeof body.notes === 'string' ? body.notes : null,
        });
        if (!rejected)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        return reply.send(successEnvelope(request.id, rejected));
      } catch (error) {
        if (error instanceof Error && error.message === 'version_conflict') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'VERSION_CONFLICT',
                'Governance request changed since you loaded it'
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/governance/:id/apply',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApplyRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      try {
        const applied = await applyLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: typeof body.notes === 'string' ? body.notes : null,
        });
        if (!applied)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        return reply.send(successEnvelope(request.id, applied));
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === 'version_conflict' ||
            error.message === 'governance_request_not_approved')
        ) {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                error.message === 'version_conflict' ? 'VERSION_CONFLICT' : 'NOT_APPROVED',
                error.message
              )
            );
        }
        throw error;
      }
    }
  );

  server.get('/pim/lex/publications', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { status?: string; limit?: string; cursor?: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const limit = parsePageLimit(query.limit, 50, 100);
    const cursor = decodeCursor(query.cursor);
    const cursorUpdatedAt =
      typeof cursor?.['updatedAt'] === 'string' ? String(cursor['updatedAt']) : null;
    const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;

    const page = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        targetType: string;
        targetRecordId: string | null;
        targetPath: string | null;
        status: string;
        attemptCount: number | null;
        errorMessage: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           id,
           target_type AS "targetType",
           target_record_id AS "targetRecordId",
           target_path AS "targetPath",
           status,
           attempt_count AS "attemptCount",
           error_message AS "errorMessage",
           updated_at::text AS "updatedAt"
         FROM lex_publication_targets
         WHERE shop_id = $1
           AND ($2::text IS NULL OR status = $2)
           AND (
             $3::timestamptz IS NULL
             OR updated_at < $3::timestamptz
             OR (updated_at = $3::timestamptz AND id < $4::uuid)
           )
         ORDER BY updated_at DESC
         LIMIT $5`,
        [session.shopId, query.status ?? null, cursorUpdatedAt, cursorId, limit + 1]
      );

      const pageRows = result.rows.slice(0, limit);
      const items = pageRows.map(
        (row): LexPublicationTargetDto => ({
          ...row,
          attemptCount: row.attemptCount ?? 0,
        })
      );

      return makeCursorPage(
        items,
        result.rows.length > limit && pageRows.at(-1)?.updatedAt
          ? encodeCursor({
              id: pageRows.at(-1)!.id,
              updatedAt: pageRows.at(-1)!.updatedAt,
            })
          : null
      );
    });

    return reply.send(successEnvelope(request.id, { publications: page.items, page }));
  });

  server.get(
    '/pim/lex/publications/:id',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const detail = await withTenantContext(session.shopId, async (client) => {
        const targetRes = await client.query<{
          id: string;
          localizationId: string | null;
          targetType: string;
          targetRecordId: string | null;
          targetPath: string | null;
          status: string;
          attemptCount: number | null;
          errorMessage: string | null;
          updatedAt: string | null;
          payload: Record<string, unknown> | null;
          previousSnapshot: Record<string, unknown> | null;
          publishedSnapshot: Record<string, unknown> | null;
        }>(
          `SELECT
           id,
           localization_id AS "localizationId",
           target_type AS "targetType",
           target_record_id AS "targetRecordId",
           target_path AS "targetPath",
           status,
           attempt_count AS "attemptCount",
           error_message AS "errorMessage",
           updated_at::text AS "updatedAt",
           payload,
           previous_snapshot AS "previousSnapshot",
           published_snapshot AS "publishedSnapshot"
         FROM lex_publication_targets
         WHERE shop_id = $1
           AND id = $2
         LIMIT 1`,
          [session.shopId, id]
        );

        const target = targetRes.rows[0];
        if (!target) return null;

        const eventsRes = await client.query<{
          id: string;
          action: string;
          status: string;
          errorMessage: string | null;
          createdAt: string | null;
          requestPayload: Record<string, unknown> | null;
          responsePayload: Record<string, unknown> | null;
        }>(
          `SELECT
           id,
           action,
           status,
           error_message AS "errorMessage",
           created_at::text AS "createdAt",
           request_payload AS "requestPayload",
           response_payload AS "responsePayload"
         FROM lex_publish_events
         WHERE publication_target_id = $1
         ORDER BY created_at DESC`,
          [id]
        );

        const rollbackStatus = getLexPublicationRollbackStatus({
          targetType: target.targetType,
          previousSnapshot: target.previousSnapshot ?? {},
        });

        return {
          publication: {
            ...target,
            attemptCount: target.attemptCount ?? 0,
            payload: target.payload ?? {},
            previousSnapshot: target.previousSnapshot ?? {},
            publishedSnapshot: target.publishedSnapshot ?? {},
            rollbackable: rollbackStatus.rollbackable,
            rollbackBlockedReason: rollbackStatus.rollbackBlockedReason,
            snapshotCompleteness: rollbackStatus.snapshotCompleteness,
            needsRepair: rollbackStatus.needsRepair,
            queueLinks: buildLexPublicationQueueLinks(),
            events: eventsRes.rows.map(
              (row): LexPublicationEventDto => ({
                ...row,
                requestPayload: row.requestPayload ?? {},
                responsePayload: row.responsePayload ?? {},
              })
            ),
          } satisfies LexPublicationDetailDto,
        };
      });

      if (!detail) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Publication target not found'));
      }

      return reply.send(successEnvelope(request.id, detail));
    }
  );

  server.post(
    '/pim/lex/publications/:id/retry',
    { preHandler: requireLexPublishSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const target = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ id: string; targetType: string }>(
          `UPDATE lex_publication_targets
         SET status = 'pending',
             error_message = NULL,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
         RETURNING id, target_type AS "targetType"`,
          [id, session.shopId]
        );
        return result.rows[0] ?? null;
      });

      if (!target) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Publication target not found'));
      }

      const queueJobId = await enqueueLexPublishJob({
        shopId: session.shopId,
        targetIds: [target.id],
        ...(target.targetType === 'prod_attr_synonyms' ||
        target.targetType === 'prod_translations' ||
        target.targetType === 'prod_semantics' ||
        target.targetType === 'shopify_collections.title_en' ||
        target.targetType === 'shopify_collections.description_en'
          ? { publicationTargetType: target.targetType }
          : {}),
        requestedAt: Date.now(),
        retryOnly: true,
      });

      await logAuditEvent('lex_publication_retry_requested', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_publication_targets',
        resourceId: target.id,
        details: {
          targetType: target.targetType,
          queueJobId,
        },
      });

      return reply
        .status(202)
        .send(successEnvelope(request.id, { queueJobId, publicationTargetId: target.id }));
    }
  );

  server.post(
    '/pim/lex/publications/:id/rollback',
    { preHandler: requireLexPublishSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const result = await rollbackLexPublicationTarget({
        shopId: session.shopId,
        publicationTargetId: id,
      });

      if (result === 'skipped') {
        return reply
          .status(404)
          .send(
            errorEnvelope(
              request.id,
              404,
              'NOT_FOUND',
              'Publication target not found or not rollbackable'
            )
          );
      }
      if (result === 'failed') {
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'ROLLBACK_FAILED', 'Publication rollback failed'));
      }

      await logAuditEvent('lex_publication_rollback', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_publication_targets',
        resourceId: id,
        details: { result },
      });

      return reply.send(successEnvelope(request.id, { publicationTargetId: id, result }));
    }
  );

  server.get('/pim/lex/metrics', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const metrics = (await collectLexMetrics({
      shopId: session.shopId,
      env: options.env,
    })) satisfies LexMetricsDto;

    return reply.send(successEnvelope(request.id, { metrics }));
  });

  return Promise.resolve();
};
