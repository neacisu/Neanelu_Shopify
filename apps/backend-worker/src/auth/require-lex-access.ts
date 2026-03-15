import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenantContext } from '@app/database';
import type { LexBootstrapDto, LexShopSettingsDto } from '@app/types';
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
  const [moduleEnabled, reviewUiEnabled, collectionAdapterEnabled, isAdmin, settings] =
    await Promise.all([
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
             auto_publish_collections AS "autoPublishCollections"
           FROM lex_shop_settings
           WHERE shop_id = $1
           LIMIT 1`,
          [session.shopId]
        );
        return result.rows[0] ?? defaultLexSettings(session.shopId);
      }),
    ]);

  const shopEnabled = settings.enabled === true;
  const canView = moduleEnabled && shopEnabled && isAdmin;
  const canReview = canView && reviewUiEnabled;
  const canPublish = canView;
  const canManageSettings = canView;

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
      return;
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
      return;
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
      return;
    }
  };
}
