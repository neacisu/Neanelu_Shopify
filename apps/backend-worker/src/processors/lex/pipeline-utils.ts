import { createHash } from 'node:crypto';
import stringify from 'fast-json-stable-stringify';

import type { TenantClient } from './pipeline-types.js';

export type { TenantClient } from './pipeline-types.js';

export type LexToken = Readonly<{
  raw: string;
  normalized: string;
  start: number;
  end: number;
  tokenIndex: number;
}>;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash determinist pentru obiecte JSON (ordine chei stabilă, fără JSON.stringify). */
export function sha256StableJson(value: unknown): string {
  return sha256(stringify(value));
}

export function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

export function normalizeLexeme(value: string): string {
  return normalizeWhitespace(value)
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function tokenizeLexText(text: string): LexToken[] {
  const tokens: LexToken[] = [];
  const regex = /[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)*/gu;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const normalized = normalizeLexeme(raw);
    if (!normalized) continue;
    tokens.push({
      raw,
      normalized,
      start: match.index,
      end: match.index + raw.length,
      tokenIndex,
    });
    tokenIndex += 1;
  }

  return tokens;
}

export function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const deduped = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) deduped.add(normalized);
  }
  return [...deduped];
}

export function buildContextWindow(
  tokens: readonly LexToken[],
  startIndex: number,
  endIndexInclusive: number,
  radius = 3
): Readonly<{
  leftContext: string;
  rightContext: string;
  neighborTerms: string[];
}> {
  const leftTokens = tokens.slice(Math.max(0, startIndex - radius), startIndex);
  const rightTokens = tokens.slice(endIndexInclusive + 1, endIndexInclusive + 1 + radius);

  return {
    leftContext: leftTokens.map((token) => token.raw).join(' '),
    rightContext: rightTokens.map((token) => token.raw).join(' '),
    neighborTerms: uniqueStrings([
      ...leftTokens.map((token) => token.normalized),
      ...rightTokens.map((token) => token.normalized),
    ]),
  };
}

export function parseShardSourceRecordIds(metadata: Record<string, unknown>): string[] {
  return Array.isArray(metadata['sourceRecordIds'])
    ? metadata['sourceRecordIds'].filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0
      )
    : [];
}

export function parseTouchedIds(metadata: Record<string, unknown>, key: string): string[] {
  return Array.isArray(metadata[key])
    ? metadata[key].filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0
      )
    : [];
}

export function toNumberOrZero(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function decimalString(value: number, scale = 4): string {
  if (!Number.isFinite(value)) return (0).toFixed(scale);
  return value.toFixed(scale);
}

/** Aligned with `lex_shop_settings` SQL defaults (`0115_lexical_module_foundation.sql`). */
export const DEFAULT_LEX_SOURCE_LANG = 'ro';
export const DEFAULT_LEX_TARGET_LANG = 'en';

export type LexShopLangPair = Readonly<{ sourceLang: string; targetLang: string }>;

export function parseLexShopLangFromSettingsRow(
  row:
    | {
        sourceLang?: string | null;
        targetLangs?: string[] | null;
      }
    | null
    | undefined
): LexShopLangPair {
  const sourceLangRaw = row?.sourceLang?.trim();
  const sourceLang =
    sourceLangRaw && sourceLangRaw.length > 0 ? sourceLangRaw : DEFAULT_LEX_SOURCE_LANG;
  const targetLangRaw = row?.targetLangs?.[0]?.trim();
  const targetLang =
    targetLangRaw && targetLangRaw.length > 0 ? targetLangRaw : DEFAULT_LEX_TARGET_LANG;
  return { sourceLang, targetLang };
}

export async function loadLexShopLangPair(params: {
  client: TenantClient;
  shopId: string;
}): Promise<LexShopLangPair> {
  const settings = await params.client.query<{
    sourceLang: string | null;
    targetLangs: string[] | null;
  }>(
    `SELECT source_lang AS "sourceLang", target_langs AS "targetLangs"
     FROM lex_shop_settings
     WHERE shop_id = $1
     LIMIT 1`,
    [params.shopId]
  );
  return parseLexShopLangFromSettingsRow(settings.rows[0]);
}

export async function loadActiveStopwords(params: {
  client: TenantClient;
  shopId: string;
  locale?: string;
}): Promise<Set<string>> {
  const result = await params.client.query<{ word: string }>(
    `SELECT word
     FROM lex_stopwords
     WHERE locale = $1
       AND is_active = true
       AND (shop_id = $2 OR shop_id IS NULL)`,
    [params.locale ?? DEFAULT_LEX_SOURCE_LANG, params.shopId]
  );

  return new Set(
    result.rows.map((row) => normalizeLexeme(row.word)).filter((word) => word.length > 0)
  );
}

export async function loadProtectedSpans(params: {
  client: TenantClient;
  shopId: string;
  fragmentIds: string[];
}): Promise<Map<string, { start: number; end: number }[]>> {
  const map = new Map<string, { start: number; end: number }[]>();
  if (params.fragmentIds.length === 0) return map;

  const entities = await params.client.query<{
    fragmentId: string;
    spanStart: number | null;
    spanEnd: number | null;
  }>(
    `SELECT fragment_id AS "fragmentId", span_start AS "spanStart", span_end AS "spanEnd"
     FROM lex_fragment_entities
     WHERE shop_id = $1
       AND fragment_id = ANY($2::uuid[])`,
    [params.shopId, params.fragmentIds]
  );

  for (const entity of entities.rows) {
    if (typeof entity.spanStart !== 'number' || typeof entity.spanEnd !== 'number') continue;
    const spans = map.get(entity.fragmentId) ?? [];
    spans.push({ start: entity.spanStart, end: entity.spanEnd });
    map.set(entity.fragmentId, spans);
  }

  return map;
}

export function tokenOverlapsProtectedSpan(
  token: Pick<LexToken, 'start' | 'end'>,
  protectedSpans: readonly { start: number; end: number }[]
): boolean {
  return protectedSpans.some((span) => token.start < span.end && token.end > span.start);
}

export function buildLocalizationContentHash(value: {
  entityType: string;
  entityId: string;
  targetLang: string;
  titleText: string | null;
  descriptionText: string | null;
  descriptionShort: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  vendorText?: string | null;
  productTypeText?: string | null;
  tags?: string[];
  optionNames?: Record<string, string>;
  metafields?: Record<string, string>;
  keywords: string[];
}): string {
  return sha256StableJson(value);
}
