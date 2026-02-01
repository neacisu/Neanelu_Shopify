import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { ShopGeneralSettings } from '@app/types';
import { withTenantContext } from '@app/database';
import { ShopPreferencesSchema } from '@app/validation';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { withTokenRetry } from '../auth/token-lifecycle.js';
import { shopifyApi } from '../shopify/client.js';

type ShopSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type ShopRow = Readonly<{
  shopifyDomain: string;
  timezone: string | null;
  settings: Record<string, unknown> | null;
}>;

type ShopifyShopQueryResponse = Readonly<{
  shop?: {
    name?: string | null;
    email?: string | null;
  };
}>;

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

function normalizeLanguage(value: unknown): 'ro' | 'en' {
  return value === 'en' ? 'en' : 'ro';
}

async function fetchShopInfo(
  shopId: string,
  env: AppEnv,
  logger: Logger
): Promise<{ name: string | null; email: string | null } | null> {
  try {
    const key = Buffer.from(env.encryptionKeyHex, 'hex');
    if (key.length !== 32) {
      throw new Error('Invalid encryption key length (expected 32 bytes)');
    }

    return await withTokenRetry(shopId, key, logger, async (accessToken, shopDomain) => {
      const client = shopifyApi.createClient({ shopDomain, accessToken });
      const query = `
        query ShopInfo {
          shop {
            name
            email
          }
        }
      `;
      const response = await client.request<ShopifyShopQueryResponse>(query);
      return {
        name: response.data?.shop?.name ?? null,
        email: response.data?.shop?.email ?? null,
      };
    });
  } catch (error) {
    logger.warn({ shopId, error }, 'Failed to fetch shop info from Shopify');
    return null;
  }
}

export const shopSettingsRoutes: FastifyPluginCallback<ShopSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/shop',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;

      try {
        const shop = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<ShopRow>(
            `SELECT shopify_domain AS "shopifyDomain",
              timezone,
              settings
            FROM shops
            WHERE id = $1`,
            [session.shopId]
          );
          return result.rows[0];
        });

        if (!shop) {
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Shop not found'));
        }

        const settings = shop.settings ?? {};
        let shopName = typeof settings['shop_name'] === 'string' ? settings['shop_name'] : null;
        let shopEmail = typeof settings['shop_email'] === 'string' ? settings['shop_email'] : null;

        if (!shopName || !shopEmail) {
          const shopInfo = await fetchShopInfo(session.shopId, env, logger);
          if (shopInfo) {
            shopName = shopInfo.name;
            shopEmail = shopInfo.email;
            await withTenantContext(session.shopId, async (client) => {
              await client.query(
                `UPDATE shops
                 SET settings = settings || $1::jsonb,
                     updated_at = now()
                 WHERE id = $2`,
                [
                  JSON.stringify({
                    ...(shopInfo.name ? { shop_name: shopInfo.name } : {}),
                    ...(shopInfo.email ? { shop_email: shopInfo.email } : {}),
                  }),
                  session.shopId,
                ]
              );
            });
          }
        }

        const notificationsEnabled =
          typeof settings['notificationsEnabled'] === 'boolean'
            ? settings['notificationsEnabled']
            : undefined;

        const response: ShopGeneralSettings = {
          shopName: shopName ?? null,
          shopDomain: shop.shopifyDomain,
          shopEmail: shopEmail ?? null,
          preferences: {
            timezone: shop.timezone ?? 'Europe/Bucharest',
            language: normalizeLanguage(settings['language']),
            ...(notificationsEnabled !== undefined ? { notificationsEnabled } : {}),
          },
        };

        return reply.send(successEnvelope(request.id, response));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load shop settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
      }
    }
  );

  server.put(
    '/settings/shop',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;
      const body = request.body as Record<string, unknown> | undefined;

      const parsed = ShopPreferencesSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Invalid preferences payload'));
      }

      try {
        const preferences = parsed.data;
        const settingsUpdate: Record<string, unknown> = {
          language: preferences.language,
        };
        if (preferences.notificationsEnabled !== undefined) {
          settingsUpdate['notificationsEnabled'] = preferences.notificationsEnabled;
        }

        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `UPDATE shops
             SET timezone = $1,
                 settings = settings || $2::jsonb,
                 updated_at = now()
             WHERE id = $3`,
            [preferences.timezone, JSON.stringify(settingsUpdate), session.shopId]
          );
        });

        return reply.send(successEnvelope(request.id, { ok: true }));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update shop settings');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update settings')
          );
      }
    }
  );
};
