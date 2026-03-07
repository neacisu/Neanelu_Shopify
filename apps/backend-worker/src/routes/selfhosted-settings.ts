import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type {
  SelfHostedHealthResponse,
  SelfHostedSettingsResponse,
  SelfHostedSettingsUpdateRequest,
} from '@app/types';
import { encryptAesGcm, withTenantContext } from '@app/database';
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { normalizeSelfHostedEndpoints } from '../services/selfhosted-credentials.js';
import { runSelfHostedHealthCheck } from '../services/selfhosted-health.js';

type SelfHostedSettingsPluginOptions = Readonly<{
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}>;

type SelfHostedRow = Readonly<{
  selfhostedEnabled: boolean;
  hasBearerToken: boolean;
  selfhostedEndpoints: unknown;
  selfhostedConnectionStatus: SelfHostedSettingsResponse['connectionStatus'] | null;
  selfhostedLastCheckedAt: string | null;
  selfhostedLastSuccessAt: string | null;
  selfhostedLastError: string | null;
}>;

type RequestWithSession = FastifyRequest & {
  session?: {
    shopId: string;
  };
};

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

function buildEncryptionKey(env: AppEnv): Buffer {
  const key = Buffer.from(env.encryptionKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid encryption key length (expected 32 bytes)');
  }
  return key;
}

async function loadSelfHostedUsage(shopId: string) {
  return withTenantContext(shopId, async (client) => {
    const result = await client.query<{
      requests: string;
      inputTokens: string;
      outputTokens: string;
      cost: string;
    }>(
      `SELECT
         COALESCE(SUM(request_count), 0) as requests,
         COALESCE(SUM(tokens_input), 0) as "inputTokens",
         COALESCE(SUM(tokens_output), 0) as "outputTokens",
         COALESCE(SUM(estimated_cost), 0) as cost
       FROM api_usage_log
      WHERE api_provider = 'selfhosted'
        AND created_at >= date_trunc('day', now())
        AND created_at < date_trunc('day', now()) + interval '1 day'`
    );
    const row = result.rows[0];
    return {
      requests: Number(row?.requests ?? 0),
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
      cost: Number(row?.cost ?? 0),
    };
  });
}

function toApiResponse(params: {
  row: SelfHostedRow | undefined;
  health: SelfHostedHealthResponse | null;
  usage: { requests: number; inputTokens: number; outputTokens: number; cost: number };
}): SelfHostedSettingsResponse {
  const endpoints = normalizeSelfHostedEndpoints(params.row?.selfhostedEndpoints ?? []);
  return {
    enabled: params.row?.selfhostedEnabled ?? false,
    hasBearerToken: params.row?.hasBearerToken ?? false,
    endpoints,
    connectionStatus:
      params.row?.selfhostedConnectionStatus ??
      (params.health?.status === 'unreachable' ? 'unreachable' : 'unknown'),
    lastCheckedAt: params.row?.selfhostedLastCheckedAt ?? null,
    lastSuccessAt: params.row?.selfhostedLastSuccessAt ?? null,
    lastError: params.row?.selfhostedLastError ?? null,
    gpuMetrics: params.health?.gpuMetrics ?? null,
    endpointStatuses: Object.fromEntries(
      endpoints.map((endpoint) => {
        const healthStatus = params.health?.endpoints[endpoint.id];
        return [
          endpoint.id,
          {
            status:
              healthStatus?.status === 'ok'
                ? 'connected'
                : healthStatus?.status === 'unreachable'
                  ? 'unreachable'
                  : 'error',
            latencyMs: healthStatus?.latencyMs ?? null,
            lastError: healthStatus && healthStatus.status !== 'ok' ? healthStatus.message : null,
            modelsLoaded: healthStatus?.modelsLoaded ?? [],
          },
        ];
      })
    ),
    todayUsage: {
      requests: params.usage.requests,
      tokensInput: params.usage.inputTokens,
      tokensOutput: params.usage.outputTokens,
      estimatedCost: params.usage.cost,
    },
  };
}

export const selfhostedSettingsRoutes: FastifyPluginCallback<SelfHostedSettingsPluginOptions> = (
  server: FastifyInstance,
  options
) => {
  const { env, logger, sessionConfig } = options;

  const fetchRow = async (shopId: string) =>
    await withTenantContext(shopId, async (client) => {
      const result = await client.query<SelfHostedRow>(
        `SELECT
           selfhosted_enabled AS "selfhostedEnabled",
           selfhosted_bearer_token_ciphertext IS NOT NULL AS "hasBearerToken",
           selfhosted_endpoints AS "selfhostedEndpoints",
           selfhosted_connection_status AS "selfhostedConnectionStatus",
           selfhosted_last_checked_at AS "selfhostedLastCheckedAt",
           selfhosted_last_success_at AS "selfhostedLastSuccessAt",
           selfhosted_last_error AS "selfhostedLastError"
         FROM shop_ai_credentials
         WHERE shop_id = $1`,
        [shopId]
      );
      return result.rows[0];
    });

  server.get(
    '/settings/selfhosted',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      try {
        let row = await fetchRow(session.shopId);
        const health = row?.selfhostedEnabled
          ? await runSelfHostedHealthCheck({
              shopId: session.shopId,
              env,
              logger,
              allowStoredWhenDisabled: true,
              persist: true,
            })
          : null;
        row = await fetchRow(session.shopId);
        const usage = await loadSelfHostedUsage(session.shopId);
        return reply.send(successEnvelope(request.id, toApiResponse({ row, health, usage })));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to load selfhosted settings');
        return reply
          .status(500)
          .send(errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to load settings'));
      }
    }
  );

  server.put(
    '/settings/selfhosted',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = (request.body ?? {}) as SelfHostedSettingsUpdateRequest;
      const enabled = body.enabled;
      const bearerToken = body.bearerToken;

      let endpoints = body.endpoints;
      try {
        if (endpoints !== undefined) {
          endpoints = normalizeSelfHostedEndpoints(endpoints);
        }
      } catch (error) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              error instanceof Error ? error.message : 'Invalid selfhosted endpoints'
            )
          );
      }

      try {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `INSERT INTO shop_ai_credentials (shop_id)
             VALUES ($1)
             ON CONFLICT (shop_id) DO NOTHING`,
            [session.shopId]
          );

          const updates: string[] = [];
          const values: (
            | string
            | boolean
            | number
            | Buffer
            | null
            | SelfHostedSettingsUpdateRequest['endpoints']
          )[] = [session.shopId];
          let idx = 2;
          let nextStatus: string | null | undefined;

          if (typeof enabled === 'boolean') {
            updates.push(`selfhosted_enabled = $${idx++}`);
            values.push(enabled);
            nextStatus = enabled ? 'pending' : 'disabled';
          }

          if (endpoints !== undefined) {
            updates.push(`selfhosted_endpoints = $${idx++}::jsonb`);
            values.push(JSON.stringify(endpoints));
            if (endpoints.length === 0 && enabled !== false) {
              nextStatus = 'error';
            }
          }

          if (bearerToken !== undefined) {
            const trimmed = bearerToken?.trim?.() ?? '';
            if (trimmed.length === 0) {
              updates.push(`selfhosted_bearer_token_ciphertext = NULL`);
              updates.push(`selfhosted_bearer_token_iv = NULL`);
              updates.push(`selfhosted_bearer_token_tag = NULL`);
              updates.push(`selfhosted_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
            } else {
              const encrypted = encryptAesGcm(
                Buffer.from(trimmed, 'utf-8'),
                buildEncryptionKey(env)
              );
              updates.push(`selfhosted_bearer_token_ciphertext = $${idx++}`);
              values.push(encrypted.ciphertext);
              updates.push(`selfhosted_bearer_token_iv = $${idx++}`);
              values.push(encrypted.iv);
              updates.push(`selfhosted_bearer_token_tag = $${idx++}`);
              values.push(encrypted.tag);
              updates.push(`selfhosted_key_version = $${idx++}`);
              values.push(env.encryptionKeyVersion);
            }
          }

          if (nextStatus != null) {
            updates.push(`selfhosted_connection_status = $${idx}`);
            values.push(nextStatus);
            updates.push(`selfhosted_last_error = NULL`);
          }

          if (updates.length > 0) {
            await client.query(
              `UPDATE shop_ai_credentials
                  SET ${updates.join(', ')}, updated_at = now()
                WHERE shop_id = $1`,
              values
            );
          }
        });

        logger.info(
          {
            shopId: session.shopId,
            enabled,
            endpointCount: endpoints?.length,
          },
          'selfhosted settings updated'
        );

        const row = await fetchRow(session.shopId);
        const usage = await loadSelfHostedUsage(session.shopId);
        return reply.send(successEnvelope(request.id, toApiResponse({ row, health: null, usage })));
      } catch (error) {
        logger.error({ requestId: request.id, error }, 'Failed to update selfhosted settings');
        return reply
          .status(500)
          .send(
            errorEnvelope(request.id, 500, 'INTERNAL_SERVER_ERROR', 'Failed to update settings')
          );
      }
    }
  );

  const handleHealthRequest = async (
    request: FastifyRequest,
    reply: FastifyReply,
    body: { bearerToken?: unknown; endpoints?: unknown; useStoredToken?: unknown }
  ) => {
    const session = (request as RequestWithSession).session;
    if (!session) {
      return reply.status(401).send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
    }

    try {
      const health = await runSelfHostedHealthCheck({
        shopId: session.shopId,
        env,
        logger,
        bearerTokenOverride:
          typeof body.bearerToken === 'string' && body.bearerToken.trim().length > 0
            ? body.bearerToken.trim()
            : null,
        endpointsOverride: body.endpoints,
        allowStoredWhenDisabled: body.useStoredToken === true,
        persist: body.endpoints === undefined && body.bearerToken === undefined,
      });
      return reply.send(successEnvelope(request.id, health));
    } catch (error) {
      const health: SelfHostedHealthResponse = {
        status: 'error',
        checkedAt: nowIso(),
        endpoints: {},
        gpuMetrics: null,
      };
      logger.warn({ requestId: request.id, error }, 'Selfhosted health check failed');
      return reply.send(successEnvelope(request.id, health));
    }
  };

  server.get(
    '/settings/selfhosted/health',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) => handleHealthRequest(request, reply, {})
  );

  server.post(
    '/settings/selfhosted/health',
    { preHandler: [requireSession(sessionConfig)] },
    async (request, reply) =>
      handleHealthRequest(
        request,
        reply,
        (request.body ?? {}) as {
          bearerToken?: unknown;
          endpoints?: unknown;
          useStoredToken?: unknown;
        }
      )
  );
};
