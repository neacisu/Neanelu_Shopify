import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { isFeatureFlagEnabled } from '../processors/bulk-operations/feature-flags.js';
import {
  recordGuardrailsPiiDetected,
  recordGuardrailsScan,
  setGuardrailsServiceHealth,
} from '../otel/metrics.js';

export type GuardrailsMode = 'disabled' | 'warn-only' | 'enforce';

export type GuardrailsScanResult = Readonly<{
  isValid: boolean;
  blocked: boolean;
  sanitizedText: string;
  detectedScanners: readonly string[];
  piiEntities: readonly string[];
  reason?: string;
  mode: GuardrailsMode;
}>;

function redactCommonPii(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD]')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi, '[REDACTED_IBAN]');
}

async function resolveGuardrailsMode(params: {
  shopId: string;
  env: AppEnv;
}): Promise<GuardrailsMode> {
  if (params.env.guardrailsMode === 'disabled') return 'disabled';
  if (!params.env.guardrailsApiUrl || !params.env.guardrailsAuthToken) return 'disabled';
  const enabled = await isFeatureFlagEnabled({
    shopId: params.shopId,
    flagKey: 'guardrails_enabled',
    fallback: false,
  });
  if (!enabled) return 'disabled';
  return params.env.guardrailsMode;
}

function parseGuardrailsPayload(payload: unknown): {
  blocked: boolean;
  sanitizedText: string | null;
  detectedScanners: string[];
  piiEntities: string[];
  reason: string | undefined;
} {
  if (!payload || typeof payload !== 'object') {
    return {
      blocked: false,
      sanitizedText: null,
      detectedScanners: [],
      piiEntities: [],
      reason: undefined,
    };
  }
  const obj = payload as Record<string, unknown>;
  const blocked = obj['blocked'] === true || obj['is_valid'] === false || obj['valid'] === false;
  const sanitizedText =
    typeof obj['sanitized_prompt'] === 'string'
      ? obj['sanitized_prompt']
      : typeof obj['sanitized_text'] === 'string'
        ? obj['sanitized_text']
        : typeof obj['output_sanitized'] === 'string'
          ? obj['output_sanitized']
          : null;
  const violations = Array.isArray(obj['violations']) ? obj['violations'] : [];
  const detectedScanners = violations
    .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>)['scanner'] : null))
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const piiEntities = violations
    .flatMap((v) => {
      if (!v || typeof v !== 'object') return [];
      const entity = (v as Record<string, unknown>)['entity'];
      if (typeof entity === 'string') return [entity];
      const entities = (v as Record<string, unknown>)['entities'];
      return Array.isArray(entities)
        ? entities.filter((x): x is string => typeof x === 'string')
        : [];
    })
    .filter((v, idx, arr) => arr.indexOf(v) === idx);
  const reason =
    typeof obj['reason'] === 'string'
      ? obj['reason']
      : typeof obj['message'] === 'string'
        ? obj['message']
        : undefined;
  return { blocked, sanitizedText, detectedScanners, piiEntities, reason };
}

async function callGuardrails(params: {
  shopId: string;
  direction: 'input' | 'output';
  endpoint: '/analyze/scan' | '/analyze/output';
  body: Record<string, unknown>;
  fallbackText: string;
  env: AppEnv;
  logger: Logger;
}): Promise<GuardrailsScanResult> {
  const mode = await resolveGuardrailsMode({ shopId: params.shopId, env: params.env });
  if (mode === 'disabled') {
    recordGuardrailsScan({
      direction: params.direction,
      scanner: 'guardrails',
      result: 'skipped',
      latencySeconds: 0,
    });
    return {
      isValid: true,
      blocked: false,
      sanitizedText: params.fallbackText,
      detectedScanners: [],
      piiEntities: [],
      mode,
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(`${params.env.guardrailsApiUrl}${params.endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.env.guardrailsAuthToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params.body),
      signal: AbortSignal.timeout(5_000),
    });
    const latencySeconds = (Date.now() - startedAt) / 1000;
    if (!response.ok) {
      setGuardrailsServiceHealth(false);
      recordGuardrailsScan({
        direction: params.direction,
        scanner: 'guardrails',
        result: 'error',
        latencySeconds,
      });
      params.logger.warn(
        { shopId: params.shopId, status: response.status, direction: params.direction },
        'guardrails_http_error_fail_open'
      );
      return {
        isValid: true,
        blocked: false,
        sanitizedText: params.fallbackText,
        detectedScanners: [],
        piiEntities: [],
        reason: `guardrails_http_${response.status}`,
        mode,
      };
    }

    const parsed = parseGuardrailsPayload(await response.json());
    setGuardrailsServiceHealth(true);
    for (const entity of parsed.piiEntities) {
      recordGuardrailsPiiDetected(entity);
    }
    recordGuardrailsScan({
      direction: params.direction,
      scanner: parsed.detectedScanners[0] ?? 'guardrails',
      result: parsed.blocked ? 'blocked' : 'ok',
      latencySeconds,
    });

    const sanitizedText = parsed.sanitizedText ?? redactCommonPii(params.fallbackText);
    const blocked = parsed.blocked && mode === 'enforce';
    return {
      isValid: !blocked,
      blocked,
      sanitizedText,
      detectedScanners: parsed.detectedScanners,
      piiEntities: parsed.piiEntities,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
      mode,
    };
  } catch (error) {
    const latencySeconds = (Date.now() - startedAt) / 1000;
    setGuardrailsServiceHealth(false);
    recordGuardrailsScan({
      direction: params.direction,
      scanner: 'guardrails',
      result: 'error',
      latencySeconds,
    });
    params.logger.warn(
      { shopId: params.shopId, error, direction: params.direction },
      'guardrails_fail_open'
    );
    return {
      isValid: true,
      blocked: false,
      sanitizedText: params.fallbackText,
      detectedScanners: [],
      piiEntities: [],
      reason: 'guardrails_unavailable',
      mode,
    };
  }
}

export async function scanInput(params: {
  shopId: string;
  text: string;
  env: AppEnv;
  logger: Logger;
}): Promise<GuardrailsScanResult> {
  return await callGuardrails({
    shopId: params.shopId,
    direction: 'input',
    endpoint: '/analyze/scan',
    body: { prompt: params.text },
    fallbackText: params.text,
    env: params.env,
    logger: params.logger,
  });
}

export async function scanOutput(params: {
  shopId: string;
  prompt: string;
  output: string;
  env: AppEnv;
  logger: Logger;
}): Promise<GuardrailsScanResult> {
  return await callGuardrails({
    shopId: params.shopId,
    direction: 'output',
    endpoint: '/analyze/output',
    body: { prompt: params.prompt, output: params.output },
    fallbackText: params.output,
    env: params.env,
    logger: params.logger,
  });
}
