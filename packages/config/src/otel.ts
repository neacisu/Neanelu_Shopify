/**
 * OpenTelemetry Configuration
 *
 * CONFORM: Plan_de_implementare F3.4.5
 * Configurare OTel per environment.
 */

export type OtelConfig = Readonly<{
  enabled: boolean;
  samplingRatio: number;
  errorSamplingRatio: number;
  exporterEndpoint: string;
  serviceName: string;
  debug: boolean;
}>;

export function loadOtelConfig(env: Record<string, string | undefined> = process.env): OtelConfig {
  const endpoint = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim() ?? '';
  const nodeEnv = env['NODE_ENV'] ?? 'development';

  // Default sampling ratios per environment
  const defaultSamplingByEnv: Record<string, number> = {
    development: 1.0, // 100%
    staging: 0.5, // 50%
    production: 0.1, // 10%
    test: 0.0, // 0% in tests
  };

  const samplingRatio = parseFloat(
    env['OTEL_SAMPLING_RATIO'] ?? String(defaultSamplingByEnv[nodeEnv] ?? 1.0)
  );

  const errorSamplingRatio = parseFloat(env['OTEL_ERROR_SAMPLING'] ?? '1.0');

  return {
    enabled: Boolean(endpoint),
    samplingRatio: Math.min(1.0, Math.max(0.0, samplingRatio)),
    errorSamplingRatio: Math.min(1.0, Math.max(0.0, errorSamplingRatio)),
    exporterEndpoint: endpoint,
    serviceName: env['OTEL_SERVICE_NAME'] ?? 'neanelu-shopify',
    debug: env['OBS_DEBUG'] === '1',
  };
}
