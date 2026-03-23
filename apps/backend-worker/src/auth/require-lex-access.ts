import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenantContext } from '@app/database';
import type { LexBootstrapDto, LexShopSettingsDto } from '@app/types';
import {
  DEFAULT_LEX_SOURCE_LANG,
  DEFAULT_LEX_TARGET_LANG,
} from '../processors/lex/pipeline-utils.js';
import { isFeatureFlagEnabled } from '../processors/bulk-operations/feature-flags.js';
import { hasAdminAccess } from './require-admin.js';
import type { SessionData } from './session.js';

type RequestWithLexAccess = FastifyRequest & {
  session?: SessionData;
  lexAccess?: LexBootstrapDto;
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Aligned with `0130_lex_guardrails_infrastructure.sql` defaults on `lex_shop_settings`. */
const LEX_GUARDRAILS_MODES = new Set<string>(['warn', 'enforce', 'progressive']);

/** Same defaults as `0130_lex_guardrails_infrastructure.sql` (used for coercion, not only fallbacks). */
const LEX_SHOP_GUARDRAILS_WARN_THRESHOLD_DEFAULT = 1000;
const LEX_SHOP_GUARDRAILS_COUNT_DEFAULT = 0;

function parseLexGuardrailsMode(value: unknown): 'warn' | 'enforce' | 'progressive' {
  return typeof value === 'string' && LEX_GUARDRAILS_MODES.has(value)
    ? (value as 'warn' | 'enforce' | 'progressive')
    : 'warn';
}

function finiteNonNegativeInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function coerceGuardrailsLastEvaluatedAt(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

export function normalizeLexShopSettingsRow(
  row: LexShopSettingsDto,
  shopId: string
): LexShopSettingsDto {
  const d = defaultLexSettings(shopId);
  const raw = row as unknown as Record<string, unknown>;
  const rowShopId = raw['shopId'];
  return {
    ...d,
    ...row,
    shopId: typeof rowShopId === 'string' && rowShopId ? rowShopId : shopId,
    guardrailsLexMode: parseLexGuardrailsMode(raw['guardrailsLexMode']),
    guardrailsWarnThreshold: finiteNonNegativeInt(
      raw['guardrailsWarnThreshold'],
      LEX_SHOP_GUARDRAILS_WARN_THRESHOLD_DEFAULT
    ),
    guardrailsWarnCount: finiteNonNegativeInt(
      raw['guardrailsWarnCount'],
      LEX_SHOP_GUARDRAILS_COUNT_DEFAULT
    ),
    guardrailsBlockCount: finiteNonNegativeInt(
      raw['guardrailsBlockCount'],
      LEX_SHOP_GUARDRAILS_COUNT_DEFAULT
    ),
    guardrailsFalsePositiveCount: finiteNonNegativeInt(
      raw['guardrailsFalsePositiveCount'],
      LEX_SHOP_GUARDRAILS_COUNT_DEFAULT
    ),
    guardrailsLastEvaluatedAt: coerceGuardrailsLastEvaluatedAt(raw['guardrailsLastEvaluatedAt']),
  };
}

function defaultLexSettings(shopId: string): LexShopSettingsDto {
  return {
    shopId,
    version: 0,
    enabled: false,
    sourceLang: DEFAULT_LEX_SOURCE_LANG,
    targetLangs: [DEFAULT_LEX_TARGET_LANG],
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
    guardrailsWarnThreshold: LEX_SHOP_GUARDRAILS_WARN_THRESHOLD_DEFAULT,
    guardrailsWarnCount: LEX_SHOP_GUARDRAILS_COUNT_DEFAULT,
    guardrailsBlockCount: LEX_SHOP_GUARDRAILS_COUNT_DEFAULT,
    guardrailsFalsePositiveCount: LEX_SHOP_GUARDRAILS_COUNT_DEFAULT,
    guardrailsLastEvaluatedAt: null,
  };
}

function sendForbidden(
  request: FastifyRequest,
  reply: FastifyReply,
  code: string,
  message: string
): FastifyReply {
  return reply.status(403).send({
    success: false,
    error: { code, message },
    meta: { request_id: request.id, timestamp: nowIso() },
  });
}

export async function resolveLexBootstrap(session: SessionData): Promise<LexBootstrapDto> {
  const [
    moduleEnabled,
    reviewUiEnabled,
    collectionAdapterEnabled,
    isAdmin,
    settings,
    publishEnabled,
    settingsWriteEnabled,
    governanceEnabled,
  ] = await Promise.all([
    isFeatureFlagEnabled({
      shopId: session.shopId,
      flagKey: 'lex_module_enabled',
      fallback: false,
    }),
    isFeatureFlagEnabled({
      shopId: session.shopId,
      flagKey: 'lex_review_ui_enabled',
      fallback: false,
    }),
    isFeatureFlagEnabled({
      shopId: session.shopId,
      flagKey: 'lex_collection_adapter_enabled',
      fallback: false,
    }),
    hasAdminAccess(session),
    withTenantContext(session.shopId, async (client) => {
      const result = await client.query<LexShopSettingsDto>(
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
      return row
        ? normalizeLexShopSettingsRow(row, session.shopId)
        : defaultLexSettings(session.shopId);
    }),
    isFeatureFlagEnabled({
      shopId: session.shopId,
      flagKey: 'lex_publish_enabled',
      fallback: true,
    }),
    isFeatureFlagEnabled({
      shopId: session.shopId,
      flagKey: 'lex_settings_write_enabled',
      fallback: true,
    }),
    isFeatureFlagEnabled({
      shopId: session.shopId,
      flagKey: 'lex_governance_enabled',
      fallback: true,
    }),
  ]);

  const shopEnabled = settings.enabled === true;
  const canView = moduleEnabled && shopEnabled && isAdmin;
  const canReview = canView && reviewUiEnabled;
  const canPublish = canView && publishEnabled;
  const canManageSettings = canView && settingsWriteEnabled;
  const canGovernance = canView && governanceEnabled;

  return {
    moduleEnabled,
    reviewUiEnabled,
    collectionAdapterEnabled,
    shopEnabled,
    isAdmin,
    permissions: {
      canView,
      canReview,
      canPublish,
      canManageSettings,
      canGovernance,
    },
    settingsSummary: {
      shopId: settings.shopId,
      version: settings.version,
      enabled: settings.enabled,
      sourceLang: settings.sourceLang,
      targetLangs: settings.targetLangs,
      shardSize: settings.shardSize,
      autoPublishProducts: settings.autoPublishProducts,
      autoPublishAttributes: settings.autoPublishAttributes,
      autoPublishCollections: settings.autoPublishCollections,
    },
  };
}

export async function isLexCollectionAdapterActive(shopId: string): Promise<boolean> {
  const [flagEnabled, settings] = await Promise.all([
    isFeatureFlagEnabled({
      shopId,
      flagKey: 'lex_collection_adapter_enabled',
      fallback: false,
    }),
    withTenantContext(shopId, async (client) => {
      const result = await client.query<{ enabled: boolean }>(
        `SELECT enabled
         FROM lex_shop_settings
         WHERE shop_id = $1
         LIMIT 1`,
        [shopId]
      );
      return result.rows[0]?.enabled === true;
    }),
  ]);

  return flagEnabled && settings;
}

async function attachLexAccess(request: FastifyRequest): Promise<LexBootstrapDto | null> {
  const req = request as RequestWithLexAccess;
  if (req.lexAccess) return req.lexAccess;
  if (!req.session) return null;
  const state = await resolveLexBootstrap(req.session);
  req.lexAccess = state;
  return state;
}

export function requireLexModuleAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await attachLexAccess(request);
    if (!access) {
      await sendForbidden(request, reply, 'LEX_SESSION_REQUIRED', 'Lexical session required');
      return;
    }
    if (!access.isAdmin) {
      await sendForbidden(request, reply, 'LEX_ADMIN_REQUIRED', 'Admin access required');
      return;
    }
    if (!access.moduleEnabled) {
      await sendForbidden(request, reply, 'LEX_MODULE_DISABLED', 'Lexical module is disabled');
      return;
    }
    if (!access.shopEnabled) {
      await sendForbidden(
        request,
        reply,
        'LEX_SHOP_DISABLED',
        'Lexical module is not enabled for this shop'
      );
    }
  };
}

export function requireLexReviewAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await attachLexAccess(request);
    if (!access) {
      await sendForbidden(request, reply, 'LEX_SESSION_REQUIRED', 'Lexical session required');
      return;
    }
    if (!access.permissions.canReview) {
      await sendForbidden(
        request,
        reply,
        'LEX_REVIEW_DISABLED',
        'Lexical review access is disabled'
      );
    }
  };
}

export function requireLexPublishAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await attachLexAccess(request);
    if (!access) {
      await sendForbidden(request, reply, 'LEX_SESSION_REQUIRED', 'Lexical session required');
      return;
    }
    if (!access.permissions.canPublish) {
      await sendForbidden(
        request,
        reply,
        'LEX_PUBLISH_DISABLED',
        'Lexical publish access is disabled'
      );
    }
  };
}

export function requireLexSettingsAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await attachLexAccess(request);
    if (!access) {
      await sendForbidden(request, reply, 'LEX_SESSION_REQUIRED', 'Lexical session required');
      return;
    }
    if (!access.permissions.canManageSettings) {
      await sendForbidden(
        request,
        reply,
        'LEX_SETTINGS_WRITE_DISABLED',
        'Lexical settings and configuration write access is disabled'
      );
    }
  };
}

export function requireLexGovernanceAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await attachLexAccess(request);
    if (!access) {
      await sendForbidden(request, reply, 'LEX_SESSION_REQUIRED', 'Lexical session required');
      return;
    }
    if (!access.permissions.canGovernance) {
      await sendForbidden(
        request,
        reply,
        'LEX_GOVERNANCE_DISABLED',
        'Lexical governance workflow access is disabled'
      );
    }
  };
}
