import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { logAuditEvent, withTenantContext } from '@app/database';
import {
  LEX_ENTITY_TYPES,
  LEX_PUBLICATION_TARGET_STATUSES,
  LEX_PUBLICATION_TARGET_TYPES,
  LEX_REVIEW_SEVERITIES,
  LEX_REVIEW_STATUSES,
  LEX_RUN_TYPES,
  isLexCanonicalUuid,
  isLexPhaseName,
  type LexBootstrapDto,
  type LexClusterDetail,
  type LexCursorPage,
  type LexDomainProfileDto,
  type LexGovernanceApprovalRequest,
  type LexGovernanceRequestDetailDto,
  type LexGovernanceApplyRequest,
  type LexGovernanceEntityType,
  type LexGlossaryEntryDto,
  type LexAssignReviewRequest,
  type LexLocalizationDetail,
  type LexLocalizationDetailDto,
  type LexLocalizationEvidenceDto,
  type LexPublicationDetailDto,
  type LexPublicationEventDto,
  type LexMetricsDto,
  type LexPublicationTargetDto,
  type LexReviewDetailDto,
  type LexReviewDecisionDto,
  type LexReviewDecisionRequest,
  type LexReviewItemDetail,
  type LexRunSummary,
  type LexRunType,
  type LexShopSettingsDto,
  type LexStopwordDto,
  type LexTermDetail,
  type LexTermFlagsPatchRequest,
  type LexTranslationRuleDto,
} from '@app/types';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';

import {
  requireLexGovernanceAccess,
  requireLexModuleAccess,
  requireLexPublishAccess,
  requireLexReviewAccess,
  requireLexSettingsAccess,
  resolveLexBootstrap,
} from '../auth/require-lex-access.js';
import type { SessionConfig, SessionData } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import {
  enqueueLexPublishJob,
  enqueueLexRunRequestedJob,
  isLexQueueName,
  retryLexDlqToMainQueue,
} from '../queue/lex-queues.js';
import { computeLexGlossaryRulesSnapshotHash } from '../services/lex-glossary-rules-snapshot.js';
import {
  findLexReuseFragmentsRunId,
  insertTranslateOnlyRunShards,
} from '../services/lex-translate-only-bootstrap.js';
import { recoverLexRun } from '../processors/lex/run-lifecycle.js';
import { reconcileLexScheduledTasks } from '../processors/lex/scheduled-tasks.js';
import {
  approveLexGovernanceRequest,
  applyLexGovernanceRequest,
  cancelLexGovernanceRequest,
  createLexGovernanceRequest,
  getLexGovernanceRequest,
  listLexGovernanceRequests,
  rejectLexGovernanceRequest,
  submitLexGovernanceRequest,
  updateLexGovernanceRequest,
} from '../services/lex-governance.js';
import {
  getLexPublicationRollbackStatus,
  rollbackLexPublicationTarget,
} from '../services/lex-localizations.js';
import { resolveLexPublicationPublishConflict } from '../services/lex-publication-conflict-resolve.js';
import {
  buildLexPublicationQueueLinks,
  calibrateLexQualityThresholds,
  collectLexMetrics,
} from '../services/lex-ops.js';
import {
  assignLexReviewItem,
  bulkDecideLexReviewItems,
  decideLexReviewItem,
  LEX_BULK_REVIEW_DECISION_MAX_ITEMS,
} from '../services/lex-review-actions.js';
import { reconcileLexStopwordTerms } from '../services/lex-stopword-reconcile.js';
import { buildLexXliffExport, importXliffUnits, parseXliffUnits } from '../services/lex-xliff.js';
import {
  sha256StableJson,
  type TenantClient as LexTenantClient,
} from '../processors/lex/pipeline-utils.js';
import { syncLexTranslationSourceEmbeddings } from '../processors/lex/ai-batches.js';

interface PimLexRoutesOptions {
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}

interface RequestWithSession {
  session?: SessionData;
  lexAccess?: LexBootstrapDto;
}

type NullableCount = string | number | null;

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

function escapeLexLikePattern(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`);
}

function lexTextSearchPattern(q: string | undefined | null): string | null {
  const t = typeof q === 'string' ? q.trim() : '';
  if (!t) return null;
  return `%${escapeLexLikePattern(t)}%`;
}

const LEX_EXPORT_MAX_ROWS = 25_000;

const LEX_EXPORT_ENTITIES = [
  'terms',
  'glossary',
  'translations',
  'rules',
  'review',
  'publications',
] as const;

type LexExportEntity = (typeof LEX_EXPORT_ENTITIES)[number];

function isLexExportEntity(value: string): value is LexExportEntity {
  return (LEX_EXPORT_ENTITIES as readonly string[]).includes(value);
}

function lexExportCsvCell(value: unknown): string {
  let raw: string;
  if (value === null || value === undefined) {
    raw = '';
  } else if (typeof value === 'object') {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = '';
    }
  } else if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    raw = String(value);
  } else if (typeof value === 'symbol') {
    const d = value.description;
    raw = d !== undefined && d !== '' ? d : '';
  } else if (typeof value === 'function') {
    raw = `[function:${value.name || 'anonymous'}]`;
  } else {
    raw = '';
  }
  const needsQuote = /[",\n\r]/.test(raw);
  const escaped = raw.replaceAll('"', '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function lexExportCsvLine(cells: readonly unknown[]): string {
  return cells.map(lexExportCsvCell).join(',');
}

/** Align with web-admin LEX_DECISION_NOTES_MAX_LENGTH (review / governance notes). */
const LEX_DECISION_NOTES_MAX_LENGTH = 2000;

function normalizeLexOptionalNotes(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > LEX_DECISION_NOTES_MAX_LENGTH ? t.slice(0, LEX_DECISION_NOTES_MAX_LENGTH) : t;
}

function assertLexUuidParam(id: string, requestId: string, reply: FastifyReply): boolean {
  if (!isLexCanonicalUuid(id)) {
    void reply
      .status(400)
      .send(
        errorEnvelope(requestId, 400, 'BAD_REQUEST', 'Parametrul id trebuie să fie un UUID valid')
      );
    return false;
  }
  return true;
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

/** POST: toate valorile trebuie string non-gol după trim. */
function lexRequireNonEmptyBodyFields(
  requestId: string,
  reply: FastifyReply,
  fields: Record<string, string>
): boolean {
  const missing: string[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (!val.trim()) missing.push(key);
  }
  if (missing.length === 0) return true;
  void reply
    .status(400)
    .send(
      errorEnvelope(
        requestId,
        400,
        'BAD_REQUEST',
        `Missing or empty required fields: ${missing.join(', ')}`
      )
    );
  return false;
}

/**
 * PATCH: dacă câmpul e prezent în body, trebuie să fie string non-gol (după trim).
 * `undefined` = nu se actualizează câmpul.
 */
function lexRejectEmptyPatchString(
  requestId: string,
  reply: FastifyReply,
  fieldLabel: string,
  value: unknown
): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'string') {
    void reply
      .status(400)
      .send(
        errorEnvelope(requestId, 400, 'BAD_REQUEST', `${fieldLabel} must be a string when provided`)
      );
    return false;
  }
  if (!value.trim()) {
    void reply
      .status(400)
      .send(errorEnvelope(requestId, 400, 'BAD_REQUEST', `${fieldLabel} cannot be empty`));
    return false;
  }
  return true;
}

const LEX_TRANSLATION_MODES = new Set(['single', 'consensus', 'auto']);

function parseLexTranslationMode(value: unknown): LexShopSettingsDto['translationMode'] {
  return typeof value === 'string' && LEX_TRANSLATION_MODES.has(value)
    ? (value as LexShopSettingsDto['translationMode'])
    : 'auto';
}

function parseLexGuardrailsMode(value: unknown): 'warn' | 'enforce' | 'progressive' {
  if (typeof value !== 'string') {
    return 'warn';
  }
  if (value === 'warn' || value === 'enforce' || value === 'progressive') {
    return value;
  }
  return 'warn';
}

function finiteNonNegativeIntLex(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function coerceLexGuardrailsLastEvaluatedAt(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function resolveLexGuardrailsLastEvaluatedAtFromPutBody(
  bodyValue: unknown,
  baseValue: string | null
): string | null {
  if (bodyValue === undefined) return baseValue;
  if (bodyValue === null) return null;
  return typeof bodyValue === 'string' ? bodyValue : baseValue;
}

function clampUnitInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function mapLexShopSettingsRow(row: Record<string, unknown>): LexShopSettingsDto {
  const sid = row['shopId'];
  const shopId = typeof sid === 'string' ? sid : '';
  const tls = row['targetLangs'];
  const guardrailsLexModeRaw: unknown = row['guardrailsLexMode'];
  const maxTermsPerLlmBatchRaw: unknown = row['maxTermsPerLlmBatch'];
  const guardrailsWarnThresholdRaw: unknown = row['guardrailsWarnThreshold'];
  const guardrailsWarnCountRaw: unknown = row['guardrailsWarnCount'];
  const guardrailsBlockCountRaw: unknown = row['guardrailsBlockCount'];
  const guardrailsFalsePositiveCountRaw: unknown = row['guardrailsFalsePositiveCount'];
  const guardrailsLastEvaluatedAtRaw: unknown = row['guardrailsLastEvaluatedAt'];
  const resolvedGuardrailsLexMode = parseLexGuardrailsMode(guardrailsLexModeRaw);
  return {
    shopId,
    version: toNumber(row['version'], 0),
    enabled: Boolean(row['enabled']),
    sourceLang:
      typeof row['sourceLang'] === 'string' && row['sourceLang'].trim()
        ? row['sourceLang'].trim()
        : 'ro',
    targetLangs: Array.isArray(tls)
      ? tls.filter((x): x is string => typeof x === 'string')
      : ['en'],
    extractScope: toJsonObject(row['extractScope']),
    shardSize: toNumber(row['shardSize'], 10_000),
    thresholds: toJsonObject(row['thresholds']),
    retentionDaysFragments: toNumber(row['retentionDaysFragments'], 90),
    retentionDaysOccurrences: toNumber(row['retentionDaysOccurrences'], 90),
    retentionDaysContexts: toNumber(row['retentionDaysContexts'], 180),
    autoPublishProducts: Boolean(row['autoPublishProducts']),
    autoPublishAttributes: Boolean(row['autoPublishAttributes']),
    autoPublishCollections: Boolean(row['autoPublishCollections']),
    translationMode: parseLexTranslationMode(row['translationMode']),
    consensusEscalationThreshold: clampUnitInterval(
      toNumber(row['consensusEscalationThreshold'], 0.8),
      0.8
    ),
    translationAutoApproveThreshold: clampUnitInterval(
      toNumber(row['translationAutoApproveThreshold'], 0.93),
      0.93
    ),
    localizationAutoApproveThreshold: clampUnitInterval(
      toNumber(row['localizationAutoApproveThreshold'], 0.85),
      0.85
    ),
    tmEnabled: row['tmEnabled'] === undefined ? true : Boolean(row['tmEnabled']),
    tmSimilarityThreshold: clampUnitInterval(toNumber(row['tmSimilarityThreshold'], 0.92), 0.92),
    qualityAuditEnabled:
      row['qualityAuditEnabled'] === undefined ? true : Boolean(row['qualityAuditEnabled']),
    qualityAuditMinBatchSize: Math.max(
      1,
      Math.min(10_000, toNumber(row['qualityAuditMinBatchSize'], 50))
    ),
    maxTermsPerLlmBatch: Math.max(1, Math.min(500, toNumber(maxTermsPerLlmBatchRaw, 10))),
    guardrailsLexMode: resolvedGuardrailsLexMode,
    guardrailsWarnThreshold: finiteNonNegativeIntLex(
      guardrailsWarnThresholdRaw,
      LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.warnThreshold
    ),
    guardrailsWarnCount: finiteNonNegativeIntLex(
      guardrailsWarnCountRaw,
      LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.warnCount
    ),
    guardrailsBlockCount: finiteNonNegativeIntLex(
      guardrailsBlockCountRaw,
      LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.blockCount
    ),
    guardrailsFalsePositiveCount: finiteNonNegativeIntLex(
      guardrailsFalsePositiveCountRaw,
      LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.falsePositiveCount
    ),
    guardrailsLastEvaluatedAt: coerceLexGuardrailsLastEvaluatedAt(guardrailsLastEvaluatedAtRaw),
  };
}

/**
 * Valori implicite guardrails pentru `lex_shop_settings` și pentru merge-ul PUT când corpul nu trimite câmpuri.
 * Folosim constante numerice explicite aici (nu `base.guardrails*`) ca al doilea argument la `toNumber` / `resolveLexGuardrailsLastEvaluatedAtFromPutBody`,
 * astfel încât @typescript-eslint/no-unsafe-argument să nu primească tipul intern `error` din anumite rezolvări DTO în IDE.
 */
const LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS = {
  warnThreshold: 1000,
  warnCount: 0,
  blockCount: 0,
  falsePositiveCount: 0,
  lastEvaluatedAt: null,
} as const;

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
    translationMode: 'auto',
    consensusEscalationThreshold: 0.8,
    translationAutoApproveThreshold: 0.93,
    localizationAutoApproveThreshold: 0.85,
    tmEnabled: true,
    tmSimilarityThreshold: 0.92,
    qualityAuditEnabled: true,
    qualityAuditMinBatchSize: 50,
    maxTermsPerLlmBatch: 10,
    guardrailsLexMode: 'warn',
    guardrailsWarnThreshold: LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.warnThreshold,
    guardrailsWarnCount: LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.warnCount,
    guardrailsBlockCount: LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.blockCount,
    guardrailsFalsePositiveCount: LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.falsePositiveCount,
    guardrailsLastEvaluatedAt: LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.lastEvaluatedAt,
  };
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

    return sha256StableJson(snapshots);
  });
}

async function buildLexExportCsvTerms(params: {
  client: LexTenantClient;
  shopId: string;
  termSearchPattern: string | null;
  limit: number;
}): Promise<{ csv: string; truncated: boolean; rowCount: number }> {
  const { client, shopId, termSearchPattern, limit } = params;
  const header = lexExportCsvLine([
    'id',
    'canonicalText',
    'normalizedKey',
    'displayTextRo',
    'ngramSize',
    'termType',
    'domainCode',
    'isTechnical',
    'isProtected',
    'status',
    'occurrencesTotal',
    'scoreGlobal',
    'updatedAt',
  ]);
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
    occurrencesTotal: NullableCount;
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
     WHERE (t.shop_id = $1 OR t.shop_id IS NULL)
       AND ($2::text IS NULL OR t.canonical_text ILIKE $2 ESCAPE '\\' OR t.normalized_key ILIKE $2 ESCAPE '\\')
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT $3`,
    [shopId, termSearchPattern, limit]
  );
  const truncated = result.rows.length > LEX_EXPORT_MAX_ROWS;
  const rows = truncated ? result.rows.slice(0, LEX_EXPORT_MAX_ROWS) : result.rows;
  const lines = [
    header,
    ...rows.map((r) =>
      lexExportCsvLine([
        r.id,
        r.canonicalText,
        r.normalizedKey,
        r.displayTextRo ?? '',
        r.ngramSize,
        r.termType,
        r.domainCode ?? '',
        r.isTechnical,
        r.isProtected,
        r.status,
        toNumber(r.occurrencesTotal),
        toNumberOrNull(r.scoreGlobal) ?? '',
        r.updatedAt,
      ])
    ),
  ];
  return { csv: lines.join('\n'), truncated, rowCount: rows.length };
}

async function buildLexExportCsv(params: {
  client: LexTenantClient;
  shopId: string;
  entity: LexExportEntity;
  qRaw: string | undefined;
}): Promise<{ csv: string; truncated: boolean; rowCount: number }> {
  const { client, shopId, entity, qRaw } = params;
  const limit = LEX_EXPORT_MAX_ROWS + 1;
  const termSearchPattern = lexTextSearchPattern(qRaw);

  if (entity === 'terms') {
    return await buildLexExportCsvTerms({ client, shopId, termSearchPattern, limit });
  }

  if (entity === 'glossary') {
    const header = lexExportCsvLine([
      'id',
      'shopId',
      'domainCode',
      'sourceLang',
      'targetLang',
      'sourceText',
      'targetText',
      'translationKind',
      'priority',
      'version',
      'isLocked',
      'isActive',
      'updatedAt',
    ]);
    const glossarySearchPattern = lexTextSearchPattern(qRaw);
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
      updatedAt: string;
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
         is_active AS "isActive",
         updated_at::text AS "updatedAt"
       FROM lex_effective_glossary_entries
       WHERE (shop_id = $1 OR shop_id IS NULL)
         AND ($2::text IS NULL OR source_text ILIKE $2 ESCAPE '\\' OR target_text ILIKE $2 ESCAPE '\\')
       ORDER BY is_locked DESC, priority ASC, updated_at DESC, id DESC
       LIMIT $3`,
      [shopId, glossarySearchPattern, limit]
    );
    const truncated = result.rows.length > LEX_EXPORT_MAX_ROWS;
    const rows = truncated ? result.rows.slice(0, LEX_EXPORT_MAX_ROWS) : result.rows;
    const lines = [
      header,
      ...rows.map((r) =>
        lexExportCsvLine([
          r.id,
          r.shopId ?? '',
          r.domainCode ?? '',
          r.sourceLang,
          r.targetLang,
          r.sourceText,
          r.targetText,
          r.translationKind,
          r.priority,
          r.version,
          r.isLocked,
          r.isActive,
          r.updatedAt,
        ])
      ),
    ];
    return { csv: lines.join('\n'), truncated, rowCount: rows.length };
  }

  if (entity === 'translations') {
    const header = lexExportCsvLine([
      'id',
      'shopId',
      'termId',
      'clusterId',
      'sourceLang',
      'targetLang',
      'translationText',
      'translationKind',
      'version',
      'qualityScore',
      'publicationStatus',
      'isLocked',
      'sourceTermCanonical',
      'createdAt',
      'updatedAt',
    ]);
    const result = await client.query<{
      id: string;
      shopId: string | null;
      termId: string;
      clusterId: string | null;
      sourceLang: string;
      targetLang: string;
      translationText: string;
      translationKind: string;
      version: number;
      qualityScore: string | null;
      publicationStatus: string | null;
      isLocked: boolean;
      sourceTermCanonical: string | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT
         tr.id,
         tr.shop_id AS "shopId",
         tr.term_id AS "termId",
         tr.cluster_id AS "clusterId",
         tr.source_lang AS "sourceLang",
         tr.target_lang AS "targetLang",
         tr.translation_text AS "translationText",
         tr.translation_kind AS "translationKind",
         tr.version,
         tr.quality_score::text AS "qualityScore",
         tr.publication_status AS "publicationStatus",
         tr.is_locked AS "isLocked",
         tm.canonical_text AS "sourceTermCanonical",
         tr.created_at::text AS "createdAt",
         tr.updated_at::text AS "updatedAt"
       FROM lex_translations tr
       LEFT JOIN lex_terms tm
         ON tm.id = tr.term_id
        AND (tm.shop_id = $1 OR tm.shop_id IS NULL)
       WHERE tr.shop_id = $1 OR tr.shop_id IS NULL
       ORDER BY tr.updated_at DESC NULLS LAST, tr.id DESC
       LIMIT $2`,
      [shopId, limit]
    );
    const truncated = result.rows.length > LEX_EXPORT_MAX_ROWS;
    const rows = truncated ? result.rows.slice(0, LEX_EXPORT_MAX_ROWS) : result.rows;
    const lines = [
      header,
      ...rows.map((r) =>
        lexExportCsvLine([
          r.id,
          r.shopId ?? '',
          r.termId,
          r.clusterId ?? '',
          r.sourceLang,
          r.targetLang,
          r.translationText,
          r.translationKind,
          r.version,
          r.qualityScore ?? '',
          r.publicationStatus ?? '',
          r.isLocked,
          r.sourceTermCanonical ?? '',
          r.createdAt,
          r.updatedAt,
        ])
      ),
    ];
    return { csv: lines.join('\n'), truncated, rowCount: rows.length };
  }

  if (entity === 'rules') {
    const header = lexExportCsvLine([
      'id',
      'shopId',
      'ruleName',
      'sourceLang',
      'targetLang',
      'matchTerm',
      'domainCode',
      'targetTranslation',
      'priority',
      'version',
      'isActive',
      'updatedAt',
    ]);
    const result = await client.query<{
      id: string;
      shopId: string | null;
      ruleName: string;
      sourceLang: string;
      targetLang: string;
      matchTerm: string;
      domainCode: string | null;
      targetTranslation: string;
      priority: number;
      version: number;
      isActive: boolean;
      updatedAt: string;
    }>(
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
         is_active AS "isActive",
         updated_at::text AS "updatedAt"
       FROM lex_translation_rules
       WHERE shop_id = $1 OR shop_id IS NULL
       ORDER BY updated_at DESC, id DESC
       LIMIT $2`,
      [shopId, limit]
    );
    const truncated = result.rows.length > LEX_EXPORT_MAX_ROWS;
    const rows = truncated ? result.rows.slice(0, LEX_EXPORT_MAX_ROWS) : result.rows;
    const lines = [
      header,
      ...rows.map((r) =>
        lexExportCsvLine([
          r.id,
          r.shopId ?? '',
          r.ruleName,
          r.sourceLang,
          r.targetLang,
          r.matchTerm,
          r.domainCode ?? '',
          r.targetTranslation,
          r.priority,
          r.version,
          r.isActive,
          r.updatedAt,
        ])
      ),
    ];
    return { csv: lines.join('\n'), truncated, rowCount: rows.length };
  }

  if (entity === 'review') {
    const header = lexExportCsvLine([
      'id',
      'entityType',
      'entityId',
      'reviewReason',
      'severity',
      'priority',
      'version',
      'status',
      'notes',
      'evidenceJson',
      'createdAt',
    ]);
    const reviewSearchPattern = lexTextSearchPattern(qRaw);
    const result = await client.query<{
      id: string;
      entityType: string;
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
         AND ($2::text IS NULL OR review_reason ILIKE $2 ESCAPE '\\' OR COALESCE(notes, '') ILIKE $2 ESCAPE '\\' OR entity_id::text ILIKE $2 ESCAPE '\\')
       ORDER BY priority DESC, created_at DESC
       LIMIT $3`,
      [shopId, reviewSearchPattern, limit]
    );
    const truncated = result.rows.length > LEX_EXPORT_MAX_ROWS;
    const rows = truncated ? result.rows.slice(0, LEX_EXPORT_MAX_ROWS) : result.rows;
    const lines = [
      header,
      ...rows.map((r) =>
        lexExportCsvLine([
          r.id,
          r.entityType,
          r.entityId,
          r.reviewReason,
          r.severity,
          r.priority,
          r.version,
          r.status,
          r.notes ?? '',
          r.evidence ?? {},
          r.createdAt,
        ])
      ),
    ];
    return { csv: lines.join('\n'), truncated, rowCount: rows.length };
  }

  const header = lexExportCsvLine([
    'id',
    'targetType',
    'targetRecordId',
    'targetPath',
    'status',
    'attemptCount',
    'errorMessage',
    'updatedAt',
  ]);
  const qPat = lexTextSearchPattern(qRaw);
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
       AND (
         $2::text IS NULL
         OR target_path ILIKE $2 ESCAPE '\\'
         OR COALESCE(target_record_id::text, '') ILIKE $2 ESCAPE '\\'
         OR target_type ILIKE $2 ESCAPE '\\'
         OR COALESCE(error_message, '') ILIKE $2 ESCAPE '\\'
       )
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT $3`,
    [shopId, qPat, limit]
  );
  const truncated = result.rows.length > LEX_EXPORT_MAX_ROWS;
  const rows = truncated ? result.rows.slice(0, LEX_EXPORT_MAX_ROWS) : result.rows;
  const lines = [
    header,
    ...rows.map((r) =>
      lexExportCsvLine([
        r.id,
        r.targetType,
        r.targetRecordId ?? '',
        r.targetPath ?? '',
        r.status,
        r.attemptCount ?? 0,
        r.errorMessage ?? '',
        r.updatedAt ?? '',
      ])
    ),
  ];
  return { csv: lines.join('\n'), truncated, rowCount: rows.length };
}

export const pimLexRoutes: FastifyPluginAsync<PimLexRoutesOptions> = (
  server: FastifyInstance,
  options
) => {
  const requireAuthenticatedSession = requireSession(options.sessionConfig);
  const requireLexSession = [requireAuthenticatedSession, requireLexModuleAccess()];
  const requireLexReviewSession = [requireAuthenticatedSession, requireLexReviewAccess()];
  const requireLexPublishSession = [requireAuthenticatedSession, requireLexPublishAccess()];
  const requireLexSettingsSession = [
    requireAuthenticatedSession,
    requireLexModuleAccess(),
    requireLexSettingsAccess(),
  ];
  const requireLexGovernanceSession = [
    requireAuthenticatedSession,
    requireLexModuleAccess(),
    requireLexGovernanceAccess(),
  ];

  const LEX_RATE_LIMIT_WINDOW_MS = 60_000;
  const LEX_RATE_LIMIT_READS = 100;
  const LEX_RATE_LIMIT_WRITES = 20;
  const lexRateLimitCounters = new Map<
    string,
    { reads: number; writes: number; windowStart: number }
  >();

  const lexRateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of lexRateLimitCounters) {
      if (now - entry.windowStart >= LEX_RATE_LIMIT_WINDOW_MS * 2) lexRateLimitCounters.delete(key);
    }
  }, 5 * 60_000);
  lexRateLimitCleanupInterval.unref();

  server.addHook('onRequest', async (request, reply) => {
    const key = request.ip;
    const now = Date.now();

    let counter = lexRateLimitCounters.get(key);
    if (!counter || now - counter.windowStart >= LEX_RATE_LIMIT_WINDOW_MS) {
      counter = { reads: 0, writes: 0, windowStart: now };
      lexRateLimitCounters.set(key, counter);
    }

    const isWrite =
      request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((LEX_RATE_LIMIT_WINDOW_MS - (now - counter.windowStart)) / 1000)
    );
    if (isWrite) {
      counter.writes += 1;
      if (counter.writes > LEX_RATE_LIMIT_WRITES) {
        void reply.header('Retry-After', String(retryAfterSeconds));
        return reply
          .status(429)
          .send(errorEnvelope(request.id, 429, 'RATE_LIMITED', 'Too Many Requests'));
      }
    } else {
      counter.reads += 1;
      if (counter.reads > LEX_RATE_LIMIT_READS) {
        void reply.header('Retry-After', String(retryAfterSeconds));
        return reply
          .status(429)
          .send(errorEnvelope(request.id, 429, 'RATE_LIMITED', 'Too Many Requests'));
      }
    }
  });

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
      const result = await client.query<Record<string, unknown>>(
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
           auto_publish_collections AS "autoPublishCollections",
           translation_mode AS "translationMode",
           consensus_escalation_threshold::float8 AS "consensusEscalationThreshold",
           translation_auto_approve_threshold::float8 AS "translationAutoApproveThreshold",
           localization_auto_approve_threshold::float8 AS "localizationAutoApproveThreshold",
           tm_enabled AS "tmEnabled",
           tm_similarity_threshold::float8 AS "tmSimilarityThreshold",
           quality_audit_enabled AS "qualityAuditEnabled",
           quality_audit_min_batch_size AS "qualityAuditMinBatchSize",
           max_terms_per_llm_batch AS "maxTermsPerLlmBatch",
           guardrails_lex_mode AS "guardrailsLexMode",
           guardrails_warn_threshold AS "guardrailsWarnThreshold",
           guardrails_warn_count AS "guardrailsWarnCount",
           guardrails_block_count AS "guardrailsBlockCount",
           guardrails_false_positive_count AS "guardrailsFalsePositiveCount",
           guardrails_last_evaluated_at::text AS "guardrailsLastEvaluatedAt"
         FROM lex_shop_settings
         WHERE shop_id = $1
         LIMIT 1`,
        [session.shopId]
      );

      const row = result.rows[0];
      return row ? mapLexShopSettingsRow(row) : null;
    });

    return reply.send(
      successEnvelope(request.id, { settings: settings ?? defaultLexSettings(session.shopId) })
    );
  });

  server.put(
    '/pim/lex/settings',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as Partial<LexShopSettingsDto>;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const base = defaultLexSettings(session.shopId);
      const parsedTargetLangs = parseStringArray(body.targetLangs, base.targetLangs);
      const putBodyRecord =
        request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      const nextGuardrailsLexMode: unknown =
        putBodyRecord['guardrailsLexMode'] ?? base.guardrailsLexMode;
      const nextGuardrailsWarnThreshold: unknown = putBodyRecord['guardrailsWarnThreshold'];
      const nextGuardrailsWarnCount: unknown = putBodyRecord['guardrailsWarnCount'];
      const nextGuardrailsBlockCount: unknown = putBodyRecord['guardrailsBlockCount'];
      const nextGuardrailsFalsePositiveCount: unknown =
        putBodyRecord['guardrailsFalsePositiveCount'];
      const nextGuardrailsLastEvaluatedAtRaw: unknown = putBodyRecord['guardrailsLastEvaluatedAt'];
      const mergedGuardrailsLexMode = parseLexGuardrailsMode(nextGuardrailsLexMode);
      const merged: LexShopSettingsDto = {
        ...base,
        ...body,
        shopId: session.shopId,
        targetLangs: parsedTargetLangs.length > 0 ? parsedTargetLangs : base.targetLangs,
        extractScope: toJsonObject(body.extractScope),
        thresholds: toJsonObject(body.thresholds),
        shardSize: Math.max(100, Math.min(100_000, toNumber(body.shardSize, base.shardSize))),
        retentionDaysFragments: Math.max(
          1,
          Math.min(365, toNumber(body.retentionDaysFragments, base.retentionDaysFragments))
        ),
        retentionDaysOccurrences: Math.max(
          1,
          Math.min(365, toNumber(body.retentionDaysOccurrences, base.retentionDaysOccurrences))
        ),
        retentionDaysContexts: Math.max(
          1,
          Math.min(730, toNumber(body.retentionDaysContexts, base.retentionDaysContexts))
        ),
        enabled: typeof body.enabled === 'boolean' ? body.enabled : base.enabled,
        autoPublishProducts:
          typeof body.autoPublishProducts === 'boolean'
            ? body.autoPublishProducts
            : base.autoPublishProducts,
        autoPublishAttributes:
          typeof body.autoPublishAttributes === 'boolean'
            ? body.autoPublishAttributes
            : base.autoPublishAttributes,
        autoPublishCollections:
          typeof body.autoPublishCollections === 'boolean'
            ? body.autoPublishCollections
            : base.autoPublishCollections,
        sourceLang:
          typeof body.sourceLang === 'string' && body.sourceLang.trim()
            ? body.sourceLang.trim().slice(0, 10)
            : base.sourceLang,
        translationMode: parseLexTranslationMode(body.translationMode ?? base.translationMode),
        consensusEscalationThreshold: clampUnitInterval(
          toNumber(body.consensusEscalationThreshold, base.consensusEscalationThreshold),
          base.consensusEscalationThreshold
        ),
        translationAutoApproveThreshold: clampUnitInterval(
          toNumber(body.translationAutoApproveThreshold, base.translationAutoApproveThreshold),
          base.translationAutoApproveThreshold
        ),
        localizationAutoApproveThreshold: clampUnitInterval(
          toNumber(body.localizationAutoApproveThreshold, base.localizationAutoApproveThreshold),
          base.localizationAutoApproveThreshold
        ),
        tmEnabled: body.tmEnabled === undefined ? base.tmEnabled : Boolean(body.tmEnabled),
        tmSimilarityThreshold: clampUnitInterval(
          toNumber(body.tmSimilarityThreshold, base.tmSimilarityThreshold),
          base.tmSimilarityThreshold
        ),
        qualityAuditEnabled:
          body.qualityAuditEnabled === undefined
            ? base.qualityAuditEnabled
            : Boolean(body.qualityAuditEnabled),
        qualityAuditMinBatchSize: Math.max(
          1,
          Math.min(10_000, toNumber(body.qualityAuditMinBatchSize, base.qualityAuditMinBatchSize))
        ),
        maxTermsPerLlmBatch: Math.max(
          1,
          Math.min(500, toNumber(body.maxTermsPerLlmBatch, base.maxTermsPerLlmBatch))
        ),
        guardrailsLexMode: mergedGuardrailsLexMode,
        guardrailsWarnThreshold: Math.max(
          0,
          Math.min(
            10_000_000,
            toNumber(
              nextGuardrailsWarnThreshold,
              LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.warnThreshold
            )
          )
        ),
        guardrailsWarnCount: Math.max(
          0,
          toNumber(nextGuardrailsWarnCount, LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.warnCount)
        ),
        guardrailsBlockCount: Math.max(
          0,
          toNumber(nextGuardrailsBlockCount, LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.blockCount)
        ),
        guardrailsFalsePositiveCount: Math.max(
          0,
          toNumber(
            nextGuardrailsFalsePositiveCount,
            LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.falsePositiveCount
          )
        ),
        guardrailsLastEvaluatedAt: resolveLexGuardrailsLastEvaluatedAtFromPutBody(
          nextGuardrailsLastEvaluatedAtRaw,
          LEX_SHOP_SETTINGS_GUARDRAILS_DEFAULTS.lastEvaluatedAt
        ),
      };

      const expectedVersion = Math.max(0, toNumber(body.version, 0));

      type PutLexSettingsTxResult =
        | { kind: 'active_lex_run'; runStatus: string }
        | { kind: 'version_conflict' }
        | {
            kind: 'saved';
            settings: LexShopSettingsDto & { version: number };
            previousSettings: Record<string, unknown> | null;
          };

      const putResult = await withTenantContext(session.shopId, async (client) => {
        const activeLexRun = await client.query<{ status: string }>(
          `SELECT status
         FROM lex_runs
         WHERE shop_id = $1
           AND status IN ('pending', 'running', 'paused')
         ORDER BY created_at DESC
         LIMIT 1`,
          [session.shopId]
        );
        if (activeLexRun.rows[0]?.status) {
          return {
            kind: 'active_lex_run',
            runStatus: activeLexRun.rows[0].status,
          } satisfies PutLexSettingsTxResult;
        }

        const current = await client.query<{
          version: number;
          enabled: boolean;
          sourceLang: string;
          targetLangs: string[];
          shardSize: number;
          translationMode: string;
          autoPublishProducts: boolean;
          autoPublishAttributes: boolean;
          autoPublishCollections: boolean;
          tmEnabled: boolean;
          qualityAuditEnabled: boolean;
        }>(
          `SELECT version,
                enabled,
                source_lang AS "sourceLang",
                target_langs AS "targetLangs",
                shard_size AS "shardSize",
                translation_mode AS "translationMode",
                auto_publish_products AS "autoPublishProducts",
                auto_publish_attributes AS "autoPublishAttributes",
                auto_publish_collections AS "autoPublishCollections",
                tm_enabled AS "tmEnabled",
                quality_audit_enabled AS "qualityAuditEnabled"
         FROM lex_shop_settings
         WHERE shop_id = $1
         LIMIT 1`,
          [session.shopId]
        );

        const currentRow = current.rows[0] ?? null;
        const currentVersion = currentRow?.version ?? 0;
        if (currentVersion !== expectedVersion) {
          return { kind: 'version_conflict' } satisfies PutLexSettingsTxResult;
        }

        const previousSettings: Record<string, unknown> | null = currentRow
          ? {
              enabled: currentRow.enabled,
              sourceLang: currentRow.sourceLang,
              targetLangs: currentRow.targetLangs,
              shardSize: currentRow.shardSize,
              translationMode: currentRow.translationMode,
              autoPublishProducts: currentRow.autoPublishProducts,
              autoPublishAttributes: currentRow.autoPublishAttributes,
              autoPublishCollections: currentRow.autoPublishCollections,
              tmEnabled: currentRow.tmEnabled,
              qualityAuditEnabled: currentRow.qualityAuditEnabled,
            }
          : null;

        if (currentVersion === 0) {
          const inserted = await client.query<{ version: number }>(
            `INSERT INTO lex_shop_settings
             (shop_id, version, enabled, source_lang, target_langs, extract_scope, shard_size, thresholds,
              retention_days_fragments, retention_days_occurrences, retention_days_contexts,
              auto_publish_products, auto_publish_attributes, auto_publish_collections,
              translation_mode, consensus_escalation_threshold, translation_auto_approve_threshold,
              localization_auto_approve_threshold, tm_enabled, tm_similarity_threshold,
              quality_audit_enabled, quality_audit_min_batch_size, max_terms_per_llm_batch,
              guardrails_lex_mode, guardrails_warn_threshold, guardrails_warn_count,
              guardrails_block_count, guardrails_false_positive_count, guardrails_last_evaluated_at,
              updated_at)
           VALUES
             ($1, 1, $2, $3, $4::text[], $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18, $19, $20, $21, $22,
              $23, $24, $25, $26, $27, $28::timestamptz,
              now())
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
              merged.translationMode,
              merged.consensusEscalationThreshold,
              merged.translationAutoApproveThreshold,
              merged.localizationAutoApproveThreshold,
              merged.tmEnabled,
              merged.tmSimilarityThreshold,
              merged.qualityAuditEnabled,
              merged.qualityAuditMinBatchSize,
              merged.maxTermsPerLlmBatch,
              merged.guardrailsLexMode,
              merged.guardrailsWarnThreshold,
              merged.guardrailsWarnCount,
              merged.guardrailsBlockCount,
              merged.guardrailsFalsePositiveCount,
              merged.guardrailsLastEvaluatedAt,
            ]
          );
          return {
            kind: 'saved',
            settings: { ...merged, version: inserted.rows[0]?.version ?? 1 },
            previousSettings,
          } satisfies PutLexSettingsTxResult;
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
             translation_mode = $15,
             consensus_escalation_threshold = $16,
             translation_auto_approve_threshold = $17,
             localization_auto_approve_threshold = $18,
             tm_enabled = $19,
             tm_similarity_threshold = $20,
             quality_audit_enabled = $21,
             quality_audit_min_batch_size = $22,
             max_terms_per_llm_batch = $23,
             guardrails_lex_mode = $24,
             guardrails_warn_threshold = $25,
             guardrails_warn_count = $26,
             guardrails_block_count = $27,
             guardrails_false_positive_count = $28,
             guardrails_last_evaluated_at = $29::timestamptz,
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
            merged.translationMode,
            merged.consensusEscalationThreshold,
            merged.translationAutoApproveThreshold,
            merged.localizationAutoApproveThreshold,
            merged.tmEnabled,
            merged.tmSimilarityThreshold,
            merged.qualityAuditEnabled,
            merged.qualityAuditMinBatchSize,
            merged.maxTermsPerLlmBatch,
            merged.guardrailsLexMode,
            merged.guardrailsWarnThreshold,
            merged.guardrailsWarnCount,
            merged.guardrailsBlockCount,
            merged.guardrailsFalsePositiveCount,
            merged.guardrailsLastEvaluatedAt,
          ]
        );

        if (!updated.rows[0]) {
          return { kind: 'version_conflict' } satisfies PutLexSettingsTxResult;
        }

        return {
          kind: 'saved',
          settings: { ...merged, version: updated.rows[0].version },
          previousSettings,
        } satisfies PutLexSettingsTxResult;
      });

      if (putResult.kind === 'active_lex_run') {
        return reply
          .status(409)
          .send(
            errorEnvelope(
              request.id,
              409,
              'ACTIVE_LEX_RUN',
              `Cannot change lexical settings while a pipeline run is active (status: ${putResult.runStatus}). Wait until the run completes or is no longer pending, running, or paused.`
            )
          );
      }

      if (putResult.kind === 'version_conflict') {
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

      const saved = putResult.settings;

      const changedFields: Record<string, { old: unknown; new: unknown }> = {};
      if (putResult.previousSettings) {
        const trackKeys = Object.keys(putResult.previousSettings);
        for (const key of trackKeys) {
          const oldVal = putResult.previousSettings[key];
          const newVal = (saved as Record<string, unknown>)[key];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            changedFields[key] = { old: oldVal, new: newVal };
          }
        }
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
          changedFields,
        },
      });

      await reconcileLexScheduledTasks({
        shopId: session.shopId,
        enabled: saved.enabled,
      }).catch(() => undefined);

      return reply.send(successEnvelope(request.id, { settings: saved }));
    }
  );

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
        pauseReason: string | null;
        currentPhase: string | null;
        startedAt: string | null;
        completedAt: string | null;
        fragmentsCount: NullableCount;
        occurrencesCount: NullableCount;
        termsCount: NullableCount;
        contextsCount: NullableCount;
        senseClustersCount: NullableCount;
        translationsCount: NullableCount;
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
           pause_reason AS "pauseReason",
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
          pauseReason: row.pauseReason,
          currentPhase: isLexPhaseName(row.currentPhase) ? row.currentPhase : null,
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

  server.post(
    '/pim/lex/runs',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as {
        runType?: string;
        sourceScope?: unknown;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const rawRunType = body.runType;
      let runType: LexRunType;
      if (typeof rawRunType === 'string') {
        const trimmed = rawRunType.trim();
        if (trimmed.length > 0) {
          if (LEX_RUN_TYPES.includes(trimmed as LexRunType)) {
            runType = trimmed as LexRunType;
          } else {
            return reply
              .status(400)
              .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'runType invalid'));
          }
        } else {
          runType = 'delta_rebuild';
        }
      } else if (rawRunType == null) {
        runType = 'delta_rebuild';
      } else {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'runType invalid'));
      }
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

        if (runType === 'translate_only') {
          const reuseFragmentsRunId = await findLexReuseFragmentsRunId(
            client,
            session.shopId,
            sourceTables
          );
          if (!reuseFragmentsRunId) {
            return {
              translateOnlyBlocked: true as const,
              reason: 'NO_COMPLETED_RUN_WITH_FRAGMENTS',
            };
          }

          const glossaryRulesSnapshotHash = await computeLexGlossaryRulesSnapshotHash(
            client,
            session.shopId
          );
          const runMetadata = {
            requested_via: 'api',
            translate_only: true,
            reuse_fragments_run_id: reuseFragmentsRunId,
            glossary_rules_snapshot_hash: glossaryRulesSnapshotHash,
          };

          const inserted = await client.query<{ id: string; createdAt: string }>(
            `INSERT INTO lex_runs
             (shop_id, run_type, source_scope, source_snapshot_hash, current_phase, status, metadata, created_by, created_at, updated_at)
           VALUES
             ($1, $2, $3::jsonb, $4, 'translate.candidates', 'pending', $6::jsonb, $5, now(), now())
           RETURNING id, created_at::text AS "createdAt"`,
            [
              session.shopId,
              runType,
              JSON.stringify(sourceScope),
              sourceSnapshotHash,
              session.staffUserId ?? null,
              JSON.stringify(runMetadata),
            ]
          );
          const row = inserted.rows[0]!;

          await insertTranslateOnlyRunShards({
            client,
            shopId: session.shopId,
            runId: row.id,
            reuseFragmentsRunId,
            sourceTables,
            extraShardMetadata: { sourceSnapshotHash },
          });

          return { ...row, conflictRunId: null } as const;
        }

        const glossaryRulesSnapshotHashFull = await computeLexGlossaryRulesSnapshotHash(
          client,
          session.shopId
        );
        const fullRunMetadata = JSON.stringify({
          requested_via: 'api',
          glossary_rules_snapshot_hash: glossaryRulesSnapshotHashFull,
        });

        const inserted = await client.query<{ id: string; createdAt: string }>(
          `INSERT INTO lex_runs
           (shop_id, run_type, source_scope, source_snapshot_hash, current_phase, status, metadata, created_by, created_at, updated_at)
         VALUES
           ($1, $2, $3::jsonb, $4, 'extract.fragments', 'pending', $6::jsonb, $5, now(), now())
         RETURNING id, created_at::text AS "createdAt"`,
          [
            session.shopId,
            runType,
            JSON.stringify(sourceScope),
            sourceSnapshotHash,
            session.staffUserId ?? null,
            fullRunMetadata,
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

      if ('translateOnlyBlocked' in run && run.translateOnlyBlocked) {
        return reply
          .status(409)
          .send(
            errorEnvelope(
              request.id,
              409,
              run.reason,
              'translate_only requires at least one completed lexical run with fragments for the selected source tables. Run a full or delta pipeline first.'
            )
          );
      }

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
          .send(
            errorEnvelope(request.id, 500, 'RUN_CREATE_FAILED', 'Failed to create lexical run')
          );
      }

      const queueJobId = await enqueueLexRunRequestedJob({
        shopId: session.shopId,
        runId: run.id,
        runType,
        triggeredBy: 'manual',
        requestedAt: Date.now(),
        sourceScope,
      });

      await logAuditEvent('lex_run_started', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_runs',
        resourceId: run.id,
        details: {
          runType,
          status: 'pending',
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
    }
  );

  server.get('/pim/lex/runs/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }
    if (!assertLexUuidParam(id, request.id, reply)) return;

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
           pause_reason AS "pauseReason",
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

      const rawRun = runRes.rows[0] ?? null;
      return {
        run: rawRun
          ? {
              ...rawRun,
              currentPhase: isLexPhaseName(rawRun.currentPhase) ? rawRun.currentPhase : null,
            }
          : null,
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

  server.post(
    '/pim/lex/runs/:id/recover',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;

      const result = await recoverLexRun({
        shopId: session.shopId,
        runId: id,
        logger: options.logger,
      });

      if (!result.recovered && result.reason === 'run_not_found') {
        return reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Run not found'));
      }

      return reply.send(
        successEnvelope(request.id, { recovered: result.recovered, reason: result.reason })
      );
    }
  );

  server.post(
    '/pim/lex/runs/:id/cancel',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;

      const cancelled = await withTenantContext(session.shopId, async (client) => {
        const res = await client.query<{ id: string; status: string }>(
          `UPDATE lex_runs
           SET status = 'cancelled',
               completed_at = COALESCE(completed_at, now()),
               updated_at = now()
           WHERE id = $1
             AND shop_id = $2
             AND status IN ('pending', 'running', 'paused')
           RETURNING id, status`,
          [id, session.shopId]
        );
        return res.rows[0] ?? null;
      });

      if (!cancelled) {
        return reply
          .status(404)
          .send(
            errorEnvelope(
              request.id,
              404,
              'NOT_FOUND',
              'Run not found or already in a terminal state'
            )
          );
      }

      await logAuditEvent('lex_run_cancelled', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_runs',
        resourceId: id,
        details: { status: 'cancelled', previousStatus: cancelled.status },
      });

      return reply.send(successEnvelope(request.id, { runId: id, status: 'cancelled' }));
    }
  );

  server.get('/pim/lex/terms', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const {
      q,
      limit: rawLimit,
      cursor: rawCursor,
      status: rawStatus,
      domainCode: rawDomainCode,
      minScore: rawMinScore,
      maxScore: rawMaxScore,
    } = (request.query ?? {}) as {
      q?: string;
      limit?: string;
      cursor?: string;
      status?: string;
      domainCode?: string;
      minScore?: string;
      maxScore?: string;
    };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const statusFilter =
      typeof rawStatus === 'string' && rawStatus.trim().length > 0 ? rawStatus.trim() : null;
    if (statusFilter && statusFilter.length > 20) {
      return reply
        .status(400)
        .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Parametrul status este prea lung'));
    }

    const domainCodeParam =
      typeof rawDomainCode === 'string' && rawDomainCode.trim().length > 0
        ? rawDomainCode.trim()
        : null;
    if (domainCodeParam && domainCodeParam.length > 100) {
      return reply
        .status(400)
        .send(
          errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Parametrul domainCode este prea lung')
        );
    }

    let minScoreFilter: number | null = null;
    if (typeof rawMinScore === 'string' && rawMinScore.trim().length > 0) {
      const n = Number(rawMinScore.trim());
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'Parametrul minScore trebuie să fie un număr între 0 și 1'
            )
          );
      }
      minScoreFilter = n;
    }

    let maxScoreFilter: number | null = null;
    if (typeof rawMaxScore === 'string' && rawMaxScore.trim().length > 0) {
      const n = Number(rawMaxScore.trim());
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'Parametrul maxScore trebuie să fie un număr între 0 și 1'
            )
          );
      }
      maxScoreFilter = n;
    }

    if (minScoreFilter != null && maxScoreFilter != null && minScoreFilter > maxScoreFilter) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Parametrul minScore nu poate fi mai mare decât maxScore'
          )
        );
    }

    const limit = parsePageLimit(rawLimit, 50, 100);
    const cursor = decodeCursor(rawCursor);
    const cursorUpdatedAt =
      typeof cursor?.['updatedAt'] === 'string' ? String(cursor['updatedAt']) : null;
    const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;
    const termSearchPattern = lexTextSearchPattern(q);

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
        occurrencesTotal: NullableCount;
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
         WHERE (t.shop_id = $1 OR t.shop_id IS NULL)
           AND ($2::text IS NULL OR t.canonical_text ILIKE $2 ESCAPE '\\' OR t.normalized_key ILIKE $2 ESCAPE '\\')
           AND ($6::text IS NULL OR t.status = $6)
           AND (
             $7::text IS NULL
             OR ($7 = '__none__' AND t.domain_code IS NULL)
             OR t.domain_code = $7
           )
           AND ($8::numeric IS NULL OR COALESCE(s.score_global::numeric, 0) >= $8::numeric)
           AND ($9::numeric IS NULL OR COALESCE(s.score_global::numeric, 0) <= $9::numeric)
           AND (
             $3::timestamptz IS NULL
             OR t.updated_at < $3::timestamptz
             OR (t.updated_at = $3::timestamptz AND t.id < $4::uuid)
           )
         ORDER BY t.updated_at DESC, t.id DESC
         LIMIT $5`,
        [
          session.shopId,
          termSearchPattern,
          cursorUpdatedAt,
          cursorId,
          limit + 1,
          statusFilter,
          domainCodeParam,
          minScoreFilter,
          maxScoreFilter,
        ]
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
    if (!assertLexUuidParam(id, request.id, reply)) return;

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
        occurrencesTotal: NullableCount;
        scoreGlobal: string | null;
      }>(
        `SELECT
           t.id,
           t.shop_id AS "shopId",
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
           s.score_global AS "scoreGlobal"
         FROM lex_effective_terms t
         LEFT JOIN lex_term_stats s
           ON s.term_id = t.id
          AND s.shop_id = $2
         WHERE t.id = $1
           AND (t.shop_id = $2 OR t.shop_id IS NULL)
         LIMIT 1`,
        [id, session.shopId]
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

      const { occurrencesTotal: occRaw, scoreGlobal: scoreRaw, ...termBase } = term;

      return {
        ...termBase,
        occurrencesTotal: toNumber(occRaw),
        scoreGlobal: toNumberOrNull(scoreRaw),
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

  server.get(
    '/pim/lex/terms/:id/products',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const query = (request.query ?? {}) as { limit?: string; cursor?: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;

      const limit = parsePageLimit(query.limit, 50, 100);
      const cur = decodeCursor(query.cursor);
      const cOcc = toNumber(cur?.['occurrenceCount'], Number.NaN);
      const cPidRaw = typeof cur?.['productId'] === 'string' ? cur['productId'].trim() : '';
      const cPid = isLexCanonicalUuid(cPidRaw) ? cPidRaw : null;
      const useCursor = Number.isFinite(cOcc) && cOcc >= 1 && cPid !== null;

      const page = await withTenantContext(session.shopId, async (client) => {
        const termOk = await client.query(
          `SELECT 1
           FROM lex_terms
           WHERE id = $1
             AND (shop_id = $2 OR shop_id IS NULL)
           LIMIT 1`,
          [id, session.shopId]
        );
        if (!termOk.rows[0]) return null;

        const result = await client.query<{
          productId: string;
          title: string;
          handle: string;
          status: string | null;
          occurrenceCount: number;
        }>(
          `WITH prod_agg AS (
             SELECT
               f.product_id AS product_id,
               COUNT(*)::int AS occurrence_count,
               COALESCE(MAX(sp.title), '') AS title,
               COALESCE(MAX(sp.handle), '') AS handle,
               MAX(sp.status::text) AS status
             FROM lex_term_occurrences o
             INNER JOIN lex_fragments f
                     ON f.id = o.fragment_id
                    AND f.shop_id = o.shop_id
             LEFT JOIN shopify_products sp
                    ON sp.id = f.product_id
                   AND sp.shop_id = o.shop_id
             WHERE o.shop_id = $1
               AND o.term_id = $2
               AND f.product_id IS NOT NULL
             GROUP BY f.product_id
           )
           SELECT
             product_id AS "productId",
             title,
             handle,
             status,
             occurrence_count AS "occurrenceCount"
           FROM prod_agg
           WHERE (
             $3::boolean IS NOT TRUE
             OR occurrence_count < $4::int
             OR (occurrence_count = $4::int AND product_id > $5::uuid)
           )
           ORDER BY occurrence_count DESC, product_id ASC
           LIMIT $6`,
          [session.shopId, id, useCursor, useCursor ? cOcc : 0, useCursor ? cPid : null, limit + 1]
        );

        const pageRows = result.rows.slice(0, limit);
        const items = pageRows;
        return makeCursorPage(
          items,
          result.rows.length > limit && pageRows.at(-1)
            ? encodeCursor({
                occurrenceCount: pageRows.at(-1)!.occurrenceCount,
                productId: pageRows.at(-1)!.productId,
              })
            : null
        );
      });

      if (!page) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Term not found'));
      }

      return reply.send(successEnvelope(request.id, { products: page.items, page }));
    }
  );

  server.patch('/pim/lex/terms/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as LexTermFlagsPatchRequest;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }
    if (!assertLexUuidParam(id, request.id, reply)) return;

    const nextTechnical = typeof body.isTechnical === 'boolean' ? body.isTechnical : undefined;
    const nextProtected = typeof body.isProtected === 'boolean' ? body.isProtected : undefined;
    if (nextTechnical === undefined && nextProtected === undefined) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'At least one of isTechnical, isProtected is required'
          )
        );
    }

    const setFragments: string[] = [];
    const values: unknown[] = [id, session.shopId];
    let nextParamIndex = 3;
    if (nextTechnical !== undefined) {
      setFragments.push(`is_technical = $${nextParamIndex}`);
      values.push(nextTechnical);
      nextParamIndex += 1;
    }
    if (nextProtected !== undefined) {
      setFragments.push(`is_protected = $${nextParamIndex}`);
      values.push(nextProtected);
    }
    setFragments.push('updated_at = now()');

    const updated = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<{
        id: string;
        isTechnical: boolean;
        isProtected: boolean;
      }>(
        `UPDATE lex_terms
           SET ${setFragments.join(', ')}
           WHERE id = $1
             AND (shop_id = $2 OR shop_id IS NULL)
           RETURNING id, is_technical AS "isTechnical", is_protected AS "isProtected"`,
        values
      );
      return result.rows[0] ?? null;
    });

    if (!updated) {
      return reply.status(404).send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Term not found'));
    }

    await logAuditEvent('lex_term_flags_updated', {
      actorType: 'user',
      actorId: session.staffUserId ?? null,
      shopId: session.shopId,
      resourceType: 'lex_terms',
      resourceId: id,
      details: {
        isTechnical: nextTechnical,
        isProtected: nextProtected,
      },
    });

    return reply.send(successEnvelope(request.id, { term: updated }));
  });

  server.get('/pim/lex/clusters/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }
    if (!assertLexUuidParam(id, request.id, reply)) return;

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
         INNER JOIN lex_sense_clusters sc
                 ON sc.id = m.cluster_id
                AND (sc.shop_id = $2 OR sc.shop_id IS NULL)
         JOIN lex_term_contexts c
           ON c.id = m.context_id
          AND c.shop_id = $2
         WHERE m.cluster_id = $1
         ORDER BY m.is_representative DESC, m.similarity_score DESC NULLS LAST, c.updated_at DESC
         LIMIT 50`,
        [id, session.shopId]
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
      if (!assertLexUuidParam(id, request.id, reply)) return;

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

  /* ------------------------------------------------------------------ */
  /*  POST /pim/lex/localizations — create manual translation            */
  /* ------------------------------------------------------------------ */
  server.post(
    '/pim/lex/localizations',
    { preHandler: requireLexReviewSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = (request.body ?? {}) as {
        termId?: string;
        translatedText?: string;
        sourceLang?: string;
        targetLang?: string;
        clusterId?: string | null;
      };

      const { termId, translatedText, sourceLang, targetLang, clusterId } = body;
      if (
        !termId ||
        typeof termId !== 'string' ||
        !translatedText ||
        typeof translatedText !== 'string' ||
        !sourceLang ||
        typeof sourceLang !== 'string' ||
        !targetLang ||
        typeof targetLang !== 'string'
      ) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'VALIDATION_ERROR',
              'termId, translatedText, sourceLang, and targetLang are required.'
            )
          );
      }

      if (!assertLexUuidParam(termId, request.id, reply)) return;
      if (clusterId && !assertLexUuidParam(clusterId, request.id, reply)) return;

      const result = await withTenantContext(session.shopId, async (client) => {
        const termCheck = await client.query<{ id: string }>(
          `SELECT id FROM lex_terms WHERE id = $1 AND shop_id = $2`,
          [termId, session.shopId]
        );
        if (termCheck.rows.length === 0) {
          return { error: 'TERM_NOT_FOUND' as const };
        }

        if (clusterId) {
          const clusterCheck = await client.query<{ id: string }>(
            `SELECT id FROM lex_sense_clusters WHERE id = $1 AND term_id = $2 AND (shop_id = $3 OR shop_id IS NULL)`,
            [clusterId, termId, session.shopId]
          );
          if (clusterCheck.rows.length === 0) {
            return { error: 'CLUSTER_NOT_FOUND' as const };
          }
        }

        await client.query('SAVEPOINT manual_translation');
        try {
          const candidateRes = await client.query<{ id: string }>(
            `INSERT INTO lex_translation_candidates
               (shop_id, term_id, cluster_id, source_lang, target_lang,
                candidate_text, candidate_source, confidence_score, status, rank)
             VALUES ($1, $2, $3, $4, $5, $6, 'manual_entry', 0.9500, 'approved', 1)
             ON CONFLICT (shop_id, term_id, COALESCE(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid), source_lang, target_lang, rank)
             DO UPDATE SET
               candidate_text = EXCLUDED.candidate_text,
               confidence_score = EXCLUDED.confidence_score,
               status = EXCLUDED.status,
               updated_at = now()
             RETURNING id`,
            [session.shopId, termId, clusterId ?? null, sourceLang, targetLang, translatedText]
          );
          const candidateId = candidateRes.rows[0]?.id;

          const translationRes = await client.query<{ id: string }>(
            `INSERT INTO lex_translations
               (shop_id, term_id, cluster_id, source_lang, target_lang,
                translation_text, translation_kind, version, quality_score,
                source_candidate_id, publication_status)
             VALUES ($1, $2, $3, $4, $5, $6, 'manual', 1, 0.9500, $7, 'draft')
             ON CONFLICT (shop_id, term_id, cluster_id, source_lang, target_lang)
             DO UPDATE SET
               translation_text = EXCLUDED.translation_text,
               quality_score = EXCLUDED.quality_score,
               source_candidate_id = EXCLUDED.source_candidate_id,
               version = lex_translations.version + 1,
               updated_at = now()
             RETURNING id`,
            [
              session.shopId,
              termId,
              clusterId ?? null,
              sourceLang,
              targetLang,
              translatedText,
              candidateId,
            ]
          );
          const translationId = translationRes.rows[0]?.id;

          await client.query('RELEASE SAVEPOINT manual_translation');

          await logAuditEvent('lex_manual_translation_created', {
            actorType: 'user',
            actorId: session.staffUserId ?? null,
            shopId: session.shopId,
            resourceType: 'lex_translation',
            resourceId: translationId ?? termId,
            details: {
              termId,
              clusterId: clusterId ?? null,
              translationId: translationId ?? null,
              candidateId,
              sourceLang,
              targetLang,
            },
          });

          return { translationId, candidateId };
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT manual_translation').catch(() => undefined);
          throw err;
        }
      });

      if (result && 'error' in result) {
        const statusMap = { TERM_NOT_FOUND: 404, CLUSTER_NOT_FOUND: 404 } as const;
        const code = statusMap[result.error] ?? 400;
        return reply.status(code).send(errorEnvelope(request.id, code, result.error, result.error));
      }

      return reply.status(201).send(successEnvelope(request.id, result));
    }
  );

  /* ------------------------------------------------------------------ */
  /*  PATCH /pim/lex/localizations/:id — edit manual translation         */
  /* ------------------------------------------------------------------ */
  server.patch(
    '/pim/lex/localizations/:id',
    { preHandler: requireLexReviewSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;

      const body = (request.body ?? {}) as {
        translatedText?: string;
        notes?: string;
      };

      if (!body.translatedText || typeof body.translatedText !== 'string') {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'VALIDATION_ERROR', 'translatedText is required.'));
      }

      const result = await withTenantContext(session.shopId, async (client) => {
        const existing = await client.query<{
          id: string;
          isLocked: boolean;
          sourceCandidateId: string | null;
          version: number;
        }>(
          `SELECT id, is_locked AS "isLocked", source_candidate_id AS "sourceCandidateId", version
           FROM lex_translations
           WHERE id = $1 AND shop_id = $2`,
          [id, session.shopId]
        );

        const existingRow = existing.rows[0];
        if (!existingRow) {
          return { error: 'NOT_FOUND' as const };
        }
        if (existingRow.isLocked) {
          return { error: 'CONFLICT_LOCKED' as const };
        }

        await client.query('SAVEPOINT edit_translation');
        try {
          await client.query(
            `UPDATE lex_translations
             SET translation_text = $1,
                 version = version + 1,
                 updated_at = now()
             WHERE id = $2 AND shop_id = $3`,
            [body.translatedText, id, session.shopId]
          );

          if (existingRow.sourceCandidateId && body.notes) {
            await client.query(
              `UPDATE lex_translation_candidates
               SET evidence = jsonb_set(COALESCE(evidence, '{}'::jsonb), '{manual_notes}', $1::jsonb),
                   updated_at = now()
               WHERE id = $2 AND shop_id = $3`,
              [JSON.stringify(body.notes), existingRow.sourceCandidateId, session.shopId]
            );
          }

          await client.query('RELEASE SAVEPOINT edit_translation');

          await logAuditEvent('lex_manual_translation_updated', {
            actorType: 'user',
            actorId: session.staffUserId ?? null,
            shopId: session.shopId,
            resourceType: 'lex_translation',
            resourceId: id,
            details: {
              newVersion: existingRow.version + 1,
            },
          });

          return { updated: true, version: existingRow.version + 1 };
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT edit_translation').catch(() => undefined);
          throw err;
        }
      });

      if (result && 'error' in result) {
        if (result.error === 'NOT_FOUND') {
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Translation not found'));
        }
        if (result.error === 'CONFLICT_LOCKED') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'CONFLICT',
                'Translation is locked and cannot be edited.'
              )
            );
        }
      }

      return reply.send(successEnvelope(request.id, result));
    }
  );

  server.get('/pim/lex/review', { preHandler: requireLexReviewSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as {
      status?: string;
      severity?: string;
      entityType?: string;
      q?: string;
      limit?: string;
      cursor?: string;
    };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const statusRaw = typeof query.status === 'string' ? query.status.trim() : '';
    const statusFilter = statusRaw.length > 0 ? statusRaw : null;
    if (statusFilter && !(LEX_REVIEW_STATUSES as readonly string[]).includes(statusFilter)) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Parametrul status nu este o valoare acceptată pentru review'
          )
        );
    }

    const severityRaw = typeof query.severity === 'string' ? query.severity.trim() : '';
    const severityFilter = severityRaw.length > 0 ? severityRaw : null;
    if (severityFilter && !(LEX_REVIEW_SEVERITIES as readonly string[]).includes(severityFilter)) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Parametrul severity nu este o valoare acceptată'
          )
        );
    }

    const entityTypeRaw = typeof query.entityType === 'string' ? query.entityType.trim() : '';
    const entityTypeFilter = entityTypeRaw.length > 0 ? entityTypeRaw : null;
    if (entityTypeFilter && !(LEX_ENTITY_TYPES as readonly string[]).includes(entityTypeFilter)) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Parametrul entityType nu este o valoare acceptată'
          )
        );
    }

    const reviewSearchPattern = lexTextSearchPattern(query.q);

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
           AND ($7::text IS NULL OR severity = $7)
           AND ($8::text IS NULL OR entity_type = $8)
           AND (
             $9::text IS NULL
             OR review_reason ILIKE $9 ESCAPE '\\'
             OR COALESCE(notes, '') ILIKE $9 ESCAPE '\\'
             OR entity_id::text ILIKE $9 ESCAPE '\\'
           )
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
          statusFilter,
          Number.isFinite(cursorPriority) ? cursorPriority : null,
          cursorCreatedAt,
          cursorId,
          limit + 1,
          severityFilter,
          entityTypeFilter,
          reviewSearchPattern,
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

  server.post(
    '/pim/lex/review/bulk-decision',
    { preHandler: requireLexReviewSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as {
        decisions?: unknown;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      if (!Array.isArray(body.decisions)) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'decisions must be a non-empty array')
          );
      }

      if (body.decisions.length === 0) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'decisions must not be empty'));
      }

      if (body.decisions.length > LEX_BULK_REVIEW_DECISION_MAX_ITEMS) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              `At most ${LEX_BULK_REVIEW_DECISION_MAX_ITEMS} review items per bulk request`
            )
          );
      }

      const seen = new Set<string>();
      const items: {
        reviewItemId: string;
        expectedVersion: number;
        decisionType: 'approve' | 'reject';
        notes: string | null;
      }[] = [];

      for (const raw of body.decisions) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return reply
            .status(400)
            .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid decision entry'));
        }
        const entry = raw as Record<string, unknown>;
        let reviewItemId = '';
        if (typeof entry['reviewItemId'] === 'string') {
          reviewItemId = entry['reviewItemId'].trim();
        } else if (typeof entry['id'] === 'string') {
          reviewItemId = entry['id'].trim();
        }
        if (!reviewItemId) {
          return reply
            .status(400)
            .send(
              errorEnvelope(
                request.id,
                400,
                'BAD_REQUEST',
                'Each decision needs a valid reviewItemId'
              )
            );
        }
        if (!assertLexUuidParam(reviewItemId, request.id, reply)) return;
        if (seen.has(reviewItemId)) continue;
        seen.add(reviewItemId);

        const decisionType = entry['decisionType'];
        if (decisionType !== 'approve' && decisionType !== 'reject') {
          return reply
            .status(400)
            .send(
              errorEnvelope(
                request.id,
                400,
                'BAD_REQUEST',
                'decisionType must be approve or reject for bulk decisions'
              )
            );
        }

        const expectedVersion = toNumber(entry['expectedVersion'], Number.NaN);
        if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
          return reply
            .status(400)
            .send(
              errorEnvelope(
                request.id,
                400,
                'BAD_REQUEST',
                'expectedVersion is required per decision'
              )
            );
        }

        items.push({
          reviewItemId,
          expectedVersion,
          decisionType,
          notes: normalizeLexOptionalNotes(entry['notes']),
        });
      }

      if (items.length === 0) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'No valid decisions after deduplication')
          );
      }

      const result = await bulkDecideLexReviewItems({
        shopId: session.shopId,
        actorId: session.staffUserId ?? null,
        items,
      });

      const approvedTranslationIds = result.succeeded
        .filter((s) => s.entityType === 'translation')
        .map((s) => s.entityId);
      if (approvedTranslationIds.length > 0) {
        syncLexTranslationSourceEmbeddings({
          shopId: session.shopId,
          translationIds: approvedTranslationIds,
          env: options.env,
          logger: options.logger,
        }).catch(() => undefined);
      }

      await logAuditEvent('lex_review_bulk_decision', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_review_items',
        resourceId: null,
        details: {
          decidedBy: session.staffUserId ?? null,
          requested: items.length,
          succeeded: result.succeeded.length,
          failed: result.failed.length,
          failedCodes: result.failed.map((f) => f.code),
        },
      });

      return reply.send(
        successEnvelope(request.id, {
          ...result,
          totals: {
            requested: items.length,
            succeeded: result.succeeded.length,
            failed: result.failed.length,
          },
        })
      );
    }
  );

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
      if (!assertLexUuidParam(id, request.id, reply)) return;

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
      if (!assertLexUuidParam(id, request.id, reply)) return;

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
            notes: normalizeLexOptionalNotes(body.notes),
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
        if (error instanceof Error && error.message === 'review_item_already_decided') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'REVIEW_ITEM_ALREADY_DECIDED',
                'Review item is no longer pending or in review'
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
      if (!assertLexUuidParam(id, request.id, reply)) return;

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
            notes: normalizeLexOptionalNotes(body.notes),
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
        if (error instanceof Error && error.message === 'review_item_already_decided') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'REVIEW_ITEM_ALREADY_DECIDED',
                'Review item is no longer pending or in review'
              )
            );
        }
        if (error instanceof Error && error.message === 'assign_requires_assign_endpoint') {
          return reply
            .status(400)
            .send(
              errorEnvelope(
                request.id,
                400,
                'BAD_REQUEST',
                'Use POST /pim/lex/review/:id/assign for assignment'
              )
            );
        }
        if (error instanceof Error && error.message === 'merge_terms_target_not_found') {
          return reply
            .status(404)
            .send(
              errorEnvelope(
                request.id,
                404,
                'NOT_FOUND',
                'Merge target term does not exist for this shop'
              )
            );
        }
        if (error instanceof Error && error.message === 'merge_terms_source_not_found') {
          return reply
            .status(404)
            .send(
              errorEnvelope(
                request.id,
                404,
                'NOT_FOUND',
                'Merge source term does not exist for this shop'
              )
            );
        }
        if (error instanceof Error && error.message === 'split_cluster_contexts_not_in_cluster') {
          return reply
            .status(400)
            .send(
              errorEnvelope(
                request.id,
                400,
                'BAD_REQUEST',
                'One or more context IDs do not belong to this cluster'
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

      if (body.decisionType === 'approve' && decision.entityType === 'translation') {
        syncLexTranslationSourceEmbeddings({
          shopId: session.shopId,
          translationIds: [decision.entityId],
          env: options.env,
          logger: options.logger,
        }).catch(() => undefined);
      }

      await logAuditEvent('lex_review_decision', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_review_items',
        resourceId: id,
        details: {
          reviewItemId: id,
          decidedBy: session.staffUserId ?? null,
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
    const query = (request.query ?? {}) as { q?: string; limit?: string; cursor?: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const qRaw = typeof query.q === 'string' ? query.q.trim() : '';
    if (qRaw.length > 200) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Parametrul q este prea lung (max 200 caractere)'
          )
        );
    }
    const limit = parsePageLimit(query.limit, 50, 100);
    const glossarySearchPattern = lexTextSearchPattern(qRaw);
    const cur = decodeCursor(query.cursor);
    const cId = typeof cur?.['id'] === 'string' ? String(cur['id']) : null;
    const cUpdatedAt = typeof cur?.['updatedAt'] === 'string' ? String(cur['updatedAt']) : null;
    const cPriority = toNumber(cur?.['priority'], Number.NaN);
    const cLocked = typeof cur?.['isLocked'] === 'boolean' ? cur['isLocked'] : null;
    const useCursor = Boolean(
      cId && cUpdatedAt && Number.isFinite(cPriority) && typeof cLocked === 'boolean'
    );

    const page = await withTenantContext(session.shopId, async (client) => {
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
        updatedAt: string;
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
           is_active AS "isActive",
           updated_at::text AS "updatedAt"
         FROM lex_effective_glossary_entries
         WHERE (shop_id = $1 OR shop_id IS NULL)
           AND ($2::text IS NULL OR source_text ILIKE $2 ESCAPE '\\' OR target_text ILIKE $2 ESCAPE '\\')
           AND (
             NOT $3::boolean
             OR (
               (is_locked < $4::boolean)
               OR (is_locked = $4::boolean AND priority > $5::int)
               OR (
                 is_locked = $4::boolean
                 AND priority = $5::int
                 AND updated_at::timestamptz < $6::timestamptz
               )
               OR (
                 is_locked = $4::boolean
                 AND priority = $5::int
                 AND updated_at::timestamptz = $6::timestamptz
                 AND id < $7::uuid
               )
             )
           )
         ORDER BY is_locked DESC, priority ASC, updated_at DESC, id DESC
         LIMIT $8`,
        [
          session.shopId,
          glossarySearchPattern,
          useCursor,
          cLocked,
          cPriority,
          cUpdatedAt,
          cId,
          limit + 1,
        ]
      );

      const pageRows = result.rows.slice(0, limit);
      const items = pageRows.map(
        ({ updatedAt: _u, ...row }): LexGlossaryEntryDto => ({
          ...row,
        })
      );
      const last = pageRows.at(-1);
      return makeCursorPage(
        items,
        result.rows.length > limit && last
          ? encodeCursor({
              isLocked: last.isLocked,
              priority: last.priority,
              updatedAt: last.updatedAt,
              id: last.id,
            })
          : null
      );
    });

    return reply.send(successEnvelope(request.id, { glossary: page.items, page }));
  });

  server.post(
    '/pim/lex/glossary',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as Partial<LexGlossaryEntryDto>;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
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
        typeof body.sourceLang === 'string' && body.sourceLang.trim()
          ? body.sourceLang.trim()
          : 'ro';
      const targetLang =
        typeof body.targetLang === 'string' && body.targetLang.trim()
          ? body.targetLang.trim()
          : 'en';
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
    }
  );

  server.patch(
    '/pim/lex/glossary/:id',
    { preHandler: requireLexSettingsSession },
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
      if (!assertLexUuidParam(id, request.id, reply)) return;
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
            body.priority == null
              ? null
              : Math.max(1, Math.min(1000, toNumber(body.priority, 100))),
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

  server.delete(
    '/pim/lex/glossary/:id',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const query = (request.query ?? {}) as { expectedVersion?: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;
      const expectedVersion = toNumber(query.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'expectedVersion query parameter is required'
            )
          );
      }

      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ id: string; version: number }>(
          `UPDATE lex_glossary_entries
           SET is_active = false,
               version = version + 1,
               updated_at = now()
           WHERE id = $1
             AND shop_id = $2
             AND version = $3
           RETURNING id, version`,
          [id, session.shopId, expectedVersion]
        );
        if (result.rows[0]) return { status: 'ok' as const, row: result.rows[0] };
        const exists = await client.query<{ one: number }>(
          `SELECT 1 AS one FROM lex_glossary_entries WHERE id = $1 AND shop_id = $2`,
          [id, session.shopId]
        );
        if (!exists.rows[0]) return { status: 'not_found' as const };
        return { status: 'conflict' as const };
      });

      if (updated.status === 'not_found') {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Glossary entry not found'));
      }
      if (updated.status === 'conflict') {
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

      await logAuditEvent('lex_glossary_deleted', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_glossary_entries',
        resourceId: id,
        details: { soft: true, version: updated.row.version },
      });

      return reply.send(
        successEnvelope(request.id, {
          deleted: true,
          id: updated.row.id,
          version: updated.row.version,
        })
      );
    }
  );

  server.get('/pim/lex/glossary/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }
    if (!assertLexUuidParam(id, request.id, reply)) return;

    const entry = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query(
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
         WHERE id = $1
           AND (shop_id = $2 OR shop_id IS NULL)`,
        [id, session.shopId]
      );
      return result.rows[0] as LexGlossaryEntryDto | undefined;
    });

    if (!entry) {
      return reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Glossary entry not found'));
    }

    return reply.send(successEnvelope(request.id, { entry }));
  });

  server.get('/pim/lex/rules', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { limit?: string; cursor?: string };
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));

    const limit = parsePageLimit(query.limit, 50, 100);
    const cursor = decodeCursor(query.cursor);
    const cursorUpdatedAt =
      typeof cursor?.['updatedAt'] === 'string' ? String(cursor['updatedAt']) : null;
    const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;

    const page = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<LexTranslationRuleDto & { updatedAt: string }>(
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
           is_active AS "isActive",
           updated_at::text AS "updatedAt"
         FROM lex_translation_rules
         WHERE (shop_id = $1 OR shop_id IS NULL)
           AND (
             $2::timestamptz IS NULL
             OR updated_at < $2::timestamptz
             OR (updated_at = $2::timestamptz AND id < $3::uuid)
           )
         ORDER BY updated_at DESC, id DESC
         LIMIT $4`,
        [session.shopId, cursorUpdatedAt, cursorId, limit + 1]
      );

      const pageRows = result.rows.slice(0, limit);
      const items: LexTranslationRuleDto[] = pageRows.map(({ updatedAt: _u, ...row }) => row);
      const last = pageRows.at(-1);
      return makeCursorPage(
        items,
        result.rows.length > limit && last
          ? encodeCursor({
              id: last.id,
              updatedAt: last.updatedAt,
            })
          : null
      );
    });

    return reply.send(successEnvelope(request.id, { rules: page.items, page }));
  });

  server.post(
    '/pim/lex/rules',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as Partial<LexTranslationRuleDto>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));

      const ruleName = typeof body.ruleName === 'string' ? body.ruleName.trim() : '';
      const matchTerm = typeof body.matchTerm === 'string' ? body.matchTerm.trim() : '';
      const targetTranslation =
        typeof body.targetTranslation === 'string' ? body.targetTranslation.trim() : '';
      if (
        !lexRequireNonEmptyBodyFields(request.id, reply, { ruleName, matchTerm, targetTranslation })
      )
        return;

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
            ruleName,
            body.sourceLang ?? 'ro',
            body.targetLang ?? 'en',
            matchTerm,
            body.domainCode ?? null,
            targetTranslation,
            Math.max(1, Math.min(1000, toNumber(body.priority, 100))),
            body.isActive !== false,
            session.staffUserId ?? null,
          ]
        );
        return result.rows[0] ?? null;
      });

      if (!inserted?.id) {
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'CREATE_FAILED', 'Failed to create translation rule')
          );
      }

      await logAuditEvent('lex_translation_rule_created', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_translation_rules',
        resourceId: inserted.id,
        details: { ruleName, matchTerm, version: inserted.version },
      });

      return reply.status(201).send(successEnvelope(request.id, inserted));
    }
  );

  server.patch(
    '/pim/lex/rules/:id',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexTranslationRuleDto> & {
        expectedVersion?: number;
      };
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      if (!assertLexUuidParam(id, request.id, reply)) return;
      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }

      if (!lexRejectEmptyPatchString(request.id, reply, 'ruleName', body.ruleName)) return;
      if (!lexRejectEmptyPatchString(request.id, reply, 'matchTerm', body.matchTerm)) return;
      if (
        !lexRejectEmptyPatchString(request.id, reply, 'targetTranslation', body.targetTranslation)
      )
        return;

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
            typeof body.ruleName === 'string' ? body.ruleName.trim() || null : null,
            typeof body.matchTerm === 'string' ? body.matchTerm.trim() || null : null,
            body.domainCode ?? null,
            typeof body.targetTranslation === 'string'
              ? body.targetTranslation.trim() || null
              : null,
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

      await logAuditEvent('lex_translation_rule_updated', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_translation_rules',
        resourceId: updated.id,
        details: { version: updated.version },
      });

      return reply.send(successEnvelope(request.id, updated));
    }
  );

  server.delete(
    '/pim/lex/rules/:id',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const query = (request.query ?? {}) as { expectedVersion?: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;
      const expectedVersion = toNumber(query.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'expectedVersion query parameter is required'
            )
          );
      }

      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ id: string; version: number }>(
          `UPDATE lex_translation_rules
           SET is_active = false,
               version = version + 1,
               updated_at = now()
           WHERE id = $1
             AND shop_id = $2
             AND version = $3
           RETURNING id, version`,
          [id, session.shopId, expectedVersion]
        );
        if (result.rows[0]) return { status: 'ok' as const, row: result.rows[0] };
        const exists = await client.query<{ one: number }>(
          `SELECT 1 AS one FROM lex_translation_rules WHERE id = $1 AND shop_id = $2`,
          [id, session.shopId]
        );
        if (!exists.rows[0]) return { status: 'not_found' as const };
        return { status: 'conflict' as const };
      });

      if (updated.status === 'not_found') {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Translation rule not found'));
      }
      if (updated.status === 'conflict') {
        return reply
          .status(409)
          .send(
            errorEnvelope(request.id, 409, 'VERSION_CONFLICT', 'Rule changed since you loaded it')
          );
      }

      await logAuditEvent('lex_translation_rule_deleted', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_translation_rules',
        resourceId: id,
        details: { soft: true, version: updated.row.version },
      });

      return reply.send(
        successEnvelope(request.id, {
          deleted: true,
          id: updated.row.id,
          version: updated.row.version,
        })
      );
    }
  );

  server.get('/pim/lex/rules/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }
    if (!assertLexUuidParam(id, request.id, reply)) return;

    const rule = await withTenantContext(session.shopId, async (client) => {
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
         WHERE id = $1
           AND (shop_id = $2 OR shop_id IS NULL)`,
        [id, session.shopId]
      );
      return result.rows[0];
    });

    if (!rule) {
      return reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Translation rule not found'));
    }

    return reply.send(successEnvelope(request.id, { rule }));
  });

  server.get('/pim/lex/profiles', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { limit?: string; cursor?: string };
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const limit = parsePageLimit(query.limit, 50, 100);
    const cursor = decodeCursor(query.cursor);
    const cursorUpdatedAt =
      typeof cursor?.['updatedAt'] === 'string' ? String(cursor['updatedAt']) : null;
    const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;

    const page = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<LexDomainProfileDto & { updatedAt: string }>(
        `SELECT
           id,
           shop_id AS "shopId",
           domain_code AS "domainCode",
           name_ro AS "nameRo",
           name_en AS "nameEn",
           description,
           version,
           is_active AS "isActive",
           updated_at::text AS "updatedAt"
         FROM lex_domain_profiles
         WHERE (shop_id = $1 OR shop_id IS NULL)
           AND (
             $2::timestamptz IS NULL
             OR updated_at < $2::timestamptz
             OR (updated_at = $2::timestamptz AND id < $3::uuid)
           )
         ORDER BY updated_at DESC, id DESC
         LIMIT $4`,
        [session.shopId, cursorUpdatedAt, cursorId, limit + 1]
      );

      const pageRows = result.rows.slice(0, limit);
      const items: LexDomainProfileDto[] = pageRows.map(({ updatedAt: _u, ...row }) => row);
      const last = pageRows.at(-1);
      return makeCursorPage(
        items,
        result.rows.length > limit && last
          ? encodeCursor({ id: last.id, updatedAt: last.updatedAt })
          : null
      );
    });
    return reply.send(successEnvelope(request.id, { profiles: page.items, page }));
  });

  server.post(
    '/pim/lex/profiles',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as Partial<LexDomainProfileDto>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));

      const domainCode = typeof body.domainCode === 'string' ? body.domainCode.trim() : '';
      const nameRo = typeof body.nameRo === 'string' ? body.nameRo.trim() : '';
      if (!lexRequireNonEmptyBodyFields(request.id, reply, { domainCode, nameRo })) return;

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
            domainCode,
            nameRo,
            body.nameEn ?? null,
            body.description ?? null,
            body.isActive !== false,
          ]
        );
        return result.rows[0] ?? null;
      });

      if (!inserted?.id) {
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'CREATE_FAILED', 'Failed to create domain profile'));
      }

      await logAuditEvent('lex_domain_profile_created', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_domain_profiles',
        resourceId: inserted.id,
        details: { domainCode, version: inserted.version },
      });

      return reply.status(201).send(successEnvelope(request.id, inserted));
    }
  );

  server.patch(
    '/pim/lex/profiles/:id',
    { preHandler: requireLexSettingsSession },
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
      if (!assertLexUuidParam(id, request.id, reply)) return;
      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }
      if (!lexRejectEmptyPatchString(request.id, reply, 'nameRo', body.nameRo)) return;

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
            typeof body.nameRo === 'string' ? body.nameRo.trim() || null : null,
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

      await logAuditEvent('lex_domain_profile_updated', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_domain_profiles',
        resourceId: updated.id,
        details: { version: updated.version },
      });

      return reply.send(successEnvelope(request.id, updated));
    }
  );

  server.delete(
    '/pim/lex/profiles/:id',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const query = (request.query ?? {}) as { expectedVersion?: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;
      const expectedVersion = toNumber(query.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'expectedVersion query parameter is required'
            )
          );
      }

      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ id: string; version: number }>(
          `UPDATE lex_domain_profiles
           SET is_active = false,
               version = version + 1,
               updated_at = now()
           WHERE id = $1
             AND shop_id = $2
             AND version = $3
           RETURNING id, version`,
          [id, session.shopId, expectedVersion]
        );
        if (result.rows[0]) return { status: 'ok' as const, row: result.rows[0] };
        const exists = await client.query<{ one: number }>(
          `SELECT 1 AS one FROM lex_domain_profiles WHERE id = $1 AND shop_id = $2`,
          [id, session.shopId]
        );
        if (!exists.rows[0]) return { status: 'not_found' as const };
        return { status: 'conflict' as const };
      });

      if (updated.status === 'not_found') {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Domain profile not found'));
      }
      if (updated.status === 'conflict') {
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
      }

      await logAuditEvent('lex_domain_profile_deleted', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_domain_profiles',
        resourceId: id,
        details: { soft: true, version: updated.row.version },
      });

      return reply.send(
        successEnvelope(request.id, {
          deleted: true,
          id: updated.row.id,
          version: updated.row.version,
        })
      );
    }
  );

  server.get('/pim/lex/profiles/:id', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const { id } = request.params as { id: string };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }
    if (!assertLexUuidParam(id, request.id, reply)) return;

    const profile = await withTenantContext(session.shopId, async (client) => {
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
         WHERE id = $1
           AND (shop_id = $2 OR shop_id IS NULL)`,
        [id, session.shopId]
      );
      return result.rows[0];
    });

    if (!profile) {
      return reply
        .status(404)
        .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Domain profile not found'));
    }

    return reply.send(successEnvelope(request.id, { profile }));
  });

  server.get('/pim/lex/stopwords', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { limit?: string; cursor?: string };
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const limit = parsePageLimit(query.limit, 50, 100);
    const cursor = decodeCursor(query.cursor);
    const cursorUpdatedAt =
      typeof cursor?.['updatedAt'] === 'string' ? String(cursor['updatedAt']) : null;
    const cursorId = typeof cursor?.['id'] === 'string' ? String(cursor['id']) : null;

    const page = await withTenantContext(session.shopId, async (client) => {
      const result = await client.query<LexStopwordDto & { updatedAt: string }>(
        `SELECT
           id,
           shop_id AS "shopId",
           locale,
           word,
           word_type AS "wordType",
           priority,
           version,
           is_active AS "isActive",
           updated_at::text AS "updatedAt"
         FROM lex_stopwords
         WHERE (shop_id = $1 OR shop_id IS NULL)
           AND (
             $2::timestamptz IS NULL
             OR updated_at < $2::timestamptz
             OR (updated_at = $2::timestamptz AND id < $3::uuid)
           )
         ORDER BY updated_at DESC, id DESC
         LIMIT $4`,
        [session.shopId, cursorUpdatedAt, cursorId, limit + 1]
      );

      const pageRows = result.rows.slice(0, limit);
      const items: LexStopwordDto[] = pageRows.map(({ updatedAt: _u, ...row }) => row);
      const last = pageRows.at(-1);
      return makeCursorPage(
        items,
        result.rows.length > limit && last
          ? encodeCursor({ id: last.id, updatedAt: last.updatedAt })
          : null
      );
    });
    return reply.send(successEnvelope(request.id, { stopwords: page.items, page }));
  });

  server.post(
    '/pim/lex/stopwords',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as Partial<LexStopwordDto>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));

      const locale =
        typeof body.locale === 'string' && body.locale.trim() ? body.locale.trim() : 'ro';
      const word = typeof body.word === 'string' ? body.word.trim() : '';
      if (!lexRequireNonEmptyBodyFields(request.id, reply, { word })) return;

      const inserted = await withTenantContext(session.shopId, async (client) => {
        const isActive = body.isActive !== false;
        const result = await client.query<{ id: string; version: number }>(
          `INSERT INTO lex_stopwords
           (shop_id, locale, word, word_type, priority, version, is_active, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, 1, $6, now(), now())
         RETURNING id, version`,
          [
            session.shopId,
            locale,
            word,
            body.wordType ?? 'noise',
            Math.max(1, Math.min(1000, toNumber(body.priority, 100))),
            isActive,
          ]
        );
        const row = result.rows[0] ?? null;
        if (row && isActive) {
          await reconcileLexStopwordTerms({
            client: client as LexTenantClient,
            shopId: session.shopId,
            word,
          });
        }
        return row;
      });

      if (!inserted?.id) {
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'CREATE_FAILED', 'Failed to create stopword'));
      }

      await logAuditEvent('lex_stopword_created', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_stopwords',
        resourceId: inserted.id,
        details: { word, locale, version: inserted.version },
      });

      return reply.status(201).send(successEnvelope(request.id, inserted));
    }
  );

  server.patch(
    '/pim/lex/stopwords/:id',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexStopwordDto> & { expectedVersion?: number };
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      if (!assertLexUuidParam(id, request.id, reply)) return;
      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }
      if (!lexRejectEmptyPatchString(request.id, reply, 'word', body.word)) return;

      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          version: number;
          word: string;
          isActive: boolean;
        }>(
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
         RETURNING id, version, word, is_active AS "isActive"`,
          [
            id,
            session.shopId,
            typeof body.word === 'string' ? body.word.trim() || null : null,
            body.wordType ?? null,
            body.priority ?? null,
            typeof body.isActive === 'boolean' ? body.isActive : null,
            expectedVersion,
          ]
        );
        const row = result.rows[0] ?? null;
        if (row && typeof body.word === 'string' && body.word.trim().length > 0 && row.isActive) {
          await reconcileLexStopwordTerms({
            client: client as LexTenantClient,
            shopId: session.shopId,
            word: row.word,
          });
        }
        return row;
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

      await logAuditEvent('lex_stopword_updated', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_stopwords',
        resourceId: updated.id,
        details: { version: updated.version },
      });

      return reply.send(successEnvelope(request.id, updated));
    }
  );

  server.delete(
    '/pim/lex/stopwords/:id',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const query = (request.query ?? {}) as { expectedVersion?: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;
      const expectedVersion = toNumber(query.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'expectedVersion query parameter is required'
            )
          );
      }

      const updated = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ id: string; version: number; word: string }>(
          `UPDATE lex_stopwords
           SET is_active = false,
               version = version + 1,
               updated_at = now()
           WHERE id = $1
             AND shop_id = $2
             AND version = $3
           RETURNING id, version, word`,
          [id, session.shopId, expectedVersion]
        );
        if (result.rows[0]) return { status: 'ok' as const, row: result.rows[0] };
        const exists = await client.query<{ one: number }>(
          `SELECT 1 AS one FROM lex_stopwords WHERE id = $1 AND shop_id = $2`,
          [id, session.shopId]
        );
        if (!exists.rows[0]) return { status: 'not_found' as const };
        return { status: 'conflict' as const };
      });

      if (updated.status === 'not_found') {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Stopword not found'));
      }
      if (updated.status === 'conflict') {
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
      }

      await logAuditEvent('lex_stopword_deleted', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_stopwords',
        resourceId: id,
        details: { soft: true, version: updated.row.version, word: updated.row.word },
      });

      return reply.send(
        successEnvelope(request.id, {
          deleted: true,
          id: updated.row.id,
          version: updated.row.version,
        })
      );
    }
  );

  server.get(
    '/pim/lex/stopwords/:id',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;

      const stopword = await withTenantContext(session.shopId, async (client) => {
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
         WHERE id = $1
           AND (shop_id = $2 OR shop_id IS NULL)`,
          [id, session.shopId]
        );
        return result.rows[0];
      });

      if (!stopword) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Stopword not found'));
      }

      return reply.send(successEnvelope(request.id, { stopword }));
    }
  );

  server.get('/pim/lex/governance', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as { status?: string; limit?: string; cursor?: string };
    if (!session)
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    const limit = parsePageLimit(query.limit, 50, 100);
    const cur = decodeCursor(query.cursor);
    const cursorCreatedAt =
      typeof cur?.['createdAt'] === 'string' ? String(cur['createdAt']) : null;
    const cursorId = typeof cur?.['id'] === 'string' ? String(cur['id']) : null;

    const { requests, nextPageCursor } = await listLexGovernanceRequests({
      shopId: session.shopId,
      status: query.status ?? null,
      limit,
      cursorCreatedAt,
      cursorId,
    });
    const page = makeCursorPage(requests, nextPageCursor ? encodeCursor(nextPageCursor) : null);
    return reply.send(successEnvelope(request.id, { requests: page.items, page }));
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
      if (!assertLexUuidParam(id, request.id, reply)) return;
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

  server.post(
    '/pim/lex/governance',
    { preHandler: requireLexGovernanceSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const body = (request.body ?? {}) as {
        entityType?: LexGovernanceEntityType;
        targetId?: string | null;
        title?: string | null;
        notes?: string | null;
        payload?: Record<string, unknown>;
      };
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
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
        notes: normalizeLexOptionalNotes(body.notes),
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
    }
  );

  server.patch(
    '/pim/lex/governance/:id',
    { preHandler: requireLexGovernanceSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        expectedVersion?: unknown;
        payload?: unknown;
        title?: string | null;
        notes?: string | null;
      };
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      if (!assertLexUuidParam(id, request.id, reply)) return;
      if (body.payload === undefined || body.payload === null || typeof body.payload !== 'object') {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'payload must be a JSON object'));
      }
      if (Array.isArray(body.payload)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'payload must be a JSON object'));
      }
      const expectedVersion = toNumber(body.expectedVersion, Number.NaN);
      if (!Number.isFinite(expectedVersion)) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'expectedVersion is required'));
      }
      try {
        const updateParams: {
          shopId: string;
          requestId: string;
          actorId: string | null;
          expectedVersion: number;
          payload: Record<string, unknown>;
          title?: string | null;
          notes?: string | null;
        } = {
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion,
          payload: toJsonObject(body.payload),
        };
        if (body.title !== undefined) {
          updateParams.title = typeof body.title === 'string' ? body.title : null;
        }
        if (body.notes !== undefined) {
          updateParams.notes = normalizeLexOptionalNotes(body.notes);
        }
        const updated = await updateLexGovernanceRequest(updateParams);
        if (!updated)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        await logAuditEvent('lex_governance_request_updated', {
          actorType: 'user',
          actorId: session.staffUserId ?? null,
          shopId: session.shopId,
          resourceType: 'lex_governance_requests',
          resourceId: updated.id,
          details: { version: updated.version },
        });
        return reply.send(successEnvelope(request.id, updated));
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
        if (error instanceof Error && error.message === 'governance_invalid_transition') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'GOVERNANCE_INVALID_TRANSITION',
                'Governance request can only be edited while in draft state'
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/governance/:id/cancel',
    { preHandler: requireLexGovernanceSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApprovalRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      if (!assertLexUuidParam(id, request.id, reply)) return;
      try {
        const cancelled = await cancelLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: normalizeLexOptionalNotes(body.notes),
        });
        if (!cancelled)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        await logAuditEvent('lex_governance_request_cancelled', {
          actorType: 'user',
          actorId: session.staffUserId ?? null,
          shopId: session.shopId,
          resourceType: 'lex_governance_requests',
          resourceId: cancelled.id,
          details: { version: cancelled.version },
        });
        return reply.send(successEnvelope(request.id, cancelled));
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
        if (error instanceof Error && error.message === 'governance_invalid_transition') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'GOVERNANCE_INVALID_TRANSITION',
                'This governance request cannot be cancelled in its current state'
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/governance/:id/submit',
    { preHandler: requireLexGovernanceSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApprovalRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      if (!assertLexUuidParam(id, request.id, reply)) return;
      try {
        const submitted = await submitLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: normalizeLexOptionalNotes(body.notes),
        });
        if (!submitted)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        await logAuditEvent('lex_governance_request_submitted', {
          actorType: 'user',
          actorId: session.staffUserId ?? null,
          shopId: session.shopId,
          resourceType: 'lex_governance_requests',
          resourceId: submitted.id,
          details: { version: submitted.version },
        });
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
        if (error instanceof Error && error.message === 'governance_invalid_transition') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'GOVERNANCE_INVALID_TRANSITION',
                'This action is not allowed in the current governance request state'
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/governance/:id/approve',
    { preHandler: requireLexGovernanceSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApprovalRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      if (!assertLexUuidParam(id, request.id, reply)) return;
      try {
        const approved = await approveLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: normalizeLexOptionalNotes(body.notes),
        });
        if (!approved)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        await logAuditEvent('lex_governance_request_approved', {
          actorType: 'user',
          actorId: session.staffUserId ?? null,
          shopId: session.shopId,
          resourceType: 'lex_governance_requests',
          resourceId: approved.id,
          details: { version: approved.version },
        });
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
        if (error instanceof Error && error.message === 'governance_invalid_transition') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'GOVERNANCE_INVALID_TRANSITION',
                'This action is not allowed in the current governance request state'
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/governance/:id/reject',
    { preHandler: requireLexGovernanceSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApprovalRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      if (!assertLexUuidParam(id, request.id, reply)) return;
      try {
        const rejected = await rejectLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: normalizeLexOptionalNotes(body.notes),
        });
        if (!rejected)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        await logAuditEvent('lex_governance_request_rejected', {
          actorType: 'user',
          actorId: session.staffUserId ?? null,
          shopId: session.shopId,
          resourceType: 'lex_governance_requests',
          resourceId: rejected.id,
          details: { version: rejected.version },
        });
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
        if (error instanceof Error && error.message === 'governance_invalid_transition') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'GOVERNANCE_INVALID_TRANSITION',
                'This action is not allowed in the current governance request state'
              )
            );
        }
        throw error;
      }
    }
  );

  server.post(
    '/pim/lex/governance/:id/apply',
    { preHandler: requireLexGovernanceSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Partial<LexGovernanceApplyRequest>;
      if (!session)
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      if (!assertLexUuidParam(id, request.id, reply)) return;
      try {
        const applied = await applyLexGovernanceRequest({
          shopId: session.shopId,
          requestId: id,
          actorId: session.staffUserId ?? null,
          expectedVersion: toNumber(body.expectedVersion, Number.NaN),
          notes: normalizeLexOptionalNotes(body.notes),
        });
        if (!applied)
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Governance request not found'));
        if (applied.status === 'apply_failed') {
          await logAuditEvent('lex_governance_request_apply_failed', {
            actorType: 'user',
            actorId: session.staffUserId ?? null,
            shopId: session.shopId,
            resourceType: 'lex_governance_requests',
            resourceId: applied.id,
            details: { version: applied.version, status: 'apply_failed' },
          });
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'GOVERNANCE_APPLY_FAILED',
                'Governance apply did not create a resource (e.g. duplicate active glossary entry). The request was marked apply_failed.'
              )
            );
        }
        await logAuditEvent('lex_governance_request_applied', {
          actorType: 'user',
          actorId: session.staffUserId ?? null,
          shopId: session.shopId,
          resourceType: 'lex_governance_requests',
          resourceId: applied.id,
          details: { version: applied.version, status: applied.status },
        });
        return reply.send(successEnvelope(request.id, applied));
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
        if (error instanceof Error && error.message === 'governance_invalid_transition') {
          return reply
            .status(409)
            .send(
              errorEnvelope(
                request.id,
                409,
                'GOVERNANCE_INVALID_TRANSITION',
                'This action is not allowed in the current governance request state'
              )
            );
        }
        throw error;
      }
    }
  );

  server.get('/pim/lex/publications', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    const query = (request.query ?? {}) as {
      status?: string;
      targetType?: string;
      q?: string;
      limit?: string;
      cursor?: string;
    };
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const statusRaw = typeof query.status === 'string' ? query.status.trim() : '';
    const statusFilter = statusRaw.length > 0 ? statusRaw : null;
    if (
      statusFilter &&
      !(LEX_PUBLICATION_TARGET_STATUSES as readonly string[]).includes(statusFilter)
    ) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Parametrul status nu este o valoare acceptată pentru publication targets'
          )
        );
    }

    const targetTypeRaw = typeof query.targetType === 'string' ? query.targetType.trim() : '';
    const targetTypeFilter = targetTypeRaw.length > 0 ? targetTypeRaw : null;
    if (
      targetTypeFilter &&
      !(LEX_PUBLICATION_TARGET_TYPES as readonly string[]).includes(targetTypeFilter)
    ) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Parametrul targetType nu este o valoare acceptată'
          )
        );
    }

    const qRaw = typeof query.q === 'string' ? query.q.trim() : '';
    if (qRaw.length > 200) {
      return reply
        .status(400)
        .send(
          errorEnvelope(
            request.id,
            400,
            'BAD_REQUEST',
            'Parametrul q este prea lung (max 200 caractere)'
          )
        );
    }
    const publicationsSearchPattern = lexTextSearchPattern(qRaw);

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
           AND ($6::text IS NULL OR target_type = $6)
           AND (
             $7::text IS NULL
             OR target_path ILIKE $7 ESCAPE '\\'
             OR COALESCE(target_record_id::text, '') ILIKE $7 ESCAPE '\\'
             OR target_type ILIKE $7 ESCAPE '\\'
             OR COALESCE(error_message, '') ILIKE $7 ESCAPE '\\'
           )
           AND (
             $3::timestamptz IS NULL
             OR updated_at < $3::timestamptz
             OR (updated_at = $3::timestamptz AND id < $4::uuid)
           )
         ORDER BY updated_at DESC
         LIMIT $5`,
        [
          session.shopId,
          statusFilter,
          cursorUpdatedAt,
          cursorId,
          limit + 1,
          targetTypeFilter,
          publicationsSearchPattern,
        ]
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
      if (!assertLexUuidParam(id, request.id, reply)) return;

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
      if (!assertLexUuidParam(id, request.id, reply)) return;

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
      if (!assertLexUuidParam(id, request.id, reply)) return;

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

  server.post(
    '/pim/lex/publications/:id/resolve-conflict',
    { preHandler: requireLexPublishSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { resolution?: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!assertLexUuidParam(id, request.id, reply)) return;
      if (body.resolution !== 'accept_lex' && body.resolution !== 'keep_manual') {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'resolution must be accept_lex or keep_manual'
            )
          );
      }

      const result = await resolveLexPublicationPublishConflict({
        shopId: session.shopId,
        publicationTargetId: id,
        resolution: body.resolution,
        actorId: session.staffUserId ?? null,
      });

      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 400;
        return reply
          .status(status)
          .send(errorEnvelope(request.id, status, result.code, result.message));
      }

      await logAuditEvent('lex_publication_conflict_resolved', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_publication_targets',
        resourceId: id,
        details: {
          resolution: body.resolution,
          queueJobId: result.queueJobId,
        },
      });

      return reply.send(
        successEnvelope(request.id, {
          publicationTargetId: id,
          resolution: body.resolution,
          queueJobId: result.queueJobId,
        })
      );
    }
  );

  server.get(
    '/pim/lex/export',
    {
      preHandler: [
        requireAuthenticatedSession,
        async (request, reply) => {
          const rawEntity = (request.query as { entity?: string })?.entity;
          const entityLower = typeof rawEntity === 'string' ? rawEntity.trim().toLowerCase() : '';
          const gate =
            entityLower === 'review' ? requireLexReviewAccess() : requireLexModuleAccess();
          await gate(request, reply);
        },
      ],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const query = (request.query ?? {}) as { format?: string; entity?: string; q?: string };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const format = typeof query.format === 'string' ? query.format.trim().toLowerCase() : '';
      if (format !== 'csv') {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Parametrul format trebuie să fie csv')
          );
      }

      const rawEntity = typeof query.entity === 'string' ? query.entity.trim().toLowerCase() : '';
      if (!isLexExportEntity(rawEntity)) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              `Parametrul entity trebuie să fie unul din: ${LEX_EXPORT_ENTITIES.join(', ')}`
            )
          );
      }

      const qRaw = typeof query.q === 'string' ? query.q.trim() : '';
      if (qRaw.length > 200) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'Parametrul q este prea lung (max 200 caractere)'
            )
          );
      }

      const exportResult = await withTenantContext(session.shopId, async (client) =>
        buildLexExportCsv({
          client,
          shopId: session.shopId,
          entity: rawEntity,
          qRaw: qRaw.length > 0 ? qRaw : undefined,
        })
      );

      const filename = `lex-${rawEntity}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.csv`;

      await logAuditEvent('data_export_requested', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_module',
        resourceId: session.shopId,
        details: {
          entity: rawEntity,
          truncated: exportResult.truncated,
          rowCount: exportResult.rowCount,
        },
      });

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('X-Export-Truncated', exportResult.truncated ? 'true' : 'false')
        .header('X-Export-Row-Count', String(exportResult.rowCount))
        .send(`\uFEFF${exportResult.csv}`);
    }
  );

  server.get('/pim/lex/tm-stats', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const metrics = (await collectLexMetrics({
      shopId: session.shopId,
      env: options.env,
    })) satisfies LexMetricsDto;

    const totalLookups = metrics.tmHits + metrics.tmMisses;
    return reply.send(
      successEnvelope(request.id, {
        hitRate: metrics.tmHitRatePercent,
        missRate: metrics.tmMissRatePercent,
        averageSimilarity: metrics.tmAverageSimilarity,
        totalLookups,
        tmHits: metrics.tmHits,
        tmMisses: metrics.tmMisses,
      })
    );
  });

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

  server.post(
    '/pim/lex/queues/:queueName/retry-dlq',
    { preHandler: requireLexSettingsSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const raw = (request.params as { queueName?: unknown }).queueName;
      const queueName = typeof raw === 'string' ? decodeURIComponent(raw.trim()) : '';

      if (!queueName || !isLexQueueName(queueName)) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'Coada lex nu este recunoscută sau numele este invalid'
            )
          );
      }

      const result = await retryLexDlqToMainQueue({
        env: options.env,
        queueName,
      });

      return reply.send(successEnvelope(request.id, result));
    }
  );

  server.get(
    '/pim/lex/quality-calibration',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const calibration = await calibrateLexQualityThresholds({
        shopId: session.shopId,
      });

      return reply.send(successEnvelope(request.id, { calibration }));
    }
  );

  // ── XLIFF 2.0 Export ──────────────────────────────────────────────────
  server.get('/pim/lex/export-xliff', { preHandler: requireLexSession }, async (request, reply) => {
    const session = (request as RequestWithSession).session;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    const query = request.query as Record<string, unknown>;
    const targetLangRaw = query['targetLang'];
    const targetLang = typeof targetLangRaw === 'string' ? targetLangRaw.trim() : '';
    if (!targetLang) {
      return reply
        .status(400)
        .send(
          errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Parametrul targetLang este obligatoriu')
        );
    }

    const statusRaw = query['status'];
    const statusFilter =
      typeof statusRaw === 'string' && statusRaw.trim() ? statusRaw.trim() : undefined;

    const exportResult = await withTenantContext(session.shopId, async (client) => {
      if (statusFilter !== undefined) {
        return await buildLexXliffExport({
          client,
          shopId: session.shopId,
          targetLang,
          status: statusFilter,
        });
      }
      return await buildLexXliffExport({
        client,
        shopId: session.shopId,
        targetLang,
      });
    });

    const filename = `lex-translations-${targetLang}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.xliff`;

    await logAuditEvent('data_export_requested', {
      actorType: 'user',
      actorId: session.staffUserId ?? null,
      shopId: session.shopId,
      resourceType: 'lex_module',
      resourceId: session.shopId,
      details: {
        format: 'xliff',
        targetLang,
        unitCount: exportResult.unitCount,
      },
    });

    return reply
      .header('Content-Type', 'application/xliff+xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Export-Unit-Count', String(exportResult.unitCount))
      .send(exportResult.xml);
  });

  // ── XLIFF 2.0 Import ──────────────────────────────────────────────────
  server.post(
    '/pim/lex/import-xliff',
    { preHandler: requireLexSession },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      let xmlBody: string;

      const contentType = (request.headers['content-type'] ?? '').toLowerCase();
      if (contentType.includes('multipart/form-data')) {
        const file = await (
          request as unknown as {
            file: () => Promise<{ toBuffer: () => Promise<Buffer> } | undefined>;
          }
        ).file();
        if (!file) {
          return reply
            .status(400)
            .send(
              errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Fișierul XLIFF lipsește din request')
            );
        }
        xmlBody = (await file.toBuffer()).toString('utf-8');
      } else {
        const rawBody = request.body;
        if (typeof rawBody === 'string') {
          xmlBody = rawBody;
        } else if (Buffer.isBuffer(rawBody)) {
          xmlBody = rawBody.toString('utf-8');
        } else {
          return reply
            .status(400)
            .send(
              errorEnvelope(
                request.id,
                400,
                'BAD_REQUEST',
                'Body-ul trebuie să fie XML XLIFF (text/xml sau application/xml)'
              )
            );
        }
      }

      if (!xmlBody.includes('<xliff')) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'Body-ul nu conține un document XLIFF valid'
            )
          );
      }

      const units = parseXliffUnits(xmlBody);

      if (units.length === 0) {
        return reply.send(
          successEnvelope(request.id, {
            imported: 0,
            skipped: 0,
            errors: ['No translation units found in XLIFF'],
          })
        );
      }

      const srcLangMatch = /srcLang\s*=\s*"([^"]+)"/.exec(xmlBody);
      const trgLangMatch = /trgLang\s*=\s*"([^"]+)"/.exec(xmlBody);
      const sourceLang = srcLangMatch?.[1] ?? 'ro';
      const targetLang = trgLangMatch?.[1] ?? 'en';

      const result = await withTenantContext(session.shopId, async (client) =>
        importXliffUnits({
          client,
          shopId: session.shopId,
          units,
          sourceLang,
          targetLang,
        })
      );

      await logAuditEvent('data_import_completed', {
        actorType: 'user',
        actorId: session.staffUserId ?? null,
        shopId: session.shopId,
        resourceType: 'lex_module',
        resourceId: session.shopId,
        details: {
          format: 'xliff',
          sourceLang,
          targetLang,
          imported: result.imported,
          skipped: result.skipped,
          errorCount: result.errors.length,
        },
      });

      return reply.send(successEnvelope(request.id, result));
    }
  );

  return Promise.resolve();
};
