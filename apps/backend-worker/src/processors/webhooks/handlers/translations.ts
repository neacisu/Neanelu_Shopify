/**
 * Handlers for translation-related Shopify webhooks.
 *
 * Dispatched from the webhook worker for topics such as `translations/create`,
 * `translations/remove` (and GraphQL-style `TRANSLATIONS_*` aliases), and
 * legacy `locales/create` / `locales/update` (locale lifecycle — kept for
 * backward compatibility). Updates `lex_publication_targets` sync state.
 */

import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';

type TranslationWebhookPayload = Readonly<Record<string, unknown>>;

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Segment numeric/string pentru `gid://shopify/{type}/{id}` din payload-uri REST/JSON.
 * Respinge obiecte/array-uri — evită `[object Object]` în GID (reguli no-base-to-string / template).
 */
function legacyWebhookResourceIdSegment(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

function extractLocale(payload: TranslationWebhookPayload): string | null {
  if (typeof payload['locale'] === 'string') return payload['locale'];
  const translations = payload['translations'];
  if (Array.isArray(translations) && translations.length > 0) {
    const first = translations[0] as Record<string, unknown> | undefined;
    if (first && typeof first['locale'] === 'string') return first['locale'];
  }
  return null;
}

export function extractResourceGid(payload: TranslationWebhookPayload): string | null {
  const resourceId = toStringOrNull(payload['resource_id']);
  if (resourceId?.startsWith('gid://')) return resourceId;

  const resourceType = toStringOrNull(payload['resource_type']);
  const legacyId =
    legacyWebhookResourceIdSegment(payload['id']) ??
    legacyWebhookResourceIdSegment(payload['resource_id']);
  if (resourceType && legacyId) {
    return `gid://shopify/${resourceType}/${legacyId}`;
  }
  return null;
}

/**
 * TRANSLATIONS_CREATE: Shopify confirms translations were registered.
 * We mark matching local publication targets as synced.
 */
export async function handleTranslationsCreate(params: {
  shopId: string;
  payload: unknown;
  logger: Logger;
}): Promise<void> {
  const body = (params.payload ?? {}) as TranslationWebhookPayload;
  const locale = extractLocale(body);
  const resourceGid = extractResourceGid(body);

  if (!locale && !resourceGid) {
    params.logger.info(
      { shopId: params.shopId },
      'translations_create webhook: no locale or resourceGid found, skipping'
    );
    return;
  }

  await withTenantContext(params.shopId, async (client) => {
    const conditions: string[] = [`pt.shop_id = $1`, `pt.status = 'published'`];
    const values: unknown[] = [params.shopId];

    if (resourceGid) {
      conditions.push(`pt.target_record_id = $${values.length + 1}`);
      values.push(resourceGid);
    }

    if (locale) {
      conditions.push(`l.target_lang = $${values.length + 1}`);
      values.push(locale);
    }

    await client.query(
      `UPDATE lex_publication_targets pt
       SET updated_at = now()
       FROM lex_entity_localizations l
       WHERE l.id = pt.localization_id
         AND l.shop_id = pt.shop_id
         AND ${conditions.join(' AND ')}`,
      values
    );

    params.logger.info(
      { shopId: params.shopId, locale, resourceGid },
      'translations_create webhook: marked targets as synced'
    );
  });
}

/**
 * TRANSLATIONS_REMOVE: Shopify removed translations.
 * We mark matching local publication targets as needing re-publish.
 */
export async function handleTranslationsRemove(params: {
  shopId: string;
  payload: unknown;
  logger: Logger;
}): Promise<void> {
  const body = (params.payload ?? {}) as TranslationWebhookPayload;
  const locale = extractLocale(body);
  const resourceGid = extractResourceGid(body);

  if (!locale && !resourceGid) {
    params.logger.info(
      { shopId: params.shopId },
      'translations_remove webhook: no locale or resourceGid found, skipping'
    );
    return;
  }

  await withTenantContext(params.shopId, async (client) => {
    const conditions: string[] = [`pt.shop_id = $1`, `pt.status = 'published'`];
    const values: unknown[] = [params.shopId];

    if (resourceGid) {
      conditions.push(`pt.target_record_id = $${values.length + 1}`);
      values.push(resourceGid);
    }

    if (locale) {
      conditions.push(`l.target_lang = $${values.length + 1}`);
      values.push(locale);
    }

    const result = await client.query(
      `UPDATE lex_publication_targets pt
       SET status = 'pending',
           error_message = 'shopify_translation_removed_needs_republish',
           updated_at = now()
       FROM lex_entity_localizations l
       WHERE l.id = pt.localization_id
         AND l.shop_id = pt.shop_id
         AND ${conditions.join(' AND ')}`,
      values
    );

    const rowCount = (result as { rowCount?: number }).rowCount ?? 0;
    params.logger.info(
      { shopId: params.shopId, locale, resourceGid, resetCount: rowCount },
      'translations_remove webhook: reset targets to pending for re-publish'
    );
  });
}
