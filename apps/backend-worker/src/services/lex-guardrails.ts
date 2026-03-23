import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { checkBudget, estimateChatCost, type ChatApiProvider } from '@app/pim';
import type { ZodError, ZodType } from 'zod';

import { lexTranslationBatchItemSchema } from '../processors/lex/lex-translation-ai-schemas.js';
import type { TenantClient } from '../processors/lex/pipeline-types.js';
import { scanInput, scanOutput } from './guardrails.js';
import type { GuardrailsScanResult } from './guardrails.js';

export type { GuardrailsScanResult } from './guardrails.js';

/** Zod shape aligned with `lexTranslationBatchItemSchema` LLM fields (f1-32). */
export const lexLlmStructuredOutputSchema = lexTranslationBatchItemSchema.pick({
  translation: true,
  confidence: true,
  alternatives: true,
  reasoning: true,
});

const REDACTED_PLACEHOLDER_PATTERN = /\[REDACTED_[^\]]+\]/i;
const HTML_INJECTION_PATTERNS: readonly { type: string; re: RegExp }[] = [
  { type: 'script_tag', re: /<script\b/i },
  { type: 'iframe_tag', re: /<iframe\b/i },
  { type: 'event_handler', re: /\bon\w+\s*=/i },
  { type: 'javascript_uri', re: /\bjavascript\s*:/i },
  { type: 'data_html_uri', re: /\bdata:text\/html/i },
];

const TEMPLATE_PLACEHOLDER_PATTERNS: RegExp[] = [/\{\{\w+\}\}/g, /%\w+%/g, /\$\w+/g];

function extractPlaceholders(text: string): Set<string> {
  const found = new Set<string>();
  for (const re of TEMPLATE_PLACEHOLDER_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.add(m[0]);
    }
  }
  return found;
}

function collectPlaceholderIssues(src: string, tgt: string): { type: string; message: string }[] {
  const issues: { type: string; message: string }[] = [];
  const srcPh = extractPlaceholders(src);
  const tgtPh = extractPlaceholders(tgt);
  for (const ph of srcPh) {
    if (!tgtPh.has(ph)) {
      issues.push({
        type: 'placeholder_missing_in_target',
        message: `Placeholder ${ph} present in source but missing in target.`,
      });
    }
  }
  for (const ph of tgtPh) {
    if (!srcPh.has(ph)) {
      issues.push({
        type: 'placeholder_added_in_target',
        message: `Placeholder ${ph} present in target but missing in source.`,
      });
    }
  }
  return issues;
}

const ROMANIAN_DIACRITICS = /[ăâîșțĂÂÎȘȚ]/;
const URL_LIKE_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function codePointWidth(cp: number): 1 | 2 {
  return cp > 0xffff ? 2 : 1;
}

function hasDisallowedControlChars(s: string): boolean {
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i);
    if (cp === undefined) {
      break;
    }
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      i += codePointWidth(cp);
      continue;
    }
    if (cp <= 0x08 || cp === 0x0b || cp === 0x0c || (cp >= 0x0e && cp <= 0x1f) || cp === 0x7f) {
      return true;
    }
    i += codePointWidth(cp);
  }
  return false;
}

function hasNonPrintableStrict(s: string): boolean {
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i);
    if (cp === undefined) {
      break;
    }
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      i += codePointWidth(cp);
      continue;
    }
    if (cp <= 0x08 || cp === 0x0b || cp === 0x0c || (cp >= 0x0e && cp <= 0x1f) || cp === 0x7f) {
      return true;
    }
    if (cp >= 0x80 && cp <= 0x9f) {
      return true;
    }
    i += codePointWidth(cp);
  }
  return false;
}

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

export async function scanLexInput(params: {
  shopId: string;
  text: string;
  env: AppEnv;
  logger: Logger;
}): Promise<GuardrailsScanResult> {
  return await scanInput(params);
}

export async function scanLexOutput(params: {
  shopId: string;
  prompt: string;
  output: string;
  env: AppEnv;
  logger: Logger;
}): Promise<GuardrailsScanResult> {
  return await scanOutput(params);
}

export function scanLexTranslationPair(params: {
  sourceText: string;
  targetText: string;
  sourceLang: string;
  targetLang: string;
}): { passed: boolean; issues: { type: string; message: string }[] } {
  const issues: { type: string; message: string }[] = [];
  const src = params.sourceText.trim();
  const tgt = params.targetText.trim();

  if (src.length === 0 && tgt.length === 0) {
    issues.push({ type: 'both_empty', message: 'Source and target are both empty.' });
    return { passed: false, issues };
  }

  if (src.length > 0 && tgt.length === 0) {
    issues.push({ type: 'target_empty', message: 'Target is empty while source has content.' });
  }

  if (src.length === 0 && tgt.length > 0) {
    issues.push({ type: 'source_empty', message: 'Source is empty while target has content.' });
  }

  if (src.length > 0 && tgt.length > 0 && src.toLowerCase() === tgt.toLowerCase()) {
    issues.push({ type: 'noop_translation', message: 'Target matches source (case-insensitive).' });
  }

  if (src.length > 0) {
    if (tgt.length > src.length * 3) {
      issues.push({
        type: 'information_added',
        message: 'Target length exceeds three times source length.',
      });
    }
    if (tgt.length < src.length * 0.2) {
      issues.push({
        type: 'information_lost',
        message: 'Target length is below 20% of source length.',
      });
    }
  }

  const sourceLang = params.sourceLang.trim().toLowerCase();
  const targetLang = params.targetLang.trim().toLowerCase();

  if (sourceLang.length === 0 || targetLang.length === 0) {
    issues.push({
      type: 'invalid_language_code',
      message: 'Source or target language code is empty.',
    });
  }

  if (sourceLang === targetLang && sourceLang.length > 0) {
    issues.push({
      type: 'same_language_pair',
      message: 'Source and target language codes are identical.',
    });
  }
  if (targetLang.startsWith('en') && ROMANIAN_DIACRITICS.test(tgt)) {
    issues.push({
      type: 'wrong_language',
      message: 'Romanian diacritics present in English-target output.',
    });
  }

  for (const { type, re } of HTML_INJECTION_PATTERNS) {
    if (re.test(tgt)) {
      issues.push({ type: 'html_injection', message: `Suspicious pattern (${type}) in target.` });
    }
  }

  if (REDACTED_PLACEHOLDER_PATTERN.test(tgt)) {
    issues.push({
      type: 'placeholder_leak',
      message: 'Target contains [REDACTED_*] placeholder text.',
    });
  }

  issues.push(...collectPlaceholderIssues(src, tgt));

  return { passed: issues.length === 0, issues };
}

export async function checkLexBatchBudget(params: {
  provider: ChatApiProvider;
  shopId: string;
  tokensInput: number;
  tokensOutput: number;
}): Promise<{ allowed: boolean; reason?: string }> {
  if (params.provider === 'selfhosted') {
    return { allowed: true };
  }

  const estimated = estimateChatCost({
    provider: params.provider,
    tokensInput: params.tokensInput,
    tokensOutput: params.tokensOutput,
  });

  const status = await checkBudget(params.provider, params.shopId);
  const remaining = status.primary.remaining;

  if (remaining <= 0) {
    return { allowed: false, reason: 'budget_remaining_zero' };
  }

  if (estimated > remaining * 0.9) {
    return { allowed: false, reason: 'estimated_cost_exceeds_90_percent_of_remaining' };
  }

  return { allowed: true };
}

export function validateLexOutputSchema(output: unknown): {
  valid: boolean;
  errors?: string[];
} {
  const parsed = lexLlmStructuredOutputSchema.safeParse(output);
  if (parsed.success) {
    return { valid: true };
  }
  const errors = parsed.error.issues.map((i) => {
    const path = i.path.length ? i.path.join('.') : '(root)';
    return `${path}: ${i.message}`;
  });
  return { valid: false, errors };
}

/** Row from `lex_shop_settings` for progressive → enforce evaluation. */
interface LexGuardrailsProgressiveSettingsRow extends Record<string, unknown> {
  guardrails_lex_mode: string;
  guardrails_warn_threshold: number;
  guardrails_warn_count: number;
  guardrails_block_count: number;
  guardrails_false_positive_count: number;
}

/**
 * g1-02: Progressive mode evaluation — auto-escalates from 'progressive' → 'enforce'
 * when warn_count >= threshold AND false-positive rate < 5%.
 */
export async function evaluateLexGuardrailsMode(params: {
  shopId: string;
  client: TenantClient;
}): Promise<{ currentMode: string; switched: boolean }> {
  const { shopId, client } = params;

  const { rows } = await client.query<LexGuardrailsProgressiveSettingsRow>(
    `SELECT guardrails_lex_mode,
            guardrails_warn_threshold,
            guardrails_warn_count,
            guardrails_block_count,
            guardrails_false_positive_count
       FROM lex_shop_settings
      WHERE shop_id = $1`,
    [shopId]
  );

  if (rows.length === 0) {
    return { currentMode: 'warn', switched: false };
  }

  const row = rows[0]!;
  const mode = row.guardrails_lex_mode;

  if (mode !== 'progressive') {
    return { currentMode: mode, switched: false };
  }

  const {
    guardrails_warn_count: warnCount,
    guardrails_warn_threshold: warnThreshold,
    guardrails_false_positive_count: fpCount,
  } = row;

  const reachedThreshold = warnCount >= warnThreshold;
  const fpRate = warnCount > 0 ? fpCount / warnCount : 1;
  const lowFalsePositives = fpRate < 0.05;

  if (reachedThreshold && lowFalsePositives) {
    await client.query(
      `UPDATE lex_shop_settings
          SET guardrails_lex_mode = 'enforce',
              guardrails_last_evaluated_at = now()
        WHERE shop_id = $1`,
      [shopId]
    );
    return { currentMode: 'enforce', switched: true };
  }

  await client.query(
    `UPDATE lex_shop_settings
        SET guardrails_last_evaluated_at = now()
      WHERE shop_id = $1`,
    [shopId]
  );

  return { currentMode: 'progressive', switched: false };
}

/**
 * g1-05 (generic): Validates raw LLM output string against an arbitrary Zod schema.
 */
export function validateLexOutputSchemaRaw<T>(params: {
  rawOutput: string;
  schema: ZodType<T>;
}): { valid: true; parsed: T } | { valid: false; error: string; details?: ZodError } {
  let json: unknown;
  try {
    json = JSON.parse(params.rawOutput);
  } catch {
    return { valid: false, error: 'invalid_json' };
  }

  const result = params.schema.safeParse(json);
  if (!result.success) {
    return { valid: false, error: 'schema_mismatch', details: result.error };
  }

  return { valid: true, parsed: result.data };
}

export function validateTermContent(text: string): { valid: boolean; reason?: string } {
  if (text.length > 200) {
    return { valid: false, reason: 'term_text_exceeds_200_chars' };
  }
  if (hasDisallowedControlChars(text)) {
    return { valid: false, reason: 'term_text_contains_control_characters' };
  }
  if (URL_LIKE_PATTERN.test(text)) {
    return { valid: false, reason: 'term_text_contains_url' };
  }
  if (EMAIL_PATTERN.test(text)) {
    return { valid: false, reason: 'term_text_contains_email' };
  }
  return { valid: true };
}

function stripHtmlTags(s: string): string {
  return s.replaceAll(/<[^>]+>/g, '');
}

function diceBigramSimilarity(a: string, b: string): number {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length === 0 && y.length === 0) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const counts = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const A = counts(x);
  const B = counts(y);
  let inter = 0;
  for (const [k, v] of A) {
    if (B.has(k)) {
      inter += Math.min(v, B.get(k)!);
    }
  }
  return (2 * inter) / (x.length - 1 + y.length - 1);
}

export function validateCompositionIntegrity(
  input: string,
  output: string
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const inStripped = stripHtmlTags(input);
  const outStripped = stripHtmlTags(output);
  const inL = inStripped.length;
  const outL = outStripped.length;

  if (hasNonPrintableStrict(output)) {
    issues.push('output_contains_non_printable_characters');
  }

  if (inL > 0) {
    const ratio = outL / inL;
    if (ratio < 0.3 || ratio > 3) {
      issues.push('output_length_ratio_outside_0_3x_to_3x_vs_input');
    }
  }

  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)(?:\s[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(output)) !== null) {
    const full = m[0];
    const name = m[1]!.toLowerCase();
    if (full.startsWith('</')) {
      if (stack.length === 0 || stack.pop() !== name) {
        issues.push(`unbalanced_or_mismatched_closing_tag_${name}`);
        break;
      }
    } else if (full.endsWith('/>') || VOID_HTML_TAGS.has(name)) {
      continue;
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    issues.push(`unclosed_html_tags:${stack.join(',')}`);
  }

  return { valid: issues.length === 0, issues };
}

/**
 * g3-02: Record a guardrail scan event into `lex_guardrails_events`.
 */
export async function recordLexGuardrailMetric(params: {
  shopId: string;
  scannerName: string;
  verdict: string;
  reason?: string;
  client: TenantClient;
  pipelinePhase?: string;
  inputHash?: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const {
    shopId,
    scannerName,
    verdict,
    reason,
    client,
    pipelinePhase = 'unknown',
    inputHash = '',
    eventType = 'scan',
    metadata = {},
  } = params;

  const reasons = reason ? [reason] : [];

  await client.query(
    `INSERT INTO lex_guardrails_events
       (shop_id, event_type, pipeline_phase, scan_point, verdict, reasons, input_hash, metadata)
     VALUES
       ($1, $2, $3, $4, $5, $6::text[], $7, $8::jsonb)`,
    [
      shopId,
      eventType,
      pipelinePhase,
      scannerName,
      verdict,
      reasons,
      inputHash,
      JSON.stringify(metadata),
    ]
  );

  if (verdict === 'block') {
    await client.query(
      `UPDATE lex_shop_settings
          SET guardrails_block_count = guardrails_block_count + 1
        WHERE shop_id = $1`,
      [shopId]
    );
  } else if (verdict === 'warn') {
    await client.query(
      `UPDATE lex_shop_settings
          SET guardrails_warn_count = guardrails_warn_count + 1
        WHERE shop_id = $1`,
      [shopId]
    );
  }
}

interface LexGuardrailStatsAggregateRow extends Record<string, unknown> {
  total_events: string;
  pass_count: string;
  warn_count: string;
  block_count: string;
  false_positive_count: string;
}

interface LexGuardrailReasonCountRow extends Record<string, unknown> {
  reason: string;
  count: string;
}

/**
 * g3-02: Aggregate guardrail stats for a shop from `lex_guardrails_events`.
 */
export async function getLexGuardrailStats(
  shopId: string,
  client: TenantClient
): Promise<{
  totalEvents: number;
  passCount: number;
  warnCount: number;
  blockCount: number;
  falsePositiveCount: number;
  topReasons: { reason: string; count: number }[];
}> {
  const { rows: statsRows } = await client.query<LexGuardrailStatsAggregateRow>(
    `SELECT
       COUNT(*)::text AS total_events,
       COUNT(*) FILTER (WHERE verdict = 'pass')::text AS pass_count,
       COUNT(*) FILTER (WHERE verdict = 'warn')::text AS warn_count,
       COUNT(*) FILTER (WHERE verdict = 'block')::text AS block_count,
       COUNT(*) FILTER (WHERE is_false_positive = true)::text AS false_positive_count
     FROM lex_guardrails_events
     WHERE shop_id = $1`,
    [shopId]
  );

  const stats = statsRows[0];

  const { rows: reasonRows } = await client.query<LexGuardrailReasonCountRow>(
    `SELECT unnest(reasons) AS reason, COUNT(*)::text AS count
     FROM lex_guardrails_events
     WHERE shop_id = $1 AND verdict != 'pass'
     GROUP BY reason
     ORDER BY count DESC
     LIMIT 20`,
    [shopId]
  );

  return {
    totalEvents: Number(stats?.total_events ?? 0),
    passCount: Number(stats?.pass_count ?? 0),
    warnCount: Number(stats?.warn_count ?? 0),
    blockCount: Number(stats?.block_count ?? 0),
    falsePositiveCount: Number(stats?.false_positive_count ?? 0),
    topReasons: reasonRows.map((r) => ({ reason: r.reason, count: Number(r.count) })),
  };
}

export function finalPublishSafetyCheck(
  original: string,
  translated: string
): { safe: boolean; reason?: string } {
  const o = original.trim();
  const t = translated.trim();
  if (o.length === 0) {
    return { safe: false, reason: 'original_empty' };
  }
  if (t.length === 0) {
    return { safe: false, reason: 'translated_empty' };
  }
  if (REDACTED_PLACEHOLDER_PATTERN.test(t)) {
    return { safe: false, reason: 'translated_contains_redacted_placeholder' };
  }

  const maxL = Math.max(o.length, t.length);
  if (maxL >= 10) {
    const lengthDiffRatio = Math.abs(o.length - t.length) / maxL;
    if (lengthDiffRatio > 0.8) {
      return { safe: false, reason: 'translation_length_diff_exceeds_80_percent_suspect' };
    }
  }

  const minL = Math.min(o.length, t.length);
  if (minL >= 15 && diceBigramSimilarity(o, t) > 0.92) {
    return { safe: false, reason: 'translation_too_similar_to_source' };
  }

  return { safe: true };
}
