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
    return { classification: 'transient', errorType: 'UNKNOWN', shouldRetry: true };
  }

  if (DIMENSION_REGEX.test(message)) {
    return { classification: 'permanent', errorType: 'DIMENSION_MISMATCH', shouldRetry: false };
  }

  if (INVALID_CONTENT_REGEX.test(message)) {
    return { classification: 'permanent', errorType: 'INVALID_CONTENT', shouldRetry: false };
  }

  if (MODEL_REGEX.test(message)) {
    return { classification: 'permanent', errorType: 'MODEL_ERROR', shouldRetry: false };
  }

  if (TRANSIENT_REGEX.test(message)) {
    return { classification: 'transient', errorType: 'RATE_LIMITED', shouldRetry: true };
  }

  return { classification: 'transient', errorType: 'UNKNOWN', shouldRetry: true };
}
