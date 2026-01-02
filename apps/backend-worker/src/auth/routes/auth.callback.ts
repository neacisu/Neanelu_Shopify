/**
 * OAuth Callback Route - GET /auth/callback
 *
 * CONFORM: Plan_de_implementare F3.2.3
 * - Verificare state/CSRF din cookie vs query
 * - Verificare HMAC pe query string
 * - Token exchange cu Shopify
 * - Criptare și stocare token în DB
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { registerWebhooks } from '../../shopify/webhooks/register.js';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { pool, encryptAesGcm } from '@app/database';
import { verifyShopifyHmac } from '../hmac.js';
import { validateShopParam } from '../validation.js';

interface AuthCallbackQuery {
  code?: string;
  shop?: string;
  state?: string;
  hmac?: string;
  timestamp?: string;
  host?: string;
}

export interface AuthCallbackRouteOptions {
  env: AppEnv;
  logger: Logger;
}

/**
 * Schimbă code pentru access token cu Shopify
 */
async function exchangeCodeForToken(params: {
  shop: string;
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ access_token: string; scope: string }> {
  const { shop, code, clientId, clientSecret } = params;

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  return (await response.json()) as { access_token: string; scope: string };
}

export function registerAuthCallbackRoute(
  server: FastifyInstance,
  options: AuthCallbackRouteOptions
): void {
  const { env, logger } = options;

  server.get<{ Querystring: AuthCallbackQuery }>(
    '/auth/callback',
    async (request: FastifyRequest<{ Querystring: AuthCallbackQuery }>, reply: FastifyReply) => {
      const { code, shop, state, hmac } = request.query;

      // 1. Validare parametri de bază
      if (!code || !shop || !state || !hmac) {
        logger.warn({ query: request.query }, 'Missing OAuth callback parameters');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_CALLBACK',
            message: 'Missing required OAuth parameters',
          },
        });
      }

      // 2. Validare shop domain
      const shopValidation = validateShopParam(shop);
      if (!shopValidation.valid) {
        logger.warn({ shop }, 'Invalid shop in callback');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SHOP',
            message: shopValidation.error,
          },
        });
      }
      const shopDomain = shopValidation.shop;

      // 3. Verificare HMAC
      const queryParams = request.query as Record<string, string | string[] | undefined>;
      if (!verifyShopifyHmac(queryParams, env.shopifyApiSecret)) {
        logger.warn({ shop: shopDomain }, 'HMAC verification failed');
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_HMAC',
            message: 'Request signature verification failed',
          },
        });
      }

      // 4. Verificare state din cookie vs query
      const cookieState = request.cookies['oauth_state'];
      if (!cookieState || cookieState !== state) {
        logger.warn(
          { shop: shopDomain, cookieState: !!cookieState, queryState: !!state },
          'State mismatch'
        );
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: 'OAuth state verification failed',
          },
        });
      }

      // 5. Verificare state în DB (not expired, not used)
      const stateResult = await pool.query<{
        id: string;
        shop_domain: string;
        expires_at: Date;
        used_at: Date | null;
      }>(
        `SELECT id, shop_domain, expires_at, used_at
         FROM oauth_states
         WHERE state = $1`,
        [state]
      );

      const stateRecord = stateResult.rows[0];
      if (!stateRecord) {
        logger.warn({ shop: shopDomain }, 'OAuth state not found in DB');
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: 'OAuth state not found',
          },
        });
      }

      if (stateRecord.used_at) {
        logger.warn({ shop: shopDomain }, 'OAuth state already used');
        return reply.status(401).send({
          success: false,
          error: {
            code: 'STATE_ALREADY_USED',
            message: 'OAuth state has already been used',
          },
        });
      }

      if (stateRecord.expires_at < new Date()) {
        logger.warn({ shop: shopDomain }, 'OAuth state expired');
        return reply.status(401).send({
          success: false,
          error: {
            code: 'STATE_EXPIRED',
            message: 'OAuth state has expired',
          },
        });
      }

      // 6. Marcare state ca used (atomic)
      await pool.query(`UPDATE oauth_states SET used_at = now() WHERE state = $1`, [state]);

      // 7. Token exchange
      let tokenResponse: { access_token: string; scope: string };
      try {
        tokenResponse = await exchangeCodeForToken({
          shop: shopDomain,
          code,
          clientId: env.shopifyApiKey,
          clientSecret: env.shopifyApiSecret,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ errorMessage, shop: shopDomain }, 'Token exchange failed');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'TOKEN_EXCHANGE_FAILED',
            message: 'Failed to exchange authorization code for token',
          },
        });
      }

      logger.info({ shop: shopDomain, scopes: tokenResponse.scope }, 'Token exchange successful');

      // 8. Criptare token AES-256-GCM
      const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');
      const tokenBuffer = Buffer.from(tokenResponse.access_token, 'utf-8');
      const encrypted = encryptAesGcm(tokenBuffer, encryptionKey);

      // 9. Upsert în shops (idempotent pentru reinstall)
      const scopes = tokenResponse.scope.split(',').map((s) => s.trim());

      let shopId: string;
      try {
        const upsertResult = await pool.query<{ id: string }>(
          `INSERT INTO shops (
             shopify_domain,
             access_token_ciphertext,
             access_token_iv,
             access_token_tag,
             key_version,
             scopes,
             installed_at,
             uninstalled_at
           ) VALUES ($1, $2, $3, $4, $5, $6, now(), NULL)
           ON CONFLICT (shopify_domain) DO UPDATE SET
             access_token_ciphertext = EXCLUDED.access_token_ciphertext,
             access_token_iv = EXCLUDED.access_token_iv,
             access_token_tag = EXCLUDED.access_token_tag,
             key_version = EXCLUDED.key_version,
             scopes = EXCLUDED.scopes,
             installed_at = COALESCE(shops.installed_at, now()),
             uninstalled_at = NULL,
             updated_at = now()
           RETURNING id`,
          [
            shopDomain,
            encrypted.ciphertext.toString('base64'),
            encrypted.iv.toString('base64'),
            encrypted.tag.toString('base64'),
            env.encryptionKeyVersion,
            scopes,
          ]
        );
        shopId = upsertResult.rows[0]?.id ?? '';
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ errorMessage, shop: shopDomain }, 'Failed to save shop credentials');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'SAVE_FAILED',
            message: 'Failed to save shop credentials',
          },
        });
      }

      logger.info({ shop: shopDomain, shopId }, 'Shop credentials saved successfully');

      // 10. Clear oauth_state cookie
      void reply.clearCookie('oauth_state', {
        path: '/auth',
      });

      // 10A. Register Webhooks (best-effort)
      // Don't block install redirect if webhook registration fails.
      try {
        if (tokenResponse.access_token) {
          const appHost = options.env.appHost.toString();
          await registerWebhooks(shopId, shopDomain, tokenResponse.access_token, appHost, logger);
        }
      } catch (err) {
        logger.error({ err, shop: shopDomain }, 'Failed to register webhooks during install');
      }

      // 11. Set session cookie for admin UI
      if (shopId) {
        const { setSessionCookie, getDefaultSessionConfig } = await import('../session.js');
        const sessionConfig = getDefaultSessionConfig(env.shopifyApiSecret);
        setSessionCookie(
          reply,
          {
            shopId,
            shopDomain,
            createdAt: Date.now(),
          },
          sessionConfig
        );
      }

      // 12. Redirect la app (sau dashboard)
      // Pentru embedded apps, redirect la host shopify admin
      const hostParam = request.query.host;
      if (hostParam) {
        const redirectUrl = `https://${Buffer.from(hostParam, 'base64').toString()}/apps/${env.shopifyApiKey}`;
        return reply.redirect(redirectUrl);
      }

      // Fallback: redirect la app host
      return reply.redirect(`${env.appHost.origin}/?shop=${shopDomain}`);
    }
  );
}
