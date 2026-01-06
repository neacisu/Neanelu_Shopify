import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { context as otelContext, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

import {
  buildJobTelemetryFromActiveContext,
  extractOtelContextFromTelemetryMetadata,
} from '../queue-manager.js';

function randomTraceId(): string {
  return randomBytes(16).toString('hex');
}

function randomSpanId(): string {
  return randomBytes(8).toString('hex');
}

// Test-only setup: unit tests don't run the full OTel SDK bootstrap, so we install
// a real context manager + propagator to validate inject/extract behavior.
otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

void describe('otel propagation helpers', () => {
  void it('round-trips trace context via BullMQ telemetry.metadata', () => {
    const spanContext = {
      traceId: randomTraceId(),
      spanId: randomSpanId(),
      traceFlags: 1,
      isRemote: false,
    };

    const span = trace.wrapSpanContext(spanContext);
    const activeCtx = trace.setSpan(otelContext.active(), span);

    const telemetry = otelContext.with(activeCtx, () => buildJobTelemetryFromActiveContext());
    assert.ok(telemetry?.metadata, 'expected telemetry.metadata to be present');

    const extractedCtx = extractOtelContextFromTelemetryMetadata(telemetry?.metadata);
    const extractedSpanContext = trace.getSpanContext(extractedCtx);

    assert.equal(extractedSpanContext?.traceId, spanContext.traceId);
    assert.equal(extractedSpanContext?.spanId, spanContext.spanId);
  });

  void it('handles invalid metadata safely', () => {
    const extractedCtx = extractOtelContextFromTelemetryMetadata('not-json-and-not-traceparent');
    const extractedSpanContext = trace.getSpanContext(extractedCtx);

    assert.equal(extractedSpanContext, undefined);
  });
});
