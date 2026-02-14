import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTenantContext } from '@app/database';
import type { SessionConfig } from '../auth/session.js';
import { getSessionFromRequest, requireSession } from '../auth/session.js';

interface UxEventsPluginOptions {
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}

type UxEventBody = Readonly<{
  name?: unknown;
  payload?: unknown;
  resourceType?: unknown;
  resourceId?: unknown;
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

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeUuid(value: unknown): string | null {
  const s = normalizeString(value);
  if (!s) return null;
  // Accept canonical UUID strings; keep strict to avoid DB cast errors.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return null;
  }
  return s;
}

export const uxEventsRoutes: FastifyPluginAsync<UxEventsPluginOptions> = (
  server: FastifyInstance,
  { logger, sessionConfig }
) => {
  server.post(
    '/ux/events',
    { preHandler: requireSession(sessionConfig) },
    async (request, reply) => {
      const session = getSessionFromRequest(request, sessionConfig);
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Session required'));
      }

      const body = (request.body ?? {}) as UxEventBody;
      const name = normalizeString(body.name);
      if (!name) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing name'));
      }

      const payload = normalizeJsonObject(body.payload);
      const resourceType = normalizeString(body.resourceType);
      const resourceId = normalizeUuid(body.resourceId);

      try {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `INSERT INTO audit_logs (action, actor_type, shop_id, resource_type, resource_id, details, ip_address, user_agent, created_at)
             VALUES ($1, 'ui', $2, $3, $4::uuid, $5::jsonb, $6::inet, $7, now())`,
            [
              `ux:${name}`,
              session.shopId,
              resourceType,
              resourceId,
              JSON.stringify(payload),
              request.ip ?? null,
              typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']
                : null,
            ]
          );
        });
      } catch (error) {
        logger.warn({ requestId: request.id, error }, 'Failed to persist UX event');
        // Non-fatal: UX events should not break the UI.
      }

      return reply.send(successEnvelope(request.id, { ok: true }));
    }
  );

  return Promise.resolve();
};
