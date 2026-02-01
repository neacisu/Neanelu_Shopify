import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { pool } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { checkTokenHealth } from '../auth/token-lifecycle.js';
import { ShopifyRateLimitedError } from '@app/shopify-client';

type ConnectionStatusPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type ConnectionStatusResponse = Readonly<{
  shopifyApiStatus: 'connected' | 'degraded' | 'disconnected';
  tokenHealthy: boolean;
  tokenHealthCheckAt: string | null;
  lastApiCallAt: string | null;
  rateLimitRemaining: number | null;
  scopes: string[];
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

export const connectionStatusRoutes: FastifyPluginCallback<ConnectionStatusPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  server.get(
    '/settings/connection',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = (request as typeof request & { session: { shopId: string } }).session;
      const tokenHealthAt = nowIso();

      try {
        const scopesResult = await pool.query<{ scopes: string[] }>(
          `SELECT scopes FROM shops WHERE id = $1`,
          [session.shopId]
        );
        const scopes = scopesResult.rows[0]?.scopes ?? [];

        try {
          const key = Buffer.from(env.encryptionKeyHex, 'hex');
          const health = await checkTokenHealth(session.shopId, key, logger);

          const response: ConnectionStatusResponse = {
            shopifyApiStatus: health.valid
              ? 'connected'
              : health.needsReauth
                ? 'disconnected'
                : 'degraded',
            tokenHealthy: health.valid,
            tokenHealthCheckAt: tokenHealthAt,
            lastApiCallAt: null,
            rateLimitRemaining: null,
            scopes,
          };

          return reply.send(successEnvelope(request.id, response));
        } catch (error) {
          if (error instanceof ShopifyRateLimitedError) {
            const response: ConnectionStatusResponse = {
              shopifyApiStatus: 'degraded',
              tokenHealthy: true,
              tokenHealthCheckAt: tokenHealthAt,
              lastApiCallAt: null,
              rateLimitRemaining: null,
              scopes,
            };
            return reply.send(successEnvelope(request.id, response));
          }
          throw error;
        }
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load connection status');
        return reply
          .status(500)
          .send(
            errorEnvelope(
              request.id,
              500,
              'INTERNAL_SERVER_ERROR',
              'Failed to load connection status'
            )
          );
      }
    }
  );
};
