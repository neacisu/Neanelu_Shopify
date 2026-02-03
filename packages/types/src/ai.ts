export const AI_EMBEDDING_BATCH_TYPES = [
  'product_title',
  'product_description',
  'specs',
  'combined',
  'attribute',
] as const;

export type AiEmbeddingBatchType = (typeof AI_EMBEDDING_BATCH_TYPES)[number];

export const AI_EMBEDDING_TYPES = ['title', 'description', 'combined'] as const;

export type AiEmbeddingType = (typeof AI_EMBEDDING_TYPES)[number];

export type AiBatchTriggeredBy = 'scheduler' | 'manual' | 'system';

export interface AiBatchOrchestratorJobPayload {
  shopId: string;
  batchType: AiEmbeddingBatchType;
  embeddingType: AiEmbeddingType;
  model: string;
  dimensions: number;
  requestedAt: number;
  triggeredBy: AiBatchTriggeredBy;
  maxItems?: number;
  productIds?: string[];
}

export interface AiBatchPollerJobPayload {
  shopId: string;
  embeddingBatchId: string;
  openAiBatchId: string;
  requestedAt: number;
  triggeredBy: AiBatchTriggeredBy;
  pollAttempt?: number;
}

export interface AiBatchCleanupJobPayload {
  shopId: string;
  requestedAt: number;
  triggeredBy: AiBatchTriggeredBy;
  retentionDays?: number;
}

export interface AiBatchBackfillJobPayload {
  shopId: string;
  requestedAt: number;
  triggeredBy: AiBatchTriggeredBy;
  chunkSize?: number;
  offsetProductId?: string;
  dailyBudgetRemaining?: number;
  nightlyWindowOnly?: boolean;
}

export interface AiSettingsResponse {
  enabled: boolean;
  hasApiKey: boolean;
  openaiBaseUrl?: string | null;
  openaiEmbeddingsModel?: string | null;
  embeddingBatchSize?: number;
  similarityThreshold?: number;
  availableModels?: string[];
  connectionStatus?: 'unknown' | 'connected' | 'error' | 'disabled' | 'missing_key' | 'pending';
  lastCheckedAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  todayUsage?: {
    requests: number;
    inputTokens: number;
    estimatedCost: number;
    percentUsed: number;
  };
}

export interface AiSettingsUpdateRequest {
  enabled?: boolean;
  apiKey?: string | null;
  openaiBaseUrl?: string | null;
  openaiEmbeddingsModel?: string | null;
  embeddingBatchSize?: number;
  similarityThreshold?: number;
}

export interface AiHealthResponse {
  status: 'ok' | 'disabled' | 'missing_key' | 'error';
  checkedAt: string;
  message?: string;
  latencyMs?: number;
  httpStatus?: number;
  baseUrl?: string;
  model?: string;
  source?: 'shop' | 'env' | 'disabled';
}

export interface XaiSettingsResponse {
  enabled: boolean;
  hasApiKey: boolean;
  baseUrl: string | null;
  model: string | null;
  availableModels: string[];
  temperature: number;
  maxTokensPerRequest: number;
  rateLimitPerMinute: number;
  dailyBudget: number;
  budgetAlertThreshold: number;
  connectionStatus: 'unknown' | 'connected' | 'error' | 'disabled' | 'missing_key' | 'pending';
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  todayUsage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    percentUsed: number;
  };
}

export interface XaiSettingsUpdateRequest {
  enabled?: boolean;
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  temperature?: number;
  maxTokensPerRequest?: number;
  rateLimitPerMinute?: number;
  dailyBudget?: number;
  budgetAlertThreshold?: number;
}

export interface XaiHealthResponse {
  status: 'ok' | 'disabled' | 'missing_key' | 'error';
  message?: string;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  baseUrl?: string;
  model?: string;
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function validateAiBatchOrchestratorJobPayload(
  data: unknown
): data is AiBatchOrchestratorJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<AiBatchOrchestratorJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.batchType !== 'string') return false;
  if (!(AI_EMBEDDING_BATCH_TYPES as readonly string[]).includes(job.batchType)) return false;
  if (typeof job.embeddingType !== 'string') return false;
  if (!(AI_EMBEDDING_TYPES as readonly string[]).includes(job.embeddingType)) return false;
  if (typeof job.model !== 'string' || !job.model.trim()) return false;
  if (typeof job.dimensions !== 'number' || !Number.isFinite(job.dimensions)) return false;
  if (!Number.isInteger(job.dimensions) || job.dimensions <= 0) return false;
  if (typeof job.requestedAt !== 'number' || !Number.isFinite(job.requestedAt)) return false;

  if (
    job.triggeredBy !== 'scheduler' &&
    job.triggeredBy !== 'manual' &&
    job.triggeredBy !== 'system'
  ) {
    return false;
  }

  if (job.maxItems !== undefined) {
    if (typeof job.maxItems !== 'number' || !Number.isFinite(job.maxItems)) return false;
    if (!Number.isInteger(job.maxItems) || job.maxItems <= 0) return false;
  }

  if (job.productIds !== undefined) {
    if (!Array.isArray(job.productIds) || job.productIds.length === 0) return false;
    if (!job.productIds.every((value) => typeof value === 'string' && isCanonicalUuid(value))) {
      return false;
    }
  }

  return true;
}

export function validateAiBatchPollerJobPayload(data: unknown): data is AiBatchPollerJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<AiBatchPollerJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.embeddingBatchId !== 'string' || !isCanonicalUuid(job.embeddingBatchId))
    return false;
  if (typeof job.openAiBatchId !== 'string' || !job.openAiBatchId.trim()) return false;
  if (typeof job.requestedAt !== 'number' || !Number.isFinite(job.requestedAt)) return false;

  if (
    job.triggeredBy !== 'scheduler' &&
    job.triggeredBy !== 'manual' &&
    job.triggeredBy !== 'system'
  ) {
    return false;
  }

  if (job.pollAttempt !== undefined) {
    if (typeof job.pollAttempt !== 'number' || !Number.isFinite(job.pollAttempt)) return false;
    if (!Number.isInteger(job.pollAttempt) || job.pollAttempt < 0) return false;
  }

  return true;
}

export function validateAiBatchCleanupJobPayload(data: unknown): data is AiBatchCleanupJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<AiBatchCleanupJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.requestedAt !== 'number' || !Number.isFinite(job.requestedAt)) return false;

  if (
    job.triggeredBy !== 'scheduler' &&
    job.triggeredBy !== 'manual' &&
    job.triggeredBy !== 'system'
  ) {
    return false;
  }

  if (job.retentionDays !== undefined) {
    if (typeof job.retentionDays !== 'number' || !Number.isFinite(job.retentionDays)) return false;
    if (!Number.isInteger(job.retentionDays) || job.retentionDays <= 0) return false;
  }

  return true;
}

export function validateAiBatchBackfillJobPayload(
  data: unknown
): data is AiBatchBackfillJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<AiBatchBackfillJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (typeof job.requestedAt !== 'number' || !Number.isFinite(job.requestedAt)) return false;

  if (
    job.triggeredBy !== 'scheduler' &&
    job.triggeredBy !== 'manual' &&
    job.triggeredBy !== 'system'
  ) {
    return false;
  }

  if (job.chunkSize !== undefined) {
    if (typeof job.chunkSize !== 'number' || !Number.isFinite(job.chunkSize)) return false;
    if (!Number.isInteger(job.chunkSize) || job.chunkSize <= 0) return false;
  }

  if (job.offsetProductId !== undefined) {
    if (typeof job.offsetProductId !== 'string' || !isCanonicalUuid(job.offsetProductId)) {
      return false;
    }
  }

  if (job.dailyBudgetRemaining !== undefined) {
    if (
      typeof job.dailyBudgetRemaining !== 'number' ||
      !Number.isFinite(job.dailyBudgetRemaining)
    ) {
      return false;
    }
    if (!Number.isInteger(job.dailyBudgetRemaining) || job.dailyBudgetRemaining < 0) return false;
  }

  if (job.nightlyWindowOnly !== undefined) {
    if (typeof job.nightlyWindowOnly !== 'boolean') return false;
  }

  return true;
}
