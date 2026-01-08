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
import {
  pool,
  exchangeCodeForToken,
  encryptShopifyAccessToken,
  upsertOfflineShopCredentials,
} from '@app/database';
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

export function registerAuthCallbackRoute(
  server: FastifyInstance,
  options: AuthCallbackRouteOptions
): void {
  const { env, logger } = options;

  function wantsJson(request: FastifyRequest): boolean {
    const accept = request.headers.accept;
    return typeof accept === 'string' && accept.includes('application/json');
  }

  function safeShopForQuery(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const shop = value.trim();
    if (!shop) return null;
    if (shop.length > 255) return null;
    if (/\s/.test(shop)) return null;
    return shop;
  }

  function normalizeReturnTo(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > 2048) return null;
    if (!trimmed.startsWith('/')) return null;
    if (trimmed.startsWith('//')) return null;
    if (trimmed.includes('://')) return null;
    if (!trimmed.startsWith('/app')) return null;
    if (trimmed === '/app') return '/app/';
    if (!trimmed.startsWith('/app/')) return null;
    return trimmed;
  }

  function buildReturnToUrl(returnTo: string | null, shopDomain: string): string {
    const fallback = new URL('/app/', env.appHost.origin);
    fallback.searchParams.set('shop', shopDomain);
    if (!returnTo) return fallback.toString();

    try {
      const url = new URL(returnTo, env.appHost.origin);
      // Defensive: ensure we never redirect outside our own /app/* UI.
      if (url.origin !== env.appHost.origin) return fallback.toString();
      if (!url.pathname.startsWith('/app/')) return fallback.toString();

      if (!url.searchParams.get('shop')) {
        url.searchParams.set('shop', shopDomain);
      }
      return url.toString();
    } catch {
      return fallback.toString();
    }
  }

  function redirectToUi(
    reply: FastifyReply,
    params: { shop?: string | null; error: string }
  ): FastifyReply {
    const url = new URL('/app/auth/callback', env.appHost.origin);
    if (params.shop) url.searchParams.set('shop', params.shop);
    url.searchParams.set('error', params.error);
    return reply.redirect(url.toString());
  }

  function sendAuthError(
    request: FastifyRequest,
    reply: FastifyReply,
    status: number,
    error: { code: string; message: string },
    shopForUi?: string | null
  ): FastifyReply {
    if (wantsJson(request)) {
      return reply.status(status).send({ success: false, error });
    }

    return redirectToUi(reply, { shop: shopForUi ?? null, error: error.code });
  }

  server.get<{ Querystring: AuthCallbackQuery }>(
    '/auth/callback',
    async (request: FastifyRequest<{ Querystring: AuthCallbackQuery }>, reply: FastifyReply) => {
      const { code, shop, state, hmac } = request.query;

      // 1. Validare parametri de bază
      if (!code || !shop || !state || !hmac) {
        logger.warn(
          {
            hasCode: Boolean(code),
            hasShop: Boolean(shop),
            hasState: Boolean(state),
            hasHmac: Boolean(hmac),
          },
          'Missing OAuth callback parameters'
        );
        return sendAuthError(
          request,
          reply,
          400,
          {
            code: 'INVALID_CALLBACK',
            message: 'Missing required OAuth parameters',
          },
          safeShopForQuery(shop)
        );
      }

      // 2. Validare shop domain
      const shopValidation = validateShopParam(shop);
      if (!shopValidation.valid) {
        logger.warn({ shop }, 'Invalid shop in callback');
        return sendAuthError(
          request,
          reply,
          400,
          {
            code: 'INVALID_SHOP',
            message: shopValidation.error,
          },
          safeShopForQuery(shop)
        );
      }
      const shopDomain = shopValidation.shop;

      // 3. Verificare HMAC
      const queryParams = request.query as Record<string, string | string[] | undefined>;
      if (!verifyShopifyHmac(queryParams, env.shopifyApiSecret)) {
        logger.warn({ shop: shopDomain }, 'HMAC verification failed');
        return sendAuthError(
          request,
          reply,
          401,
          {
            code: 'INVALID_HMAC',
            message: 'Request signature verification failed',
          },
          shopDomain
        );
      }

      // 4. Verificare state din cookie vs query
      const cookieState = request.cookies['oauth_state'];
      if (!cookieState || cookieState !== state) {
        logger.warn(
          { shop: shopDomain, cookieState: !!cookieState, queryState: !!state },
          'State mismatch'
        );
        return sendAuthError(
          request,
          reply,
          401,
          {
            code: 'INVALID_STATE',
            message: 'OAuth state verification failed',
          },
          shopDomain
        );
      }

      // 5. Verificare state în DB (not expired, not used)
      const stateResult = await pool.query<{
        id: string;
        shop_domain: string;
        expires_at: Date;
        used_at: Date | null;
        return_to: string | null;
      }>(
        `SELECT id, shop_domain, expires_at, used_at, return_to
         FROM oauth_states
         WHERE state = $1`,
        [state]
      );

      const stateRecord = stateResult.rows[0];
      if (!stateRecord) {
        logger.warn({ shop: shopDomain }, 'OAuth state not found in DB');
        return sendAuthError(
          request,
          reply,
          401,
          {
            code: 'INVALID_STATE',
            message: 'OAuth state not found',
          },
          shopDomain
        );
      }

      if (stateRecord.used_at) {
        logger.warn({ shop: shopDomain }, 'OAuth state already used');
        return sendAuthError(
          request,
          reply,
          401,
          {
            code: 'STATE_ALREADY_USED',
            message: 'OAuth state has already been used',
          },
          shopDomain
        );
      }

      if (stateRecord.expires_at < new Date()) {
        logger.warn({ shop: shopDomain }, 'OAuth state expired');
        return sendAuthError(
          request,
          reply,
          401,
          {
            code: 'STATE_EXPIRED',
            message: 'OAuth state has expired',
          },
          shopDomain
        );
      }

      // 7. Token exchange
      let tokenResponse: { access_token: string; scope: string };
      try {
        tokenResponse = await exchangeCodeForToken({
          shopDomain,
          code,
          clientId: env.shopifyApiKey,
          clientSecret: env.shopifyApiSecret,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ errorMessage, shop: shopDomain }, 'Token exchange failed');
        return sendAuthError(
          request,
          reply,
          500,
          {
            code: 'TOKEN_EXCHANGE_FAILED',
            message: 'Failed to exchange authorization code for token',
          },
          shopDomain
        );
      }

      logger.info({ shop: shopDomain, scopes: tokenResponse.scope }, 'Token exchange successful');

      // 8. Criptare token AES-256-GCM
      const encrypted = encryptShopifyAccessToken({
        accessToken: tokenResponse.access_token,
        encryptionKeyHex: env.encryptionKeyHex,
      });

      // 9. Persistență (idempotent pentru reinstall)
      const scopes = tokenResponse.scope.split(',').map((s) => s.trim());

      let shopId: string;
      try {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const markUsed = await client.query<{ shop_domain: string }>(
            `UPDATE oauth_states
             SET used_at = now()
             WHERE state = $1
               AND used_at IS NULL
               AND expires_at > now()
             RETURNING shop_domain`,
            [state]
          );

          const usedShopDomain = markUsed.rows[0]?.shop_domain;
          if (!usedShopDomain) {
            await client.query('ROLLBACK');
            logger.warn(
              { shop: shopDomain },
              'OAuth state could not be marked used (race/expired)'
            );
            return sendAuthError(
              request,
              reply,
              401,
              {
                code: 'INVALID_STATE',
                message: 'OAuth state is invalid or expired',
              },
              shopDomain
            );
          }

          if (usedShopDomain !== shopDomain) {
            await client.query('ROLLBACK');
            logger.warn(
              { shop: shopDomain, stateShopDomain: usedShopDomain },
              'OAuth state shop domain mismatch'
            );
            return sendAuthError(
              request,
              reply,
              401,
              {
                code: 'INVALID_STATE',
                message: 'OAuth state does not match shop',
              },
              shopDomain
            );
          }

          const result = await upsertOfflineShopCredentials({
            client,
            shopDomain,
            encryptedToken: encrypted,
            keyVersion: env.encryptionKeyVersion,
            scopes,
          });

          await client.query('COMMIT');
          shopId = result.shopId;
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // ignore
          }
          throw err;
        } finally {
          client.release();
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ errorMessage, shop: shopDomain }, 'Failed to save shop credentials');
        return sendAuthError(
          request,
          reply,
          500,
          {
            code: 'SAVE_FAILED',
            message: 'Failed to save shop credentials',
          },
          shopDomain
        );
      }

      logger.info({ shop: shopDomain, shopId }, 'Shop credentials saved successfully');

      const returnTo = buildReturnToUrl(normalizeReturnTo(stateRecord.return_to), shopDomain);

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
        const sessionConfig = getDefaultSessionConfig(env.shopifyApiSecret, env.shopifyApiKey);
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

      // Non-embedded / top-level: return to original UI location when available.
      return reply.redirect(returnTo);
    }
  );
}
