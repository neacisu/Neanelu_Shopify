/**
 * OAuth Start Route - GET/POST /auth
 *
 * CONFORM: Plan_de_implementare F3.2.2
 * - Validare shop domain
 * - Generare state cryptografic
 * - Stocare state în DB (oauth_states)
 * - Redirect la Shopify authorize
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { pool } from '@app/database';
import { validateShopParam, buildAuthorizationUrl } from '../validation.js';
import { generateSecureState, generateNonce, getStateExpiration } from '../state.js';

interface AuthStartQuery {
  shop?: string;
}

export interface AuthStartRouteOptions {
  env: AppEnv;
  logger: Logger;
}

export function registerAuthStartRoute(
  server: FastifyInstance,
  options: AuthStartRouteOptions
): void {
  const { env, logger } = options;

  server.get<{ Querystring: AuthStartQuery }>(
    '/auth',
    async (request: FastifyRequest<{ Querystring: AuthStartQuery }>, reply: FastifyReply) => {
      const { shop } = request.query;

      // 1. Validare shop domain
      const validation = validateShopParam(shop);
      if (!validation.valid) {
        logger.warn({ shop, error: validation.error }, 'Invalid shop parameter');
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SHOP',
            message: validation.error,
          },
        });
      }

      const shopDomain = validation.shop;
      logger.info({ shop: shopDomain }, 'Starting OAuth flow');

      // 2. Generare state și nonce
      const state = generateSecureState();
      const nonce = generateNonce();
      const expiresAt = getStateExpiration(10); // 10 minute TTL

      // 3. Construiește redirect URI
      const redirectUri = `${env.appHost.origin}/auth/callback`;

      // 4. Salvează state în DB
      try {
        await pool.query(
          `INSERT INTO oauth_states (state, shop_domain, redirect_uri, nonce, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [state, shopDomain, redirectUri, nonce, expiresAt]
        );
      } catch (err) {
        logger.error({ err, shop: shopDomain }, 'Failed to save OAuth state');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to initialize OAuth flow',
          },
        });
      }

      // 5. Setează cookie pentru state (SameSite=None pentru iframe Shopify)
      void reply.cookie('oauth_state', state, {
        httpOnly: true,
        secure: true,
        sameSite: 'none', // Necesar pentru iframe în Shopify Admin
        path: '/auth',
        maxAge: 10 * 60, // 10 minute
      });

      // 6. Construiește authorization URL și redirect
      const authUrl = buildAuthorizationUrl({
        shop: shopDomain,
        clientId: env.shopifyApiKey,
        scopes: env.scopes.join(','),
        redirectUri,
        state,
      });

      logger.info({ shop: shopDomain, redirectTo: authUrl }, 'Redirecting to Shopify authorize');
      return reply.redirect(authUrl);
    }
  );
}
