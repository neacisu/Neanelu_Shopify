/**
 * OpenTelemetry Log Correlation
 *
 * CONFORM: Plan_de_implementare F3.4.2
 * Leagă logger-ul de contextul OTel pentru corelație logs-traces.
 */

import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

export type TraceContext = Readonly<{
  traceId: string | undefined;
  spanId: string | undefined;
  traceFlags: number | undefined;
}>;

/**
 * Get current trace context from active span
 */
export function getTraceContext(): TraceContext {
  const activeSpan = trace.getActiveSpan();
  const spanContext = activeSpan?.spanContext();

  if (!spanContext) {
    return { traceId: undefined, spanId: undefined, traceFlags: undefined };
  }

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
}

/**
 * Create a child span with given name and optional attributes
 */
export function createSpan(
  name: string,
  attributes: Record<string, string | number | boolean> = {}
): Span {
  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan(name, { attributes });
  return span;
}

/**
 * Run a function within a new span context (async version)
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan(name, { attributes });

  try {
    const result = await otelContext.with(trace.setSpan(otelContext.active(), span), () =>
      fn(span)
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Run a sync function within a new span context
 */
export function withSpanSync<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => T
): T {
  const tracer = trace.getTracer('neanelu-shopify');
  const span = tracer.startSpan(name, { attributes });

  try {
    const result = otelContext.with(trace.setSpan(otelContext.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Add request ID to current span attributes
 */
export function setRequestIdAttribute(requestId: string): void {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute('http.request_id', requestId);
  }
}
