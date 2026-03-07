import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { GpuMetrics, SelfHostedEndpoint, SelfHostedHealthResponse } from '@app/types';
import { withTenantContext } from '@app/database';
import { setSelfhostedKvCacheUsagePercent, setVllmInferenceMetrics } from '../otel/metrics.js';
import {
  loadSelfHostedCredentials,
  normalizeSelfHostedEndpoints,
  validateSelfHostedBaseUrl,
} from './selfhosted-credentials.js';

function nowIso(): string {
  return new Date().toISOString();
}

function buildHeaders(bearerToken: string | null): Record<string, string> {
  if (!bearerToken) {
    return { 'Content-Type': 'application/json' };
  }
  return {
    Authorization: `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
  };
}

function parseGpuMetrics(metricsText: string): GpuMetrics | null {
  const parseValue = (pattern: RegExp): number | null => {
    const match = pattern.exec(metricsText);
    if (!match?.[1]) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };

  const gpuUtilizationPercent = parseValue(/gpu[_:]utilization(?:_percent)?[^\n]* ([0-9.e+-]+)$/m);
  const temperatureCelsius = parseValue(/temperature(?:_celsius|_c)?[^\n]* ([0-9.e+-]+)$/m);
  const vramUsedGiB = parseValue(/vram[_:]used(?:_gib)?[^\n]* ([0-9.e+-]+)$/m);
  const vramTotalGiB = parseValue(/vram[_:]total(?:_gib)?[^\n]* ([0-9.e+-]+)$/m);

  if (
    gpuUtilizationPercent == null &&
    temperatureCelsius == null &&
    vramUsedGiB == null &&
    vramTotalGiB == null
  ) {
    return null;
  }

  return {
    gpuName: null,
    vramUsedGiB,
    vramTotalGiB,
    gpuUtilizationPercent,
    temperatureCelsius,
    collectedAt: nowIso(),
  };
}

function parsePrometheusValue(metricsText: string, names: readonly string[]): number | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped}(?:\\{[^}]*\\})?\\s+([0-9.e+-]+)$`, 'm');
    const match = regex.exec(metricsText);
    if (!match?.[1]) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function fetchEndpointModels(params: {
  endpoint: SelfHostedEndpoint;
  bearerToken: string | null;
}): Promise<{
  status: 'ok' | 'error' | 'unreachable';
  latencyMs: number | null;
  message: string;
  modelsLoaded: string[];
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.endpoint.timeoutMs);
  const startedAt = Date.now();

  try {
    const modelsUrl = params.endpoint.baseUrl.replace(/\/+$/, '').endsWith('/v1')
      ? `${params.endpoint.baseUrl.replace(/\/+$/, '')}/models`
      : `${params.endpoint.baseUrl.replace(/\/+$/, '')}/v1/models`;
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: buildHeaders(params.bearerToken),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        status: 'error',
        latencyMs,
        message: `HTTP ${response.status}`,
        modelsLoaded: [],
      };
    }

    const payload = (await response.json()) as { data?: { id?: string }[] };
    const modelsLoaded = (payload.data ?? [])
      .map((item) => item.id ?? '')
      .filter((item) => item.length > 0);

    if (!modelsLoaded.includes(params.endpoint.modelId)) {
      return {
        status: 'error',
        latencyMs,
        message: `Configured model not present on endpoint (${params.endpoint.modelId})`,
        modelsLoaded,
      };
    }

    return {
      status: 'ok',
      latencyMs,
      message: 'Endpoint reachable',
      modelsLoaded,
    };
  } catch (error) {
    return {
      status: 'unreachable',
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : 'Endpoint unreachable',
      modelsLoaded: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGpuMetrics(params: {
  endpoint: SelfHostedEndpoint | null;
  bearerToken: string | null;
}): Promise<GpuMetrics | null> {
  if (!params.endpoint) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(params.endpoint.timeoutMs, 10_000));
  try {
    const metricsBase = params.endpoint.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const response = await fetch(`${metricsBase}/metrics`, {
      method: 'GET',
      headers: buildHeaders(params.bearerToken),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    const kvCacheUsagePercent = parsePrometheusValue(text, [
      'vllm_gpu_cache_usage_perc',
      'vllm:gpu_cache_usage_perc',
    ]);
    const ttftSeconds = parsePrometheusValue(text, [
      'vllm_time_to_first_token_seconds',
      'vllm:time_to_first_token_seconds',
    ]);
    const numRequestsRunning = parsePrometheusValue(text, [
      'vllm_num_requests_running',
      'vllm:num_requests_running',
    ]);
    const numRequestsWaiting = parsePrometheusValue(text, [
      'vllm_num_requests_waiting',
      'vllm:num_requests_waiting',
    ]);
    const prefixCacheHitRate = parsePrometheusValue(text, [
      'vllm_gpu_prefix_cache_hit_rate',
      'vllm:gpu_prefix_cache_hit_rate',
    ]);
    if (typeof kvCacheUsagePercent === 'number') {
      setSelfhostedKvCacheUsagePercent(kvCacheUsagePercent / 100);
    }
    setVllmInferenceMetrics({
      ...(typeof ttftSeconds === 'number' ? { timeToFirstTokenSeconds: ttftSeconds } : {}),
      ...(typeof numRequestsRunning === 'number' ? { numRequestsRunning } : {}),
      ...(typeof numRequestsWaiting === 'number' ? { numRequestsWaiting } : {}),
      ...(typeof kvCacheUsagePercent === 'number'
        ? { gpuCacheUsagePerc: kvCacheUsagePercent }
        : {}),
      ...(typeof prefixCacheHitRate === 'number' ? { prefixCacheHitRate } : {}),
    });
    return parseGpuMetrics(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runSelfHostedHealthCheck(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  bearerTokenOverride?: string | null;
  endpointsOverride?: unknown;
  allowStoredWhenDisabled?: boolean;
  persist?: boolean;
}): Promise<SelfHostedHealthResponse> {
  const stored = await loadSelfHostedCredentials({
    shopId: params.shopId,
    encryptionKeyHex: params.env.encryptionKeyHex,
    allowDisabled: true,
  });

  if (!stored) {
    return {
      status: 'disabled',
      checkedAt: nowIso(),
      endpoints: {},
      gpuMetrics: null,
    };
  }

  const enabled = stored.enabled || params.allowStoredWhenDisabled === true;
  if (!enabled && !params.endpointsOverride) {
    return {
      status: 'disabled',
      checkedAt: nowIso(),
      endpoints: {},
      gpuMetrics: null,
    };
  }

  const endpoints = params.endpointsOverride
    ? normalizeSelfHostedEndpoints(params.endpointsOverride).map((endpoint) => ({
        ...endpoint,
        baseUrl: validateSelfHostedBaseUrl(endpoint.baseUrl),
      }))
    : stored.endpoints;

  const activeEndpoints = endpoints.filter(
    (endpoint) =>
      endpoint.enabled &&
      (endpoint.type === 'chat' || endpoint.type === 'embedding' || endpoint.type === 'both')
  );
  const bearerToken = params.bearerTokenOverride ?? stored.bearerToken;

  const endpointEntries = await Promise.all(
    activeEndpoints.map(async (endpoint) => {
      const result = await fetchEndpointModels({ endpoint, bearerToken });
      return [endpoint.id, result] as const;
    })
  );

  const endpointStatuses = Object.fromEntries(
    endpointEntries.map(([id, result]) => [
      id,
      {
        status: result.status,
        latencyMs: result.latencyMs,
        message: result.message,
        modelsLoaded: result.modelsLoaded,
      },
    ])
  );

  const okCount = endpointEntries.filter(([, result]) => result.status === 'ok').length;
  const unreachableCount = endpointEntries.filter(
    ([, result]) => result.status === 'unreachable'
  ).length;

  const status: SelfHostedHealthResponse['status'] =
    endpointEntries.length === 0
      ? 'error'
      : okCount === endpointEntries.length
        ? 'ok'
        : okCount > 0
          ? 'partial'
          : unreachableCount === endpointEntries.length
            ? 'unreachable'
            : 'error';

  const gpuMetrics = await fetchGpuMetrics({
    endpoint:
      activeEndpoints.find((endpoint) => endpoint.type === 'chat' || endpoint.type === 'both') ??
      null,
    bearerToken,
  });

  if (params.persist) {
    const connectionStatus =
      status === 'ok'
        ? 'connected'
        : status === 'partial'
          ? 'error'
          : status === 'unreachable'
            ? 'unreachable'
            : status;
    const lastError = endpointEntries
      .map(([, result]) => (result.status === 'ok' ? null : result.message))
      .find((value) => typeof value === 'string' && value.length > 0);

    await withTenantContext(params.shopId, async (client) => {
      await client.query(
        `UPDATE shop_ai_credentials
            SET selfhosted_connection_status = $1,
                selfhosted_last_checked_at = now(),
                selfhosted_last_error = $2,
                selfhosted_last_success_at = CASE WHEN $1 = 'connected' THEN now() ELSE selfhosted_last_success_at END
          WHERE shop_id = $3`,
        [connectionStatus, lastError ?? null, params.shopId]
      );
    });
  }

  params.logger.info(
    {
      shopId: params.shopId,
      status,
      endpoints: endpointEntries.map(([endpointId, result]) => ({
        endpointId,
        status: result.status,
      })),
    },
    'selfhosted health check completed'
  );

  return {
    status,
    checkedAt: nowIso(),
    endpoints: endpointStatuses,
    gpuMetrics,
  };
}
