import {
  enforceBudget,
  estimateChatCost,
  type ChatApiProvider,
  type ChatModelCredentials,
} from '@app/pim';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import { createLLMClientForProvider } from '@app/ai-engine';
import type { AiProvider } from '@app/types';
import { z } from 'zod';

import { toPgVectorLiteral } from '../bulk-operations/pim/vector.js';
import {
  getChatTaskTimeoutMs,
  resolveChatTaskCredentials,
  resolveEmbeddingsProvider,
} from '../../services/ai-provider-routing.js';
import {
  consensusChatCompletion,
  normalizeForComparison,
} from '../../services/consensus-engine.js';
import { insertLexReviewOpenItemsBatch } from '../../services/lex-review-insert.js';
import { scanInput, scanOutput } from '../../services/guardrails.js';
import { scanLexTranslationPair } from '../../services/lex-guardrails.js';
import { decimalString, parseLexShopLangFromSettingsRow, sha256 } from './pipeline-utils.js';
import type { TenantClient } from './pipeline-types.js';
import {
  lexTranslationAuditEnvelopeSchema,
  lexTranslationLlmEnvelopeSchema,
  type LexTranslationAuditInput,
  type LexTranslationBatchItem,
  type LexTranslationLlmEnvelope,
} from './lex-translation-ai-schemas.js';

export {
  lexTranslationAuditEnvelopeSchema,
  lexTranslationAuditItemSchema,
  lexTranslationBatchItemSchema,
  lexTranslationLlmEnvelopeSchema,
  type LexTranslationAuditInput,
  type LexTranslationAuditItem,
  type LexTranslationBatchItem,
  type LexTranslationLlmEnvelope,
} from './lex-translation-ai-schemas.js';

/**
 * Upper bound for model-produced confidence scores: strictly below
 * `lex_shop_settings.translation_auto_approve_threshold` so raw LLM output cannot
 * cross the auto-approve line without consensus / non-LLM sources.
 */
function lexAiProducedConfidenceCap(translationAutoApproveThreshold: number): number {
  const t = Math.max(0, Math.min(1, translationAutoApproveThreshold));
  return Math.max(0, Math.min(t - 0.01, 0.9999));
}

const LEX_QUALITY_AUDIT_CHUNK_MAX = 60;

const translationConsensusPayloadSchema = z.object({
  translation: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  alternatives: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
});

type TranslationConsensusPayload = z.infer<typeof translationConsensusPayloadSchema>;

function estimateTokens(text: string): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xffff) {
      units += 4;
    } else if (cp > 0x7f) {
      units += 3;
    } else {
      units += 1;
    }
  }
  return Math.max(1, Math.ceil(units / 4));
}

function toAiProvider(provider: ChatApiProvider): AiProvider {
  return provider;
}

async function enforceBudgetUnlessSelfhosted(
  provider: ChatApiProvider,
  shopId: string
): Promise<void> {
  if (provider === 'selfhosted') {
    return;
  }
  await enforceBudget({ provider, shopId });
}

async function createAiBatch(params: {
  client: TenantClient;
  shopId: string;
  batchType: 'embedding' | 'translation' | 'translation_audit';
  requestCount: number;
  provider: string;
}): Promise<string> {
  const inserted = await params.client.query<{ id: string }>(
    `INSERT INTO ai_batches
       (shop_id, provider, batch_type, status, request_count, submitted_at, created_at, updated_at)
     VALUES
       ($1, $2, $3, 'processing', $4, now(), now(), now())
     RETURNING id`,
    [params.shopId, params.provider, params.batchType, params.requestCount]
  );
  return inserted.rows[0]!.id;
}

function clampAiConfidence(raw: number, cap: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  const c = Number.isFinite(cap) && cap > 0 ? cap : 0.92;
  return Math.max(0, Math.min(c, raw));
}

function mapConsensusMethodToConfidence(
  method: 'unanimous' | 'majority' | 'arbitration' | 'single_fallback',
  consensusScore: number,
  confidenceCap: number
): number {
  const score = Number.isFinite(consensusScore) ? consensusScore : 0;
  let v: number;
  if (method === 'unanimous') {
    v = 0.97;
  } else if (method === 'majority') {
    v = 0.85 + score * 0.1;
  } else if (method === 'arbitration') {
    v = Math.max(0.5, Math.min(0.95, score));
  } else {
    v = 0.7;
  }
  return clampAiConfidence(v, confidenceCap);
}

function isNoOpTranslation(source: string, target: string): boolean {
  return source.trim().toLowerCase() === target.trim().toLowerCase();
}

function applyNoOpAndCap(params: {
  canonicalText: string;
  translation: string;
  confidence: number;
  confidenceCap: number;
}): { translation: string; confidence: number; echo: boolean } {
  if (isNoOpTranslation(params.canonicalText, params.translation)) {
    return { translation: params.translation, confidence: 0.5, echo: true };
  }
  return {
    translation: params.translation,
    confidence: clampAiConfidence(params.confidence, params.confidenceCap),
    echo: false,
  };
}

type LexTranslationMode = 'single' | 'consensus' | 'auto';

function shouldEscalateToConsensus(params: {
  mode: LexTranslationMode;
  llmConfidence: number;
  threshold: number;
  domainCode: string | null;
}): boolean {
  if (params.mode === 'consensus') {
    return true;
  }
  if (params.mode === 'single') {
    return false;
  }
  if (params.domainCode === null) {
    return true;
  }
  return params.llmConfidence < params.threshold;
}

export type LexTranslationClusterInput = Readonly<{
  clusterId: string;
  termId: string;
  canonicalText: string;
  domainCode: string | null;
}>;

export interface LexTranslationOutputRow {
  candidateText: string;
  confidence: number;
  candidateSource: string;
  evidence: Record<string, unknown>;
}

type LexTranslationPrefetch = Readonly<{
  sourceLang: string;
  targetLang: string;
  translationMode: LexTranslationMode;
  consensusEscalationThreshold: number;
  translationAutoApproveThreshold: number;
  aiProducedConfidenceCap: number;
  maxTermsPerLlmBatch: number;
  glossaryRows: readonly {
    sourceText: string;
    targetText: string;
    domainCode: string | null;
    translationKind: string;
  }[];
  ruleRows: readonly {
    matchTerm: string;
    targetTranslation: string;
    domainCode: string | null;
  }[];
  profilesByDomain: ReadonlyMap<string, string>;
  fewShotLines: readonly string[];
  termContextLines: ReadonlyMap<string, readonly string[]>;
  clusterSnippetLines: ReadonlyMap<string, readonly string[]>;
}>;

function parseTranslationMode(raw: string | null | undefined): LexTranslationMode {
  if (raw === 'single' || raw === 'consensus' || raw === 'auto') {
    return raw;
  }
  return 'auto';
}

interface LexShopTranslationSettingsQueryRow extends Record<string, unknown> {
  sourceLang: string;
  targetLangs: string[] | null;
  translationMode: string | null;
  consensusEscalationThreshold: string | null;
  translationAutoApproveThreshold: string | null;
  maxTermsPerLlmBatch: string | null;
}

async function fetchLexShopTranslationSettingsRow(
  client: TenantClient,
  shopId: string
): Promise<LexShopTranslationSettingsQueryRow | undefined> {
  const settings = await client.query<LexShopTranslationSettingsQueryRow>(
    `SELECT
       source_lang AS "sourceLang",
       target_langs AS "targetLangs",
       translation_mode AS "translationMode",
       consensus_escalation_threshold::text AS "consensusEscalationThreshold",
       translation_auto_approve_threshold::text AS "translationAutoApproveThreshold",
       max_terms_per_llm_batch::text AS "maxTermsPerLlmBatch"
     FROM lex_shop_settings
     WHERE shop_id = $1
     LIMIT 1`,
    [shopId]
  );
  return settings.rows[0];
}

function deriveLexTranslationPrefetchScalars(
  row: LexShopTranslationSettingsQueryRow | undefined
): Readonly<{
  sourceLang: string;
  targetLang: string;
  translationMode: LexTranslationMode;
  consensusEscalationThreshold: number;
  translationAutoApproveThreshold: number;
  aiProducedConfidenceCap: number;
  maxTermsPerLlmBatch: number;
}> {
  const { sourceLang, targetLang } = parseLexShopLangFromSettingsRow(row);
  const translationMode = parseTranslationMode(row?.translationMode);
  const consensusEscalationThreshold = Math.max(
    0,
    Math.min(1, Number(row?.consensusEscalationThreshold ?? 0.8))
  );
  const translationAutoApproveThreshold = Math.max(
    0,
    Math.min(1, Number(row?.translationAutoApproveThreshold ?? 0.93))
  );
  const aiProducedConfidenceCap = lexAiProducedConfidenceCap(translationAutoApproveThreshold);
  const maxTermsPerLlmBatch = Math.max(
    1,
    Math.min(50, Math.trunc(Number(row?.maxTermsPerLlmBatch ?? 10)))
  );
  return {
    sourceLang,
    targetLang,
    translationMode,
    consensusEscalationThreshold,
    translationAutoApproveThreshold,
    aiProducedConfidenceCap,
    maxTermsPerLlmBatch,
  };
}

async function fetchLexGlossaryPrefetchRows(
  client: TenantClient,
  shopId: string,
  sourceLang: string,
  targetLang: string
): Promise<
  readonly {
    sourceText: string;
    targetText: string;
    domainCode: string | null;
    translationKind: string;
  }[]
> {
  const glossaryRows = await client.query<{
    sourceText: string;
    targetText: string;
    domainCode: string | null;
    translationKind: string;
  }>(
    `SELECT
       source_text AS "sourceText",
       target_text AS "targetText",
       domain_code AS "domainCode",
       translation_kind AS "translationKind"
     FROM lex_glossary_entries
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND source_lang = $2
       AND target_lang = $3
       AND is_active = true
     ORDER BY shop_id DESC NULLS LAST, priority ASC, updated_at DESC
     LIMIT 120`,
    [shopId, sourceLang, targetLang]
  );
  return glossaryRows.rows;
}

async function fetchLexRulePrefetchRows(
  client: TenantClient,
  shopId: string,
  sourceLang: string,
  targetLang: string
): Promise<
  readonly {
    matchTerm: string;
    targetTranslation: string;
    domainCode: string | null;
  }[]
> {
  const ruleRows = await client.query<{
    matchTerm: string;
    targetTranslation: string;
    domainCode: string | null;
  }>(
    `SELECT
       match_term AS "matchTerm",
       target_translation AS "targetTranslation",
       domain_code AS "domainCode"
     FROM lex_translation_rules
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND source_lang = $2
       AND target_lang = $3
       AND is_active = true
     ORDER BY shop_id DESC NULLS LAST, priority ASC, updated_at DESC
     LIMIT 200`,
    [shopId, sourceLang, targetLang]
  );
  return ruleRows.rows;
}

async function fetchLexProfilesByDomain(
  client: TenantClient,
  shopId: string,
  clusters: readonly LexTranslationClusterInput[],
  sourceLang: string,
  targetLang: string
): Promise<ReadonlyMap<string, string>> {
  const domainCodes = [
    ...new Set(clusters.map((c) => c.domainCode).filter((d): d is string => Boolean(d))),
  ];
  const profilesByDomain = new Map<string, string>();
  if (domainCodes.length === 0) {
    return profilesByDomain;
  }
  const prof = await client.query<{
    domainCode: string;
    nameRo: string;
    nameEn: string | null;
    description: string | null;
    categoryHints: unknown;
    protectedPatterns: unknown;
  }>(
    `SELECT
       domain_code AS "domainCode",
       name_ro AS "nameRo",
       name_en AS "nameEn",
       description,
       category_hints AS "categoryHints",
       protected_patterns AS "protectedPatterns"
     FROM lex_domain_profiles
     WHERE (shop_id = $1 OR shop_id IS NULL)
       AND is_active = true
       AND domain_code = ANY($2::text[])`,
    [shopId, domainCodes]
  );
  for (const p of prof.rows) {
    const bits = [
      `name(${sourceLang}): ${p.nameRo}`,
      p.nameEn ? `name(${targetLang}): ${p.nameEn}` : null,
      p.description ? `description: ${p.description}` : null,
      p.categoryHints ? `category_hints: ${JSON.stringify(p.categoryHints)}` : null,
      p.protectedPatterns ? `protected_patterns: ${JSON.stringify(p.protectedPatterns)}` : null,
    ].filter(Boolean);
    profilesByDomain.set(p.domainCode, bits.join('\n'));
  }
  return profilesByDomain;
}

async function fetchLexFewShotPrefetchLines(
  client: TenantClient,
  shopId: string,
  sourceLang: string,
  targetLang: string
): Promise<readonly string[]> {
  const fewShot = await client.query<{ canonical: string; translation: string }>(
    `SELECT
       t.canonical_text AS "canonical",
       lt.translation_text AS "translation"
     FROM lex_translations lt
     INNER JOIN lex_terms t ON t.id = lt.term_id
     WHERE (lt.shop_id = $1 OR lt.shop_id IS NULL)
       AND lt.source_lang = $2
       AND lt.target_lang = $3
       AND lt.quality_score >= 0.95
       AND lt.publication_status IN ('approved', 'draft')
     ORDER BY lt.updated_at DESC NULLS LAST
     LIMIT 12`,
    [shopId, sourceLang, targetLang]
  );
  return fewShot.rows.map((r) => `"${r.canonical}" → "${r.translation}"`);
}

async function fetchLexTermContextLinesByTerm(
  client: TenantClient,
  shopId: string,
  clusters: readonly LexTranslationClusterInput[]
): Promise<Map<string, string[]>> {
  const termIds = [...new Set(clusters.map((c) => c.termId))];
  const termContextLines = new Map<string, string[]>();
  if (termIds.length === 0) {
    return termContextLines;
  }
  const ctx = await client.query<{ termId: string; text: string }>(
    `SELECT
       term_id AS "termId",
       representative_text AS "text"
     FROM lex_term_contexts
     WHERE shop_id = $1
       AND term_id = ANY($2::uuid[])
     ORDER BY term_id, occurrences_count DESC NULLS LAST, created_at ASC`,
    [shopId, termIds]
  );
  for (const ctxRow of ctx.rows) {
    const bucket = termContextLines.get(ctxRow.termId) ?? [];
    if (bucket.length < 4) {
      bucket.push(ctxRow.text);
      termContextLines.set(ctxRow.termId, bucket);
    }
  }
  return termContextLines;
}

async function fetchLexClusterSnippetLines(
  client: TenantClient,
  shopId: string,
  clusters: readonly LexTranslationClusterInput[]
): Promise<Map<string, string[]>> {
  const clusterIds = clusters.map((c) => c.clusterId);
  const clusterSnippetLines = new Map<string, string[]>();
  if (clusterIds.length === 0) {
    return clusterSnippetLines;
  }
  const snip = await client.query<{ clusterId: string; text: string }>(
    `SELECT
       m.cluster_id AS "clusterId",
       tc.representative_text AS "text"
     FROM lex_sense_cluster_members m
     INNER JOIN lex_sense_clusters sc
             ON sc.id = m.cluster_id
            AND (sc.shop_id = $1 OR sc.shop_id IS NULL)
     INNER JOIN lex_term_contexts tc
             ON tc.id = m.context_id
            AND tc.shop_id = $1
     WHERE m.cluster_id = ANY($2::uuid[])
     ORDER BY m.cluster_id, m.is_representative DESC, m.similarity_score DESC NULLS LAST, m.created_at ASC`,
    [shopId, clusterIds]
  );
  for (const snipRow of snip.rows) {
    const bucket = clusterSnippetLines.get(snipRow.clusterId) ?? [];
    if (bucket.length < 6) {
      bucket.push(snipRow.text);
      clusterSnippetLines.set(snipRow.clusterId, bucket);
    }
  }
  return clusterSnippetLines;
}

async function loadLexTranslationPrefetch(params: {
  client: TenantClient;
  shopId: string;
  clusters: readonly LexTranslationClusterInput[];
}): Promise<LexTranslationPrefetch> {
  const settingsRow = await fetchLexShopTranslationSettingsRow(params.client, params.shopId);
  const scalars = deriveLexTranslationPrefetchScalars(settingsRow);
  const { sourceLang, targetLang, ...numericAndMode } = scalars;

  const [
    glossaryRows,
    ruleRows,
    profilesByDomain,
    fewShotLines,
    termContextLines,
    clusterSnippetLines,
  ] = await Promise.all([
    fetchLexGlossaryPrefetchRows(params.client, params.shopId, sourceLang, targetLang),
    fetchLexRulePrefetchRows(params.client, params.shopId, sourceLang, targetLang),
    fetchLexProfilesByDomain(params.client, params.shopId, params.clusters, sourceLang, targetLang),
    fetchLexFewShotPrefetchLines(params.client, params.shopId, sourceLang, targetLang),
    fetchLexTermContextLinesByTerm(params.client, params.shopId, params.clusters),
    fetchLexClusterSnippetLines(params.client, params.shopId, params.clusters),
  ]);

  return {
    sourceLang,
    targetLang,
    ...numericAndMode,
    glossaryRows,
    ruleRows,
    profilesByDomain,
    fewShotLines,
    termContextLines,
    clusterSnippetLines,
  };
}

function glossaryHintsForCluster(
  cluster: LexTranslationClusterInput,
  prefetch: LexTranslationPrefetch
): string[] {
  const key = cluster.canonicalText.trim().toLowerCase();
  const out: string[] = [];
  for (const g of prefetch.glossaryRows) {
    if (g.domainCode && cluster.domainCode && g.domainCode !== cluster.domainCode) {
      continue;
    }
    if (
      g.sourceText.toLowerCase().includes(key) ||
      key.includes(g.sourceText.trim().toLowerCase())
    ) {
      out.push(`${g.sourceText} → ${g.targetText} (${g.translationKind})`);
    }
    if (out.length >= 10) {
      break;
    }
  }
  return out;
}

function rulesForCluster(
  cluster: LexTranslationClusterInput,
  prefetch: LexTranslationPrefetch
): string[] {
  const out: string[] = [];
  const lower = cluster.canonicalText.trim().toLowerCase();
  for (const r of prefetch.ruleRows) {
    if (r.domainCode && cluster.domainCode && r.domainCode !== cluster.domainCode) {
      continue;
    }
    if (r.matchTerm.trim().toLowerCase() === lower) {
      out.push(`${r.matchTerm} → ${r.targetTranslation}`);
    }
    if (out.length >= 8) {
      break;
    }
  }
  return out;
}

/**
 * Six context layers (L1 glossary … L6 cluster snippets), then token budget trim.
 */
export function buildTranslationPrompt(params: {
  prefetch: LexTranslationPrefetch;
  chunk: readonly LexTranslationClusterInput[];
}): { system: string; user: string } {
  const { prefetch, chunk } = params;
  const layersCombined = chunk.map((cluster) => {
    const l1 = glossaryHintsForCluster(cluster, prefetch);
    const l2 = rulesForCluster(cluster, prefetch);
    const l3 = cluster.domainCode ? (prefetch.profilesByDomain.get(cluster.domainCode) ?? '') : '';
    const l4 = prefetch.fewShotLines.slice(0, 5).join('\n');
    const l5 = (prefetch.termContextLines.get(cluster.termId) ?? []).join('\n');
    const l6 = (prefetch.clusterSnippetLines.get(cluster.clusterId) ?? []).join('\n');
    return [
      `### cluster ${cluster.clusterId}`,
      `L1_GLOSSARY:\n${l1.length ? l1.join('\n') : '(none)'}`,
      `L2_RULES:\n${l2.length ? l2.join('\n') : '(none)'}`,
      `L3_DOMAIN_PROFILE:\n${l3 || '(none)'}`,
      `L4_FEW_SHOT:\n${l4 || '(none)'}`,
      `L5_TERM_CONTEXTS:\n${l5 || '(none)'}`,
      `L6_CLUSTER_SNIPPETS:\n${l6 || '(none)'}`,
    ].join('\n');
  });

  const system = [
    `You are a professional translator for e-commerce product terminology.`,
    `Translate from ${prefetch.sourceLang} to ${prefetch.targetLang}.`,
    `Return STRICT JSON with shape: {"items":[{"clusterId":"<uuid>","translation":"<string>","confidence":0-1,"alternatives":["..."],"reasoning":"..."}]}`,
    `Include exactly one item per term below; clusterId must match.`,
    `Confidence must reflect certainty; never fabricate facts.`,
  ].join('\n');

  const maxSystemTokens = 2000;
  const maxUserTokens = 8000;

  const layerText = layersCombined.join('\n\n---\n\n');
  let userBody = [
    `Terms (batch):`,
    ...chunk.map(
      (c) =>
        `- clusterId=${c.clusterId} domain=${c.domainCode ?? 'null'} term=${JSON.stringify(c.canonicalText)}`
    ),
    layerText,
  ].join('\n\n');

  let sys = system;
  while (estimateTokens(sys) > maxSystemTokens && sys.length > 200) {
    sys = sys.slice(0, Math.floor(sys.length * 0.85));
  }
  while (
    estimateTokens(sys + userBody) > maxSystemTokens + maxUserTokens &&
    userBody.length > 400
  ) {
    userBody = userBody.slice(0, Math.floor(userBody.length * 0.88));
  }

  return { system: sys, user: userBody };
}

async function translateWithLLMChunk(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  credentials: ChatModelCredentials;
  prefetch: LexTranslationPrefetch;
  chunk: readonly LexTranslationClusterInput[];
}): Promise<{
  envelope: LexTranslationLlmEnvelope | null;
  tokensIn: number;
  tokensOut: number;
  raw: string;
  blockedByGuardrail?: 'input' | 'output';
}> {
  const { system, user } = buildTranslationPrompt({
    prefetch: params.prefetch,
    chunk: params.chunk,
  });
  const inputScan = await scanInput({
    shopId: params.shopId,
    text: `${system}\n\n${user}`,
    env: params.env,
    logger: params.logger,
  });
  if (!inputScan.isValid) {
    params.logger.warn(
      { shopId: params.shopId, reason: inputScan.reason },
      'lex_translation_guardrails_blocked_input'
    );
    return { envelope: null, tokensIn: 0, tokensOut: 0, raw: '', blockedByGuardrail: 'input' };
  }

  let client;
  try {
    client = createLLMClientForProvider({
      provider: toAiProvider(params.credentials.provider),
      baseUrl: params.credentials.baseUrl,
      model: params.credentials.model,
      ...(params.credentials.apiKey ? { apiKey: params.credentials.apiKey } : {}),
      temperature: params.credentials.temperature,
      maxTokens: Math.min(2000, params.credentials.maxTokensPerRequest),
      timeoutMs: getChatTaskTimeoutMs({
        taskType: 'translation',
        provider: toAiProvider(params.credentials.provider),
        model: params.credentials.model,
        endpointId: `${params.credentials.provider}:${params.credentials.model}`,
        timeoutMs: params.env.openAiTimeoutMs,
      }),
    });
  } catch (error) {
    params.logger.error(
      { shopId: params.shopId, err: error instanceof Error ? error.message : String(error) },
      'lex_translation_llm_client_creation_failed'
    );
    return { envelope: null, tokensIn: 0, tokensOut: 0, raw: '' };
  }

  let completion;
  try {
    completion = await client.chatCompletion({
      model: params.credentials.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: inputScan.sanitizedText },
      ],
      responseFormat: { type: 'json_object' },
      maxTokens: Math.min(2000, params.credentials.maxTokensPerRequest),
      timeoutMs: getChatTaskTimeoutMs({
        taskType: 'translation',
        provider: toAiProvider(params.credentials.provider),
        model: params.credentials.model,
        endpointId: `${params.credentials.provider}:${params.credentials.model}`,
        timeoutMs: params.env.openAiTimeoutMs,
      }),
    });
  } catch (error) {
    params.logger.warn(
      { shopId: params.shopId, err: error instanceof Error ? error.message : String(error) },
      'lex_translation_chat_completion_failed'
    );
    return { envelope: null, tokensIn: 0, tokensOut: 0, raw: '' };
  }

  const outputScan = await scanOutput({
    shopId: params.shopId,
    prompt: inputScan.sanitizedText,
    output: completion.content,
    env: params.env,
    logger: params.logger,
  });
  if (!outputScan.isValid) {
    params.logger.warn(
      { shopId: params.shopId, reason: outputScan.reason },
      'lex_translation_guardrails_blocked_output'
    );
    return {
      envelope: null,
      tokensIn: completion.tokensInput,
      tokensOut: completion.tokensOutput,
      raw: completion.content,
      blockedByGuardrail: 'output',
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(outputScan.sanitizedText) as unknown;
  } catch {
    return {
      envelope: null,
      tokensIn: completion.tokensInput,
      tokensOut: completion.tokensOutput,
      raw: outputScan.sanitizedText,
    };
  }
  const parsed = lexTranslationLlmEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return {
      envelope: null,
      tokensIn: completion.tokensInput,
      tokensOut: completion.tokensOutput,
      raw: outputScan.sanitizedText,
    };
  }
  return {
    envelope: parsed.data,
    tokensIn: completion.tokensInput,
    tokensOut: completion.tokensOutput,
    raw: outputScan.sanitizedText,
  };
}

async function translateWithConsensusForCluster(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  prefetch: LexTranslationPrefetch;
  cluster: LexTranslationClusterInput;
}): Promise<{ payload: TranslationConsensusPayload; tokensIn: number; tokensOut: number } | null> {
  const glossary = glossaryHintsForCluster(params.cluster, params.prefetch).join('\n');
  const system = [
    `You translate ${params.prefetch.sourceLang} → ${params.prefetch.targetLang} for e-commerce/hardware retail.`,
    `Return STRICT JSON: {"translation":"<string>","confidence":0-1,"alternatives":["..."],"reasoning":"..."}`,
    glossary ? `Glossary hints:\n${glossary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const user = `Term: ${JSON.stringify(params.cluster.canonicalText)}\nDomain: ${params.cluster.domainCode ?? 'null'}`;

  try {
    const cons = await consensusChatCompletion<TranslationConsensusPayload>({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      taskType: 'translation',
      systemPrompt: system,
      userPrompt: user,
      responseFormat: { type: 'json_object' },
      maxTokens: 800,
      keyField: 'translation',
      compareValue: (v) => normalizeForComparison(v.translation),
      parseResponse: (raw) => {
        const parsed = translationConsensusPayloadSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) throw new Error('consensus_translation_zod_validation_failed');
        return parsed.data;
      },
    });
    const tr = cons.result.translation?.trim() ?? '';
    if (!tr) {
      return null;
    }

    const pairScan = scanLexTranslationPair({
      sourceText: params.cluster.canonicalText,
      targetText: tr,
      sourceLang: params.prefetch.sourceLang,
      targetLang: params.prefetch.targetLang,
    });
    if (!pairScan.passed) {
      const blockingTypes = new Set(['html_injection', 'placeholder_leak']);
      const hasBlocking = pairScan.issues.some((i) => blockingTypes.has(i.type));
      if (hasBlocking) {
        params.logger.warn(
          {
            shopId: params.shopId,
            clusterId: params.cluster.clusterId,
            issues: pairScan.issues,
          },
          'lex_consensus_guardrail_blocked'
        );
        return null;
      }
      params.logger.warn(
        {
          shopId: params.shopId,
          clusterId: params.cluster.clusterId,
          issues: pairScan.issues,
        },
        'lex_consensus_guardrail_warn'
      );
    }

    const mapped = mapConsensusMethodToConfidence(
      cons.method,
      cons.consensusScore,
      params.prefetch.aiProducedConfidenceCap
    );
    const estIn = estimateTokens(system + user) * cons.participantCount;
    const estOut = cons.rawResponses.reduce((sum, r) => sum + estimateTokens(r), 0);
    return {
      payload: {
        translation: tr,
        confidence: mapped,
        ...(typeof cons.arbitrationReasoning === 'string'
          ? { reasoning: cons.arbitrationReasoning }
          : {}),
      },
      tokensIn: estIn,
      tokensOut: estOut,
    };
  } catch (error) {
    params.logger.warn(
      { shopId: params.shopId, clusterId: params.cluster.clusterId, err: String(error) },
      'lex_translation_consensus_failed'
    );
    return null;
  }
}

function buildTranslationQualityAuditPrompt(params: {
  sourceLang: string;
  targetLang: string;
  chunk: readonly LexTranslationAuditInput[];
}): { system: string; user: string } {
  const system = [
    `You are a senior translation quality auditor for e-commerce / hardware product terminology.`,
    `Translations are ${params.sourceLang} → ${params.targetLang}.`,
    `Return STRICT JSON: {"items":[{"termId":"<uuid>","clusterId":"<uuid>","valid":true|false,"issues":["..."],"suggestedFix":"<optional>","consistencyScore":0-1}]}`,
    `Include exactly one item per input row; termId and clusterId must match the input.`,
    `consistencyScore: 1 = excellent alignment with source meaning; 0 = unusable or wrong language.`,
    `Set valid=false when there are serious terminology or meaning errors.`,
    `suggestedFix: optional improved target-language text only when clearly better than translatedText.`,
  ].join('\n');

  const payload = params.chunk.map((r) => ({
    termId: r.termId,
    clusterId: r.clusterId,
    domainCode: r.domainCode,
    sourceText: r.sourceText,
    translatedText: r.translatedText,
  }));

  const user = `Audit these translations (JSON array):\n${JSON.stringify(payload)}`;
  return { system, user };
}

async function runTranslationQualityAuditChunk(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  credentials: ChatModelCredentials;
  chunk: readonly LexTranslationAuditInput[];
  sourceLang: string;
  targetLang: string;
}): Promise<{
  envelope: z.infer<typeof lexTranslationAuditEnvelopeSchema> | null;
  tokensIn: number;
  tokensOut: number;
  raw: string;
}> {
  const { system, user } = buildTranslationQualityAuditPrompt({
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
    chunk: params.chunk,
  });
  const inputScan = await scanInput({
    shopId: params.shopId,
    text: `${system}\n\n${user}`,
    env: params.env,
    logger: params.logger,
  });
  if (!inputScan.isValid) {
    params.logger.warn(
      { shopId: params.shopId, reason: inputScan.reason },
      'lex_translation_audit_guardrails_blocked_input'
    );
    return { envelope: null, tokensIn: 0, tokensOut: 0, raw: '' };
  }

  let client;
  try {
    client = createLLMClientForProvider({
      provider: toAiProvider(params.credentials.provider),
      baseUrl: params.credentials.baseUrl,
      model: params.credentials.model,
      ...(params.credentials.apiKey ? { apiKey: params.credentials.apiKey } : {}),
      temperature: Math.min(0.2, params.credentials.temperature),
      maxTokens: Math.min(8000, params.credentials.maxTokensPerRequest),
      timeoutMs: getChatTaskTimeoutMs({
        taskType: 'audit',
        provider: toAiProvider(params.credentials.provider),
        model: params.credentials.model,
        endpointId: `${params.credentials.provider}:${params.credentials.model}`,
        timeoutMs: params.env.openAiTimeoutMs,
      }),
    });
  } catch (error) {
    params.logger.error(
      { shopId: params.shopId, err: error instanceof Error ? error.message : String(error) },
      'lex_translation_audit_client_creation_failed'
    );
    return { envelope: null, tokensIn: 0, tokensOut: 0, raw: '' };
  }

  let completion;
  try {
    completion = await client.chatCompletion({
      model: params.credentials.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: inputScan.sanitizedText },
      ],
      responseFormat: { type: 'json_object' },
      maxTokens: Math.min(8000, params.credentials.maxTokensPerRequest),
      timeoutMs: getChatTaskTimeoutMs({
        taskType: 'audit',
        provider: toAiProvider(params.credentials.provider),
        model: params.credentials.model,
        endpointId: `${params.credentials.provider}:${params.credentials.model}`,
        timeoutMs: params.env.openAiTimeoutMs,
      }),
    });
  } catch (error) {
    params.logger.warn(
      { shopId: params.shopId, err: error instanceof Error ? error.message : String(error) },
      'lex_translation_audit_chat_completion_failed'
    );
    return { envelope: null, tokensIn: 0, tokensOut: 0, raw: '' };
  }

  const outputScan = await scanOutput({
    shopId: params.shopId,
    prompt: inputScan.sanitizedText,
    output: completion.content,
    env: params.env,
    logger: params.logger,
  });
  if (!outputScan.isValid) {
    params.logger.warn(
      { shopId: params.shopId, reason: outputScan.reason },
      'lex_translation_audit_guardrails_blocked_output'
    );
    return {
      envelope: null,
      tokensIn: completion.tokensInput,
      tokensOut: completion.tokensOutput,
      raw: completion.content,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(outputScan.sanitizedText) as unknown;
  } catch {
    return {
      envelope: null,
      tokensIn: completion.tokensInput,
      tokensOut: completion.tokensOutput,
      raw: outputScan.sanitizedText,
    };
  }
  const parsed = lexTranslationAuditEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return {
      envelope: null,
      tokensIn: completion.tokensInput,
      tokensOut: completion.tokensOutput,
      raw: outputScan.sanitizedText,
    };
  }

  const allowed = new Set(params.chunk.map((c) => `${c.termId}:${c.clusterId}`));
  const filtered = parsed.data.items.filter((it) => allowed.has(`${it.termId}:${it.clusterId}`));
  if (filtered.length === 0) {
    return {
      envelope: null,
      tokensIn: completion.tokensInput,
      tokensOut: completion.tokensOutput,
      raw: outputScan.sanitizedText,
    };
  }
  return {
    envelope: { items: filtered },
    tokensIn: completion.tokensInput,
    tokensOut: completion.tokensOutput,
    raw: outputScan.sanitizedText,
  };
}

interface LexTranslationQualityAuditChunkResult {
  chunk: readonly LexTranslationAuditInput[];
  envelope: z.infer<typeof lexTranslationAuditEnvelopeSchema> | null;
  tokensIn: number;
  tokensOut: number;
}

async function persistLexTranslationQualityAuditChunk(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  sourceLang: string;
  targetLang: string;
  credentials: ChatModelCredentials;
  chunkIndex: number;
  cr: LexTranslationQualityAuditChunkResult;
  byKey: Map<string, LexTranslationAuditInput>;
}): Promise<{
  batchId: string;
  reviewItemsCreated: number;
  suggestionCandidatesWritten: number;
}> {
  const { client, shopId, runId, sourceLang, targetLang, credentials, chunkIndex, cr, byKey } =
    params;
  const batchId = await createAiBatch({
    client,
    shopId,
    batchType: 'translation_audit',
    requestCount: cr.chunk.length,
    provider: credentials.provider,
  });

  const inputPayload = JSON.stringify({
    chunkIndex,
    runId,
    items: cr.chunk.map((c) => ({
      termId: c.termId,
      clusterId: c.clusterId,
      sourceText: c.sourceText,
      translatedText: c.translatedText,
    })),
  });
  const contentHash = sha256(inputPayload);
  const customId = `lex-translate-audit:${runId}:${chunkIndex}:${contentHash.slice(0, 16)}`;

  const itemRow = await client.query<{ id: string }>(
    `INSERT INTO ai_batch_items
       (batch_id, shop_id, entity_type, entity_id, custom_id, input_content, content_hash, status, created_at)
     VALUES
       ($1, $2, 'lex_run', $3, $4, $5, $6, 'processing', now())
     RETURNING id`,
    [batchId, shopId, runId, customId, inputPayload, contentHash]
  );

  const outJson = cr.envelope
    ? JSON.stringify({ items: cr.envelope.items })
    : JSON.stringify({ error: 'audit_parse_failed_or_empty' });

  const chunkCost = estimateChatCost({
    provider: credentials.provider,
    tokensInput: cr.tokensIn,
    tokensOutput: cr.tokensOut,
  });

  await client.query(
    `UPDATE ai_batch_items
     SET status = 'completed',
         output_content = $2,
         tokens_used = $3,
         processed_at = now()
     WHERE id = $1`,
    [itemRow.rows[0]!.id, outJson, Math.max(1, estimateTokens(outJson))]
  );

  await client.query(
    `UPDATE ai_batches
     SET status = 'completed',
         completed_count = $2,
         total_tokens = $3,
         estimated_cost = $4,
         completed_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [batchId, cr.chunk.length, cr.tokensIn + cr.tokensOut, chunkCost]
  );

  await client.query(
    `UPDATE lex_runs
     SET ai_batches_count = COALESCE(ai_batches_count, 0) + 1,
         updated_at = now()
     WHERE id = $1
       AND shop_id = $2`,
    [runId, shopId]
  );

  if (!cr.envelope) {
    return { batchId, reviewItemsCreated: 0, suggestionCandidatesWritten: 0 };
  }

  const auditReviewRows: {
    entityType: string;
    entityId: string;
    reviewReason: string;
    severity: 'high';
    evidence: Record<string, unknown>;
  }[] = [];

  let suggestionCandidatesWritten = 0;

  for (const row of cr.envelope.items) {
    const key = `${row.termId}:${row.clusterId}`;
    const src = byKey.get(key);
    if (!src) {
      continue;
    }

    if (row.consistencyScore < 0.7) {
      auditReviewRows.push({
        entityType: 'translation',
        entityId: src.translationId,
        reviewReason: 'quality_audit_failed',
        severity: 'high',
        evidence: {
          consistencyScore: row.consistencyScore,
          issues: row.issues,
          valid: row.valid,
          sourceText: src.sourceText,
          translatedText: src.translatedText,
        },
      });
    }

    const fix = row.suggestedFix?.trim();
    if (fix && fix.length > 0) {
      await client.query(
        `INSERT INTO lex_translation_candidates
           (shop_id, term_id, cluster_id, source_lang, target_lang, candidate_text, candidate_source,
            confidence_score, justification, evidence, rank, status, created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 2, $11, now(), now())
         ON CONFLICT (shop_id, term_id, COALESCE(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid), source_lang, target_lang, rank)
         DO UPDATE SET
           candidate_text = EXCLUDED.candidate_text,
           candidate_source = EXCLUDED.candidate_source,
           confidence_score = EXCLUDED.confidence_score,
           justification = EXCLUDED.justification,
           evidence = EXCLUDED.evidence,
           status = EXCLUDED.status,
           updated_at = now()`,
        [
          shopId,
          src.termId,
          src.clusterId,
          sourceLang,
          targetLang,
          fix,
          'quality_audit_suggestion',
          decimalString(0.75),
          'quality_audit_suggestion',
          JSON.stringify({
            source: 'quality_audit_suggestion',
            consistencyScore: row.consistencyScore,
            issues: row.issues,
          }),
          'pending',
        ]
      );
      suggestionCandidatesWritten += 1;
    }
  }

  let reviewItemsCreated = 0;
  if (auditReviewRows.length > 0) {
    reviewItemsCreated = await insertLexReviewOpenItemsBatch({
      client,
      shopId,
      runId,
      rows: auditReviewRows,
    });
  }

  return { batchId, reviewItemsCreated, suggestionCandidatesWritten };
}

/**
 * QwQ-32B (taskType audit) batch quality review: persists `translation_audit` batches, optional review items,
 * and rank-2 `quality_audit_suggestion` candidates.
 */
export async function processLexTranslationQualityAudit(params: {
  shopId: string;
  runId: string;
  env: AppEnv;
  logger: Logger;
  sourceLang: string;
  targetLang: string;
  items: readonly LexTranslationAuditInput[];
}): Promise<{
  auditBatchIds: string[];
  reviewItemsCreated: number;
  suggestionCandidatesWritten: number;
}> {
  if (params.items.length === 0) {
    return { auditBatchIds: [], reviewItemsCreated: 0, suggestionCandidatesWritten: 0 };
  }

  const credentials = await resolveChatTaskCredentials({
    shopId: params.shopId,
    taskType: 'audit',
    env: params.env,
    logger: params.logger,
  });

  if (!credentials) {
    params.logger.warn({ shopId: params.shopId }, 'lex_translation_audit_credentials_unavailable');
    return { auditBatchIds: [], reviewItemsCreated: 0, suggestionCandidatesWritten: 0 };
  }

  await enforceBudgetUnlessSelfhosted(credentials.provider, params.shopId);

  const chunks: LexTranslationAuditInput[][] = [];
  for (let i = 0; i < params.items.length; i += LEX_QUALITY_AUDIT_CHUNK_MAX) {
    chunks.push(params.items.slice(i, i + LEX_QUALITY_AUDIT_CHUNK_MAX));
  }

  const chunkResults: LexTranslationQualityAuditChunkResult[] = [];

  for (const chunk of chunks) {
    let attempt = await runTranslationQualityAuditChunk({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      credentials,
      chunk,
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
    });
    if (!attempt.envelope) {
      attempt = await runTranslationQualityAuditChunk({
        shopId: params.shopId,
        env: params.env,
        logger: params.logger,
        credentials,
        chunk,
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
      });
    }
    chunkResults.push({
      chunk,
      envelope: attempt.envelope,
      tokensIn: attempt.tokensIn,
      tokensOut: attempt.tokensOut,
    });
  }

  return await withTenantContext(params.shopId, async (client) => {
    const auditBatchIds: string[] = [];
    let reviewItemsCreated = 0;
    let suggestionCandidatesWritten = 0;

    const byKey = new Map<string, LexTranslationAuditInput>();
    for (const it of params.items) {
      byKey.set(`${it.termId}:${it.clusterId}`, it);
    }

    for (let ci = 0; ci < chunkResults.length; ci += 1) {
      const cr = chunkResults[ci]!;
      const persisted = await persistLexTranslationQualityAuditChunk({
        client,
        shopId: params.shopId,
        runId: params.runId,
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
        credentials,
        chunkIndex: ci,
        cr,
        byKey,
      });
      auditBatchIds.push(persisted.batchId);
      reviewItemsCreated += persisted.reviewItemsCreated;
      suggestionCandidatesWritten += persisted.suggestionCandidatesWritten;
    }

    return { auditBatchIds, reviewItemsCreated, suggestionCandidatesWritten };
  });
}

interface LexTranslateLlmChunkResult {
  envelope: LexTranslationLlmEnvelope | null;
  tokensIn: number;
  tokensOut: number;
  raw: string;
  blockedByGuardrail?: 'input' | 'output';
}

function partitionLexClustersByDomainIntoChunks(
  clusters: readonly LexTranslationClusterInput[],
  maxPer: number
): LexTranslationClusterInput[][] {
  const byDomain = new Map<string, LexTranslationClusterInput[]>();
  for (const c of clusters) {
    const dk = c.domainCode ?? '__none__';
    const b = byDomain.get(dk) ?? [];
    b.push(c);
    byDomain.set(dk, b);
  }
  const outChunks: LexTranslationClusterInput[][] = [];
  for (const [, list] of byDomain) {
    for (let i = 0; i < list.length; i += maxPer) {
      outChunks.push(list.slice(i, i + maxPer));
    }
  }
  return outChunks;
}

async function runLexTranslationLlmChunkWithRetry(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  credentials: ChatModelCredentials;
  prefetch: LexTranslationPrefetch;
  chunk: readonly LexTranslationClusterInput[];
}): Promise<{
  attempt: LexTranslateLlmChunkResult;
  tokensIn: number;
  tokensOut: number;
}> {
  let attempt: LexTranslateLlmChunkResult = await translateWithLLMChunk({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
    credentials: params.credentials,
    prefetch: params.prefetch,
    chunk: params.chunk,
  });
  let tokensIn = attempt.tokensIn;
  let tokensOut = attempt.tokensOut;

  if (attempt.blockedByGuardrail) {
    return { attempt, tokensIn, tokensOut };
  }

  if (!attempt.envelope) {
    const retry = await translateWithLLMChunk({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      credentials: params.credentials,
      prefetch: params.prefetch,
      chunk: params.chunk,
    });
    tokensIn += retry.tokensIn;
    tokensOut += retry.tokensOut;
    attempt = retry;
  }

  return { attempt, tokensIn, tokensOut };
}

async function backfillMissingLexTranslationClusterItems(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  credentials: ChatModelCredentials;
  prefetch: LexTranslationPrefetch;
  chunk: readonly LexTranslationClusterInput[];
  byId: Map<string, LexTranslationBatchItem>;
  outputs: Map<string, LexTranslationOutputRow>;
}): Promise<{ tokensIn: number; tokensOut: number }> {
  const missing = params.chunk.filter((c) => !params.byId.has(c.clusterId));
  let tokensIn = 0;
  let tokensOut = 0;
  for (const cl of missing) {
    const one = await translateWithLLMChunk({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      credentials: params.credentials,
      prefetch: params.prefetch,
      chunk: [cl],
    });
    tokensIn += one.tokensIn;
    tokensOut += one.tokensOut;
    const firstItem = one.envelope?.items[0];
    if (firstItem) {
      params.byId.set(cl.clusterId, firstItem);
    } else {
      const source = one.blockedByGuardrail ? 'guardrail_blocked' : 'ai_parse_error';
      params.outputs.set(cl.clusterId, {
        candidateText: cl.canonicalText,
        confidence: 0,
        candidateSource: source,
        evidence: {
          strategy: source,
          ...(one.blockedByGuardrail
            ? { phase: one.blockedByGuardrail }
            : { raw: one.raw.slice(0, 2000) }),
        },
      });
    }
  }
  return { tokensIn, tokensOut };
}

async function resolveSingleClusterLexTranslationOutput(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  prefetch: LexTranslationPrefetch;
  cluster: LexTranslationClusterInput;
  item: LexTranslationBatchItem;
}): Promise<LexTranslationOutputRow> {
  const { shopId, env, logger, prefetch, cluster: cl, item } = params;
  let text = item.translation.trim();
  let conf = item.confidence;
  let source: 'ai_contextual' | 'ai_echo' = 'ai_contextual';
  const shaped = applyNoOpAndCap({
    canonicalText: cl.canonicalText,
    translation: text,
    confidence: conf,
    confidenceCap: prefetch.aiProducedConfidenceCap,
  });
  text = shaped.translation;
  conf = shaped.confidence;
  if (shaped.echo) {
    source = 'ai_echo';
  }

  const escalate = shouldEscalateToConsensus({
    mode: prefetch.translationMode,
    llmConfidence: conf,
    threshold: prefetch.consensusEscalationThreshold,
    domainCode: cl.domainCode,
  });
  if (shaped.echo) {
    logger.warn(
      { shopId, clusterId: cl.clusterId, canonicalText: cl.canonicalText },
      'lex_translation_no_op_echo_detected'
    );
  }
  if (escalate) {
    logger.info(
      {
        shopId,
        clusterId: cl.clusterId,
        mode: prefetch.translationMode,
        llmConfidence: conf,
        threshold: prefetch.consensusEscalationThreshold,
        domainCode: cl.domainCode,
      },
      'lex_translation_escalated_to_consensus'
    );
  }
  if (escalate) {
    const cons = await translateWithConsensusForCluster({
      shopId,
      env,
      logger,
      prefetch,
      cluster: cl,
    });
    if (cons?.payload.translation) {
      const c2 = applyNoOpAndCap({
        canonicalText: cl.canonicalText,
        translation: cons.payload.translation,
        confidence: cons.payload.confidence ?? 0.8,
        confidenceCap: prefetch.aiProducedConfidenceCap,
      });
      text = c2.translation;
      conf = c2.confidence;
      source = c2.echo ? 'ai_echo' : 'ai_contextual';
      return {
        candidateText: text,
        confidence: conf,
        candidateSource: source,
        evidence: {
          strategy: 'consensus_translation',
          reasoning: cons.payload.reasoning,
        },
      };
    }
  }

  return {
    candidateText: text,
    confidence: conf,
    candidateSource: source,
    evidence: {
      strategy: 'ai_batches',
      alternatives: item.alternatives,
      reasoning: item.reasoning,
    },
  };
}

async function finalizeLexTranslationOutputsForChunk(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  prefetch: LexTranslationPrefetch;
  chunk: readonly LexTranslationClusterInput[];
  byId: Map<string, LexTranslationBatchItem>;
  outputs: Map<string, LexTranslationOutputRow>;
}): Promise<void> {
  for (const cl of params.chunk) {
    if (params.outputs.has(cl.clusterId)) {
      continue;
    }
    const item = params.byId.get(cl.clusterId);
    if (!item) {
      params.outputs.set(cl.clusterId, {
        candidateText: cl.canonicalText,
        confidence: 0,
        candidateSource: 'ai_batch_partial_miss',
        evidence: { strategy: 'ai_batch_partial_miss' },
      });
      continue;
    }

    params.outputs.set(
      cl.clusterId,
      await resolveSingleClusterLexTranslationOutput({
        shopId: params.shopId,
        env: params.env,
        logger: params.logger,
        prefetch: params.prefetch,
        cluster: cl,
        item,
      })
    );
  }
}

async function persistLexTranslationAiBatchRows(params: {
  client: TenantClient;
  shopId: string;
  runId: string;
  batchId: string;
  clusters: readonly LexTranslationClusterInput[];
  outputs: Map<string, LexTranslationOutputRow>;
  prefetch: LexTranslationPrefetch;
  totalTokensIn: number;
  totalTokensOut: number;
  estimatedCost: number;
}): Promise<void> {
  const {
    client,
    shopId,
    runId,
    batchId,
    clusters,
    outputs,
    prefetch,
    totalTokensIn,
    totalTokensOut,
    estimatedCost,
  } = params;

  for (const cluster of clusters) {
    const out = outputs.get(cluster.clusterId);
    if (!out) {
      continue;
    }
    const inputContent = JSON.stringify({
      text: cluster.canonicalText,
      domainCode: cluster.domainCode,
      sourceLang: prefetch.sourceLang,
      targetLang: prefetch.targetLang,
    });
    const customId = `lex-translate:${cluster.clusterId}:${prefetch.targetLang}:${sha256(inputContent)}`;
    const contentHash = sha256(inputContent);
    const itemRow = await client.query<{ id: string }>(
      `INSERT INTO ai_batch_items
         (batch_id, shop_id, entity_type, entity_id, custom_id, input_content, content_hash, status, created_at)
       VALUES
         ($1, $2, 'lex_sense_cluster', $3, $4, $5, $6, 'processing', now())
       RETURNING id`,
      [batchId, shopId, cluster.clusterId, customId, inputContent, contentHash]
    );

    const outputPayload = {
      translation: out.candidateText,
      confidence: out.confidence,
      candidateSource: out.candidateSource,
      evidence: out.evidence,
    };

    await client.query(
      `UPDATE ai_batch_items
       SET status = 'completed',
           output_content = $2,
           tokens_used = $3,
           processed_at = now()
       WHERE id = $1`,
      [
        itemRow.rows[0]!.id,
        JSON.stringify(outputPayload),
        Math.max(1, estimateTokens(JSON.stringify(outputPayload))),
      ]
    );
  }

  await client.query(
    `UPDATE ai_batches
     SET status = 'completed',
         completed_count = $2,
         total_tokens = $3,
         estimated_cost = $4,
         completed_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [batchId, clusters.length, totalTokensIn + totalTokensOut, estimatedCost]
  );

  await client.query(
    `UPDATE lex_runs
     SET ai_batches_count = COALESCE(ai_batches_count, 0) + 1,
         updated_at = now()
     WHERE id = $1
       AND shop_id = $2`,
    [runId, shopId]
  );
}

export async function processLexTranslationBatch(params: {
  shopId: string;
  runId: string;
  env: AppEnv;
  logger: Logger;
  clusters: readonly LexTranslationClusterInput[];
}): Promise<{
  batchId: string | null;
  outputs: Map<string, LexTranslationOutputRow>;
}> {
  if (params.clusters.length === 0) {
    return { batchId: null, outputs: new Map() };
  }

  const credentials = await resolveChatTaskCredentials({
    shopId: params.shopId,
    taskType: 'translation',
    env: params.env,
    logger: params.logger,
  });

  if (!credentials) {
    const outputs = new Map<string, LexTranslationOutputRow>();
    for (const c of params.clusters) {
      outputs.set(c.clusterId, {
        candidateText: c.canonicalText,
        confidence: 0,
        candidateSource: 'ai_credentials_unavailable',
        evidence: { strategy: 'ai_credentials_unavailable' },
      });
    }
    return { batchId: null, outputs };
  }

  await enforceBudgetUnlessSelfhosted(credentials.provider, params.shopId);

  const prefetch = await withTenantContext(params.shopId, async (client) =>
    loadLexTranslationPrefetch({ client, shopId: params.shopId, clusters: params.clusters })
  );

  const chunks = partitionLexClustersByDomainIntoChunks(
    params.clusters,
    prefetch.maxTermsPerLlmBatch
  );

  const outputs = new Map<string, LexTranslationOutputRow>();
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const chunk of chunks) {
    const { attempt, tokensIn, tokensOut } = await runLexTranslationLlmChunkWithRetry({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      credentials,
      prefetch,
      chunk,
    });
    totalTokensIn += tokensIn;
    totalTokensOut += tokensOut;

    if (attempt.blockedByGuardrail) {
      for (const cl of chunk) {
        outputs.set(cl.clusterId, {
          candidateText: cl.canonicalText,
          confidence: 0,
          candidateSource: 'guardrail_blocked',
          evidence: { strategy: 'guardrail_blocked', phase: attempt.blockedByGuardrail },
        });
      }
      continue;
    }

    const byId = new Map<string, LexTranslationBatchItem>();
    if (attempt.envelope) {
      for (const item of attempt.envelope.items) {
        byId.set(item.clusterId, item);
      }
    }

    const backfill = await backfillMissingLexTranslationClusterItems({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      credentials,
      prefetch,
      chunk,
      byId,
      outputs,
    });
    totalTokensIn += backfill.tokensIn;
    totalTokensOut += backfill.tokensOut;

    await finalizeLexTranslationOutputsForChunk({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      prefetch,
      chunk,
      byId,
      outputs,
    });
  }

  const estimatedCost = estimateChatCost({
    provider: credentials.provider,
    tokensInput: totalTokensIn,
    tokensOutput: totalTokensOut,
  });

  return await withTenantContext(params.shopId, async (client) => {
    const batchId = await createAiBatch({
      client,
      shopId: params.shopId,
      batchType: 'translation',
      requestCount: params.clusters.length,
      provider: credentials.provider,
    });

    await persistLexTranslationAiBatchRows({
      client,
      shopId: params.shopId,
      runId: params.runId,
      batchId,
      clusters: params.clusters,
      outputs,
      prefetch,
      totalTokensIn,
      totalTokensOut,
      estimatedCost,
    });

    return { batchId, outputs };
  });
}

export async function processLexEmbeddingBatch(params: {
  shopId: string;
  runId: string;
  env: AppEnv;
  logger: Logger;
  contexts: readonly {
    id: string;
    representativeText: string;
    fieldKind: string | null;
    vendorHint: string | null;
    productTypeHint: string | null;
    domainCode: string | null;
  }[];
}): Promise<{ batchId: string | null; contextsProcessed: number; embeddingsWritten: number }> {
  if (params.contexts.length === 0) {
    return { batchId: null, contextsProcessed: 0, embeddingsWritten: 0 };
  }

  const embedder = await resolveEmbeddingsProvider({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
  });
  if (!embedder.isAvailable()) {
    params.logger.warn({ shopId: params.shopId }, 'lex_embedding_provider_unavailable');
    return { batchId: null, contextsProcessed: params.contexts.length, embeddingsWritten: 0 };
  }

  const providerForBudget: ChatApiProvider =
    embedder.kind === 'selfhosted' ? 'selfhosted' : 'openai';
  await enforceBudgetUnlessSelfhosted(providerForBudget, params.shopId);

  const texts = params.contexts.map((c) => c.representativeText);
  let embeddings: readonly (readonly number[])[];
  try {
    embeddings = await embedder.embedTexts(texts);
  } catch (error) {
    params.logger.error(
      { shopId: params.shopId, err: error instanceof Error ? error.message : String(error) },
      'lex_embedding_batch_failed'
    );
    return { batchId: null, contextsProcessed: params.contexts.length, embeddingsWritten: 0 };
  }

  const batchProvider = embedder.kind === 'noop' ? 'openai' : (embedder.kind as string);

  return await withTenantContext(params.shopId, async (client) => {
    const batchId = await createAiBatch({
      client,
      shopId: params.shopId,
      batchType: 'embedding',
      requestCount: params.contexts.length,
      provider: batchProvider,
    });

    let totalTokens = 0;
    let written = 0;

    for (let i = 0; i < params.contexts.length; i += 1) {
      const context = params.contexts[i]!;
      const embedding = embeddings[i];
      const inputContent = JSON.stringify({
        representativeText: context.representativeText,
        fieldKind: context.fieldKind,
        vendorHint: context.vendorHint,
        productTypeHint: context.productTypeHint,
        domainCode: context.domainCode,
      });
      const customId = `lex-embed:${context.id}:${sha256(inputContent)}`;
      const contentHash = sha256(inputContent);
      const tokens = estimateTokens(inputContent);
      totalTokens += tokens;

      const item = await client.query<{ id: string }>(
        `INSERT INTO ai_batch_items
           (batch_id, shop_id, entity_type, entity_id, custom_id, input_content, content_hash, status, created_at)
         VALUES
           ($1, $2, 'lex_term_context', $3, $4, $5, $6, 'processing', now())
         RETURNING id`,
        [batchId, params.shopId, context.id, customId, inputContent, contentHash]
      );

      if (embedding?.length !== embedder.model.dimensions) {
        await client.query(
          `UPDATE ai_batch_items
           SET status = 'failed',
               output_content = $2,
               tokens_used = $3,
               processed_at = now()
           WHERE id = $1`,
          [item.rows[0]!.id, JSON.stringify({ error: 'embedding_dimension_mismatch' }), tokens]
        );
        continue;
      }

      const vecLiteral = toPgVectorLiteral(embedding);
      await client.query(
        `UPDATE ai_batch_items
         SET status = 'completed',
             output_content = $2,
             tokens_used = $3,
             processed_at = now()
         WHERE id = $1`,
        [item.rows[0]!.id, JSON.stringify({ contentHash, dimensions: embedding.length }), tokens]
      );

      await client.query(
        `INSERT INTO lex_context_embeddings
           (shop_id, context_id, provider, model_name, dimensions, content_hash, embedding, status, created_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7::vector(2000), 'ready', now())
         ON CONFLICT (context_id, model_name, content_hash)
         DO UPDATE SET
           embedding = EXCLUDED.embedding,
           provider = EXCLUDED.provider,
           dimensions = EXCLUDED.dimensions,
           status = 'ready'`,
        [
          params.shopId,
          context.id,
          batchProvider,
          embedder.model.name,
          embedder.model.dimensions,
          contentHash,
          vecLiteral,
        ]
      );
      written += 1;
    }

    const estCost =
      providerForBudget === 'selfhosted'
        ? 0
        : estimateChatCost({
            provider: 'openai',
            tokensInput: totalTokens,
            tokensOutput: 0,
          });

    await client.query(
      `UPDATE ai_batches
       SET status = 'completed',
           completed_count = $2,
           total_tokens = $3,
           estimated_cost = $4,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [batchId, written, totalTokens, estCost]
    );

    await client.query(
      `UPDATE lex_runs
       SET ai_batches_count = COALESCE(ai_batches_count, 0) + 1,
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.runId, params.shopId]
    );

    return {
      batchId,
      contextsProcessed: params.contexts.length,
      embeddingsWritten: written,
    };
  });
}

export async function syncLexTranslationSourceEmbeddings(params: {
  shopId: string;
  translationIds: readonly string[];
  env: AppEnv;
  logger: Logger;
}): Promise<{ updated: number }> {
  if (params.translationIds.length === 0) {
    return { updated: 0 };
  }
  const embedder = await resolveEmbeddingsProvider({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
  });
  if (!embedder.isAvailable()) {
    params.logger.debug(
      { shopId: params.shopId, translationCount: params.translationIds.length },
      'sync_source_embeddings_skipped_no_embedder'
    );
    return { updated: 0 };
  }

  const rows = await withTenantContext(params.shopId, async (client) => {
    const res = await client.query<{ id: string; sourceText: string }>(
      `SELECT lt.id, t.canonical_text AS "sourceText"
       FROM lex_translations lt
       INNER JOIN lex_terms t ON t.id = lt.term_id
       WHERE lt.shop_id = $1
         AND lt.id = ANY($2::uuid[])`,
      [params.shopId, params.translationIds]
    );
    return res.rows;
  });

  const embeddable = rows.filter((r) => r.sourceText?.trim().length > 0);
  if (embeddable.length === 0) {
    return { updated: 0 };
  }

  let vectors: readonly (readonly number[])[];
  try {
    vectors = await embedder.embedTexts(embeddable.map((r) => r.sourceText));
  } catch (err) {
    params.logger.info(
      { shopId: params.shopId, err: err instanceof Error ? err.message : String(err) },
      'sync_source_embeddings_embed_failed'
    );
    return { updated: 0 };
  }

  let updated = 0;
  await withTenantContext(params.shopId, async (client) => {
    for (let i = 0; i < embeddable.length; i += 1) {
      const row = embeddable[i]!;
      const vec = vectors[i];
      if (vec?.length !== embedder.model.dimensions) {
        continue;
      }
      await client.query(
        `UPDATE lex_translations
         SET source_embedding = $2::vector(2000),
             updated_at = now()
         WHERE id = $1
           AND shop_id = $3`,
        [row.id, toPgVectorLiteral(vec), params.shopId]
      );
      updated += 1;
    }
  });
  return { updated };
}

export { BudgetExceededError } from '@app/pim';
