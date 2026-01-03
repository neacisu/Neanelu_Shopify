/**
 * OpenTelemetry Registration (Preload)
 *
 * CONFORM: Plan_de_implementare F3.4.1
 * Must be loaded with: node --import ./src/otel/register.ts
 *
 * Inițializează SDK-ul OTel înainte de a importa orice altceva
 * pentru a captura toate modulele auto-instrumentation.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
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

// ============================================
// Environment Configuration
// ============================================
const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'neanelu-shopify';
const serviceVersion = process.env['npm_package_version'] ?? '0.1.0';
const otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? '';
const samplingRatio = parseFloat(process.env['OTEL_SAMPLING_RATIO'] ?? '1.0');
const isDebug = process.env['OBS_DEBUG'] === '1';
const nodeEnv = process.env['NODE_ENV'] ?? 'development';

// ============================================
// Diagnostic (verbose logging în dev dacă OBS_DEBUG=1)
// ============================================
if (isDebug && nodeEnv === 'development') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

// ============================================
// Sampler Configuration
// ============================================
// În producție error sampling = 100%, traces normale = samplingRatio
function createSampler(): ParentBasedSampler | AlwaysOnSampler | TraceIdRatioBasedSampler {
  if (nodeEnv === 'production') {
    // Parent-based sampler with ratio sampling
    return new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplingRatio),
    });
  }
  // Dev/staging: ratio-based
  if (samplingRatio >= 1.0) {
    return new AlwaysOnSampler();
  }
  return new TraceIdRatioBasedSampler(samplingRatio);
}

// ============================================
// SDK Initialization
// ============================================
let sdk: NodeSDK | null = null;

function initializeOtel(): void {
  // Skip initialization if no endpoint configured (CI mode)
  if (!otlpEndpoint) {
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
        exportIntervalMillis: 30_000, // Export every 30s
      }),
      sampler: createSampler(),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Dezactivăm instrumentations care ar genera zgomot
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
          // Activăm cele necesare
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-pg': { enabled: true },
          '@opentelemetry/instrumentation-ioredis': { enabled: true },
          '@opentelemetry/instrumentation-fastify': { enabled: true },
        }),
      ],
    });

    sdk.start();
    console.info(
      `[OTel] SDK started (endpoint: ${otlpEndpoint}, sampling: ${String(samplingRatio * 100)}%)`
    );

    // Graceful shutdown
    process.on('SIGTERM', () => {
      sdk
        ?.shutdown()
        .then(() => console.info('[OTel] SDK shutdown complete'))
        .catch((err: unknown) => console.error('[OTel] SDK shutdown error', err));
    });
  } catch (error: unknown) {
    // FALLBACK SILENȚIOS - nu bloca runtime
    console.warn('[OTel] Failed to initialize SDK, continuing without tracing:', error);
  }
}

initializeOtel();

export { sdk };
