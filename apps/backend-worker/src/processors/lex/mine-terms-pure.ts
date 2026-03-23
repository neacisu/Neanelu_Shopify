import type { LexToken } from './pipeline-utils.js';
import { tokenOverlapsProtectedSpan } from './pipeline-utils.js';

export type LexMiningProtectedSpan = Readonly<{ start: number; end: number }>;

/** Single-token or two-token window to upsert as a term + occurrence. */
export type LexTermMiningWindow = Readonly<{
  raw: string;
  normalized: string;
  endIndex: number;
}>;

export function shouldSkipLexMiningToken(
  token: LexToken,
  protectedSpans: readonly LexMiningProtectedSpan[],
  stopwords: ReadonlySet<string>
): boolean {
  if (tokenOverlapsProtectedSpan(token, protectedSpans)) return true;
  if (stopwords.has(token.normalized) || token.normalized.length < 2) return true;
  if (/^\d+$/.test(token.normalized)) return true;
  return false;
}

/**
 * Builds 1-gram and optional 2-gram window starting at `index` (bigram only if next token is minable).
 */
export function buildLexTermMiningWindows(
  tokens: readonly LexToken[],
  index: number,
  protectedSpans: readonly LexMiningProtectedSpan[],
  stopwords: ReadonlySet<string>
): LexTermMiningWindow[] {
  const token = tokens[index];
  if (!token) return [];

  const windows: LexTermMiningWindow[] = [
    { raw: token.raw, normalized: token.normalized, endIndex: index },
  ];

  const nextToken = tokens[index + 1];
  if (
    nextToken &&
    !tokenOverlapsProtectedSpan(nextToken, protectedSpans) &&
    !stopwords.has(nextToken.normalized)
  ) {
    windows.push({
      raw: `${token.raw} ${nextToken.raw}`,
      normalized: `${token.normalized} ${nextToken.normalized}`,
      endIndex: index + 1,
    });
  }

  return windows;
}
