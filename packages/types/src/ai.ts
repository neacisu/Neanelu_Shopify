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
  status: AiHealthStatus;
  checkedAt: string;
  message?: string;
  latencyMs?: number;
  httpStatus?: number;
  baseUrl?: string;
  model?: string;
  source?: 'shop' | 'env' | 'disabled';
  /**
   * List of embedding-capable models (UI dropdown).
   * When present, it's derived from /v1/models for the tested key.
   */
  availableModels?: string[];
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
  status: AiHealthStatus;
  message?: string;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  baseUrl?: string;
  model?: string;
}

export type AiConnectionStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'missing_key'
  | 'pending';

export type AiHealthStatus =
  | 'ok'
  | Extract<AiConnectionStatus, 'error' | 'disabled' | 'missing_key'>;

export type AiProvider = 'openai' | 'xai' | 'gemini' | 'deepseek' | 'selfhosted';

export type AiTaskType = 'translation' | 'classification' | 'embedding' | 'extraction' | 'audit';

export interface ModelRouting {
  translation: string;
  classification: string;
  embedding: string;
  extraction: string;
  audit: string;
}

export interface GeminiSettingsResponse {
  enabled: boolean;
  hasApiKey: boolean;
  model: string | null;
  availableModels: string[];
  temperature: number;
  maxTokensPerRequest: number;
  rateLimitPerMinute: number;
  dailyBudget: number;
  budgetAlertThreshold: number;
  connectionStatus: AiConnectionStatus;
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

export interface GeminiSettingsUpdateRequest {
  enabled?: boolean;
  apiKey?: string | null;
  model?: string | null;
  temperature?: number;
  maxTokensPerRequest?: number;
  rateLimitPerMinute?: number;
  dailyBudget?: number;
  budgetAlertThreshold?: number;
}

export interface GeminiHealthResponse {
  status: AiHealthStatus;
  message?: string;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  model?: string;
  availableModels?: string[];
}

export interface DeepSeekSettingsResponse {
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
  connectionStatus: AiConnectionStatus;
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

export interface DeepSeekSettingsUpdateRequest {
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

export interface DeepSeekHealthResponse {
  status: AiHealthStatus;
  message?: string;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  baseUrl?: string;
  model?: string;
  availableModels?: string[];
}

export interface SelfHostedEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  modelId: string;
  type: 'chat' | 'embedding' | 'both';
  enabled: boolean;
  maxConcurrentRequests: number;
  timeoutMs: number;
}

export interface GpuMetrics {
  gpuName: string | null;
  vramUsedGiB: number | null;
  vramTotalGiB: number | null;
  gpuUtilizationPercent: number | null;
  temperatureCelsius: number | null;
  collectedAt: string;
}

export interface SelfHostedSettingsResponse {
  enabled: boolean;
  hasBearerToken: boolean;
  endpoints: SelfHostedEndpoint[];
  connectionStatus: AiConnectionStatus | 'unreachable';
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  gpuMetrics: GpuMetrics | null;
  endpointStatuses: Record<
    string,
    {
      status: 'connected' | 'error' | 'unreachable';
      latencyMs: number | null;
      lastError: string | null;
      modelsLoaded: string[];
    }
  >;
  todayUsage: {
    requests: number;
    tokensInput: number;
    tokensOutput: number;
    estimatedCost: number;
  };
}

export interface SelfHostedSettingsUpdateRequest {
  enabled?: boolean;
  bearerToken?: string | null;
  endpoints?: SelfHostedEndpoint[];
}

export interface SelfHostedHealthResponse {
  status: 'ok' | 'partial' | 'error' | 'disabled' | 'unreachable';
  checkedAt: string;
  endpoints: Record<
    string,
    {
      status: 'ok' | 'error' | 'unreachable';
      latencyMs: number | null;
      message: string;
      modelsLoaded: string[];
    }
  >;
  gpuMetrics: GpuMetrics | null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' | 'text' };
  timeoutMs?: number;
}

export interface ChatCompletionResult {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  model: string;
  provider: AiProvider;
}

export interface ModelRoutingResponse {
  translation: string;
  classification: string;
  embedding: string;
  extraction: string;
  audit: string;
}

export interface ModelRoutingUpdateRequest {
  translation?: string;
  classification?: string;
  embedding?: string;
  extraction?: string;
  audit?: string;
}

export interface ExtractedProduct {
  title: string;
  brand?: string;
  mpn?: string;
  gtin?: string;
  category?: string;
  specifications: {
    name: string;
    value: string;
    unit?: string;
  }[];
  price?: {
    amount?: number;
    currency: string;
    isPromotional: boolean;
  };
  images: string[];
  confidence: {
    overall: number;
    fieldsUncertain: string[];
  };
}

export interface XaiExtractionJobPayload {
  shopId: string;
  matchId: string;
  requestedAt: number;
  triggeredBy?: 'manual' | 'system';
}

export interface XaiExtractionResult {
  success: boolean;
  data?: ExtractedProduct;
  tokensUsed: {
    input: number;
    output: number;
  };
  latencyMs: number;
  error?: string;
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function isValidTriggeredBy(
  value: 'scheduler' | 'manual' | 'system' | undefined
): value is 'scheduler' | 'manual' | 'system' {
  return value === 'scheduler' || value === 'manual' || value === 'system';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || isPositiveInteger(value);
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function isOptionalCanonicalUuid(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && isCanonicalUuid(value));
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function hasValidUuidArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && isCanonicalUuid(item))
  );
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
  if (!isPositiveInteger(job.dimensions)) return false;
  if (!isFiniteNumber(job.requestedAt)) return false;
  if (!isValidTriggeredBy(job.triggeredBy)) return false;

  if (!isOptionalPositiveInteger(job.maxItems)) return false;

  if (job.productIds !== undefined) {
    if (!hasValidUuidArray(job.productIds)) return false;
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
  if (!isFiniteNumber(job.requestedAt)) return false;
  if (!isValidTriggeredBy(job.triggeredBy)) return false;

  if (!isOptionalNonNegativeInteger(job.pollAttempt)) return false;

  return true;
}

export function validateAiBatchCleanupJobPayload(data: unknown): data is AiBatchCleanupJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<AiBatchCleanupJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (!isFiniteNumber(job.requestedAt)) return false;
  if (!isValidTriggeredBy(job.triggeredBy)) return false;

  if (!isOptionalPositiveInteger(job.retentionDays)) return false;

  return true;
}

export function validateAiBatchBackfillJobPayload(
  data: unknown
): data is AiBatchBackfillJobPayload {
  if (!data || typeof data !== 'object') return false;
  const job = data as Partial<AiBatchBackfillJobPayload>;

  if (typeof job.shopId !== 'string' || !isCanonicalUuid(job.shopId)) return false;
  if (!isFiniteNumber(job.requestedAt)) return false;
  if (!isValidTriggeredBy(job.triggeredBy)) return false;

  if (!isOptionalPositiveInteger(job.chunkSize)) return false;
  if (!isOptionalCanonicalUuid(job.offsetProductId)) return false;
  if (!isOptionalNonNegativeInteger(job.dailyBudgetRemaining)) return false;
  if (!isOptionalBoolean(job.nightlyWindowOnly)) return false;

  return true;
}
