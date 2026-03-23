/**
 * Pure helpers dedicated to `compose-localizations.worker.ts`.
 * Kept separate from `pipeline-pure-fns.ts` so tooling resolves types without spurious
 * `@typescript-eslint/no-unsafe-*` noise in the worker.
 */

import type { ReplacementRule } from './compose-apply-translations.js';
import { toNumberOrZero } from './pipeline-utils.js';

/** Tag names from simple HTML markup (compose HTML-stripped guardrail). */
export function extractHtmlTagNamesFromMarkup(html: string): string[] {
  const tags: string[] = [];
  const re = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[1];
    if (name) tags.push(name.toLowerCase());
  }
  return tags;
}

/**
 * C0 control characters and DEL, excluding TAB (9), LF (10), CR (13).
 * Replaces a regex with explicit control escapes (eslint `no-control-regex`).
 */
export function containsComposeDisallowedControlChars(text: string): boolean {
  for (let i = 0; i < text.length; ) {
    const c = text.codePointAt(i);
    if (c === undefined) break;
    if (c <= 8) return true;
    if (c === 11 || c === 12) return true;
    if (c >= 14 && c <= 31) return true;
    if (c === 127) return true;
    i += c > 0xffff ? 2 : 1;
  }
  return false;
}

export type LexTranslationReplacementSourceRow = Readonly<{
  translationText: string;
  qualityScore: string | null;
  sourceTexts: readonly string[];
}>;

export function buildLexReplacementRulesFromTranslationRows(
  rows: readonly LexTranslationReplacementSourceRow[]
): ReplacementRule[] {
  const out: ReplacementRule[] = [];
  for (const row of rows) {
    const sources = row.sourceTexts.length > 0 ? row.sourceTexts : [];
    const qualityScore = toNumberOrZero(row.qualityScore);
    for (const sourceText of sources) {
      if (sourceText.trim().length === 0) continue;
      out.push({ sourceText, targetText: row.translationText, qualityScore });
    }
  }
  return out;
}
