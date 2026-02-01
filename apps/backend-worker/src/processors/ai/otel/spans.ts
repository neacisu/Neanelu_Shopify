import { withSpan } from '@app/logger';

export type AiSpanAttributes = Record<string, string | number | boolean> & {
  'ai.shop_id'?: string;
  'ai.batch_id'?: string;
  'ai.items_count'?: number;
  'ai.tokens_used'?: number;
  'ai.embedding_type'?: string;
};

export type AiSpanInputAttributes = AiSpanAttributes & {
  shopId?: string;
};

export const AI_SPAN_NAMES = {
  ENQUEUE: 'ai.batch.enqueue',
  ORCHESTRATOR: 'ai.batch.orchestrator',
  BUILD: 'ai.batch.build',
  SUBMIT: 'ai.batch.submit',
  POLL: 'ai.batch.poll',
  DOWNLOAD: 'ai.batch.download',
  PARSE: 'ai.batch.parse',
  DB_UPSERT: 'ai.batch.db_upsert',
  SEARCH_QUERY: 'ai.search.query',
  SEARCH_EMBEDDING: 'ai.search.embedding',
} as const;

export function withAiSpan<T>(
  name: (typeof AI_SPAN_NAMES)[keyof typeof AI_SPAN_NAMES],
  attributes: AiSpanInputAttributes,
  fn: () => T | Promise<T>
): Promise<T> {
  const { shopId, ...rest } = attributes;
  const resolvedShopId = shopId ?? rest['ai.shop_id'];
  const spanAttributes: AiSpanAttributes = {
    ...rest,
    ...(resolvedShopId ? { 'ai.shop_id': resolvedShopId, 'shop.id': resolvedShopId } : {}),
  };
  return withSpan(name, spanAttributes, async () => Promise.resolve(fn()));
}
