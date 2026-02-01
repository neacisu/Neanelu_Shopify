import { addAiEvent, AI_EVENTS } from './otel/events.js';

export type EmbeddingErrorClass = 'transient' | 'permanent';

export type EmbeddingErrorType =
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_CONTENT'
  | 'MODEL_ERROR'
  | 'DIMENSION_MISMATCH'
  | 'UNKNOWN';

export type EmbeddingErrorDecision = Readonly<{
  classification: EmbeddingErrorClass;
  errorType: EmbeddingErrorType;
  shouldRetry: boolean;
}>;

const TRANSIENT_REGEX =
  /\b(rate limit|rate_limited|too many requests|429|timeout|timed out|temporar|network|econnreset|enotfound|eai_again|bad gateway|gateway timeout|service unavailable|503)\b/i;
const DIMENSION_REGEX = /\b(dimension|dimensions|embedding_dimension_mismatch)\b/i;
const INVALID_CONTENT_REGEX = /\b(invalid content|invalid input|bad request|400)\b/i;
const MODEL_REGEX = /\b(model|model not found|invalid model|unsupported model)\b/i;

export function classifyEmbeddingError(
  errorMessage: string | null | undefined
): EmbeddingErrorDecision {
  const message = errorMessage?.trim() ?? '';
  if (!message) {
    const decision = {
      classification: 'transient',
      errorType: 'UNKNOWN',
      shouldRetry: true,
    } as const;
    addAiEvent(AI_EVENTS.ERROR_CLASSIFIED, {
      error_type: decision.errorType,
      classification: decision.classification,
      should_retry: decision.shouldRetry,
    });
    return decision;
  }

  if (DIMENSION_REGEX.test(message)) {
    const decision = {
      classification: 'permanent',
      errorType: 'DIMENSION_MISMATCH',
      shouldRetry: false,
    } as const;
    addAiEvent(AI_EVENTS.ERROR_CLASSIFIED, {
      error_type: decision.errorType,
      classification: decision.classification,
      should_retry: decision.shouldRetry,
    });
    return decision;
  }

  if (INVALID_CONTENT_REGEX.test(message)) {
    const decision = {
      classification: 'permanent',
      errorType: 'INVALID_CONTENT',
      shouldRetry: false,
    } as const;
    addAiEvent(AI_EVENTS.ERROR_CLASSIFIED, {
      error_type: decision.errorType,
      classification: decision.classification,
      should_retry: decision.shouldRetry,
    });
    return decision;
  }

  if (MODEL_REGEX.test(message)) {
    const decision = {
      classification: 'permanent',
      errorType: 'MODEL_ERROR',
      shouldRetry: false,
    } as const;
    addAiEvent(AI_EVENTS.ERROR_CLASSIFIED, {
      error_type: decision.errorType,
      classification: decision.classification,
      should_retry: decision.shouldRetry,
    });
    return decision;
  }

  if (TRANSIENT_REGEX.test(message)) {
    const decision = {
      classification: 'transient',
      errorType: 'RATE_LIMITED',
      shouldRetry: true,
    } as const;
    addAiEvent(AI_EVENTS.ERROR_CLASSIFIED, {
      error_type: decision.errorType,
      classification: decision.classification,
      should_retry: decision.shouldRetry,
    });
    return decision;
  }

  const decision = {
    classification: 'transient',
    errorType: 'UNKNOWN',
    shouldRetry: true,
  } as const;
  addAiEvent(AI_EVENTS.ERROR_CLASSIFIED, {
    error_type: decision.errorType,
    classification: decision.classification,
    should_retry: decision.shouldRetry,
  });
  return decision;
}
