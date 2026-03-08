import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import { configFromEnv, createQueue } from '@app/queue-manager';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { getShopOpenAiConfig } from '../runtime/openai-config.js';
import { resolveChatTaskCredentials } from '../services/ai-provider-routing.js';
import { consensusChatCompletion } from '../services/consensus-engine.js';
import {
  approveMenuAssignment,
  deleteMenuAssignment,
  executeMenuAssignmentForCollection,
  getMenuAssignmentStatus,
  rejectMenuAssignment,
  setPrimaryMenuAssignment,
} from '../services/menu-assignment-engine.js';
import { syncMenuItemEmbeddings } from '../services/menu-ai.js';
import {
  generateDualEmbeddings,
  mergeMultiModelCandidates,
  resolveDualEmbeddingsProviders,
} from '../services/multi-model-embedding.js';
import {
  enqueueCollectionsSyncJob,
  PIM_COLLECTIONS_SYNC_QUEUE_NAME,
} from '../queue/collections-sync-queue.js';
import { enqueueCollectionShopifySyncJob } from '../queue/collection-shopify-sync-queue.js';
import { toPgVectorLiteral } from '../processors/bulk-operations/pim/vector.js';
import {
  approvePendingCollectionChanges,
  getPendingCollectionChangeCounts,
  listPendingCollectionChanges,
  rejectPendingCollectionChange,
  upsertFieldUpdatePendingChange,
  upsertMenuAssignPendingChange,
  upsertTaxonomyAssignPendingChange,
  upsertTaxonomyUnassignPendingChange,
  type CollectionPendingChangeSource,
} from '../services/collection-pending-changes.js';
import {
  buildMenuAssignPendingMetadata,
  buildTaxonomyAssignPendingMetadata,
  buildTaxonomyUnassignPendingMetadata,
  loadCollectionFieldSnapshot,
} from '../services/collection-sync-back-metadata.js';

interface CollectionsRoutesOptions {
  env: AppEnv;
  logger: Logger;
  sessionConfig: SessionConfig;
}

interface RequestWithSession {
  session?: {
    shopId: string;
  };
}

interface TaxonomyClassification {
  taxonomyId: string;
  taxonomyName: string;
  confidence: number;
  reasoning: string;
  translatedQuery: string;
  detectedLanguage: string;
  consensusMethod?: 'unanimous' | 'majority' | 'arbitration' | 'single_fallback';
  consensusScore?: number;
}

interface CollectionAiContext {
  title: string;
  description: string | null;
  descriptionEn: string | null;
  titleEn: string | null;
  parentTitle: string | null;
  menuLevel: number | null;
  menuPath: string | null;
}

interface CollectionTitleTranslation {
  categoryEn: string;
  reasoning: string;
  consensusMethod?: 'unanimous' | 'majority' | 'arbitration' | 'single_fallback';
  consensusScore?: number;
}

function parsePendingSource(
  value: unknown,
  fallback: CollectionPendingChangeSource
): CollectionPendingChangeSource {
  switch (value) {
    case 'manual':
    case 'ai_generate':
    case 'ai_translate':
    case 'ai_taxonomy':
    case 'ai_menu':
    case 'sync':
      return value;
    default:
      return fallback;
  }
}

function parseHierarchySegments(menuPath: string | null): string[] {
  if (!menuPath) return [];
  return menuPath
    .split('>')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function buildHierarchyPromptContext(context: {
  collectionTitle: string;
  menuPath: string | null;
  menuLevel: number | null;
  parentTitle: string | null;
}): string {
  const segments = parseHierarchySegments(context.menuPath);
  if (segments.length === 0 && context.parentTitle == null && context.menuLevel == null) return '';

  const parentSegments =
    segments.length > 1 ? segments.slice(0, -1) : context.parentTitle ? [context.parentTitle] : [];
  const lines = ['Shopify hierarchy context:'];

  if (context.menuPath) {
    lines.push(`- full_tree_path: ${context.menuPath}`);
  }
  if (parentSegments.length > 0) {
    lines.push(`- ancestor_categories: ${parentSegments.join(' > ')}`);
  }
  if (context.parentTitle) {
    lines.push(`- direct_parent_category: ${context.parentTitle}`);
  }
  if (context.menuLevel != null) {
    lines.push(`- tree_level: ${context.menuLevel}`);
  }
  lines.push(
    `- current_collection_title: ${context.collectionTitle}`,
    '- Use this hierarchy ONLY as disambiguation context when the collection title is ambiguous.'
  );

  return lines.join('\n');
}

function buildCollectionEmbeddingText(params: {
  title: string;
  titleEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  menuPath: string | null;
  parentTitle: string | null;
}): string {
  const parts = [params.titleEn ?? params.title];
  if (params.titleEn) {
    parts.push(`Romanian title: ${params.title}`);
  }
  if (params.menuPath) {
    parts.push(`Shopify tree: ${params.menuPath}`);
  } else if (params.parentTitle) {
    parts.push(`Parent category: ${params.parentTitle}`);
  }
  const descText = params.descriptionEn ?? params.description;
  if (descText) {
    parts.push(descText);
  }
  return parts.join(' — ').trim();
}

async function getCollectionAiContext(params: {
  shopId: string;
  collectionId: string;
}): Promise<CollectionAiContext | null> {
  return withTenantContext(params.shopId, async (client) => {
    const r = await client.query<CollectionAiContext>(
      `SELECT sc.title,
              sc.description,
              sc.description_en AS "descriptionEn",
              sc.title_en AS "titleEn",
              parent_sc.title AS "parentTitle",
              sc.menu_level AS "menuLevel",
              sc.menu_path AS "menuPath"
       FROM shopify_collections sc
       LEFT JOIN shopify_collections parent_sc ON parent_sc.id = sc.parent_collection_id
       WHERE sc.shop_id = $1 AND sc.id = $2
       LIMIT 1`,
      [params.shopId, params.collectionId]
    );
    return r.rows[0] ?? null;
  });
}

const TAXONOMY_KEYWORD_STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'other',
  'more',
  'type',
  'types',
  'supplies',
  'supply',
  'products',
  'product',
  'items',
  'item',
  'general',
  'misc',
  'various',
]);

function filterKeywordTokens(tokens: string[]): string[] {
  return tokens.filter((t) => t.length >= 3 && !TAXONOMY_KEYWORD_STOP_WORDS.has(t));
}

function scoreKeywordMatch(taxonomyName: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const lowerName = taxonomyName.toLowerCase();
  let matched = 0;
  for (const token of queryTokens) {
    if (lowerName.includes(token)) matched++;
  }
  const ratio = matched / queryTokens.length;
  return 0.45 + ratio * 0.35;
}

function scoreExactNameMatch(taxonomyName: string, searchTitle: string): number {
  const lowerName = taxonomyName.toLowerCase().trim();
  const lowerTitle = searchTitle.toLowerCase().trim();
  if (lowerName === lowerTitle) return 0.98;
  if (lowerTitle.includes(lowerName)) return 0.92;
  if (lowerName.includes(lowerTitle)) return 0.88;
  return 0.85;
}

async function classifyWithLLM(params: {
  shopId: string;
  env: AppEnv;
  collectionTitle: string;
  collectionTitleEn: string | null;
  collectionDescription: string | null;
  collectionMenuPath: string | null;
  collectionMenuLevel: number | null;
  collectionParentTitle: string | null;
  productSamples?: string[];
  candidates: readonly { id: string; name: string; similarity: number }[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  logger: Logger;
  onConsensusProgress?: (event: {
    step: string;
    message: string;
    status?: 'done' | 'error';
  }) => void;
}): Promise<TaxonomyClassification | null> {
  if (params.candidates.length === 0) return null;

  const topCandidatesForLLM = params.candidates.slice(0, 12);
  const candidateList = topCandidatesForLLM
    .map((c, i) => `${i + 1}. [${c.id}] ${c.name} (relevance: ${Math.round(c.similarity * 100)}%)`)
    .join('\n');

  const titlePart = params.collectionTitleEn
    ? `"${params.collectionTitle}" (English: "${params.collectionTitleEn}")`
    : `"${params.collectionTitle}"`;
  const collectionText = params.collectionDescription
    ? `${titlePart} — ${params.collectionDescription}`
    : titlePart;

  const productSection = params.productSamples?.length
    ? `\n\nSample products from this collection:\n${params.productSamples.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : '';
  const hierarchySection = buildHierarchyPromptContext({
    collectionTitle: params.collectionTitle,
    menuPath: params.collectionMenuPath,
    menuLevel: params.collectionMenuLevel,
    parentTitle: params.collectionParentTitle,
  });

  const userPrompt = `Collection: ${collectionText}${hierarchySection ? `\n\n${hierarchySection}` : ''}${productSection}\n\nCandidate categories (ranked by vector relevance):\n${candidateList}`;

  try {
    const consensus = await consensusChatCompletion<{
      selectedId?: string;
      selectedName?: string;
      confidence?: number;
      reasoning?: string;
      translatedQuery?: string;
      language?: string;
    }>({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      taskType: 'classification',
      systemPrompt: `You are an expert product taxonomy classifier for a Romanian home improvement / hardware / garden e-commerce store on Shopify.

TASK: Given a product collection name, sample product names from the collection, and a ranked list of candidate Google Product Taxonomy categories, select the BEST matching category.

RETURN a JSON object with:
- "selectedId": the UUID from [id] — copy EXACTLY, no brackets
- "selectedName": name of the selected candidate
- "confidence": float 0.0–1.0. Be HONEST and STRICT:
  * 0.9+ = the category name is an obvious, unambiguous match for the products
  * 0.7–0.89 = strong match with minor ambiguity
  * 0.5–0.69 = plausible but uncertain
  * <0.5 = poor match, none of the candidates truly fit
- "reasoning": one sentence explaining WHY
- "translatedQuery": English translation of the collection name
- "language": ISO 639-1 code (e.g. "ro")

CRITICAL RULES:
1. USE THE SAMPLE PRODUCT NAMES as your PRIMARY signal. They tell you what the collection ACTUALLY sells. The collection title can be ambiguous — products never lie.
2. Match the category to WHAT IS BEING SOLD, not to superficially similar words.
3. If sample products are about plants/gardening → pick a plant/garden category, NOT flooring/carpet.
4. If sample products are about paints → pick a paint category, NOT wipes/cleaning.
5. If sample products are about heating stoves/fireplaces → pick a fireplace/stove category, NOT generators.
6. Use the Shopify hierarchy path as SECONDARY context to resolve ambiguous terms. Ancestor categories constrain the domain, but they never override clear product evidence.
7. If NONE of the candidates is a genuine match for the products, set confidence below 0.3.
8. Do NOT inflate confidence. A 95% confidence means you are absolutely certain — use it only when the category name is essentially identical to what the products are.
9. Candidates ranked higher (by relevance %) are statistically more likely but NOT always correct. Override the ranking if a lower-ranked candidate is a clearly better product domain match.`,
      userPrompt,
      responseFormat: { type: 'json_object' },
      maxTokens: 300,
      keyField: 'selectedId',
      ...(params.onConsensusProgress ? { onProgress: params.onConsensusProgress } : {}),
    });
    const parsed = consensus.result;
    if (!parsed.selectedId || typeof parsed.confidence !== 'number') {
      params.logger.warn({ parsed }, 'Invalid LLM classification response');
      return null;
    }

    const normalizedId = parsed.selectedId.replace(/^\[|\]$/g, '').trim();
    const matched = params.candidates.find((c) => c.id === normalizedId);
    if (!matched) {
      params.logger.warn({ selectedId: parsed.selectedId }, 'LLM selected an ID not in candidates');
      return null;
    }

    return {
      taxonomyId: matched.id,
      taxonomyName: parsed.selectedName ?? matched.name,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      reasoning: parsed.reasoning ?? '',
      translatedQuery: parsed.translatedQuery ?? params.collectionTitle,
      detectedLanguage: (parsed.language ?? 'unknown').toLowerCase(),
      consensusMethod: consensus.method,
      consensusScore: consensus.consensusScore,
    };
  } catch (err) {
    params.logger.warn({ err }, 'Taxonomy classification LLM call failed');
    return null;
  }
}

async function sampleProductNames(params: {
  shopId: string;
  collectionId: string;
  limit: number;
}): Promise<string[]> {
  return withTenantContext(params.shopId, async (client) => {
    const r = await client.query<{ title: string }>(
      `SELECT p.title
       FROM shopify_collection_products cp
       JOIN shopify_products p ON p.id = cp.product_id AND p.shop_id = cp.shop_id
       WHERE cp.shop_id = $1 AND cp.collection_id = $2
       ORDER BY cp.position ASC NULLS LAST
       LIMIT $3`,
      [params.shopId, params.collectionId, params.limit]
    );
    return r.rows.map((row) => row.title);
  });
}

async function translateTitleToEnglish(params: {
  shopId: string;
  title: string;
  description: string | null;
  menuPath: string | null;
  menuLevel: number | null;
  parentTitle: string | null;
  env: AppEnv;
  productSamples?: string[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  logger: Logger;
  onConsensusProgress?: (event: {
    step: string;
    message: string;
    status?: 'done' | 'error';
  }) => void;
}): Promise<CollectionTitleTranslation | null> {
  const hasProducts = params.productSamples && params.productSamples.length > 0;
  const productSection = hasProducts
    ? `\n\nSample products sold in this collection:\n${params.productSamples!.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : '';
  const hierarchySection = buildHierarchyPromptContext({
    collectionTitle: params.title,
    menuPath: params.menuPath,
    menuLevel: params.menuLevel,
    parentTitle: params.parentTitle,
  });

  try {
    const consensus = await consensusChatCompletion<{
      reasoning?: string;
      categoryEn?: string;
    }>({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      taskType: 'translation',
      systemPrompt: `You translate Romanian product collection names into English product category names for a home improvement / hardware / garden e-commerce store.

RULE 1 — THE COLLECTION NAME IS THE CATEGORY NAME.
Your job is to translate the COLLECTION NAME into English. The collection name defines the category. Products inside the collection are ONLY used to help you understand unfamiliar Romanian words — they do NOT define the category name.

RULE 2 — SCIENTIFIC / INTERNATIONAL TERMS STAY EXACT.
Words like "acaricide", "fungicide", "herbicide", "insecticide", "nematocide" are international terms. Translate them IDENTICALLY into English. "Acaricide" → "Acaricides" (NOT "Insecticides", NOT "Pesticides").

RULE 3 — USE ROMANCE COGNATES FOR ROMANIAN WORDS.
Romanian is a Romance language. Use French/Italian/Latin cognates:
- "bazin/bazine" = French "bassin" = pool, basin, tank (NEVER "barbecue")
- "butelie" = French "bouteille" = gas bottle/cylinder
- "semineu" = French "cheminée" = fireplace
- "lavabil" = French "lavable" = washable
- "faianta/faianță" = French "faïence" = wall tiles
- "robinet" = French "robinet" = faucet/tap
- "irigații" = French "irrigation" = irrigation
- "mulci" = English "mulch" = garden mulch
- "gresie" = stoneware floor tiles

RULE 4 — "ACCESORII X" = "X Accessories".
Always translate X first using Rules 2-3, then append "Accessories".
Example: "Accesorii Bazine" → "Pool Accessories" (bazine = pools/basins, NOT barbecue).

RULE 5 — USE THE SHOPIFY CATEGORY TREE AS DISAMBIGUATION CONTEXT.
If the collection title is ambiguous, use the ancestor categories/path to understand the business domain. The hierarchy constrains meaning, but the output must still translate the current collection name itself.

EXAMPLES (follow these exactly):
- "Acaricide" → { "reasoning": "Acaricide is an international scientific term meaning mite/tick killers. It must stay exact.", "categoryEn": "Acaricides" }
- "Accesorii Bazine" → { "reasoning": "Bazine = French bassin = pools/basins/tanks. Accesorii = Accessories.", "categoryEn": "Pool Accessories" }
- "Accesorii Butelie" → { "reasoning": "Butelie = French bouteille = gas bottle. Accesorii = Accessories.", "categoryEn": "Gas Bottle Accessories" }
- "Vopsele lavabile" → { "reasoning": "Vopsele = paints, lavabile = washable. This is washable paint.", "categoryEn": "Washable Paints" }
- "Centrale termice" → { "reasoning": "Centrale termice = central heating boilers.", "categoryEn": "Central Heating Boilers" }

Return JSON: { "reasoning": "...", "categoryEn": "..." }`,
      userPrompt: `Collection name: "${params.title}"${params.description ? `\nDescription: ${params.description}` : ''}${hierarchySection ? `\n\n${hierarchySection}` : ''}${productSection}`,
      responseFormat: { type: 'json_object' },
      maxTokens: 300,
      keyField: 'categoryEn',
      ...(params.onConsensusProgress ? { onProgress: params.onConsensusProgress } : {}),
    });

    const parsed = consensus.result;
    const categoryEn = parsed.categoryEn?.trim();
    if (!categoryEn) {
      params.logger.warn({ parsed }, 'taxonomy_assign: translation returned no categoryEn');
      return null;
    }

    params.logger.info(
      { original: params.title, translated: categoryEn, reasoning: parsed.reasoning, hasProducts },
      'taxonomy_assign: translated collection title to English'
    );
    return {
      categoryEn,
      reasoning: parsed.reasoning ?? '',
      consensusMethod: consensus.method,
      consensusScore: consensus.consensusScore,
    };
  } catch (err) {
    params.logger.warn({ err, title: params.title }, 'taxonomy_assign: translation failed');
    return null;
  }
}

async function translateDescriptionToEnglish(params: {
  shopId: string;
  title: string;
  titleEn: string | null;
  description: string;
  env: AppEnv;
  logger: Logger;
  onConsensusProgress?: (event: {
    step: string;
    message: string;
    status?: 'done' | 'error';
  }) => void;
}): Promise<{ descriptionEn: string; consensusMethod?: string; consensusScore?: number } | null> {
  try {
    const consensus = await consensusChatCompletion<{
      descriptionEn?: string;
    }>({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      taskType: 'translation',
      systemPrompt: `You translate Romanian product collection descriptions into English for a home improvement / hardware / garden e-commerce store.

RULES:
1. Translate the description text accurately from Romanian to English.
2. Preserve the meaning, tone, and structure of the original description.
3. Use domain-specific English terms for home improvement, hardware, garden, and agricultural products.
4. Keep the translation concise and professional — do not add information not present in the original.
5. Use the collection title (Romanian and English) as context for domain disambiguation.

Return JSON: { "descriptionEn": "..." }`,
      userPrompt: `Collection: "${params.title}"${params.titleEn ? ` (English: "${params.titleEn}")` : ''}\n\nRomanian description to translate:\n${params.description}`,
      responseFormat: { type: 'json_object' },
      maxTokens: 500,
      keyField: 'descriptionEn',
      ...(params.onConsensusProgress ? { onProgress: params.onConsensusProgress } : {}),
    });

    const descEn = consensus.result.descriptionEn?.trim();
    if (!descEn) {
      params.logger.warn(
        { shopId: params.shopId },
        'translate_description: returned no descriptionEn'
      );
      return null;
    }
    return {
      descriptionEn: descEn,
      consensusMethod: consensus.method,
      consensusScore: consensus.consensusScore,
    };
  } catch (err) {
    params.logger.warn({ err }, 'translate_description: failed');
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function successEnvelope<T>(requestId: string, data: T) {
  return {
    success: true,
    data,
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
  } as const;
}

function errorEnvelope(requestId: string, status: number, code: string, message: string) {
  return {
    success: false,
    error: { code, message },
    meta: {
      request_id: requestId,
      timestamp: nowIso(),
    },
    status,
  } as const;
}

export const collectionsRoutes: FastifyPluginAsync<CollectionsRoutesOptions> = (
  server: FastifyInstance,
  options
) => {
  const { sessionConfig } = options;
  const requireAdminSession = requireSession(sessionConfig);

  const ALLOWED_SORT: Record<string, string> = {
    title: 'sc.title',
    products_count: 'sc.products_count',
    synced_at: 'sc.synced_at',
    collection_type: 'sc.collection_type',
    menu_level: 'sc.menu_level',
  };

  server.get(
    '/collections',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const query = request.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(query['page'] ?? '1', 10) || 1);
      const limitRaw = query['limit'] ?? '25';
      const allowedLimits = [10, 25, 50, 100];
      const limit = allowedLimits.includes(parseInt(limitRaw, 10)) ? parseInt(limitRaw, 10) : 25;
      const search = (query['search'] ?? '').trim();
      const type = query['type'] ?? 'all';
      const hasTaxonomy = query['hasTaxonomy'] ?? 'all';
      const hasTranslation = query['hasTranslation'] ?? 'all';
      const hasDescription = query['hasDescription'] ?? 'all';
      const hasImage = query['hasImage'] ?? 'all';
      const menuLevel = query['menuLevel'] ?? 'all';
      const menuAiState = query['menuAiState'] ?? 'all';
      const sortBy = query['sortBy'] ?? 'synced_at';
      const sortDir = (query['sortDir'] ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const minProducts = query['minProducts'] != null ? parseInt(query['minProducts'], 10) : null;
      const maxProducts = query['maxProducts'] != null ? parseInt(query['maxProducts'], 10) : null;

      const orderColumn = ALLOWED_SORT[sortBy] ?? 'sc.updated_at';

      const rows = await withTenantContext(session.shopId, async (client) => {
        const params: unknown[] = [session.shopId];
        let paramIdx = 2;
        const conditions: string[] = ['sc.shop_id = $1'];

        if (search.length > 0) {
          conditions.push(`(sc.title ILIKE $${paramIdx} OR sc.handle ILIKE $${paramIdx})`);
          params.push(`%${search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
          paramIdx += 1;
        }
        if (type === 'MANUAL' || type === 'SMART') {
          conditions.push(`sc.collection_type = $${paramIdx}`);
          params.push(type);
          paramIdx += 1;
        }
        if (hasTaxonomy === 'true') {
          conditions.push(
            `EXISTS (SELECT 1 FROM pim_taxonomy_collection_map m WHERE m.collection_id = sc.id AND m.shop_id = sc.shop_id)`
          );
        } else if (hasTaxonomy === 'false') {
          conditions.push(
            `NOT EXISTS (SELECT 1 FROM pim_taxonomy_collection_map m WHERE m.collection_id = sc.id AND m.shop_id = sc.shop_id)`
          );
        }
        if (hasTranslation === 'true') {
          conditions.push(`sc.title_en IS NOT NULL AND sc.title_en <> ''`);
        } else if (hasTranslation === 'false') {
          conditions.push(`(sc.title_en IS NULL OR sc.title_en = '')`);
        }
        if (hasDescription === 'true') {
          conditions.push(`sc.description IS NOT NULL AND sc.description <> ''`);
        } else if (hasDescription === 'false') {
          conditions.push(`(sc.description IS NULL OR sc.description = '')`);
        }
        if (hasImage === 'true') {
          conditions.push(`sc.image_url IS NOT NULL AND sc.image_url <> ''`);
        } else if (hasImage === 'false') {
          conditions.push(`(sc.image_url IS NULL OR sc.image_url = '')`);
        }
        if (menuLevel === 'none') {
          conditions.push(`sc.menu_level IS NULL`);
        } else if (menuLevel === 'in_menu') {
          conditions.push(`sc.menu_level IS NOT NULL`);
        } else if (menuLevel !== 'all') {
          const parsedMenuLevel = parseInt(menuLevel, 10);
          if (!Number.isNaN(parsedMenuLevel)) {
            conditions.push(`sc.menu_level = $${paramIdx}`);
            params.push(parsedMenuLevel);
            paramIdx += 1;
          }
        }
        if (menuAiState === 'has_assignments') {
          conditions.push(
            `EXISTS (
               SELECT 1
                 FROM shopify_collection_menu_assignments sma
                WHERE sma.shop_id = sc.shop_id
                  AND sma.collection_id = sc.id
                  AND sma.status IN ('active', 'approved')
             )`
          );
        } else if (menuAiState === 'review_required') {
          conditions.push(
            `EXISTS (
               SELECT 1
                 FROM shopify_collection_menu_assignments sma
                WHERE sma.shop_id = sc.shop_id
                  AND sma.collection_id = sc.id
                  AND sma.status = 'proposed'
             )`
          );
        } else if (menuAiState === 'multiparent') {
          conditions.push(
            `(SELECT COUNT(*)
                FROM shopify_collection_menu_assignments sma
               WHERE sma.shop_id = sc.shop_id
                 AND sma.collection_id = sc.id
                 AND sma.status IN ('active', 'approved')) > 1`
          );
        }
        if (minProducts != null && !Number.isNaN(minProducts)) {
          conditions.push(`sc.products_count >= $${paramIdx}`);
          params.push(minProducts);
          paramIdx += 1;
        }
        if (maxProducts != null && !Number.isNaN(maxProducts)) {
          conditions.push(`sc.products_count <= $${paramIdx}`);
          params.push(maxProducts);
          paramIdx += 1;
        }

        const whereClause = conditions.join(' AND ');
        params.push(limit, (page - 1) * limit);

        const result = await client.query<{
          id: string;
          shopify_gid: string;
          legacy_resource_id: number;
          title: string;
          handle: string;
          collection_type: string;
          products_count: number;
          taxonomy_count: number;
          taxonomy_name: string | null;
          synced_at: string | null;
          description: string | null;
          description_html: string | null;
          description_en: string | null;
          title_en: string | null;
          image_url: string | null;
          parent_collection_id: string | null;
          parent_title: string | null;
          menu_level: number | null;
          menu_path: string | null;
          menu_assignment_count: number;
          menu_review_count: number;
          total_count: string;
        }>(
          `SELECT sc.id,
                  sc.shopify_gid,
                  sc.legacy_resource_id,
                  sc.title,
                  sc.title_en,
                  sc.handle,
                  sc.collection_type,
                  sc.products_count,
                  COALESCE(COUNT(ptcm.taxonomy_id), 0)::int AS taxonomy_count,
                  MAX(pt.name) AS taxonomy_name,
                  sc.synced_at::text,
                  sc.description,
                  sc.description_html,
                  sc.description_en,
                  sc.image_url,
                  sc.parent_collection_id,
                  parent_sc.title AS parent_title,
                  sc.menu_level,
                  sc.menu_path,
                  COALESCE((
                    SELECT COUNT(*)::int
                      FROM shopify_collection_menu_assignments sma
                     WHERE sma.shop_id = sc.shop_id
                       AND sma.collection_id = sc.id
                       AND sma.status IN ('active', 'approved')
                  ), 0) AS menu_assignment_count,
                  COALESCE((
                    SELECT COUNT(*)::int
                      FROM shopify_collection_menu_assignments sma
                     WHERE sma.shop_id = sc.shop_id
                       AND sma.collection_id = sc.id
                       AND sma.status = 'proposed'
                  ), 0) AS menu_review_count,
                  COUNT(*) OVER()::text AS total_count
           FROM shopify_collections sc
           LEFT JOIN shopify_collections parent_sc
             ON parent_sc.id = sc.parent_collection_id
           LEFT JOIN pim_taxonomy_collection_map ptcm
             ON ptcm.collection_id = sc.id
            AND ptcm.shop_id = sc.shop_id
           LEFT JOIN prod_taxonomy pt ON pt.id = ptcm.taxonomy_id
           WHERE ${whereClause}
           GROUP BY sc.id, sc.shopify_gid, sc.legacy_resource_id, sc.title, sc.title_en, sc.handle,
                    sc.collection_type, sc.products_count, sc.synced_at, sc.description,
                    sc.description_html, sc.description_en, sc.image_url, sc.parent_collection_id, parent_sc.title,
                    sc.menu_level, sc.menu_path, sc.updated_at
           ORDER BY ${orderColumn} ${sortDir}
           LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          params
        );

        return result.rows;
      });

      const total = rows.length > 0 ? parseInt(rows[0]!.total_count, 10) : 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const collections = rows.map((r) => ({
        id: r.id,
        shopify_gid: r.shopify_gid,
        legacy_resource_id: r.legacy_resource_id,
        title: r.title,
        title_en: r.title_en,
        handle: r.handle,
        collection_type: r.collection_type,
        products_count: r.products_count,
        taxonomy_count: r.taxonomy_count,
        taxonomy_name: r.taxonomy_name,
        synced_at: r.synced_at,
        description: r.description,
        description_html: r.description_html,
        description_en: r.description_en,
        image_url: r.image_url,
        parent_collection_id: r.parent_collection_id,
        parent_title: r.parent_title,
        menu_level: r.menu_level,
        menu_path: r.menu_path,
        menu_assignment_count: r.menu_assignment_count,
        menu_review_count: r.menu_review_count,
      }));

      return reply.send(
        successEnvelope(request.id, {
          collections,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        })
      );
    }
  );

  server.get(
    '/collections/all-ids',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const query = request.query as Record<string, string | undefined>;
      const search = (query['search'] ?? '').trim();
      const type = query['type'] ?? 'all';
      const hasTaxonomy = query['hasTaxonomy'] ?? 'all';
      const hasTranslation = query['hasTranslation'] ?? 'all';
      const hasDescription = query['hasDescription'] ?? 'all';
      const hasImage = query['hasImage'] ?? 'all';
      const menuLevel = query['menuLevel'] ?? 'all';
      const menuAiState = query['menuAiState'] ?? 'all';

      const ids = await withTenantContext(session.shopId, async (client) => {
        const params: unknown[] = [session.shopId];
        let paramIdx = 2;
        const conditions: string[] = ['shop_id = $1'];

        if (search.length > 0) {
          conditions.push(`(title ILIKE $${paramIdx} OR handle ILIKE $${paramIdx})`);
          params.push(`%${search.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
          paramIdx += 1;
        }
        if (type === 'MANUAL' || type === 'SMART') {
          conditions.push(`collection_type = $${paramIdx}`);
          params.push(type);
          paramIdx += 1;
        }
        if (hasTaxonomy === 'true') {
          conditions.push(
            `EXISTS (SELECT 1 FROM pim_taxonomy_collection_map m WHERE m.collection_id = shopify_collections.id AND m.shop_id = shopify_collections.shop_id)`
          );
        } else if (hasTaxonomy === 'false') {
          conditions.push(
            `NOT EXISTS (SELECT 1 FROM pim_taxonomy_collection_map m WHERE m.collection_id = shopify_collections.id AND m.shop_id = shopify_collections.shop_id)`
          );
        }
        if (hasTranslation === 'true') {
          conditions.push(`title_en IS NOT NULL AND title_en <> ''`);
        } else if (hasTranslation === 'false') {
          conditions.push(`(title_en IS NULL OR title_en = '')`);
        }
        if (hasDescription === 'true') {
          conditions.push(`description IS NOT NULL AND description <> ''`);
        } else if (hasDescription === 'false') {
          conditions.push(`(description IS NULL OR description = '')`);
        }
        if (hasImage === 'true') {
          conditions.push(`image_url IS NOT NULL AND image_url <> ''`);
        } else if (hasImage === 'false') {
          conditions.push(`(image_url IS NULL OR image_url = '')`);
        }
        if (menuLevel === 'none') {
          conditions.push(`menu_level IS NULL`);
        } else if (menuLevel === 'in_menu') {
          conditions.push(`menu_level IS NOT NULL`);
        } else if (menuLevel !== 'all') {
          const parsedMenuLevel = parseInt(menuLevel, 10);
          if (!Number.isNaN(parsedMenuLevel)) {
            conditions.push(`menu_level = $${paramIdx}`);
            params.push(parsedMenuLevel);
          }
        }
        if (menuAiState === 'has_assignments') {
          conditions.push(
            `EXISTS (
               SELECT 1
                 FROM shopify_collection_menu_assignments m
                WHERE m.collection_id = shopify_collections.id
                  AND m.shop_id = shopify_collections.shop_id
                  AND m.status IN ('active', 'approved')
             )`
          );
        } else if (menuAiState === 'review_required') {
          conditions.push(
            `EXISTS (
               SELECT 1
                 FROM shopify_collection_menu_assignments m
                WHERE m.collection_id = shopify_collections.id
                  AND m.shop_id = shopify_collections.shop_id
                  AND m.status = 'proposed'
             )`
          );
        } else if (menuAiState === 'multiparent') {
          conditions.push(
            `(SELECT COUNT(*)
                FROM shopify_collection_menu_assignments m
               WHERE m.collection_id = shopify_collections.id
                 AND m.shop_id = shopify_collections.shop_id
                 AND m.status IN ('active', 'approved')) > 1`
          );
        }

        const r = await client.query<{ id: string }>(
          `SELECT id FROM shopify_collections WHERE ${conditions.join(' AND ')} ORDER BY id`,
          params
        );
        return r.rows.map((row) => row.id);
      });

      return reply.send(successEnvelope(request.id, { ids, total: ids.length }));
    }
  );

  server.get(
    '/collections/stats',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const statsRow = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          total: number;
          manual: number;
          smart: number;
          with_taxonomy: number;
          translated: number;
          with_description: number;
          with_image: number;
          in_menu: number;
          roots: number;
          not_in_menu: number;
          total_products: number;
          last_synced_at: string | null;
        }>(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE collection_type = 'MANUAL')::int AS manual,
                  COUNT(*) FILTER (WHERE collection_type = 'SMART')::int AS smart,
                  COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM pim_taxonomy_collection_map m
                    WHERE m.collection_id = sc.id AND m.shop_id = sc.shop_id
                  ))::int AS with_taxonomy,
                  COUNT(*) FILTER (WHERE title_en IS NOT NULL AND title_en <> '')::int AS translated,
                  COUNT(*) FILTER (WHERE description IS NOT NULL AND description <> '')::int AS with_description,
                  COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url <> '')::int AS with_image,
                  COUNT(*) FILTER (WHERE menu_level IS NOT NULL)::int AS in_menu,
                  COUNT(*) FILTER (WHERE menu_level = 0)::int AS roots,
                  COUNT(*) FILTER (WHERE menu_level IS NULL)::int AS not_in_menu,
                  COALESCE(SUM(products_count), 0)::int AS total_products,
                  MAX(synced_at)::text AS last_synced_at
           FROM shopify_collections sc
           WHERE sc.shop_id = $1`,
          [session.shopId]
        );
        return result.rows[0] ?? null;
      });

      if (!statsRow) {
        return reply.send(
          successEnvelope(request.id, {
            total: 0,
            manual: 0,
            smart: 0,
            withTaxonomy: 0,
            translated: 0,
            withDescription: 0,
            withImage: 0,
            inMenu: 0,
            roots: 0,
            notInMenu: 0,
            totalProducts: 0,
            lastSyncedAt: null,
          })
        );
      }

      return reply.send(
        successEnvelope(request.id, {
          total: statsRow.total,
          manual: statsRow.manual,
          smart: statsRow.smart,
          withTaxonomy: statsRow.with_taxonomy,
          translated: statsRow.translated,
          withDescription: statsRow.with_description,
          withImage: statsRow.with_image,
          inMenu: statsRow.in_menu,
          roots: statsRow.roots,
          notInMenu: statsRow.not_in_menu,
          totalProducts: statsRow.total_products,
          lastSyncedAt: statsRow.last_synced_at,
        })
      );
    }
  );

  server.get(
    '/collections/:id',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }

      const row = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          shopify_gid: string;
          legacy_resource_id: number;
          title: string;
          title_en: string | null;
          handle: string;
          collection_type: string;
          products_count: number;
          taxonomy_count: number;
          taxonomy_name: string | null;
          synced_at: string | null;
          description: string | null;
          description_html: string | null;
          description_en: string | null;
          image_url: string | null;
          parent_collection_id: string | null;
          parent_title: string | null;
          menu_level: number | null;
          menu_path: string | null;
          menu_assignment_count: number;
          menu_review_count: number;
        }>(
          `SELECT sc.id,
                  sc.shopify_gid,
                  sc.legacy_resource_id,
                  sc.title,
                  sc.title_en,
                  sc.handle,
                  sc.collection_type,
                  sc.products_count,
                  COALESCE(COUNT(ptcm.taxonomy_id), 0)::int AS taxonomy_count,
                  MAX(pt.name) AS taxonomy_name,
                  sc.synced_at::text,
                  sc.description,
                  sc.description_html,
                  sc.description_en,
                  sc.image_url,
                  sc.parent_collection_id,
                  parent_sc.title AS parent_title,
                  sc.menu_level,
                  sc.menu_path,
                  COALESCE((
                    SELECT COUNT(*)::int
                      FROM shopify_collection_menu_assignments sma
                     WHERE sma.shop_id = sc.shop_id
                       AND sma.collection_id = sc.id
                       AND sma.status IN ('active', 'approved')
                  ), 0) AS menu_assignment_count,
                  COALESCE((
                    SELECT COUNT(*)::int
                      FROM shopify_collection_menu_assignments sma
                     WHERE sma.shop_id = sc.shop_id
                       AND sma.collection_id = sc.id
                       AND sma.status = 'proposed'
                  ), 0) AS menu_review_count
           FROM shopify_collections sc
           LEFT JOIN shopify_collections parent_sc
             ON parent_sc.id = sc.parent_collection_id
           LEFT JOIN pim_taxonomy_collection_map ptcm
             ON ptcm.collection_id = sc.id
            AND ptcm.shop_id = sc.shop_id
           LEFT JOIN prod_taxonomy pt ON pt.id = ptcm.taxonomy_id
           WHERE sc.shop_id = $1
             AND sc.id = $2
           GROUP BY sc.id, sc.shopify_gid, sc.legacy_resource_id, sc.title, sc.title_en,
                    sc.handle, sc.collection_type, sc.products_count, sc.synced_at,
                    sc.description, sc.description_html, sc.description_en, sc.image_url,
                    sc.parent_collection_id, parent_sc.title, sc.menu_level, sc.menu_path
           LIMIT 1`,
          [session.shopId, collectionId]
        );
        return result.rows[0] ?? null;
      });

      if (!row) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Collection not found'));
      }

      return reply.send(
        successEnvelope(request.id, {
          collection: {
            id: row.id,
            shopify_gid: row.shopify_gid,
            legacy_resource_id: row.legacy_resource_id,
            title: row.title,
            title_en: row.title_en,
            handle: row.handle,
            collection_type: row.collection_type,
            products_count: row.products_count,
            taxonomy_count: row.taxonomy_count,
            taxonomy_name: row.taxonomy_name,
            synced_at: row.synced_at,
            description: row.description,
            description_html: row.description_html,
            description_en: row.description_en,
            image_url: row.image_url,
            parent_collection_id: row.parent_collection_id,
            parent_title: row.parent_title,
            menu_level: row.menu_level,
            menu_path: row.menu_path,
            menu_assignment_count: row.menu_assignment_count,
            menu_review_count: row.menu_review_count,
          },
        })
      );
    }
  );

  server.patch(
    '/collections/:id',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }

      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing body'));
      }

      const allowedFields: Record<string, 'title' | 'title_en' | 'description' | 'description_en'> =
        {
          title: 'title',
          title_en: 'title_en',
          description: 'description',
          description_en: 'description_en',
        };
      const source = parsePendingSource(body['source'], 'manual');

      const setClauses: string[] = [];
      const values: unknown[] = [session.shopId, collectionId];
      let paramIdx = 3;
      const pendingFieldUpdates: {
        fieldName: 'title' | 'description';
        newValue: string | null;
      }[] = [];

      for (const [jsonKey, dbColumn] of Object.entries(allowedFields)) {
        if (jsonKey in body) {
          const val = body[jsonKey];
          if (val !== null && typeof val !== 'string') continue;
          const normalizedValue = val === '' ? null : val;
          setClauses.push(`${dbColumn} = $${paramIdx}`);
          values.push(normalizedValue);
          if (dbColumn === 'title' || dbColumn === 'description') {
            pendingFieldUpdates.push({
              fieldName: dbColumn,
              newValue: normalizedValue,
            });
          }
          paramIdx += 1;
        }
      }

      if (setClauses.length === 0) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'No updatable fields provided'));
      }

      setClauses.push('updated_at = now()');

      await withTenantContext(session.shopId, async (client) => {
        const snapshot = await loadCollectionFieldSnapshot({
          shopId: session.shopId,
          collectionId,
        });
        await client.query(
          `UPDATE shopify_collections
              SET ${setClauses.join(', ')}
            WHERE shop_id = $1 AND id = $2`,
          values
        );
        for (const fieldUpdate of pendingFieldUpdates) {
          await upsertFieldUpdatePendingChange(client, {
            shopId: session.shopId,
            collectionId,
            fieldName: fieldUpdate.fieldName,
            oldValue: fieldUpdate.fieldName === 'title' ? snapshot.title : snapshot.description,
            newValue: fieldUpdate.newValue,
            source,
          });
        }
      });

      const pending = await getPendingCollectionChangeCounts(session.shopId);
      return reply.send(successEnvelope(request.id, { updated: true, pendingChanges: pending }));
    }
  );

  server.get(
    '/collections/pending-changes',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const pending = await listPendingCollectionChanges(session.shopId);
      return reply.send(successEnvelope(request.id, pending));
    }
  );

  server.get(
    '/collections/pending-changes/count',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const counts = await getPendingCollectionChangeCounts(session.shopId);
      return reply.send(successEnvelope(request.id, counts));
    }
  );

  server.post(
    '/collections/pending-changes/approve',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const approved = await approvePendingCollectionChanges(session.shopId);
      for (const change of approved) {
        await enqueueCollectionShopifySyncJob({
          shopId: change.shopId,
          changeId: change.id,
          collectionId: change.collectionId,
          changeType: change.changeType,
          fieldName: change.fieldName,
          newValue: change.newValue,
          metadata: change.metadata,
          shopifyMutation: change.shopifyMutation,
        });
      }
      const pending = await getPendingCollectionChangeCounts(session.shopId);
      return reply.send(
        successEnvelope(request.id, { approved: approved.length, queued: approved.length, pending })
      );
    }
  );

  server.post(
    '/collections/pending-changes/:id/reject',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const changeId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!changeId?.trim()) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing pending change id'));
      }

      const rejected = await rejectPendingCollectionChange(session.shopId, changeId);
      if (!rejected) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Pending change not found'));
      }
      const pending = await getPendingCollectionChangeCounts(session.shopId);
      return reply.send(successEnvelope(request.id, { rejected: true, pending }));
    }
  );

  server.post(
    '/collections/menu-items/regenerate-embeddings',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      try {
        const result = await syncMenuItemEmbeddings({
          shopId: session.shopId,
          env: options.env,
          logger: options.logger,
          force: true,
        });
        return reply.send(
          successEnvelope(request.id, {
            embedded: result.embedded,
            total: result.total,
            errors: result.errors,
          })
        );
      } catch (error) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              error instanceof Error ? error.message : 'Regenerarea embedding-urilor a eșuat.'
            )
          );
      }
    }
  );

  server.get(
    '/collections/:id/menu-assignment-status',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId?.trim()) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }

      const status = await getMenuAssignmentStatus({
        shopId: session.shopId,
        collectionId,
      });
      if (!status) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Collection not found'));
      }

      return reply.send(successEnvelope(request.id, status));
    }
  );

  server.post(
    '/collections/:id/assign-menu-ai',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId?.trim()) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });

      const emit = (event: Record<string, unknown>) => {
        try {
          raw.write(JSON.stringify(event) + '\n');
        } catch {
          /* closed */
        }
      };

      try {
        const collectionRow = await getCollectionAiContext({
          shopId: session.shopId,
          collectionId,
        });
        if (!collectionRow?.title) {
          emit({ type: 'error', message: 'Colecția nu a fost găsită.' });
          return;
        }

        emit({ type: 'menu_assign_start', total: 1 });
        emit({
          type: 'menu_assign_collection_start',
          collectionId,
          collectionTitle: collectionRow.title,
          index: 0,
          total: 1,
        });

        const result = await executeMenuAssignmentForCollection({
          shopId: session.shopId,
          collectionId,
          env: options.env,
          logger: options.logger,
          onProgress: (step, message, status) => {
            emit({
              type: 'menu_assign_progress',
              collectionId,
              step,
              message,
              ...(status ? { status } : {}),
            });
          },
        });

        emit({
          type: 'menu_assign_collection_result',
          collectionId,
          collectionTitle: collectionRow.title,
          status: result.status,
          assignments: result.assignments,
          reviewRequired: result.reviewRequired,
          message: result.message,
          primaryCount: result.primaryCount,
          secondaryCount: result.secondaryCount,
          proposedCount: result.proposedCount,
          missingPathProposal: result.missingPathProposal,
          consensusMethod: result.consensusMethod ?? null,
          consensusScore: result.consensusScore ?? null,
        });
        emit({ type: 'menu_assign_done' });
      } catch (error) {
        options.logger.error({ err: error, collectionId }, 'Single menu assignment failed');
        emit({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'Eroare internă la asignarea categoriilor AI.',
        });
      } finally {
        raw.end();
      }
    }
  );

  server.post(
    '/collections/bulk/assign-menu-ai',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = (request.body ?? {}) as { collectionIds?: unknown };
      const rawIds = Array.isArray(body.collectionIds) ? body.collectionIds : [];
      const collectionIds = rawIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .slice(0, 50);
      if (collectionIds.length === 0) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing or invalid collectionIds'));
      }

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });

      const emit = (event: Record<string, unknown>) => {
        try {
          raw.write(JSON.stringify(event) + '\n');
        } catch {
          /* closed */
        }
      };

      try {
        emit({ type: 'menu_assign_start', total: collectionIds.length });
        for (let index = 0; index < collectionIds.length; index += 1) {
          const collectionId = collectionIds[index]!;
          const collectionRow = await getCollectionAiContext({
            shopId: session.shopId,
            collectionId,
          });
          const collectionTitle = collectionRow?.title ?? collectionId;

          emit({
            type: 'menu_assign_collection_start',
            collectionId,
            collectionTitle,
            index,
            total: collectionIds.length,
          });

          try {
            const result = await executeMenuAssignmentForCollection({
              shopId: session.shopId,
              collectionId,
              env: options.env,
              logger: options.logger,
              onProgress: (step, message, status) => {
                emit({
                  type: 'menu_assign_progress',
                  collectionId,
                  step,
                  message,
                  ...(status ? { status } : {}),
                });
              },
            });

            emit({
              type: 'menu_assign_collection_result',
              collectionId,
              collectionTitle,
              status: result.status,
              assignments: result.assignments,
              reviewRequired: result.reviewRequired,
              message: result.message,
              primaryCount: result.primaryCount,
              secondaryCount: result.secondaryCount,
              proposedCount: result.proposedCount,
              missingPathProposal: result.missingPathProposal,
              consensusMethod: result.consensusMethod ?? null,
              consensusScore: result.consensusScore ?? null,
            });
          } catch (error) {
            options.logger.error({ err: error, collectionId }, 'Bulk menu assignment failed');
            emit({
              type: 'menu_assign_collection_result',
              collectionId,
              collectionTitle,
              status: 'error',
              assignments: [],
              reviewRequired: false,
              message: error instanceof Error ? error.message : 'Eroare internă.',
              primaryCount: 0,
              secondaryCount: 0,
              proposedCount: 0,
              missingPathProposal: null,
            });
          }
        }
        emit({ type: 'menu_assign_done' });
      } catch (error) {
        options.logger.error({ err: error }, 'Bulk menu assignment stream failed');
        emit({
          type: 'error',
          message: error instanceof Error ? error.message : 'Eroare internă la bulk menu AI.',
        });
      } finally {
        raw.end();
      }
    }
  );

  server.post(
    '/collections/:id/menu-assignments/:assignmentId/approve',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id: collectionId, assignmentId } = request.params as {
        id?: string;
        assignmentId?: string;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId?.trim() || !assignmentId?.trim()) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection or assignment id')
          );
      }

      try {
        const updated = await approveMenuAssignment({
          shopId: session.shopId,
          collectionId,
          assignmentId,
          actor: 'admin-ui',
        });
        if (!updated) {
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Assignment not found'));
        }
        const pendingMetadata = await buildMenuAssignPendingMetadata({
          shopId: session.shopId,
          collectionId,
          assignmentId,
        });
        if (pendingMetadata) {
          await withTenantContext(session.shopId, async (client) => {
            await upsertMenuAssignPendingChange(client, {
              shopId: session.shopId,
              collectionId,
              assignmentId,
              metadata: pendingMetadata,
              source: 'ai_menu',
            });
          });
        }
        const status = await getMenuAssignmentStatus({ shopId: session.shopId, collectionId });
        return reply.send(successEnvelope(request.id, { updated: true, status }));
      } catch (error) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              error instanceof Error ? error.message : 'Aprobarea a eșuat.'
            )
          );
      }
    }
  );

  server.post(
    '/collections/:id/menu-assignments/:assignmentId/reject',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id: collectionId, assignmentId } = request.params as {
        id?: string;
        assignmentId?: string;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId?.trim() || !assignmentId?.trim()) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection or assignment id')
          );
      }

      const updated = await rejectMenuAssignment({
        shopId: session.shopId,
        collectionId,
        assignmentId,
        actor: 'admin-ui',
      });
      if (!updated) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Assignment not found'));
      }
      const status = await getMenuAssignmentStatus({ shopId: session.shopId, collectionId });
      return reply.send(successEnvelope(request.id, { updated: true, status }));
    }
  );

  server.patch(
    '/collections/:id/menu-assignments/:assignmentId/primary',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id: collectionId, assignmentId } = request.params as {
        id?: string;
        assignmentId?: string;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId?.trim() || !assignmentId?.trim()) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection or assignment id')
          );
      }

      try {
        const updated = await setPrimaryMenuAssignment({
          shopId: session.shopId,
          collectionId,
          assignmentId,
          actor: 'admin-ui',
        });
        if (!updated) {
          return reply
            .status(404)
            .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Assignment not found'));
        }
        const status = await getMenuAssignmentStatus({ shopId: session.shopId, collectionId });
        return reply.send(successEnvelope(request.id, { updated: true, status }));
      } catch (error) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              error instanceof Error ? error.message : 'Setarea primarei a eșuat.'
            )
          );
      }
    }
  );

  server.delete(
    '/collections/:id/menu-assignments/:assignmentId',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const { id: collectionId, assignmentId } = request.params as {
        id?: string;
        assignmentId?: string;
      };
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId?.trim() || !assignmentId?.trim()) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection or assignment id')
          );
      }

      const pendingMetadata = await buildMenuAssignPendingMetadata({
        shopId: session.shopId,
        collectionId,
        assignmentId,
      });
      const removed = await deleteMenuAssignment({
        shopId: session.shopId,
        collectionId,
        assignmentId,
        actor: 'admin-ui',
      });
      if (!removed) {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Assignment not found'));
      }
      if (pendingMetadata) {
        await withTenantContext(session.shopId, async (client) => {
          await upsertMenuAssignPendingChange(client, {
            shopId: session.shopId,
            collectionId,
            assignmentId,
            metadata: {
              ...pendingMetadata,
              action: 'remove',
            },
            source: 'manual',
          });
        });
      }
      const status = await getMenuAssignmentStatus({ shopId: session.shopId, collectionId });
      return reply.send(successEnvelope(request.id, { removed: true, status }));
    }
  );

  server.post(
    '/collections/bulk/assign-taxonomy-ai',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = (request.body ?? {}) as {
        collectionIds?: unknown;
        mode?: unknown;
        source?: unknown;
      };
      const rawIds = Array.isArray(body.collectionIds) ? body.collectionIds : [];
      const collectionIds = rawIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .slice(0, 50);
      const mode =
        body.mode === 'add_secondary'
          ? 'add_secondary'
          : ('replace' as 'replace' | 'add_secondary');
      const source = parsePendingSource(body.source, 'ai_taxonomy');
      if (collectionIds.length === 0) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing or invalid collectionIds'));
      }

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });

      const emit = (event: Record<string, unknown>) => {
        try {
          raw.write(JSON.stringify(event) + '\n');
        } catch {
          /* closed */
        }
      };

      try {
        const providers = await resolveDualEmbeddingsProviders({
          shopId: session.shopId,
          env: options.env,
          logger: options.logger,
        });
        const provider = providers.primary;

        emit({ type: 'bulk_start', total: collectionIds.length });

        const CONFIDENCE_THRESHOLD = 0.65;
        const VECTOR_CANDIDATES = 40;

        for (let idx = 0; idx < collectionIds.length; idx++) {
          const collectionId = collectionIds[idx]!;
          const progress = `[${idx + 1}/${collectionIds.length}]`;

          try {
            const collectionRow = await getCollectionAiContext({
              shopId: session.shopId,
              collectionId,
            });

            if (!collectionRow?.title) {
              emit({
                type: 'collection_result',
                collectionId,
                collectionTitle: collectionId,
                status: 'error',
                message: 'Colecția nu a fost găsită.',
              });
              continue;
            }

            emit({
              type: 'collection_start',
              collectionId,
              collectionTitle: collectionRow.title,
              index: idx,
              total: collectionIds.length,
            });

            const existingMappings = await withTenantContext(session.shopId, async (client) => {
              const r = await client.query<{ taxonomy_id: string; name: string }>(
                `SELECT m.taxonomy_id, pt.name
                 FROM pim_taxonomy_collection_map m
                 JOIN prod_taxonomy pt ON pt.id = m.taxonomy_id
                 WHERE m.shop_id = $1 AND m.collection_id = $2`,
                [session.shopId, collectionId]
              );
              return r.rows;
            });

            if (mode === 'replace' && existingMappings.length > 0) {
              emit({
                type: 'collection_progress',
                collectionId,
                step: 'delete_old',
                message: `${progress} Șterg taxonomia veche: „${existingMappings[0]?.name}"...`,
              });
              for (const row of existingMappings) {
                const metadata = await buildTaxonomyUnassignPendingMetadata({
                  shopId: session.shopId,
                  collectionId,
                  taxonomyId: row.taxonomy_id,
                  taxonomyName: row.name,
                });
                await withTenantContext(session.shopId, async (client) => {
                  await upsertTaxonomyUnassignPendingChange(client, {
                    shopId: session.shopId,
                    collectionId,
                    metadata,
                    source,
                  });
                });
              }
              await withTenantContext(session.shopId, async (client) => {
                await client.query(
                  `DELETE FROM pim_taxonomy_collection_map WHERE shop_id = $1 AND collection_id = $2`,
                  [session.shopId, collectionId]
                );
                await client.query(
                  `UPDATE shopify_collections SET metafields = '{}'::jsonb, updated_at = now() WHERE id = $1 AND shop_id = $2`,
                  [collectionId, session.shopId]
                );
              });
              emit({
                type: 'collection_progress',
                collectionId,
                step: 'delete_old',
                status: 'done',
                message: `${progress} Taxonomia veche ștearsă.`,
              });
            }

            const classificationCreds = await resolveChatTaskCredentials({
              shopId: session.shopId,
              taskType: 'classification',
              env: options.env,
              logger: options.logger,
            });
            if (!classificationCreds) {
              emit({
                type: 'collection_result',
                collectionId,
                collectionTitle: collectionRow.title,
                status: 'error',
                message: 'Nu s-au putut rezolva credențialele AI.',
              });
              continue;
            }
            const resolvedBaseUrl = classificationCreds.baseUrl;

            const productSamples = await sampleProductNames({
              shopId: session.shopId,
              collectionId,
              limit: 5,
            });

            const translationCreds = await resolveChatTaskCredentials({
              shopId: session.shopId,
              taskType: 'translation',
              env: options.env,
              logger: options.logger,
            });

            let effectiveTitleEn = collectionRow.titleEn;
            if (!effectiveTitleEn) {
              const txCreds = translationCreds ?? classificationCreds;
              const txBaseUrl = txCreds.baseUrl;
              emit({
                type: 'collection_progress',
                collectionId,
                step: 'translate',
                message: `${progress} Traduc „${collectionRow.title}"...`,
              });
              const translatedTitle = await translateTitleToEnglish({
                shopId: session.shopId,
                title: collectionRow.title,
                description: collectionRow.description,
                menuPath: collectionRow.menuPath,
                menuLevel: collectionRow.menuLevel,
                parentTitle: collectionRow.parentTitle,
                env: options.env,
                productSamples,
                ...(txCreds.apiKey ? { apiKey: txCreds.apiKey } : {}),
                ...(txBaseUrl != null ? { baseUrl: txBaseUrl } : {}),
                model: txCreds.model,
                timeoutMs: 30_000,
                logger: options.logger,
                onConsensusProgress: (event) =>
                  emit({
                    type: 'collection_progress',
                    collectionId,
                    step: event.step,
                    message: `${progress} ${event.message}`,
                    ...(event.status ? { status: event.status } : {}),
                  }),
              });
              effectiveTitleEn = translatedTitle?.categoryEn ?? null;
              if (effectiveTitleEn) {
                await withTenantContext(session.shopId, async (client) => {
                  await client.query(
                    `UPDATE shopify_collections SET title_en = $1, updated_at = now() WHERE id = $2 AND shop_id = $3 AND (title_en IS NULL OR title_en = '')`,
                    [effectiveTitleEn, collectionId, session.shopId]
                  );
                });
                emit({
                  type: 'collection_progress',
                  collectionId,
                  step: 'translate',
                  status: 'done',
                  message: `${progress} Traducere: „${effectiveTitleEn}"`,
                });
              } else {
                emit({
                  type: 'collection_progress',
                  collectionId,
                  step: 'translate',
                  status: 'done',
                  message: `${progress} Traducerea nu a reușit, folosesc titlul original.`,
                });
              }
            }

            emit({
              type: 'collection_progress',
              collectionId,
              step: 'embed',
              message: `${progress} Generez embedding...`,
            });
            const embeddingText = buildCollectionEmbeddingText({
              title: collectionRow.title,
              titleEn: effectiveTitleEn,
              description: collectionRow.description,
              descriptionEn: collectionRow.descriptionEn,
              menuPath: collectionRow.menuPath,
              parentTitle: collectionRow.parentTitle,
            });
            const dualResult = await generateDualEmbeddings({
              shopId: session.shopId,
              env: options.env,
              logger: options.logger,
              text: embeddingText.trim(),
              primary: providers.primary,
              secondary: providers.secondary,
            });
            const embedding = dualResult.primaryEmbedding;
            emit({
              type: 'collection_progress',
              collectionId,
              step: 'embed',
              status: 'done',
              message: `${progress} Embedding generat.`,
            });

            emit({
              type: 'collection_progress',
              collectionId,
              step: 'search',
              message: `${progress} Caut taxonomii compatibile...`,
            });
            const bkSearchTitle = effectiveTitleEn ?? collectionRow.title;
            const bkAllTokens = bkSearchTitle
              .split(/[\s,\-—–]+/)
              .map((t) => t.trim().toLowerCase())
              .filter((t) => t.length >= 3);
            const bkTokens = filterKeywordTokens(bkAllTokens);
            const [bkVecRes, bkSecondaryRes, bkKwRes, bkExactRes] = await Promise.all([
              withTenantContext(session.shopId, async (client) => {
                const vec = toPgVectorLiteral(embedding);
                return (
                  await client.query<{ id: string; name: string; similarity: number }>(
                    `SELECT id, name, (1 - (embedding <=> $1::vector(2000)))::float AS similarity FROM prod_taxonomy WHERE is_active = true AND embedding IS NOT NULL AND (model_version IS NULL OR model_version = $3) ORDER BY embedding <=> $1::vector(2000) LIMIT $2`,
                    [vec, VECTOR_CANDIDATES, provider.model.name]
                  )
                ).rows;
              }),
              dualResult.secondaryEmbedding
                ? withTenantContext(session.shopId, async (client) => {
                    const vec = toPgVectorLiteral(dualResult.secondaryEmbedding!);
                    return (
                      await client.query<{ id: string; name: string; similarity: number }>(
                        `SELECT id, name, (1 - (embedding_secondary <=> $1::vector(2000)))::float AS similarity FROM prod_taxonomy WHERE is_active = true AND embedding_secondary IS NOT NULL AND model_version_secondary = $3 ORDER BY embedding_secondary <=> $1::vector(2000) LIMIT $2`,
                        [vec, VECTOR_CANDIDATES, dualResult.secondaryModel!]
                      )
                    ).rows;
                  })
                : Promise.resolve([] as { id: string; name: string; similarity: number }[]),
              bkTokens.length > 0
                ? withTenantContext(session.shopId, async (client) => {
                    const likeConds = bkTokens
                      .map((_, i) => `LOWER(name) LIKE $${i + 1}`)
                      .join(' OR ');
                    return (
                      await client.query<{ id: string; name: string }>(
                        `SELECT id, name FROM prod_taxonomy WHERE is_active = true AND embedding IS NOT NULL AND model_version = '${provider.model.name}' AND (${likeConds}) LIMIT 20`,
                        bkTokens.map((t) => `%${t}%`)
                      )
                    ).rows;
                  })
                : Promise.resolve([]),
              withTenantContext(session.shopId, async (client) => {
                return (
                  await client.query<{ id: string; name: string }>(
                    `SELECT id, name FROM prod_taxonomy
                     WHERE is_active = true AND embedding IS NOT NULL
                       AND (LOWER($1) LIKE '%' || LOWER(name) || '%'
                            OR LOWER(name) LIKE '%' || LOWER($1) || '%')
                     LIMIT 15`,
                    [bkSearchTitle]
                  )
                ).rows;
              }),
            ]);
            const mergedVec = mergeMultiModelCandidates(bkVecRes, bkSecondaryRes, 'prod_taxonomy');
            const bkSeen = new Set(mergedVec.map((r) => r.id));

            for (const exact of bkExactRes) {
              if (!bkSeen.has(exact.id)) {
                const exactScore = scoreExactNameMatch(exact.name, bkSearchTitle);
                mergedVec.push({ id: exact.id, name: exact.name, similarity: exactScore });
                bkSeen.add(exact.id);
              } else {
                const existing = mergedVec.find((r) => r.id === exact.id);
                if (existing) {
                  const exactScore = scoreExactNameMatch(exact.name, bkSearchTitle);
                  existing.similarity = Math.max(existing.similarity, exactScore);
                }
              }
            }

            const bkBoosts: { id: string; name: string; similarity: number }[] = [];
            for (const kw of bkKwRes) {
              if (!bkSeen.has(kw.id)) {
                const kwScore = scoreKeywordMatch(kw.name, bkTokens);
                bkBoosts.push({ id: kw.id, name: kw.name, similarity: kwScore });
                bkSeen.add(kw.id);
              }
            }
            const vectorCandidates = [...bkBoosts, ...mergedVec].sort(
              (a, b) => b.similarity - a.similarity
            );

            if (vectorCandidates.length === 0) {
              emit({
                type: 'collection_result',
                collectionId,
                collectionTitle: collectionRow.title,
                status: 'error',
                message: 'Nu s-au găsit taxonomii compatibile.',
              });
              continue;
            }
            emit({
              type: 'collection_progress',
              collectionId,
              step: 'search',
              status: 'done',
              message: `${progress} Găsit ${vectorCandidates.length} candidați.`,
            });

            emit({
              type: 'collection_progress',
              collectionId,
              step: 'classify',
              message: `${progress} Clasific cu AI...`,
            });
            const classification = await classifyWithLLM({
              shopId: session.shopId,
              env: options.env,
              collectionTitle: collectionRow.title,
              collectionTitleEn: effectiveTitleEn,
              collectionDescription: collectionRow.description,
              collectionMenuPath: collectionRow.menuPath,
              collectionMenuLevel: collectionRow.menuLevel,
              collectionParentTitle: collectionRow.parentTitle,
              productSamples,
              candidates: vectorCandidates,
              ...(classificationCreds.apiKey ? { apiKey: classificationCreds.apiKey } : {}),
              ...(resolvedBaseUrl != null ? { baseUrl: resolvedBaseUrl } : {}),
              model: classificationCreds.model,
              timeoutMs: options.env.openAiTimeoutMs,
              logger: options.logger,
              onConsensusProgress: (event) =>
                emit({
                  type: 'collection_progress',
                  collectionId,
                  step: event.step,
                  message: `${progress} ${event.message}`,
                  ...(event.status ? { status: event.status } : {}),
                }),
            });

            if (!classification || classification.confidence < CONFIDENCE_THRESHOLD) {
              const pct = Math.round((classification?.confidence ?? 0) * 100);
              emit({
                type: 'collection_progress',
                collectionId,
                step: 'classify',
                status: 'done',
                message: `${progress} Clasificare: „${classification?.taxonomyName ?? 'N/A'}" — ${pct}%`,
              });
              emit({
                type: 'collection_result',
                collectionId,
                collectionTitle: collectionRow.title,
                status: 'low_confidence',
                taxonomyName: classification?.taxonomyName ?? vectorCandidates[0]?.name ?? null,
                confidence: classification?.confidence ?? null,
                consensusMethod: classification?.consensusMethod ?? null,
                consensusScore: classification?.consensusScore ?? null,
                message: `Confidență scăzută (${pct}%): „${classification?.taxonomyName ?? 'N/A'}"`,
              });
              continue;
            }

            const pct = Math.round(classification.confidence * 100);
            emit({
              type: 'collection_progress',
              collectionId,
              step: 'classify',
              status: 'done',
              message: `${progress} „${classification.taxonomyName}" — ${pct}%`,
            });

            emit({
              type: 'collection_progress',
              collectionId,
              step: 'persist',
              message: `${progress} Atribui taxonomia...`,
            });
            if (mode !== 'replace') {
              await withTenantContext(session.shopId, async (client) => {
                await client.query(
                  `UPDATE pim_taxonomy_collection_map SET is_primary = false WHERE shop_id = $1 AND collection_id = $2`,
                  [session.shopId, collectionId]
                );
              });
            }
            await withTenantContext(session.shopId, async (client) => {
              await client.query(
                `INSERT INTO pim_taxonomy_collection_map (shop_id, taxonomy_id, collection_id, is_primary, created_at) VALUES ($1, $2, $3, true, now()) ON CONFLICT (shop_id, taxonomy_id, collection_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
                [session.shopId, classification.taxonomyId, collectionId]
              );
            });
            const assignMetadata = await buildTaxonomyAssignPendingMetadata({
              shopId: session.shopId,
              collectionId,
              taxonomyId: classification.taxonomyId,
              previousTaxonomyId: existingMappings[0]?.taxonomy_id ?? null,
              previousTaxonomyName: existingMappings[0]?.name ?? null,
            });
            await withTenantContext(session.shopId, async (client) => {
              await upsertTaxonomyAssignPendingChange(client, {
                shopId: session.shopId,
                collectionId,
                metadata: assignMetadata,
                source,
              });
            });
            emit({
              type: 'collection_progress',
              collectionId,
              step: 'persist',
              status: 'done',
              message: `${progress} Taxonomie atribuită și adăugată în coada HITL.`,
            });

            emit({
              type: 'collection_result',
              collectionId,
              collectionTitle: collectionRow.title,
              status: 'assigned',
              taxonomyId: classification.taxonomyId,
              taxonomyName: classification.taxonomyName,
              confidence: classification.confidence,
              consensusMethod: classification.consensusMethod ?? null,
              consensusScore: classification.consensusScore ?? null,
              message: `„${classification.taxonomyName}" — ${pct}% confidență`,
            });
          } catch (err) {
            options.logger.error(
              { err, collectionId },
              'bulk taxonomy assignment failed for collection'
            );
            emit({
              type: 'collection_result',
              collectionId,
              collectionTitle: collectionId,
              status: 'error',
              message: 'Eroare internă.',
            });
          }
        }

        emit({ type: 'bulk_done' });
      } catch (err) {
        options.logger.error({ err }, 'bulk taxonomy assignment failed');
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Eroare internă.' });
      } finally {
        raw.end();
      }
    }
  );

  server.post(
    '/collections/:collectionId/translate',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const { collectionId } = request.params as { collectionId: string };
      const bodyTx = (request.body ?? {}) as { force?: boolean; field?: string };
      const forceRetranslate = bodyTx.force === true;
      const translateField =
        bodyTx.field === 'title_en' || bodyTx.field === 'description_en' ? bodyTx.field : null;

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      const emit = (event: Record<string, unknown>) => {
        try {
          raw.write(JSON.stringify(event) + '\n');
        } catch {
          /* closed */
        }
      };

      try {
        const collectionRow = await getCollectionAiContext({
          shopId: session.shopId,
          collectionId,
        });

        if (!collectionRow) {
          emit({ type: 'error', message: 'Colecția nu a fost găsită.' });
          raw.end();
          return;
        }

        if (collectionRow.titleEn && !forceRetranslate && translateField !== 'description_en') {
          emit({
            type: 'progress',
            step: 'skip',
            status: 'done',
            message: `Deja tradusă: „${collectionRow.titleEn}"`,
          });
          emit({ type: 'result', status: 'already_translated', titleEn: collectionRow.titleEn });
          raw.end();
          return;
        }

        if (collectionRow.titleEn && forceRetranslate && translateField !== 'description_en') {
          emit({
            type: 'progress',
            step: 'clear',
            status: 'done',
            message: `Șterg traducerea veche: „${collectionRow.titleEn}"`,
          });
        }

        const txCreds = await resolveChatTaskCredentials({
          shopId: session.shopId,
          taskType: 'translation',
          env: options.env,
          logger: options.logger,
        });
        if (!txCreds) {
          emit({ type: 'error', message: 'Credențialele AI nu sunt configurate.' });
          raw.end();
          return;
        }

        let titleEnResult: string | null = null;
        let descriptionEnResult: string | null = null;
        let consensusMethod: string | null = null;
        let consensusScore: number | null = null;

        if (translateField === 'description_en' && collectionRow.titleEn) {
          titleEnResult = collectionRow.titleEn;
        } else {
          emit({ type: 'progress', step: 'sample', message: 'Eșantionez produse din colecție...' });
          const samples = await sampleProductNames({
            shopId: session.shopId,
            collectionId,
            limit: 5,
          });
          emit({
            type: 'progress',
            step: 'sample',
            status: 'done',
            message: `${samples.length} produse eșantionate.`,
          });

          emit({
            type: 'progress',
            step: 'translate',
            message: `Traduc „${collectionRow.title}" cu AI...`,
          });
          const translated = await translateTitleToEnglish({
            shopId: session.shopId,
            title: collectionRow.title,
            description: collectionRow.description,
            menuPath: collectionRow.menuPath,
            menuLevel: collectionRow.menuLevel,
            parentTitle: collectionRow.parentTitle,
            env: options.env,
            productSamples: samples,
            ...(txCreds.apiKey ? { apiKey: txCreds.apiKey } : {}),
            baseUrl: txCreds.baseUrl,
            model: txCreds.model,
            timeoutMs: 30_000,
            logger: options.logger,
            onConsensusProgress: (event) =>
              emit({
                type: 'progress',
                step: event.step,
                message: event.message,
                ...(event.status ? { status: event.status } : {}),
              }),
          });
          if (!translated) {
            emit({
              type: 'progress',
              step: 'translate',
              status: 'error',
              message: 'Traducerea nu a reușit.',
            });
            emit({ type: 'result', status: 'error', message: 'Traducerea nu a reușit.' });
            raw.end();
            return;
          }
          consensusMethod = translated.consensusMethod ?? null;
          consensusScore = translated.consensusScore ?? null;

          if (translateField !== 'description_en') {
            titleEnResult = translated.categoryEn;
            await withTenantContext(session.shopId, async (client) => {
              await client.query(
                `UPDATE shopify_collections SET title_en = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
                [titleEnResult, collectionId, session.shopId]
              );
            });
            emit({
              type: 'progress',
              step: 'translate',
              status: 'done',
              message: `Traducere titlu: „${titleEnResult}"`,
            });
          } else {
            titleEnResult = translated.categoryEn;
          }
        }

        if (
          translateField !== 'title_en' &&
          collectionRow.description &&
          collectionRow.description.trim().length > 0
        ) {
          emit({
            type: 'progress',
            step: 'translate_description',
            message: 'Traduc descrierea colecției...',
          });
          const contextTitleEn = titleEnResult ?? collectionRow.titleEn ?? collectionRow.title;
          const descResult = await translateDescriptionToEnglish({
            shopId: session.shopId,
            title: collectionRow.title,
            titleEn: contextTitleEn,
            description: collectionRow.description,
            env: options.env,
            logger: options.logger,
            onConsensusProgress: (event) =>
              emit({
                type: 'progress',
                step: event.step,
                message: event.message,
                ...(event.status ? { status: event.status } : {}),
              }),
          });
          if (descResult) {
            descriptionEnResult = descResult.descriptionEn;
            await withTenantContext(session.shopId, async (client) => {
              await client.query(
                `UPDATE shopify_collections SET description_en = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
                [descriptionEnResult, collectionId, session.shopId]
              );
            });
            emit({
              type: 'progress',
              step: 'translate_description',
              status: 'done',
              message: `Descriere tradusă: „${descResult.descriptionEn.slice(0, 80)}${descResult.descriptionEn.length > 80 ? '...' : ''}"`,
            });
          } else {
            emit({
              type: 'progress',
              step: 'translate_description',
              status: 'error',
              message: 'Traducerea descrierii nu a reușit.',
            });
          }
        }

        emit({
          type: 'result',
          status: 'translated',
          field: translateField,
          titleEn: titleEnResult,
          descriptionEn: descriptionEnResult,
          consensusMethod,
          consensusScore,
        });
      } catch (err) {
        options.logger.error({ err, collectionId }, 'Single collection translate failed');
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Eroare internă.' });
      } finally {
        raw.end();
      }
    }
  );

  server.post(
    '/collections/:collectionId/generate-ro',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      const { collectionId } = request.params as { collectionId: string };
      const bodyGen = (request.body ?? {}) as {
        field?: 'title' | 'description';
        source?: CollectionPendingChangeSource;
      };
      const field = bodyGen.field ?? 'title';
      const source = parsePendingSource(bodyGen.source, 'ai_generate');

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      const emit = (event: Record<string, unknown>) => {
        try {
          raw.write(JSON.stringify(event) + '\n');
        } catch {
          /* closed */
        }
      };

      try {
        const ctx = await getCollectionAiContext({ shopId: session.shopId, collectionId });
        if (!ctx) {
          emit({ type: 'error', message: 'Colecția nu a fost găsită.' });
          raw.end();
          return;
        }

        emit({ type: 'progress', step: 'context', message: 'Încarc contextul colecției...' });

        const samples = await sampleProductNames({
          shopId: session.shopId,
          collectionId,
          limit: 10,
        });

        emit({
          type: 'progress',
          step: 'context',
          status: 'done',
          message: `${samples.length} produse eșantionate.`,
        });

        const contextLines = [
          `Handle: ${ctx.title.toLowerCase().replace(/\s+/g, '-')}`,
          ctx.menuPath ? `Poziție în meniu: ${ctx.menuPath}` : null,
          ctx.parentTitle ? `Categorie părinte: ${ctx.parentTitle}` : null,
          ctx.titleEn ? `Titlu EN existent: ${ctx.titleEn}` : null,
          ctx.description ? `Descriere actuală: ${ctx.description}` : null,
          samples.length > 0
            ? `Produse din colecție:\n${samples.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n');

        if (field === 'title') {
          emit({ type: 'progress', step: 'generate', message: 'Generez titlu optimizat cu AI...' });

          const consensus = await consensusChatCompletion<{ title: string }>({
            shopId: session.shopId,
            env: options.env,
            logger: options.logger,
            taskType: 'translation',
            systemPrompt: `Ești specialist SEO și merchandising pentru un magazin online românesc de bricolaj, materiale de construcții, grădinărit și agricultură (neanelu.ro).

SARCINĂ: Generează un titlu optimizat ÎN ROMÂNĂ pentru o colecție/categorie de produse.

REGULI:
1. Titlul trebuie să fie concis (2-5 cuvinte), clar și descriptiv.
2. Folosește terminologia corectă din domeniul bricolaj/construcții/grădinărit/agricultură în limba română.
3. Titlul trebuie să reflecte fidel conținutul colecției pe baza produselor și poziției în meniu.
4. Nu inventa categorii — bazează-te strict pe contextul furnizat.
5. Dacă titlul curent este deja bun, îmbunătățește-l minimal.

Returnează JSON: { "title": "..." }`,
            userPrompt: `Titlu curent: "${ctx.title}"\n\nContext:\n${contextLines}`,
            responseFormat: { type: 'json_object' },
            maxTokens: 100,
            keyField: 'title',
            onProgress: (event) =>
              emit({
                type: 'progress',
                step: event.step,
                message: event.message,
                ...(event.status ? { status: event.status } : {}),
              }),
          });

          const newTitle = consensus.result.title?.trim();
          if (newTitle) {
            await withTenantContext(session.shopId, async (client) => {
              await client.query(
                `UPDATE shopify_collections SET title = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
                [newTitle, collectionId, session.shopId]
              );
              await upsertFieldUpdatePendingChange(client, {
                shopId: session.shopId,
                collectionId,
                fieldName: 'title',
                oldValue: ctx.title,
                newValue: newTitle,
                source,
              });
            });
            emit({
              type: 'progress',
              step: 'generate',
              status: 'done',
              message: `Titlu generat: „${newTitle}"`,
            });
            emit({
              type: 'result',
              status: 'generated',
              field: 'title',
              value: newTitle,
              consensusMethod: consensus.method,
              consensusScore: consensus.consensusScore,
            });
          } else {
            emit({ type: 'error', message: 'Generarea titlului nu a produs rezultat.' });
          }
        } else {
          emit({
            type: 'progress',
            step: 'generate',
            message: 'Generez descriere optimizată cu AI...',
          });

          const consensus = await consensusChatCompletion<{ description: string }>({
            shopId: session.shopId,
            env: options.env,
            logger: options.logger,
            taskType: 'translation',
            systemPrompt: `Ești specialist SEO și copywriter pentru un magazin online românesc de bricolaj, materiale de construcții, grădinărit și agricultură (neanelu.ro).

SARCINĂ: Generează o descriere optimizată ÎN ROMÂNĂ pentru o colecție/categorie de produse.

REGULI:
1. Descrierea trebuie să aibă 2-4 propoziții, concisă și informativă.
2. Menționează tipurile de produse din colecție și utilizarea lor principală.
3. Folosește terminologia corectă din domeniu în limba română.
4. Tonul trebuie să fie profesional, orientat spre client.
5. Include cuvinte cheie relevante pentru SEO.
6. Nu inventa detalii — bazează-te strict pe contextul furnizat.

Returnează JSON: { "description": "..." }`,
            userPrompt: `Colecție: "${ctx.title}"\n\nContext:\n${contextLines}`,
            responseFormat: { type: 'json_object' },
            maxTokens: 300,
            keyField: 'description',
            onProgress: (event) =>
              emit({
                type: 'progress',
                step: event.step,
                message: event.message,
                ...(event.status ? { status: event.status } : {}),
              }),
          });

          const newDesc = consensus.result.description?.trim();
          if (newDesc) {
            await withTenantContext(session.shopId, async (client) => {
              await client.query(
                `UPDATE shopify_collections SET description = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
                [newDesc, collectionId, session.shopId]
              );
              await upsertFieldUpdatePendingChange(client, {
                shopId: session.shopId,
                collectionId,
                fieldName: 'description',
                oldValue: ctx.description,
                newValue: newDesc,
                source,
              });
            });
            emit({
              type: 'progress',
              step: 'generate',
              status: 'done',
              message: `Descriere generată: „${newDesc.slice(0, 80)}${newDesc.length > 80 ? '...' : ''}"`,
            });
            emit({
              type: 'result',
              status: 'generated',
              field: 'description',
              value: newDesc,
              consensusMethod: consensus.method,
              consensusScore: consensus.consensusScore,
            });
          } else {
            emit({ type: 'error', message: 'Generarea descrierii nu a produs rezultat.' });
          }
        }
      } catch (err) {
        options.logger.error({ err, collectionId }, 'Generate RO failed');
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Eroare internă.' });
      } finally {
        raw.end();
      }
    }
  );

  server.post(
    '/collections/:collectionId/assign-taxonomy-ai',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const { collectionId } = request.params as { collectionId: string };
      const bodyAssign = (request.body ?? {}) as { source?: unknown };
      const source = parsePendingSource(bodyAssign.source, 'ai_taxonomy');
      if (!collectionId?.trim()) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collectionId'));
      }

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });

      const emit = (event: Record<string, unknown>) => {
        try {
          raw.write(JSON.stringify(event) + '\n');
        } catch {
          /* connection already closed */
        }
      };

      try {
        const collectionRow = await getCollectionAiContext({
          shopId: session.shopId,
          collectionId,
        });

        if (!collectionRow?.title) {
          emit({ type: 'error', message: 'Colecția nu a fost găsită.' });
          raw.end();
          return;
        }

        const existingMappings = await withTenantContext(session.shopId, async (client) => {
          const r = await client.query<{ taxonomy_id: string; name: string }>(
            `SELECT m.taxonomy_id, pt.name
             FROM pim_taxonomy_collection_map m
             JOIN prod_taxonomy pt ON pt.id = m.taxonomy_id
             WHERE m.shop_id = $1 AND m.collection_id = $2`,
            [session.shopId, collectionId]
          );
          return r.rows;
        });

        if (existingMappings.length > 0) {
          emit({
            type: 'progress',
            step: 'delete_old',
            message: `Șterg taxonomia veche: „${existingMappings[0]?.name}"...`,
          });
          for (const row of existingMappings) {
            const metadata = await buildTaxonomyUnassignPendingMetadata({
              shopId: session.shopId,
              collectionId,
              taxonomyId: row.taxonomy_id,
              taxonomyName: row.name,
            });
            await withTenantContext(session.shopId, async (client) => {
              await upsertTaxonomyUnassignPendingChange(client, {
                shopId: session.shopId,
                collectionId,
                metadata,
                source,
              });
            });
          }
          await withTenantContext(session.shopId, async (client) => {
            await client.query(
              `DELETE FROM pim_taxonomy_collection_map WHERE shop_id = $1 AND collection_id = $2`,
              [session.shopId, collectionId]
            );
            await client.query(
              `UPDATE shopify_collections SET metafields = '{}'::jsonb, updated_at = now()
               WHERE id = $1 AND shop_id = $2`,
              [collectionId, session.shopId]
            );
          });
          emit({
            type: 'progress',
            step: 'delete_old',
            status: 'done',
            message: 'Taxonomia veche a fost ștearsă.',
          });
        }

        const classificationCreds = await resolveChatTaskCredentials({
          shopId: session.shopId,
          taskType: 'classification',
          env: options.env,
          logger: options.logger,
        });
        if (!classificationCreds) {
          emit({
            type: 'error',
            message: 'Nu s-au putut rezolva credențialele AI. Configurați un provider AI.',
          });
          raw.end();
          return;
        }
        const resolvedBaseUrl = classificationCreds.baseUrl;

        const singleProductSamples = await sampleProductNames({
          shopId: session.shopId,
          collectionId,
          limit: 5,
        });

        const translationCreds = await resolveChatTaskCredentials({
          shopId: session.shopId,
          taskType: 'translation',
          env: options.env,
          logger: options.logger,
        });

        let effectiveTitleEn = collectionRow.titleEn;
        if (!effectiveTitleEn) {
          const txCreds = translationCreds ?? classificationCreds;
          const txBaseUrl = txCreds.baseUrl;
          emit({
            type: 'progress',
            step: 'translate',
            message: `Traduc „${collectionRow.title}" în engleză...`,
          });
          const translatedTitle = await translateTitleToEnglish({
            shopId: session.shopId,
            title: collectionRow.title,
            description: collectionRow.description,
            menuPath: collectionRow.menuPath,
            menuLevel: collectionRow.menuLevel,
            parentTitle: collectionRow.parentTitle,
            env: options.env,
            productSamples: singleProductSamples,
            ...(txCreds.apiKey ? { apiKey: txCreds.apiKey } : {}),
            ...(txBaseUrl != null ? { baseUrl: txBaseUrl } : {}),
            model: txCreds.model,
            timeoutMs: 30_000,
            logger: options.logger,
            onConsensusProgress: (event) =>
              emit({
                type: 'progress',
                step: event.step,
                message: event.message,
                ...(event.status ? { status: event.status } : {}),
              }),
          });
          effectiveTitleEn = translatedTitle?.categoryEn ?? null;
          if (effectiveTitleEn) {
            await withTenantContext(session.shopId, async (client) => {
              await client.query(
                `UPDATE shopify_collections SET title_en = $1, updated_at = now()
                 WHERE id = $2 AND shop_id = $3 AND (title_en IS NULL OR title_en = '')`,
                [effectiveTitleEn, collectionId, session.shopId]
              );
            });
            emit({
              type: 'progress',
              step: 'translate',
              status: 'done',
              message: `Traducere: „${effectiveTitleEn}"`,
            });
          } else {
            emit({
              type: 'progress',
              step: 'translate',
              status: 'done',
              message: 'Traducerea nu a reușit, folosesc titlul original.',
            });
          }
        }

        emit({ type: 'progress', step: 'embed', message: 'Generez embedding pentru căutare...' });
        const singleProviders = await resolveDualEmbeddingsProviders({
          shopId: session.shopId,
          env: options.env,
          logger: options.logger,
        });
        const provider = singleProviders.primary;
        const embeddingText = buildCollectionEmbeddingText({
          title: collectionRow.title,
          titleEn: effectiveTitleEn,
          description: collectionRow.description,
          descriptionEn: collectionRow.descriptionEn,
          menuPath: collectionRow.menuPath,
          parentTitle: collectionRow.parentTitle,
        });
        const singleDual = await generateDualEmbeddings({
          shopId: session.shopId,
          env: options.env,
          logger: options.logger,
          text: embeddingText.trim(),
          primary: singleProviders.primary,
          secondary: singleProviders.secondary,
        });
        const embedding = singleDual.primaryEmbedding;
        emit({ type: 'progress', step: 'embed', status: 'done', message: 'Embedding generat.' });

        emit({
          type: 'progress',
          step: 'search',
          message: 'Caut taxonomiile cele mai compatibile...',
        });
        const VECTOR_CANDIDATES = 40;
        const searchTitle = effectiveTitleEn ?? collectionRow.title;
        const allKeywordTokens = searchTitle
          .split(/[\s,\-—–]+/)
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length >= 3);
        const keywordTokens = filterKeywordTokens(allKeywordTokens);

        const [vectorResults, secondaryVectorResults, keywordResults, exactNameResults] =
          await Promise.all([
            withTenantContext(session.shopId, async (client) => {
              const vec = toPgVectorLiteral(embedding);
              const res = await client.query<{ id: string; name: string; similarity: number }>(
                `SELECT id, name,
                      (1 - (embedding <=> $1::vector(2000)))::float AS similarity
               FROM prod_taxonomy
               WHERE is_active = true
                 AND embedding IS NOT NULL
                 AND (model_version IS NULL OR model_version = $3)
               ORDER BY embedding <=> $1::vector(2000)
               LIMIT $2`,
                [vec, VECTOR_CANDIDATES, provider.model.name]
              );
              return res.rows;
            }),
            singleDual.secondaryEmbedding
              ? withTenantContext(session.shopId, async (client) => {
                  const vec = toPgVectorLiteral(singleDual.secondaryEmbedding!);
                  const res = await client.query<{ id: string; name: string; similarity: number }>(
                    `SELECT id, name,
                          (1 - (embedding_secondary <=> $1::vector(2000)))::float AS similarity
                   FROM prod_taxonomy
                   WHERE is_active = true
                     AND embedding_secondary IS NOT NULL
                     AND model_version_secondary = $3
                   ORDER BY embedding_secondary <=> $1::vector(2000)
                   LIMIT $2`,
                    [vec, VECTOR_CANDIDATES, singleDual.secondaryModel!]
                  );
                  return res.rows;
                })
              : Promise.resolve([] as { id: string; name: string; similarity: number }[]),
            keywordTokens.length > 0
              ? withTenantContext(session.shopId, async (client) => {
                  const likeConditions = keywordTokens
                    .map((_, i) => `LOWER(name) LIKE $${i + 1}`)
                    .join(' OR ');
                  const likeParams = keywordTokens.map((t) => `%${t}%`);
                  const res = await client.query<{ id: string; name: string }>(
                    `SELECT id, name FROM prod_taxonomy
                   WHERE is_active = true AND embedding IS NOT NULL
                     AND model_version = '${provider.model.name}'
                     AND (${likeConditions})
                   LIMIT 20`,
                    likeParams
                  );
                  return res.rows;
                })
              : Promise.resolve([]),
            withTenantContext(session.shopId, async (client) => {
              const res = await client.query<{ id: string; name: string }>(
                `SELECT id, name FROM prod_taxonomy
               WHERE is_active = true AND embedding IS NOT NULL
                 AND (LOWER($1) LIKE '%' || LOWER(name) || '%'
                      OR LOWER(name) LIKE '%' || LOWER($1) || '%')
               LIMIT 15`,
                [searchTitle]
              );
              return res.rows;
            }),
          ]);

        const mergedResults = mergeMultiModelCandidates(
          vectorResults,
          secondaryVectorResults,
          'prod_taxonomy'
        );
        const seenIds = new Set(mergedResults.map((r) => r.id));

        for (const exact of exactNameResults) {
          if (!seenIds.has(exact.id)) {
            const exactScore = scoreExactNameMatch(exact.name, searchTitle);
            mergedResults.push({ id: exact.id, name: exact.name, similarity: exactScore });
            seenIds.add(exact.id);
          } else {
            const existing = mergedResults.find((r) => r.id === exact.id);
            if (existing) {
              const exactScore = scoreExactNameMatch(exact.name, searchTitle);
              existing.similarity = Math.max(existing.similarity, exactScore);
            }
          }
        }

        const keywordBoosts: { id: string; name: string; similarity: number }[] = [];
        for (const kw of keywordResults) {
          if (!seenIds.has(kw.id)) {
            const kwScore = scoreKeywordMatch(kw.name, keywordTokens);
            keywordBoosts.push({ id: kw.id, name: kw.name, similarity: kwScore });
            seenIds.add(kw.id);
          }
        }

        const vectorCandidates = [...keywordBoosts, ...mergedResults].sort(
          (a, b) => b.similarity - a.similarity
        );

        if (vectorCandidates.length === 0) {
          emit({ type: 'error', message: 'Nu s-au găsit taxonomii cu embedding-uri compatibile.' });
          raw.end();
          return;
        }
        const topCandidates = vectorCandidates.slice(0, 5).map((c) => ({
          name: c.name,
          similarity: Math.round(c.similarity * 1000) / 1000,
        }));
        const keywordHitCount = keywordBoosts.length;
        emit({
          type: 'progress',
          step: 'search',
          status: 'done',
          message: `Am găsit ${vectorCandidates.length} candidați (${keywordHitCount} keyword boost). Top: ${topCandidates[0]?.name} (${topCandidates[0]?.similarity})`,
        });

        emit({ type: 'progress', step: 'classify', message: 'Clasific cu AI...' });
        const classification = await classifyWithLLM({
          shopId: session.shopId,
          env: options.env,
          collectionTitle: collectionRow.title,
          collectionTitleEn: effectiveTitleEn,
          collectionDescription: collectionRow.description,
          collectionMenuPath: collectionRow.menuPath,
          collectionMenuLevel: collectionRow.menuLevel,
          collectionParentTitle: collectionRow.parentTitle,
          productSamples: singleProductSamples,
          candidates: vectorCandidates,
          ...(classificationCreds.apiKey ? { apiKey: classificationCreds.apiKey } : {}),
          ...(resolvedBaseUrl != null ? { baseUrl: resolvedBaseUrl } : {}),
          model: classificationCreds.model,
          timeoutMs: options.env.openAiTimeoutMs,
          logger: options.logger,
          onConsensusProgress: (event) =>
            emit({
              type: 'progress',
              step: event.step,
              message: event.message,
              ...(event.status ? { status: event.status } : {}),
            }),
        });

        options.logger.info(
          {
            collectionId,
            collectionTitle: collectionRow.title,
            titleEn: effectiveTitleEn,
            classification: classification
              ? {
                  taxonomyName: classification.taxonomyName,
                  confidence: classification.confidence,
                  reasoning: classification.reasoning,
                  translatedQuery: classification.translatedQuery,
                }
              : null,
            vectorTop5: topCandidates,
          },
          'streaming taxonomy_assign: LLM classification result'
        );

        const CONFIDENCE_THRESHOLD = 0.65;
        if (!classification || classification.confidence < CONFIDENCE_THRESHOLD) {
          const pct = Math.round((classification?.confidence ?? 0) * 100);
          emit({
            type: 'progress',
            step: 'classify',
            status: 'done',
            message: `Clasificare: „${classification?.taxonomyName ?? 'N/A'}" — ${pct}% confidență`,
          });
          emit({
            type: 'result',
            status: 'low_confidence',
            taxonomyName: classification?.taxonomyName ?? vectorCandidates[0]?.name ?? null,
            confidence: classification?.confidence ?? null,
            consensusMethod: classification?.consensusMethod ?? null,
            consensusScore: classification?.consensusScore ?? null,
            message: `Confidență scăzută (${pct}%): „${classification?.taxonomyName ?? 'N/A'}". Atribuiți manual.`,
            reasoning: classification?.reasoning ?? null,
            candidates: topCandidates,
          });
          raw.end();
          return;
        }

        emit({
          type: 'progress',
          step: 'classify',
          status: 'done',
          message: `Clasificare: „${classification.taxonomyName}" — ${Math.round(classification.confidence * 100)}% confidență`,
        });

        emit({ type: 'progress', step: 'persist', message: 'Atribui noua taxonomie...' });
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `INSERT INTO pim_taxonomy_collection_map
               (shop_id, taxonomy_id, collection_id, is_primary, created_at)
             VALUES ($1, $2, $3, true, now())
             ON CONFLICT (shop_id, taxonomy_id, collection_id)
             DO UPDATE SET is_primary = EXCLUDED.is_primary`,
            [session.shopId, classification.taxonomyId, collectionId]
          );
        });
        const assignMetadata = await buildTaxonomyAssignPendingMetadata({
          shopId: session.shopId,
          collectionId,
          taxonomyId: classification.taxonomyId,
          previousTaxonomyId: existingMappings[0]?.taxonomy_id ?? null,
          previousTaxonomyName: existingMappings[0]?.name ?? null,
        });
        await withTenantContext(session.shopId, async (client) => {
          await upsertTaxonomyAssignPendingChange(client, {
            shopId: session.shopId,
            collectionId,
            metadata: assignMetadata,
            source,
          });
        });
        emit({
          type: 'progress',
          step: 'persist',
          status: 'done',
          message: 'Taxonomie atribuită cu succes.',
        });

        emit({
          type: 'progress',
          step: 'metafield_push',
          message: 'Adaug sincronizarea metafields în coada HITL...',
        });
        emit({
          type: 'progress',
          step: 'metafield_push',
          status: 'done',
          message: 'Sincronizare metafields adăugată în coada HITL.',
        });

        emit({
          type: 'result',
          status: 'assigned',
          taxonomyId: classification.taxonomyId,
          taxonomyName: classification.taxonomyName,
          confidence: classification.confidence,
          consensusMethod: classification.consensusMethod ?? null,
          consensusScore: classification.consensusScore ?? null,
          reasoning: classification.reasoning,
          translatedText: classification.translatedQuery,
          detectedLanguage: classification.detectedLanguage,
          candidates: topCandidates,
        });
      } catch (err) {
        options.logger.error({ err, collectionId }, 'Streaming taxonomy assignment failed');
        emit({
          type: 'error',
          message: err instanceof Error ? err.message : 'Eroare internă la atribuirea taxonomiei.',
        });
      } finally {
        raw.end();
      }
    }
  );

  server.post(
    '/collections/bulk/push-metafields',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = (request.body ?? {}) as { collectionIds?: unknown };
      const rawIds = Array.isArray(body.collectionIds) ? body.collectionIds : [];
      const collectionIds = rawIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .slice(0, 50);
      if (collectionIds.length === 0) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing or invalid collectionIds'));
      }

      let queued = 0;
      for (const collectionId of collectionIds) {
        const primaryMapping = await withTenantContext(session.shopId, async (client) => {
          const result = await client.query<{ taxonomy_id: string }>(
            `SELECT taxonomy_id
               FROM pim_taxonomy_collection_map
              WHERE shop_id = $1
                AND collection_id = $2
              ORDER BY is_primary DESC, created_at ASC
              LIMIT 1`,
            [session.shopId, collectionId]
          );
          return result.rows[0] ?? null;
        });
        if (!primaryMapping?.taxonomy_id) continue;
        const metadata = await buildTaxonomyAssignPendingMetadata({
          shopId: session.shopId,
          collectionId,
          taxonomyId: primaryMapping.taxonomy_id,
        });
        await withTenantContext(session.shopId, async (client) => {
          await upsertTaxonomyAssignPendingChange(client, {
            shopId: session.shopId,
            collectionId,
            metadata,
            source: 'manual',
          });
        });
        queued += 1;
      }

      return reply.send(successEnvelope(request.id, { queued: true, jobCount: queued }));
    }
  );

  server.post(
    '/collections/bulk/translate',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const body = (request.body ?? {}) as { collectionIds?: unknown; force?: unknown };
      const scopeIds = Array.isArray(body.collectionIds)
        ? body.collectionIds.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          )
        : null;
      const force = body.force === true;

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      const emit = (event: Record<string, unknown>) => {
        try {
          raw.write(JSON.stringify(event) + '\n');
        } catch {
          /* closed */
        }
      };

      try {
        const untranslatedFilter = force ? '' : " AND (title_en IS NULL OR title_en = '')";
        const untranslated = await withTenantContext(session.shopId, async (client) => {
          if (scopeIds && scopeIds.length > 0) {
            const r = await client.query<{
              id: string;
              title: string;
              description: string | null;
              parentTitle: string | null;
              menuLevel: number | null;
              menuPath: string | null;
            }>(
              `SELECT sc.id,
                      sc.title,
                      sc.description,
                      parent_sc.title AS "parentTitle",
                      sc.menu_level AS "menuLevel",
                      sc.menu_path AS "menuPath"
               FROM shopify_collections sc
               LEFT JOIN shopify_collections parent_sc ON parent_sc.id = sc.parent_collection_id
               WHERE sc.shop_id = $1 AND sc.id = ANY($2::uuid[])${untranslatedFilter.replaceAll('title_en', 'sc.title_en')}
               ORDER BY sc.title ASC`,
              [session.shopId, scopeIds]
            );
            return r.rows;
          }
          const r = await client.query<{
            id: string;
            title: string;
            description: string | null;
            parentTitle: string | null;
            menuLevel: number | null;
            menuPath: string | null;
          }>(
            `SELECT sc.id,
                    sc.title,
                    sc.description,
                    parent_sc.title AS "parentTitle",
                    sc.menu_level AS "menuLevel",
                    sc.menu_path AS "menuPath"
             FROM shopify_collections sc
             LEFT JOIN shopify_collections parent_sc ON parent_sc.id = sc.parent_collection_id
             WHERE sc.shop_id = $1${untranslatedFilter.replaceAll('title_en', 'sc.title_en')}
             ORDER BY sc.title ASC`,
            [session.shopId]
          );
          return r.rows;
        });

        if (untranslated.length === 0) {
          emit({
            type: 'translate_done',
            translated: 0,
            total: 0,
            message: 'Toate colecțiile sunt deja traduse.',
          });
          raw.end();
          return;
        }

        const translateCreds = await resolveChatTaskCredentials({
          shopId: session.shopId,
          taskType: 'translation',
          env: options.env,
          logger: options.logger,
        });
        if (!translateCreds) {
          emit({ type: 'error', message: 'Credențialele AI nu sunt configurate.' });
          raw.end();
          return;
        }

        emit({ type: 'translate_start', total: untranslated.length });

        let translated = 0;
        for (let idx = 0; idx < untranslated.length; idx++) {
          const col = untranslated[idx]!;
          const progress = `[${idx + 1}/${untranslated.length}]`;

          emit({
            type: 'translate_collection_start',
            collectionId: col.id,
            collectionTitle: col.title,
            index: idx,
            total: untranslated.length,
          });

          try {
            emit({
              type: 'translate_progress',
              collectionId: col.id,
              step: 'sample',
              message: `${progress} Eșantionez produse...`,
            });
            const samples = await sampleProductNames({
              shopId: session.shopId,
              collectionId: col.id,
              limit: 5,
            });
            emit({
              type: 'translate_progress',
              collectionId: col.id,
              step: 'sample',
              status: 'done',
              message: `${progress} ${samples.length} produse eșantionate.`,
            });

            emit({
              type: 'translate_progress',
              collectionId: col.id,
              step: 'translate',
              message: `${progress} Traduc „${col.title}"...`,
            });
            const translatedTitle = await translateTitleToEnglish({
              shopId: session.shopId,
              title: col.title,
              description: col.description,
              menuPath: col.menuPath,
              menuLevel: col.menuLevel,
              parentTitle: col.parentTitle,
              env: options.env,
              productSamples: samples,
              ...(translateCreds.apiKey ? { apiKey: translateCreds.apiKey } : {}),
              baseUrl: translateCreds.baseUrl,
              model: translateCreds.model,
              timeoutMs: 30_000,
              logger: options.logger,
              onConsensusProgress: (event) =>
                emit({
                  type: 'translate_progress',
                  collectionId: col.id,
                  step: event.step,
                  message: `${progress} ${event.message}`,
                  ...(event.status ? { status: event.status } : {}),
                }),
            });

            if (translatedTitle) {
              await withTenantContext(session.shopId, async (client) => {
                await client.query(
                  `UPDATE shopify_collections SET title_en = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
                  [translatedTitle.categoryEn, col.id, session.shopId]
                );
              });
              translated++;
              emit({
                type: 'translate_progress',
                collectionId: col.id,
                step: 'translate',
                status: 'done',
                message: `${progress} „${translatedTitle.categoryEn}"`,
              });

              let descriptionEn: string | null = null;
              if (col.description && col.description.trim().length > 0) {
                emit({
                  type: 'translate_progress',
                  collectionId: col.id,
                  step: 'translate_description',
                  message: `${progress} Traduc descrierea...`,
                });
                const descResult = await translateDescriptionToEnglish({
                  shopId: session.shopId,
                  title: col.title,
                  titleEn: translatedTitle.categoryEn,
                  description: col.description,
                  env: options.env,
                  logger: options.logger,
                  onConsensusProgress: (event) =>
                    emit({
                      type: 'translate_progress',
                      collectionId: col.id,
                      step: event.step,
                      message: `${progress} ${event.message}`,
                      ...(event.status ? { status: event.status } : {}),
                    }),
                });
                if (descResult) {
                  descriptionEn = descResult.descriptionEn;
                  await withTenantContext(session.shopId, async (client) => {
                    await client.query(
                      `UPDATE shopify_collections SET description_en = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
                      [descriptionEn, col.id, session.shopId]
                    );
                  });
                  emit({
                    type: 'translate_progress',
                    collectionId: col.id,
                    step: 'translate_description',
                    status: 'done',
                    message: `${progress} Descriere tradusă.`,
                  });
                } else {
                  emit({
                    type: 'translate_progress',
                    collectionId: col.id,
                    step: 'translate_description',
                    status: 'error',
                    message: `${progress} Traducerea descrierii nu a reușit.`,
                  });
                }
              }

              emit({
                type: 'translate_collection_result',
                collectionId: col.id,
                collectionTitle: col.title,
                status: 'translated',
                titleEn: translatedTitle.categoryEn,
                descriptionEn,
                consensusMethod: translatedTitle.consensusMethod,
                consensusScore: translatedTitle.consensusScore,
              });
            } else {
              emit({
                type: 'translate_progress',
                collectionId: col.id,
                step: 'translate',
                status: 'error',
                message: `${progress} Traducerea nu a reușit.`,
              });
              emit({
                type: 'translate_collection_result',
                collectionId: col.id,
                collectionTitle: col.title,
                status: 'error',
                message: 'Traducerea nu a reușit.',
              });
            }
          } catch (err) {
            options.logger.warn(
              { err, collectionId: col.id },
              'Bulk translate failed for collection'
            );
            emit({
              type: 'translate_collection_result',
              collectionId: col.id,
              collectionTitle: col.title,
              status: 'error',
              message: 'Eroare internă.',
            });
          }
        }

        emit({
          type: 'translate_done',
          translated,
          total: untranslated.length,
          message: `${translated} din ${untranslated.length} colecții traduse.`,
        });
      } catch (err) {
        options.logger.error({ err }, 'Bulk translate streaming failed');
        emit({ type: 'error', message: err instanceof Error ? err.message : 'Eroare internă.' });
      } finally {
        raw.end();
      }
    }
  );

  server.get(
    '/collections/:id/products',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }

      const rows = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          shopify_gid: string;
          title: string;
          vendor: string | null;
          product_type: string | null;
          status: string | null;
          position: number | null;
        }>(
          `SELECT sp.id,
                  sp.shopify_gid,
                  sp.title,
                  sp.vendor,
                  sp.product_type,
                  sp.status,
                  scp.position
           FROM shopify_collection_products scp
           JOIN shopify_products sp
             ON sp.id = scp.product_id
            AND sp.shop_id = scp.shop_id
           WHERE scp.shop_id = $1
             AND scp.collection_id = $2
           ORDER BY scp.position ASC, sp.title ASC
           LIMIT 1000`,
          [session.shopId, collectionId]
        );
        return result.rows;
      });

      return reply.send(successEnvelope(request.id, { products: rows }));
    }
  );

  server.get(
    '/collections/:id/taxonomy-status',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }

      const data = await withTenantContext(session.shopId, async (client) => {
        const mapsRes = await client.query<{
          taxonomy_id: string;
          taxonomy_name: string;
          is_primary: boolean;
          collection_title: string;
        }>(
          `SELECT m.taxonomy_id, pt.name AS taxonomy_name, m.is_primary, sc.title AS collection_title
           FROM pim_taxonomy_collection_map m
           JOIN prod_taxonomy pt ON pt.id = m.taxonomy_id
           JOIN shopify_collections sc ON sc.id = m.collection_id AND sc.shop_id = m.shop_id
           WHERE m.shop_id = $1 AND m.collection_id = $2
           ORDER BY m.is_primary DESC NULLS LAST`,
          [session.shopId, collectionId]
        );
        const metaRes = await client.query<{ metafields: Record<string, unknown> | null }>(
          `SELECT metafields FROM shopify_collections
           WHERE shop_id = $1 AND id = $2 LIMIT 1`,
          [session.shopId, collectionId]
        );
        const metafields = metaRes.rows[0]?.metafields ?? {};
        const metafieldKeys = Object.keys(metafields);
        const hasMetafields = metafieldKeys.length > 0;
        const mappings = mapsRes.rows;
        const hasExistingTaxonomy = mappings.length > 0;
        const primary = mappings.find((m) => m.is_primary) ?? mappings[0];
        const existingTaxonomyName = primary?.taxonomy_name ?? null;
        return {
          hasExistingTaxonomy,
          existingTaxonomyName,
          taxonomies: mappings.map((m) => ({
            id: collectionId,
            collection_id: collectionId,
            taxonomy_id: m.taxonomy_id,
            is_primary: m.is_primary,
            collection_title: m.collection_title,
            taxonomy_name: m.taxonomy_name,
          })),
          hasMetafields,
          metafieldKeys,
        };
      });

      return reply.send(successEnvelope(request.id, data));
    }
  );

  server.get(
    '/collections/:id/metafields',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }

      const row = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ metafields: Record<string, unknown> | null }>(
          `SELECT metafields
           FROM shopify_collections
           WHERE shop_id = $1
             AND id = $2
           LIMIT 1`,
          [session.shopId, collectionId]
        );
        return result.rows[0] ?? null;
      });

      return reply.send(successEnvelope(request.id, { metafields: row?.metafields ?? {} }));
    }
  );

  server.post(
    '/collections/:id/identify-products',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }

      const result = await withTenantContext(session.shopId, async (client) => {
        const collectionRes = await client.query<{ collection_type: string }>(
          `SELECT collection_type FROM shopify_collections WHERE id = $1 AND shop_id = $2 LIMIT 1`,
          [collectionId, session.shopId]
        );
        const collection = collectionRes.rows[0];
        if (!collection) {
          return { error: 'NOT_FOUND' as const };
        }
        if (collection.collection_type === 'SMART') {
          return { error: 'SMART' as const };
        }

        const taxRes = await client.query<{ taxonomy_id: string }>(
          `SELECT taxonomy_id FROM pim_taxonomy_collection_map
           WHERE collection_id = $1 AND shop_id = $2
           ORDER BY is_primary DESC NULLS LAST
           LIMIT 1`,
          [collectionId, session.shopId]
        );
        const taxonomyId = taxRes.rows[0]?.taxonomy_id;
        if (!taxonomyId) {
          return { error: 'NO_TAXONOMY' as const };
        }

        const candidatesRes = await client.query<{
          product_id: string;
          product_master_id: string;
          title: string;
          shopify_gid: string;
          confidence: string | null;
        }>(
          `SELECT sp.id AS product_id,
                  pm.id AS product_master_id,
                  sp.title,
                  sp.shopify_gid,
                  pm.taxonomy_ai_confidence::text AS confidence
           FROM prod_master pm
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = pm.id AND pcm.channel = 'shopify' AND pcm.shop_id = $1
           JOIN shopify_products sp ON sp.shopify_gid = pcm.external_id AND sp.shop_id = $1
           WHERE pm.taxonomy_id = $2
             AND NOT EXISTS (
               SELECT 1 FROM shopify_collection_products scp
               WHERE scp.product_id = sp.id AND scp.collection_id = $3
             )
           ORDER BY pm.taxonomy_ai_confidence DESC NULLS LAST
           LIMIT 100`,
          [session.shopId, taxonomyId, collectionId]
        );

        return {
          candidates: candidatesRes.rows.map((r) => ({
            productId: r.product_id,
            productMasterId: r.product_master_id,
            title: r.title,
            shopifyGid: r.shopify_gid,
            confidence: r.confidence,
          })),
          total: candidatesRes.rows.length,
        };
      });

      if (result.error === 'NOT_FOUND') {
        return reply
          .status(404)
          .send(errorEnvelope(request.id, 404, 'NOT_FOUND', 'Collection not found'));
      }
      if (result.error === 'SMART') {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              'Nu se pot identifica produse manual la colecții SMART'
            )
          );
      }
      if (result.error === 'NO_TAXONOMY') {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Colecția nu are taxonomie asignată')
          );
      }

      return reply.send(
        successEnvelope(request.id, {
          candidates: result.candidates,
          total: result.total,
        })
      );
    }
  );

  server.post(
    '/collections/sync',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const jobId = await enqueueCollectionsSyncJob({
        shopId: session.shopId,
        trigger: 'manual',
      });
      return reply.status(202).send(successEnvelope(request.id, { queued: true, jobId }));
    }
  );

  server.get(
    '/collections/sync/status',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const jobId = `pim-collections-sync-${session.shopId}`;
      const queue = createQueue(
        { config: configFromEnv(options.env) },
        { name: PIM_COLLECTIONS_SYNC_QUEUE_NAME }
      );
      try {
        const job = await queue.getJob(jobId);
        if (!job) {
          return reply.send(
            successEnvelope(request.id, { status: 'idle' as const, progress: null })
          );
        }
        const state = await job.getState();
        const progress = (job.progress ?? null) as Record<string, unknown> | number | null;
        return reply.send(
          successEnvelope(request.id, {
            status: state,
            progress,
            createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
            processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
            finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            failedReason: job.failedReason ?? null,
          })
        );
      } finally {
        await queue.close().catch(() => undefined);
      }
    }
  );

  server.post(
    '/collections/:id/assign-taxonomy',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      const body = (request.body ?? {}) as {
        taxonomyId?: unknown;
        isPrimary?: unknown;
        mode?: unknown;
        source?: unknown;
      };
      const taxonomyId =
        typeof body.taxonomyId === 'string' && body.taxonomyId.trim().length > 0
          ? body.taxonomyId.trim()
          : null;
      const isPrimary = body.isPrimary === undefined ? true : Boolean(body.isPrimary);
      const source = parsePendingSource(body.source, 'manual');
      const mode =
        body.mode === 'add_secondary'
          ? 'add_secondary'
          : ('replace' as 'replace' | 'add_secondary');
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId || !taxonomyId) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collectionId or taxonomyId')
          );
      }

      let namespaceCollisionCount: number | null = null;

      const existingMappings = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{ taxonomy_id: string }>(
          `SELECT taxonomy_id FROM pim_taxonomy_collection_map
           WHERE shop_id = $1 AND collection_id = $2`,
          [session.shopId, collectionId]
        );
        return r.rows;
      });

      if (mode === 'replace' && existingMappings.length > 0) {
        for (const row of existingMappings) {
          const metadata = await buildTaxonomyUnassignPendingMetadata({
            shopId: session.shopId,
            collectionId,
            taxonomyId: row.taxonomy_id,
          });
          await withTenantContext(session.shopId, async (client) => {
            await upsertTaxonomyUnassignPendingChange(client, {
              shopId: session.shopId,
              collectionId,
              metadata,
              source,
            });
          });
        }
      }

      if (mode === 'add_secondary' && existingMappings.length > 0) {
        const existingKeys = await withTenantContext(session.shopId, async (client) => {
          const r = await client.query<{ ns: string; k: string }>(
            `SELECT s.shopify_namespace AS ns, s.shopify_key AS k
             FROM pim_taxonomy_collection_map m
             JOIN pim_taxonomy_metafield_schema s ON s.taxonomy_id = m.taxonomy_id
             WHERE m.shop_id = $1 AND m.collection_id = $2`,
            [session.shopId, collectionId]
          );
          return new Set(r.rows.map((x) => `${x.ns}.${x.k}`));
        });
        const newKeys = await withTenantContext(session.shopId, async (client) => {
          const r = await client.query<{ ns: string; k: string }>(
            `SELECT shopify_namespace AS ns, shopify_key AS k
             FROM pim_taxonomy_metafield_schema WHERE taxonomy_id = $1`,
            [taxonomyId]
          );
          return r.rows.map((x) => `${x.ns}.${x.k}`);
        });
        namespaceCollisionCount = newKeys.filter((k) => existingKeys.has(k)).length;
      }

      await withTenantContext(session.shopId, async (client) => {
        if (mode === 'replace') {
          await client.query(
            `DELETE FROM pim_taxonomy_collection_map
             WHERE shop_id = $1 AND collection_id = $2`,
            [session.shopId, collectionId]
          );
          await client.query(
            `UPDATE shopify_collections SET metafields = '{}'::jsonb, updated_at = now()
             WHERE id = $1 AND shop_id = $2`,
            [collectionId, session.shopId]
          );
        } else {
          await client.query(
            `UPDATE pim_taxonomy_collection_map SET is_primary = false
             WHERE shop_id = $1 AND collection_id = $2`,
            [session.shopId, collectionId]
          );
        }
        await client.query(
          `INSERT INTO pim_taxonomy_collection_map
             (shop_id, taxonomy_id, collection_id, is_primary, created_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (shop_id, taxonomy_id, collection_id) DO UPDATE SET
             is_primary = EXCLUDED.is_primary`,
          [session.shopId, taxonomyId, collectionId, isPrimary]
        );
      });
      const assignMetadata = await buildTaxonomyAssignPendingMetadata({
        shopId: session.shopId,
        collectionId,
        taxonomyId,
        previousTaxonomyId: existingMappings[0]?.taxonomy_id ?? null,
      });
      await withTenantContext(session.shopId, async (client) => {
        await upsertTaxonomyAssignPendingChange(client, {
          shopId: session.shopId,
          collectionId,
          metadata: assignMetadata,
          source,
        });
      });

      return reply.send(
        successEnvelope(request.id, {
          assigned: true,
          queuedForApproval: true,
          mode,
          namespaceCollisionWarning:
            namespaceCollisionCount != null && namespaceCollisionCount > 0
              ? namespaceCollisionCount
              : undefined,
        })
      );
    }
  );

  server.patch(
    '/collections/:id/taxonomy-primary',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      const body = (request.body ?? {}) as { taxonomyId?: unknown };
      const taxonomyId =
        typeof body.taxonomyId === 'string' && body.taxonomyId.trim().length > 0
          ? body.taxonomyId.trim()
          : null;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId || !taxonomyId) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collectionId or taxonomyId')
          );
      }
      const updated = await withTenantContext(session.shopId, async (client) => {
        const exists = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM pim_taxonomy_collection_map
           WHERE shop_id = $1 AND collection_id = $2 AND taxonomy_id = $3`,
          [session.shopId, collectionId, taxonomyId]
        );
        if (parseInt(exists.rows[0]?.count ?? '0', 10) === 0) {
          return false;
        }
        await client.query(
          `UPDATE pim_taxonomy_collection_map SET is_primary = (taxonomy_id = $3)
           WHERE shop_id = $1 AND collection_id = $2`,
          [session.shopId, collectionId, taxonomyId]
        );
        return true;
      });
      if (!updated) {
        return reply
          .status(404)
          .send(
            errorEnvelope(
              request.id,
              404,
              'NOT_FOUND',
              'Taxonomia specificată nu este mapată pe această colecție'
            )
          );
      }
      return reply.send(successEnvelope(request.id, { updated: true }));
    }
  );

  server.delete(
    '/collections/:id/taxonomy/:taxonomyId',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      const taxonomyId = (request.params as { taxonomyId?: string }).taxonomyId;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId || !taxonomyId) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collectionId or taxonomyId')
          );
      }
      const taxonomyMeta = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{ ns: string; k: string; taxonomy_name: string }>(
          `SELECT s.shopify_namespace AS ns,
                  s.shopify_key AS k,
                  pt.name AS taxonomy_name
             FROM pim_taxonomy_metafield_schema s
             JOIN prod_taxonomy pt ON pt.id = s.taxonomy_id
            WHERE s.taxonomy_id = $1`,
          [taxonomyId]
        );
        return {
          keys: r.rows.map((row) => `${row.ns}.${row.k}`),
          taxonomyName: r.rows[0]?.taxonomy_name ?? null,
        };
      });
      const unassignMetadata = await buildTaxonomyUnassignPendingMetadata({
        shopId: session.shopId,
        collectionId,
        taxonomyId,
        taxonomyName: taxonomyMeta.taxonomyName,
      });
      await withTenantContext(session.shopId, async (client) => {
        await upsertTaxonomyUnassignPendingChange(client, {
          shopId: session.shopId,
          collectionId,
          metadata: unassignMetadata,
          source: 'manual',
        });
      });

      const wasPromoted = await withTenantContext(session.shopId, async (client) => {
        const deletedRow = await client.query<{ is_primary: boolean }>(
          `DELETE FROM pim_taxonomy_collection_map
           WHERE shop_id = $1 AND collection_id = $2 AND taxonomy_id = $3
           RETURNING is_primary`,
          [session.shopId, collectionId, taxonomyId]
        );
        const wasPrimary = deletedRow.rows[0]?.is_primary === true;

        if (wasPrimary) {
          const promoted = await client.query(
            `UPDATE pim_taxonomy_collection_map SET is_primary = true
             WHERE shop_id = $1 AND collection_id = $2
               AND taxonomy_id = (
                 SELECT taxonomy_id FROM pim_taxonomy_collection_map
                 WHERE shop_id = $1 AND collection_id = $2
                 ORDER BY created_at ASC LIMIT 1
               )`,
            [session.shopId, collectionId]
          );
          if ((promoted.rowCount ?? 0) > 0) return true;
        }
        return false;
      });

      if (taxonomyMeta.keys.length > 0) {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `UPDATE shopify_collections
             SET metafields = metafields ${taxonomyMeta.keys.map((_, i) => `- $${i + 3}`).join(' ')},
                 updated_at = now()
             WHERE id = $1 AND shop_id = $2`,
            [collectionId, session.shopId, ...taxonomyMeta.keys]
          );
        });
      }

      return reply.send(
        successEnvelope(request.id, {
          removed: true,
          promotedSecondary: wasPromoted,
        })
      );
    }
  );

  server.post(
    '/collections/:id/push-metafields',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      const collectionId = (request.params as { id?: string }).id;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }
      if (!collectionId) {
        return reply
          .status(400)
          .send(errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Missing collection id'));
      }
      const primaryMapping = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{ taxonomy_id: string }>(
          `SELECT taxonomy_id
             FROM pim_taxonomy_collection_map
            WHERE shop_id = $1
              AND collection_id = $2
            ORDER BY is_primary DESC, created_at ASC
            LIMIT 1`,
          [session.shopId, collectionId]
        );
        return result.rows[0] ?? null;
      });
      if (!primaryMapping?.taxonomy_id) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Collection has no taxonomy mapping')
          );
      }
      const metadata = await buildTaxonomyAssignPendingMetadata({
        shopId: session.shopId,
        collectionId,
        taxonomyId: primaryMapping.taxonomy_id,
      });
      await withTenantContext(session.shopId, async (client) => {
        await upsertTaxonomyAssignPendingChange(client, {
          shopId: session.shopId,
          collectionId,
          metadata,
          source: 'manual',
        });
      });
      return reply.status(202).send(successEnvelope(request.id, { queued: true }));
    }
  );

  server.get(
    '/collections/taxonomy-search',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const query = ((request.query as Record<string, string>)['q'] ?? '').trim();
      if (query.length < 2) {
        return reply.send(successEnvelope(request.id, { results: [] }));
      }

      const rows = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{
          id: string;
          name: string;
          parent_id: string | null;
          level: number;
          breadcrumbs: string;
        }>(
          `SELECT t.id, t.name, t.parent_id, t.level,
                  COALESCE(array_to_string(t.breadcrumbs, ' > '), '') AS breadcrumbs
           FROM prod_taxonomy t
           WHERE t.is_active = true
             AND (t.name ILIKE $1 OR array_to_string(t.breadcrumbs, ' > ') ILIKE $1)
           ORDER BY t.level ASC, t.name ASC
           LIMIT 50`,
          [`%${query}%`]
        );
        return r.rows;
      });

      return reply.send(
        successEnvelope(request.id, {
          results: rows.map((r) => ({
            id: r.id,
            name: r.name,
            parentId: r.parent_id,
            level: r.level,
            breadcrumbs: r.breadcrumbs,
          })),
        })
      );
    }
  );

  server.get(
    '/collections/taxonomy-map',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const rows = await withTenantContext(session.shopId, async (client) => {
        const result = await client.query<{
          id: string;
          collection_id: string;
          taxonomy_id: string;
          is_primary: boolean;
          collection_title: string;
          taxonomy_name: string;
        }>(
          `SELECT m.id,
                  m.collection_id,
                  m.taxonomy_id,
                  m.is_primary,
                  sc.title AS collection_title,
                  pt.name AS taxonomy_name
           FROM pim_taxonomy_collection_map m
           JOIN shopify_collections sc
             ON sc.id = m.collection_id
            AND sc.shop_id = m.shop_id
           JOIN prod_taxonomy pt
             ON pt.id = m.taxonomy_id
           WHERE m.shop_id = $1
           ORDER BY sc.title ASC, pt.name ASC`,
          [session.shopId]
        );
        return result.rows;
      });

      return reply.send(successEnvelope(request.id, { mappings: rows }));
    }
  );

  server.get(
    '/collections/taxonomy-embeddings/status',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const stats = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{
          total: number;
          with_embeddings: number;
        }>(
          `SELECT COUNT(*)::int AS total,
                  COUNT(embedding)::int AS with_embeddings
           FROM prod_taxonomy
           WHERE is_active = true`
        );
        return r.rows[0] ?? { total: 0, with_embeddings: 0 };
      });

      const batches = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{
          id: string;
          status: string;
          total_items: number;
          completed_items: number;
          failed_items: number;
          tokens_used: number | null;
          error_message: string | null;
          submitted_at: string | null;
          completed_at: string | null;
          updated_at: string | null;
        }>(
          `(SELECT id, status, total_items, completed_items, failed_items,
                   tokens_used, error_message,
                   submitted_at::text, completed_at::text, updated_at::text
              FROM embedding_batches
             WHERE shop_id = $1 AND batch_type = 'taxonomy'
               AND status IN ('pending', 'submitted', 'processing')
             ORDER BY created_at DESC LIMIT 1)
           UNION ALL
           (SELECT id, status, total_items, completed_items, failed_items,
                   tokens_used, error_message,
                   submitted_at::text, completed_at::text, updated_at::text
              FROM embedding_batches
             WHERE shop_id = $1 AND batch_type = 'taxonomy'
               AND status IN ('completed', 'failed', 'cancelled')
             ORDER BY completed_at DESC NULLS LAST LIMIT 1)`,
          [session.shopId]
        );
        return r.rows;
      });

      const activeBatch =
        batches.find((b) => ['pending', 'submitted', 'processing'].includes(b.status)) ?? null;
      const lastBatch =
        batches.find((b) => ['completed', 'failed', 'cancelled'].includes(b.status)) ?? null;

      const toBatchDto = (b: (typeof batches)[number]) => ({
        id: b.id,
        status: b.status,
        totalItems: b.total_items,
        completedItems: b.completed_items,
        failedItems: b.failed_items,
        tokensUsed: b.tokens_used ?? 0,
        errorMessage: b.error_message,
        submittedAt: b.submitted_at,
        completedAt: b.completed_at,
        updatedAt: b.updated_at,
      });

      return reply.send(
        successEnvelope(request.id, {
          total: stats.total,
          withEmbeddings: stats.with_embeddings,
          complete: stats.total > 0 && stats.with_embeddings >= stats.total,
          percentage: stats.total > 0 ? Math.round((stats.with_embeddings / stats.total) * 100) : 0,
          batch: activeBatch ? toBatchDto(activeBatch) : null,
          lastBatch: lastBatch ? toBatchDto(lastBatch) : null,
        })
      );
    }
  );

  server.post(
    '/collections/taxonomy-embeddings/generate',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const aiConfig = await getShopOpenAiConfig({
        shopId: session.shopId,
        env: options.env,
        logger: options.logger,
      });
      if (!aiConfig.enabled || !aiConfig.openAiApiKey) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'NO_AI_CREDENTIALS',
              'Credențialele OpenAI nu sunt configurate. Configurați-le în Setări → OpenAI.'
            )
          );
      }

      const { runTaxonomyBatchOrchestrator } = await import('../processors/ai/taxonomy-batch.js');
      const result = await runTaxonomyBatchOrchestrator({
        shopId: session.shopId,
        logger: options.logger,
      });

      if (result.alreadyRunning) {
        return reply.send(
          successEnvelope(request.id, {
            status: 'already_running',
            embeddingBatchId: result.embeddingBatchId,
            message: 'Un batch de taxonomy embeddings este deja în procesare.',
          })
        );
      }

      if (!result.embeddingBatchId) {
        return reply.send(
          successEnvelope(request.id, {
            status: 'nothing_to_process',
            embeddingBatchId: null,
            message: 'Toate categoriile au deja embedding-uri generate.',
          })
        );
      }

      options.logger.info(
        {
          shopId: session.shopId,
          embeddingBatchId: result.embeddingBatchId,
          totalItems: result.totalItems,
        },
        'Taxonomy embeddings batch submitted via Batch API'
      );

      return reply.send(
        successEnvelope(request.id, {
          status: 'submitted',
          embeddingBatchId: result.embeddingBatchId,
          totalItems: result.totalItems,
          message: `Batch trimis cu ${result.totalItems.toLocaleString('ro-RO')} categorii. Procesarea se face asincron prin OpenAI Batch API.`,
        })
      );
    }
  );

  server.post(
    '/collections/taxonomy-embeddings/poll',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const activeBatch = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{
          id: string;
          openai_batch_id: string;
        }>(
          `SELECT id, openai_batch_id
             FROM embedding_batches
            WHERE shop_id = $1 AND batch_type = 'taxonomy'
              AND status IN ('pending', 'submitted', 'processing')
              AND openai_batch_id IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`,
          [session.shopId]
        );
        return r.rows[0] ?? null;
      });

      if (!activeBatch) {
        return reply.send(
          successEnvelope(request.id, { polled: false, message: 'Niciun batch activ.' })
        );
      }

      const { runAiBatchPoller } = await import('../processors/ai/batch.js');
      await runAiBatchPoller({
        payload: {
          shopId: session.shopId,
          embeddingBatchId: activeBatch.id,
          openAiBatchId: activeBatch.openai_batch_id,
          requestedAt: Date.now(),
          triggeredBy: 'manual',
          pollAttempt: 0,
        },
        logger: options.logger,
      });

      return reply.send(
        successEnvelope(request.id, { polled: true, embeddingBatchId: activeBatch.id })
      );
    }
  );

  server.post(
    '/collections/taxonomy-embeddings/cancel',
    {
      preHandler: [requireAdminSession],
    },
    async (request, reply) => {
      const session = (request as RequestWithSession).session;
      if (!session) {
        return reply
          .status(401)
          .send(errorEnvelope(request.id, 401, 'UNAUTHORIZED', 'Unauthorized'));
      }

      const activeBatch = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{
          id: string;
          openai_batch_id: string;
        }>(
          `SELECT id, openai_batch_id
             FROM embedding_batches
            WHERE shop_id = $1 AND batch_type = 'taxonomy'
              AND status IN ('pending', 'submitted', 'processing')
              AND openai_batch_id IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`,
          [session.shopId]
        );
        return r.rows[0] ?? null;
      });

      if (!activeBatch) {
        return reply.send(
          successEnvelope(request.id, {
            cancelled: false,
            message: 'Niciun batch activ de anulat.',
          })
        );
      }

      const aiConfig = await getShopOpenAiConfig({
        shopId: session.shopId,
        env: options.env,
        logger: options.logger,
      });
      if (!aiConfig.enabled || !aiConfig.openAiApiKey) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'NO_AI_CREDENTIALS',
              'Credențialele OpenAI nu sunt configurate.'
            )
          );
      }

      const { OpenAiBatchManager } = await import('@app/ai-engine');
      const batchManager = new OpenAiBatchManager({
        apiKey: aiConfig.openAiApiKey,
        ...(aiConfig.openAiBaseUrl ? { baseUrl: aiConfig.openAiBaseUrl } : {}),
        timeoutMs: options.env.openAiTimeoutMs,
      });

      await batchManager.cancelBatch(activeBatch.openai_batch_id);

      await withTenantContext(session.shopId, async (client) => {
        await client.query(
          `UPDATE embedding_batches
           SET status = 'cancelled',
               error_message = 'Anulat manual de utilizator',
               completed_at = now(),
               updated_at = now()
           WHERE id = $1 AND shop_id = $2`,
          [activeBatch.id, session.shopId]
        );
      });

      options.logger.info(
        { shopId: session.shopId, embeddingBatchId: activeBatch.id },
        'Taxonomy embeddings batch cancelled by user'
      );

      return reply.send(
        successEnvelope(request.id, { cancelled: true, embeddingBatchId: activeBatch.id })
      );
    }
  );

  return Promise.resolve();
};
