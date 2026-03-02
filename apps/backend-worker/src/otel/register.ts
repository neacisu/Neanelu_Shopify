/**
 * OpenTelemetry Registration (Preload)
 *
 * Must be loaded with: node --import ./src/otel/register.ts
 *
 * Inițializează SDK-ul OTel înainte de a importa orice altceva
 * pentru a captura toate modulele auto-instrumentation.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  AlwaysOnSampler,
} from '@opentelemetry/sdk-trace-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { loadOtelConfig } from '@app/config';

const otelConfig = loadOtelConfig(process.env);
const serviceName = otelConfig.serviceName;
const serviceVersion = process.env['npm_package_version'] ?? '0.1.0';
const otlpEndpoint = otelConfig.exporterEndpoint;
const samplingRatio = otelConfig.samplingRatio;
const isDebug = otelConfig.debug;
const nodeEnv = process.env['NODE_ENV'] ?? 'development';

if (isDebug && nodeEnv === 'development') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

function createSampler() {
  if (nodeEnv === 'production') {
    return new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplingRatio),
    });
  }
  if (samplingRatio >= 1.0) {
    return new AlwaysOnSampler();
  }
  return new TraceIdRatioBasedSampler(samplingRatio);
}

function filterInstrumentations(instrumentations: Instrumentation[]): Instrumentation[] {
  const disabledNames = new Set([
    '@opentelemetry/instrumentation-fs',
    '@opentelemetry/instrumentation-dns',
    '@opentelemetry/instrumentation-net',
  ]);
  return instrumentations.filter((inst) => !disabledNames.has(inst.instrumentationName));
}

let sdk: NodeSDK | null = null;

function initializeOtel(): void {
  if (!otelConfig.enabled) {
    console.info('[OTel] No OTLP endpoint configured, tracing disabled');
    return;
  }

  try {
    const traceExporter = new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
    });
    const metricExporter = new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
    });

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: serviceVersion,
        'deployment.environment': nodeEnv,
      }),
      traceExporter,
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 30_000,
      }),
      sampler: createSampler(),
      instrumentations: [filterInstrumentations(getNodeAutoInstrumentations())],
    });

    sdk.start();
    console.info(
      `[OTel] SDK started (endpoint: ${otlpEndpoint}, sampling: ${String(samplingRatio * 100)}%)`
    );

    process.on('SIGTERM', () => {
      sdk
        ?.shutdown()
        .then(() => console.info('[OTel] SDK shutdown complete'))
        .catch((err: unknown) => console.error('[OTel] SDK shutdown error', err));
    });
  } catch (error) {
    console.warn('[OTel] Failed to initialize SDK, continuing without tracing:', error);
  }
}

initializeOtel();

export { sdk };
