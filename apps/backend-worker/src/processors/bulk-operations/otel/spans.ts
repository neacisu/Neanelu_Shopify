import { withSpan, OTEL_ATTR } from '@app/logger';
import type { Span } from '@opentelemetry/api';

export type BulkSpanAttributes = Readonly<{
  shopId?: string | null;
  bulkRunId?: string | null;
  operationType?: string | null;
  queryType?: string | null;
  mutationType?: string | null;
  status?: string | null;
  step?: string | null;
}>;

export function buildBulkSpanAttributes(
  attrs: BulkSpanAttributes
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (attrs.shopId) out[OTEL_ATTR.SHOP_ID] = attrs.shopId;
  if (attrs.bulkRunId) out[OTEL_ATTR.BULK_RUN_ID] = attrs.bulkRunId;
  if (attrs.operationType) out[OTEL_ATTR.BULK_OPERATION_TYPE] = attrs.operationType;
  if (attrs.queryType) out[OTEL_ATTR.BULK_QUERY_TYPE] = attrs.queryType;
  if (attrs.mutationType) out[OTEL_ATTR.BULK_MUTATION_TYPE] = attrs.mutationType;
  if (attrs.status) out[OTEL_ATTR.BULK_STATUS] = attrs.status;
  if (attrs.step) out[OTEL_ATTR.BULK_STEP] = attrs.step;
  return out;
}

export function applyBulkSpanAttributes(span: Span, attrs: BulkSpanAttributes): void {
  const resolved = buildBulkSpanAttributes(attrs);
  for (const [key, value] of Object.entries(resolved)) {
    span.setAttribute(key, value);
  }
}

export async function withBulkSpan<T>(
  name: string,
  attrs: BulkSpanAttributes,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return await withSpan(name, buildBulkSpanAttributes(attrs), fn);
}
