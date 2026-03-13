/**
 * Metafield Brainstorm Service
 *
 * Generează sugestii de metafield definitions pentru o colecție folosind
 * un pattern brainstorm + curate (NU consensus) cu 4 sub-agenți paraleli
 * și un arbitru QwQ-32B care selectează top 10.
 *
 * Pattern diferit de consensusChatCompletion:
 *  - Consensus = aceleași răspunsuri de la toți (convergență)
 *  - Brainstorm = răspunsuri diverse, apoi curatare (diversitate → selecție)
 */
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { buildChatCompletionsUrl } from '@app/pim';
import {
  resolveConsensusCredentials,
  type ConsensusChatModelConfig,
} from './ai-provider-routing.js';

export interface MetafieldSuggestion {
  attr_code: string;
  display_name_ro: string;
  display_name_en: string;
  shopify_key: string;
  shopify_type: MetafieldShopifyType;
  description: string;
  is_required: boolean;
}

export type MetafieldShopifyType =
  | 'single_line_text_field'
  | 'multi_line_text_field'
  | 'number_integer'
  | 'number_decimal'
  | 'boolean'
  | 'list.single_line_text_field'
  | 'dimension'
  | 'weight'
  | 'volume';

const VALID_SHOPIFY_TYPES = new Set<string>([
  'single_line_text_field',
  'multi_line_text_field',
  'number_integer',
  'number_decimal',
  'boolean',
  'list.single_line_text_field',
  'dimension',
  'weight',
  'volume',
]);

const ATTR_CODE_RE = /^[a-z][a-z0-9_]{1,98}$/;
const SHOPIFY_KEY_RE = /^[a-z][a-z0-9_]{1,62}$/;

const MAX_SUGGESTIONS_PER_AGENT = 20;
const TOP_N = 10;
const PARALLEL_BATCH_SIZE = 2;

export interface BrainstormCollectionContext {
  titleRo: string;
  titleEn: string;
  descriptionRo: string | null;
  descriptionEn: string | null;
  handle: string;
  taxonomyName: string;
  productTitles: string[];
  existingAttrCodes: string[];
}

interface BrainstormProgressEvent {
  step: string;
  message: string;
  status?: 'done' | 'error' | undefined;
}

export interface BrainstormMetafieldSuggestionsParams {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  context: BrainstormCollectionContext;
  onProgress?: (event: BrainstormProgressEvent) => void;
}

function buildAgentSystemPrompt(): string {
  return `Ești un expert în standardizare atribute tehnice pentru produse din domeniul bricolaj, construcții și amenajări interioare/exterioare.
Primești informații despre o colecție de produse și generezi EXACT ${MAX_SUGGESTIONS_PER_AGENT} metafield-uri standardizate de atribute tehnice.

REGULI OBLIGATORII:
1. Atributele trebuie să fie TEHNICE și MĂSURABILE (nu comerciale, nu descrieri)
2. attr_code: snake_case, litere mici, cifre, underscore, minim 2 caractere (ex: outer_diameter_mm, voltage_v, material_type)
3. shopify_key: identic cu attr_code dar max 64 caractere
4. shopify_type: EXCLUSIV din lista: single_line_text_field, multi_line_text_field, number_integer, number_decimal, boolean, list.single_line_text_field, dimension, weight, volume
5. display_name_ro și display_name_en: max 200 caractere
6. description: max 500 caractere, explică ce se măsoară și în ce unitate
7. Nu repeta același attr_code de două ori în lista ta

Răspunde EXCLUSIV cu JSON valid:
{
  "metafields": [
    {
      "attr_code": "thickness_mm",
      "display_name_ro": "Grosime (mm)",
      "display_name_en": "Thickness (mm)",
      "shopify_key": "thickness_mm",
      "shopify_type": "number_decimal",
      "description": "Grosimea materialului în milimetri",
      "is_required": false
    }
  ]
}`;
}

function buildAgentUserPrompt(context: BrainstormCollectionContext): string {
  const productList =
    context.productTitles.length > 0
      ? context.productTitles.slice(0, 50).join('\n- ')
      : 'Nu sunt disponibile';

  const existing =
    context.existingAttrCodes.length > 0
      ? `\nAtribute deja definite (nu le repeta): ${context.existingAttrCodes.join(', ')}`
      : '';

  return `COLECȚIE DE PRODUSE:
Titlu RO: ${context.titleRo}
Titlu EN: ${context.titleEn}
Handle: ${context.handle}
Taxonomie: ${context.taxonomyName}
${context.descriptionRo ? `Descriere RO: ${context.descriptionRo.slice(0, 500)}` : ''}
${context.descriptionEn ? `Descriere EN: ${context.descriptionEn.slice(0, 500)}` : ''}
${existing}

PRODUSE DIN COLECȚIE (primele 50):
- ${productList}

Generează ${MAX_SUGGESTIONS_PER_AGENT} metafield-uri tehnice standardizate pentru această colecție.`;
}

function buildArbitratorSystemPrompt(): string {
  return `Ești un expert senior în standardizare date pentru e-commerce. Primești sugestii de metafield-uri de la mai mulți agenți AI și selectezi cele mai bune.

CRITERII DE SELECȚIE (în ordine de prioritate):
1. Aplicabilitate: atributul se aplică la >70% din produsele colecției
2. Utilitate pentru filtrare: clienții folosesc activ acest atribut pentru a căuta produse
3. Măsurabilitate: valoarea poate fi standardizată și completată consistent
4. Tip de date corect: shopify_type potrivit pentru datele reale
5. Unicitate: nu selecta atribute redundante (ex: width_mm și width_cm sunt redundante)

Răspunde EXCLUSIV cu JSON valid:
{
  "selected": [
    {
      "attr_code": "string",
      "display_name_ro": "string",
      "display_name_en": "string",
      "shopify_key": "string",
      "shopify_type": "string",
      "description": "string",
      "is_required": false,
      "reasoning": "De ce a fost selectat"
    }
  ],
  "reasoning_summary": "Explicație generală a selecției"
}`;
}

function buildArbitratorUserPrompt(
  allSuggestions: MetafieldSuggestion[],
  context: BrainstormCollectionContext
): string {
  return `COLECȚIE: "${context.titleRo}" (${context.taxonomyName})

Am primit ${allSuggestions.length} sugestii de metafield-uri de la mai mulți agenți.
Selectează EXACT ${TOP_N} cele mai bune, eliminând duplicatele și atributele irelevante.

SUGESTII PRIMITE:
${JSON.stringify(allSuggestions, null, 2)}

Selectează EXACT ${TOP_N} metafield-uri.`;
}

function validateSuggestion(raw: unknown): MetafieldSuggestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const attrCode = typeof obj['attr_code'] === 'string' ? obj['attr_code'].trim() : '';
  const displayNameRo =
    typeof obj['display_name_ro'] === 'string' ? obj['display_name_ro'].trim() : '';
  const displayNameEn =
    typeof obj['display_name_en'] === 'string' ? obj['display_name_en'].trim() : '';
  const shopifyKey = typeof obj['shopify_key'] === 'string' ? obj['shopify_key'].trim() : attrCode;
  const shopifyType = typeof obj['shopify_type'] === 'string' ? obj['shopify_type'].trim() : '';
  const description = typeof obj['description'] === 'string' ? obj['description'].trim() : '';
  const isRequired = obj['is_required'] === true;

  if (!ATTR_CODE_RE.test(attrCode)) return null;
  if (!SHOPIFY_KEY_RE.test(shopifyKey)) return null;
  if (!VALID_SHOPIFY_TYPES.has(shopifyType)) return null;
  if (!displayNameRo || displayNameRo.length > 200) return null;
  if (!displayNameEn || displayNameEn.length > 200) return null;
  if (!description || description.length > 500) return null;

  return {
    attr_code: attrCode,
    display_name_ro: displayNameRo,
    display_name_en: displayNameEn,
    shopify_key: shopifyKey,
    shopify_type: shopifyType as MetafieldShopifyType,
    description,
    is_required: isRequired,
  };
}

function parseAgentResponse(raw: string, logger: Logger): MetafieldSuggestion[] {
  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(raw);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const items = Array.isArray(parsed['metafields']) ? parsed['metafields'] : [];

    const seen = new Set<string>();
    const valid: MetafieldSuggestion[] = [];
    for (const item of items) {
      const suggestion = validateSuggestion(item);
      if (!suggestion) {
        logger.warn({ item }, 'brainstorm: invalid suggestion from agent, skipping');
        continue;
      }
      if (seen.has(suggestion.attr_code)) continue;
      seen.add(suggestion.attr_code);
      valid.push(suggestion);
    }
    return valid;
  } catch (err) {
    logger.warn({ err, raw: raw.slice(0, 200) }, 'brainstorm: failed to parse agent response');
    return [];
  }
}

function parseArbitratorResponse(raw: string, logger: Logger): MetafieldSuggestion[] {
  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(raw);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const items = Array.isArray(parsed['selected']) ? parsed['selected'] : [];

    const seen = new Set<string>();
    const valid: MetafieldSuggestion[] = [];
    for (const item of items) {
      const suggestion = validateSuggestion(item);
      if (!suggestion) {
        logger.warn({ item }, 'brainstorm: invalid arbitrator suggestion, skipping');
        continue;
      }
      if (seen.has(suggestion.attr_code)) continue;
      seen.add(suggestion.attr_code);
      valid.push(suggestion);
      if (valid.length >= TOP_N) break;
    }
    return valid;
  } catch (err) {
    logger.warn({ err, raw: raw.slice(0, 200) }, 'brainstorm: failed to parse arbitrator response');
    return [];
  }
}

const BRAINSTORM_MIN_TIMEOUT_MS = 90_000;

async function callLlm(
  config: ConsensusChatModelConfig,
  systemPrompt: string,
  userPrompt: string,
  logger: Logger
): Promise<string> {
  const effectiveTimeout = Math.max(config.timeoutMs, BRAINSTORM_MIN_TIMEOUT_MS);
  const url = buildChatCompletionsUrl(config.baseUrl);
  logger.info(
    { url, model: config.model, temperature: config.temperature, timeoutMs: effectiveTimeout },
    'brainstorm: calling LLM'
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`brainstorm_llm_error:${response.status}:${body.slice(0, 200)}`);
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null } | null }[];
    };
    const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) throw new Error('brainstorm_empty_content');
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export async function brainstormMetafieldSuggestions(
  params: BrainstormMetafieldSuggestionsParams
): Promise<MetafieldSuggestion[]> {
  const { shopId, env, logger, context, onProgress } = params;

  const emit = (step: string, message: string, status?: 'done' | 'error') => {
    onProgress?.({ step, message, status: status ?? undefined });
  };

  emit('init', 'Se pregătesc sub-agenții AI...');

  const credentialSet = await resolveConsensusCredentials({
    shopId,
    taskType: 'classification',
    env,
    logger,
  });

  if (!credentialSet) {
    throw new Error('brainstorm_no_credentials: Nu sunt disponibile credențiale AI');
  }

  const { calls, arbitration } = credentialSet;

  if (calls.length === 0) {
    throw new Error('brainstorm_no_calls: Nu sunt configurate endpoint-uri pentru sub-agenți');
  }

  const systemPrompt = buildAgentSystemPrompt();
  const userPrompt = buildAgentUserPrompt(context);

  const totalBatches = Math.ceil(calls.length / PARALLEL_BATCH_SIZE);
  emit(
    'agents',
    `Se lansează ${calls.length} sub-agenți (${totalBatches} serii × ${PARALLEL_BATCH_SIZE})...`
  );

  const allSuggestions: MetafieldSuggestion[] = [];
  const seenCodes = new Set(context.existingAttrCodes);

  for (let batchIdx = 0; batchIdx < calls.length; batchIdx += PARALLEL_BATCH_SIZE) {
    const batch = calls.slice(batchIdx, batchIdx + PARALLEL_BATCH_SIZE);
    const batchNum = Math.floor(batchIdx / PARALLEL_BATCH_SIZE) + 1;

    emit(
      `batch_${batchNum}`,
      `Serie ${batchNum}/${totalBatches}: ${batch.length} sub-agenți (${batch.map((c) => c.model.split('/').pop()).join(' + ')})...`
    );

    const results = await Promise.allSettled(
      batch.map((config, localIdx) =>
        callLlm(config, systemPrompt, userPrompt, logger).then((raw) => ({
          idx: batchIdx + localIdx,
          model: config.model,
          raw,
        }))
      )
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.warn({ err: result.reason }, 'brainstorm: sub-agent failed');
        continue;
      }
      const suggestions = parseAgentResponse(result.value.raw, logger);
      logger.info(
        { idx: result.value.idx, model: result.value.model, count: suggestions.length },
        'brainstorm: agent response parsed'
      );
      for (const s of suggestions) {
        if (!seenCodes.has(s.attr_code)) {
          seenCodes.add(s.attr_code);
          allSuggestions.push(s);
        }
      }
    }

    emit(
      `batch_${batchNum}`,
      `Serie ${batchNum}/${totalBatches}: finalizată. ${allSuggestions.length} sugestii până acum.`,
      'done'
    );
  }

  emit(
    'merge',
    `${allSuggestions.length} sugestii unice colectate de la ${calls.length} sub-agenți.`,
    'done'
  );

  if (allSuggestions.length === 0) {
    throw new Error('brainstorm_no_suggestions: Niciun sub-agent nu a returnat sugestii valide');
  }

  emit('arbitration', `Se selectează top ${TOP_N} din ${allSuggestions.length} sugestii...`);

  const arbitratorSystem = buildArbitratorSystemPrompt();
  const arbitratorUser = buildArbitratorUserPrompt(allSuggestions, context);

  let finalSuggestions: MetafieldSuggestion[];
  try {
    const arbitratorRaw = await callLlm(arbitration, arbitratorSystem, arbitratorUser, logger);
    finalSuggestions = parseArbitratorResponse(arbitratorRaw, logger);
    logger.info({ count: finalSuggestions.length }, 'brainstorm: arbitrator selected suggestions');
  } catch (err) {
    logger.warn(
      { err },
      'brainstorm: arbitrator failed, falling back to top suggestions by frequency'
    );
    finalSuggestions = allSuggestions.slice(0, TOP_N);
  }

  if (finalSuggestions.length === 0) {
    finalSuggestions = allSuggestions.slice(0, TOP_N);
  }

  emit('done', `${finalSuggestions.length} metafield-uri selectate.`, 'done');

  return finalSuggestions;
}
