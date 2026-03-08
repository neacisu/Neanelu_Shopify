import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import { configFromEnv, createQueue } from '@app/queue-manager';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { SessionConfig } from '../auth/session.js';
import { requireSession } from '../auth/session.js';
import { getShopOpenAiConfig } from '../runtime/openai-config.js';
import {
  resolveChatTaskCredentials,
  resolveEmbeddingsProvider,
} from '../services/ai-provider-routing.js';
import { scanInput, scanOutput } from '../services/guardrails.js';
import {
  enqueueCollectionsSyncJob,
  PIM_COLLECTIONS_SYNC_QUEUE_NAME,
} from '../queue/collections-sync-queue.js';
import { enqueueCollectionMetafieldPushJob } from '../queue/collection-metafield-push-queue.js';
import { toPgVectorLiteral } from '../processors/bulk-operations/pim/vector.js';
import { deleteCollectionMetafieldsForTaxonomy } from '../services/collection-metafields-delete.js';

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
}

async function classifyWithLLM(params: {
  shopId: string;
  env: AppEnv;
  collectionTitle: string;
  collectionTitleEn: string | null;
  collectionDescription: string | null;
  productSamples?: string[];
  candidates: readonly { id: string; name: string; similarity: number }[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  logger: Logger;
}): Promise<TaxonomyClassification | null> {
  if (params.candidates.length === 0) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 20_000);
  const baseRaw = (params.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
  const base = baseRaw.endsWith('/v1') ? baseRaw : `${baseRaw}/v1`;

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

  const userPrompt = `Collection: ${collectionText}${productSection}\n\nCandidate categories (ranked by vector relevance):\n${candidateList}`;
  const inputScan = await scanInput({
    shopId: params.shopId,
    text: userPrompt,
    env: params.env,
    logger: params.logger,
  });
  if (!inputScan.isValid) {
    params.logger.warn(
      { shopId: params.shopId, reason: inputScan.reason, scanners: inputScan.detectedScanners },
      'guardrails_blocked_taxonomy_classification_input'
    );
    return null;
  }

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        ...(params.apiKey ? { authorization: `Bearer ${params.apiKey}` } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert product taxonomy classifier for a Romanian home improvement / hardware / garden e-commerce store on Shopify.

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
6. If NONE of the candidates is a genuine match for the products, set confidence below 0.3.
7. Do NOT inflate confidence. A 95% confidence means you are absolutely certain — use it only when the category name is essentially identical to what the products are.
8. Candidates ranked higher (by relevance %) are statistically more likely but NOT always correct. Override the ranking if a lower-ranked candidate is a clearly better product domain match.`,
          },
          {
            role: 'user',
            content: inputScan.sanitizedText,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      params.logger.warn({ status: res.status, body }, 'Taxonomy classification API error');
      return null;
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const contentRaw = json.choices?.[0]?.message?.content ?? '';
    const outputScan = await scanOutput({
      shopId: params.shopId,
      prompt: inputScan.sanitizedText,
      output: contentRaw,
      env: params.env,
      logger: params.logger,
    });
    if (!outputScan.isValid) {
      params.logger.warn(
        { shopId: params.shopId, reason: outputScan.reason, scanners: outputScan.detectedScanners },
        'guardrails_blocked_taxonomy_classification_output'
      );
      return null;
    }
    const content = outputScan.sanitizedText;
    const parsed = JSON.parse(content) as {
      selectedId?: string;
      selectedName?: string;
      confidence?: number;
      reasoning?: string;
      translatedQuery?: string;
      language?: string;
    };

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
    };
  } catch (err) {
    params.logger.warn({ err }, 'Taxonomy classification LLM call failed');
    return null;
  } finally {
    clearTimeout(timeout);
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
  title: string;
  description: string | null;
  productSamples?: string[];
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  logger: Logger;
}): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 30_000);
  const baseRaw = (params.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
  const base = baseRaw.endsWith('/v1') ? baseRaw : `${baseRaw}/v1`;

  const hasProducts = params.productSamples && params.productSamples.length > 0;
  const productSection = hasProducts
    ? `\n\nSample products sold in this collection:\n${params.productSamples!.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : '';

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        ...(params.apiKey ? { authorization: `Bearer ${params.apiKey}` } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You translate Romanian product collection names into English product category names for a home improvement / hardware / garden e-commerce store.

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

EXAMPLES (follow these exactly):
- "Acaricide" → { "reasoning": "Acaricide is an international scientific term meaning mite/tick killers. It must stay exact.", "categoryEn": "Acaricides" }
- "Accesorii Bazine" → { "reasoning": "Bazine = French bassin = pools/basins/tanks. Accesorii = Accessories.", "categoryEn": "Pool Accessories" }
- "Accesorii Butelie" → { "reasoning": "Butelie = French bouteille = gas bottle. Accesorii = Accessories.", "categoryEn": "Gas Bottle Accessories" }
- "Vopsele lavabile" → { "reasoning": "Vopsele = paints, lavabile = washable. This is washable paint.", "categoryEn": "Washable Paints" }
- "Centrale termice" → { "reasoning": "Centrale termice = central heating boilers.", "categoryEn": "Central Heating Boilers" }

Return JSON: { "reasoning": "...", "categoryEn": "..." }`,
          },
          {
            role: 'user',
            content: `Collection name: "${params.title}"${params.description ? `\nDescription: ${params.description}` : ''}${productSection}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      params.logger.warn({ status: res.status, body }, 'taxonomy_assign: translation API error');
      return null;
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { reasoning?: string; categoryEn?: string };
    const categoryEn = parsed.categoryEn?.trim();
    if (!categoryEn) {
      params.logger.warn({ raw, parsed }, 'taxonomy_assign: translation returned no categoryEn');
      return null;
    }

    params.logger.info(
      { original: params.title, translated: categoryEn, reasoning: parsed.reasoning, hasProducts },
      'taxonomy_assign: translated collection title to English'
    );
    return categoryEn;
  } catch (err) {
    params.logger.warn({ err, title: params.title }, 'taxonomy_assign: translation failed');
    return null;
  } finally {
    clearTimeout(timeout);
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
      const menuLevel = query['menuLevel'] ?? 'all';
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
          title_en: string | null;
          image_url: string | null;
          parent_collection_id: string | null;
          parent_title: string | null;
          menu_level: number | null;
          menu_path: string | null;
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
                  sc.image_url,
                  sc.parent_collection_id,
                  parent_sc.title AS parent_title,
                  sc.menu_level,
                  sc.menu_path,
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
                    sc.description_html, sc.image_url, sc.parent_collection_id, parent_sc.title,
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
        image_url: r.image_url,
        parent_collection_id: r.parent_collection_id,
        parent_title: r.parent_title,
        menu_level: r.menu_level,
        menu_path: r.menu_path,
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
      const menuLevel = query['menuLevel'] ?? 'all';

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
          image_url: string | null;
          parent_collection_id: string | null;
          parent_title: string | null;
          menu_level: number | null;
          menu_path: string | null;
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
                  sc.image_url,
                  sc.parent_collection_id,
                  parent_sc.title AS parent_title,
                  sc.menu_level,
                  sc.menu_path
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
                    sc.description, sc.description_html, sc.image_url,
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
            image_url: row.image_url,
            parent_collection_id: row.parent_collection_id,
            parent_title: row.parent_title,
            menu_level: row.menu_level,
            menu_path: row.menu_path,
          },
        })
      );
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

      const body = (request.body ?? {}) as { collectionIds?: unknown; mode?: unknown };
      const rawIds = Array.isArray(body.collectionIds) ? body.collectionIds : [];
      const collectionIds = rawIds
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .slice(0, 50);
      const mode =
        body.mode === 'add_secondary'
          ? 'add_secondary'
          : ('replace' as 'replace' | 'add_secondary');
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
        const provider = await resolveEmbeddingsProvider({
          shopId: session.shopId,
          env: options.env,
          logger: options.logger,
        });

        emit({ type: 'bulk_start', total: collectionIds.length });

        const CONFIDENCE_THRESHOLD = 0.65;
        const VECTOR_CANDIDATES = 40;

        for (let idx = 0; idx < collectionIds.length; idx++) {
          const collectionId = collectionIds[idx]!;
          const progress = `[${idx + 1}/${collectionIds.length}]`;

          try {
            const collectionRow = await withTenantContext(session.shopId, async (client) => {
              const r = await client.query<{
                title: string;
                description: string | null;
                titleEn: string | null;
              }>(
                `SELECT title, description, title_en AS "titleEn"
                 FROM shopify_collections WHERE shop_id = $1 AND id = $2 LIMIT 1`,
                [session.shopId, collectionId]
              );
              return r.rows[0] ?? null;
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
                await deleteCollectionMetafieldsForTaxonomy({
                  shopId: session.shopId,
                  collectionId,
                  taxonomyId: row.taxonomy_id,
                  logger: options.logger,
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
              effectiveTitleEn = await translateTitleToEnglish({
                title: collectionRow.title,
                description: collectionRow.description,
                productSamples,
                ...(txCreds.apiKey ? { apiKey: txCreds.apiKey } : {}),
                ...(txBaseUrl != null ? { baseUrl: txBaseUrl } : {}),
                model: txCreds.model,
                timeoutMs: 30_000,
                logger: options.logger,
              });
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
            const embeddingText =
              (effectiveTitleEn ?? collectionRow.title) +
              (collectionRow.description ? ` — ${collectionRow.description}` : '');
            const [embedding] = await provider.embedTexts([embeddingText.trim()]);
            if (!embedding || embedding.length === 0) {
              emit({
                type: 'collection_result',
                collectionId,
                collectionTitle: collectionRow.title,
                status: 'error',
                message: 'Nu s-a putut genera embedding-ul.',
              });
              continue;
            }
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
            const bkTokens = bkSearchTitle
              .split(/[\s,\-—–]+/)
              .map((t) => t.trim().toLowerCase())
              .filter((t) => t.length >= 3);
            const [bkVecRes, bkKwRes] = await Promise.all([
              withTenantContext(session.shopId, async (client) => {
                const vec = toPgVectorLiteral(embedding);
                return (
                  await client.query<{ id: string; name: string; similarity: number }>(
                    `SELECT id, name, (1 - (embedding <=> $1::vector(2000)))::float AS similarity FROM prod_taxonomy WHERE is_active = true AND embedding IS NOT NULL AND (model_version IS NULL OR model_version = $3) ORDER BY embedding <=> $1::vector(2000) LIMIT $2`,
                    [vec, VECTOR_CANDIDATES, provider.model.name]
                  )
                ).rows;
              }),
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
            ]);
            const bkSeen = new Set(bkVecRes.map((r) => r.id));
            const bkBoosts: { id: string; name: string; similarity: number }[] = [];
            for (const kw of bkKwRes) {
              if (!bkSeen.has(kw.id)) {
                bkBoosts.push({ id: kw.id, name: kw.name, similarity: 0.85 });
                bkSeen.add(kw.id);
              }
            }
            const vectorCandidates = [...bkBoosts, ...bkVecRes].sort(
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
              productSamples,
              candidates: vectorCandidates,
              ...(classificationCreds.apiKey ? { apiKey: classificationCreds.apiKey } : {}),
              ...(resolvedBaseUrl != null ? { baseUrl: resolvedBaseUrl } : {}),
              model: classificationCreds.model,
              timeoutMs: options.env.openAiTimeoutMs,
              logger: options.logger,
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
            void enqueueCollectionMetafieldPushJob({
              shopId: session.shopId,
              collectionId,
              trigger: 'category_classifier',
            });
            emit({
              type: 'collection_progress',
              collectionId,
              step: 'persist',
              status: 'done',
              message: `${progress} Taxonomie atribuită.`,
            });

            emit({
              type: 'collection_result',
              collectionId,
              collectionTitle: collectionRow.title,
              status: 'assigned',
              taxonomyId: classification.taxonomyId,
              taxonomyName: classification.taxonomyName,
              confidence: classification.confidence,
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
      const bodyTx = (request.body ?? {}) as { force?: boolean };
      const forceRetranslate = bodyTx.force === true;

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
        const collectionRow = await withTenantContext(session.shopId, async (client) => {
          const r = await client.query<{
            title: string;
            description: string | null;
            titleEn: string | null;
          }>(
            `SELECT title, description, title_en AS "titleEn" FROM shopify_collections WHERE shop_id = $1 AND id = $2 LIMIT 1`,
            [session.shopId, collectionId]
          );
          return r.rows[0] ?? null;
        });

        if (!collectionRow) {
          emit({ type: 'error', message: 'Colecția nu a fost găsită.' });
          raw.end();
          return;
        }

        if (collectionRow.titleEn && !forceRetranslate) {
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

        if (collectionRow.titleEn && forceRetranslate) {
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
          title: collectionRow.title,
          description: collectionRow.description,
          productSamples: samples,
          ...(txCreds.apiKey ? { apiKey: txCreds.apiKey } : {}),
          baseUrl: txCreds.baseUrl,
          model: txCreds.model,
          timeoutMs: 30_000,
          logger: options.logger,
        });

        if (translated) {
          await withTenantContext(session.shopId, async (client) => {
            await client.query(
              `UPDATE shopify_collections SET title_en = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
              [translated, collectionId, session.shopId]
            );
          });
          emit({
            type: 'progress',
            step: 'translate',
            status: 'done',
            message: `Traducere: „${translated}"`,
          });
          emit({ type: 'result', status: 'translated', titleEn: translated });
        } else {
          emit({
            type: 'progress',
            step: 'translate',
            status: 'error',
            message: 'Traducerea nu a reușit.',
          });
          emit({ type: 'result', status: 'error', message: 'Traducerea nu a reușit.' });
        }
      } catch (err) {
        options.logger.error({ err, collectionId }, 'Single collection translate failed');
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
        const collectionRow = await withTenantContext(session.shopId, async (client) => {
          const r = await client.query<{
            title: string;
            description: string | null;
            titleEn: string | null;
          }>(
            `SELECT title, description, title_en AS "titleEn"
             FROM shopify_collections WHERE shop_id = $1 AND id = $2 LIMIT 1`,
            [session.shopId, collectionId]
          );
          return r.rows[0] ?? null;
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
            await deleteCollectionMetafieldsForTaxonomy({
              shopId: session.shopId,
              collectionId,
              taxonomyId: row.taxonomy_id,
              logger: options.logger,
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
          effectiveTitleEn = await translateTitleToEnglish({
            title: collectionRow.title,
            description: collectionRow.description,
            productSamples: singleProductSamples,
            ...(txCreds.apiKey ? { apiKey: txCreds.apiKey } : {}),
            ...(txBaseUrl != null ? { baseUrl: txBaseUrl } : {}),
            model: txCreds.model,
            timeoutMs: 30_000,
            logger: options.logger,
          });
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
        const provider = await resolveEmbeddingsProvider({
          shopId: session.shopId,
          env: options.env,
          logger: options.logger,
        });
        const embeddingText =
          (effectiveTitleEn ?? collectionRow.title) +
          (collectionRow.description ? ` — ${collectionRow.description}` : '');
        const [embedding] = await provider.embedTexts([embeddingText.trim()]);
        if (!embedding || embedding.length === 0) {
          emit({ type: 'error', message: 'Nu s-a putut genera embedding-ul.' });
          raw.end();
          return;
        }
        emit({ type: 'progress', step: 'embed', status: 'done', message: 'Embedding generat.' });

        emit({
          type: 'progress',
          step: 'search',
          message: 'Caut taxonomiile cele mai compatibile...',
        });
        const VECTOR_CANDIDATES = 40;
        const searchTitle = effectiveTitleEn ?? collectionRow.title;
        const keywordTokens = searchTitle
          .split(/[\s,\-—–]+/)
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length >= 3);

        const [vectorResults, keywordResults] = await Promise.all([
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
        ]);

        const seenIds = new Set(vectorResults.map((r) => r.id));
        const keywordBoosts: { id: string; name: string; similarity: number }[] = [];
        for (const kw of keywordResults) {
          if (!seenIds.has(kw.id)) {
            keywordBoosts.push({ id: kw.id, name: kw.name, similarity: 0.85 });
            seenIds.add(kw.id);
          }
        }

        const vectorCandidates = [...keywordBoosts, ...vectorResults].sort(
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
          productSamples: singleProductSamples,
          candidates: vectorCandidates,
          ...(classificationCreds.apiKey ? { apiKey: classificationCreds.apiKey } : {}),
          ...(resolvedBaseUrl != null ? { baseUrl: resolvedBaseUrl } : {}),
          model: classificationCreds.model,
          timeoutMs: options.env.openAiTimeoutMs,
          logger: options.logger,
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
        emit({
          type: 'progress',
          step: 'persist',
          status: 'done',
          message: 'Taxonomie atribuită cu succes.',
        });

        emit({
          type: 'progress',
          step: 'metafield_push',
          message: 'Programez sincronizarea metafields...',
        });
        void enqueueCollectionMetafieldPushJob({
          shopId: session.shopId,
          collectionId,
          trigger: 'category_classifier',
        });
        emit({
          type: 'progress',
          step: 'metafield_push',
          status: 'done',
          message: 'Sincronizare metafields programată.',
        });

        emit({
          type: 'result',
          status: 'assigned',
          taxonomyId: classification.taxonomyId,
          taxonomyName: classification.taxonomyName,
          confidence: classification.confidence,
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

      for (const collectionId of collectionIds) {
        await enqueueCollectionMetafieldPushJob({
          shopId: session.shopId,
          collectionId,
          trigger: 'manual',
        });
      }

      return reply.send(
        successEnvelope(request.id, { queued: true, jobCount: collectionIds.length })
      );
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
            const r = await client.query<{ id: string; title: string; description: string | null }>(
              `SELECT id, title, description FROM shopify_collections
               WHERE shop_id = $1 AND id = ANY($2::uuid[])${untranslatedFilter}
               ORDER BY title ASC`,
              [session.shopId, scopeIds]
            );
            return r.rows;
          }
          const r = await client.query<{ id: string; title: string; description: string | null }>(
            `SELECT id, title, description FROM shopify_collections
             WHERE shop_id = $1${untranslatedFilter}
             ORDER BY title ASC`,
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
              title: col.title,
              description: col.description,
              productSamples: samples,
              ...(translateCreds.apiKey ? { apiKey: translateCreds.apiKey } : {}),
              baseUrl: translateCreds.baseUrl,
              model: translateCreds.model,
              timeoutMs: 30_000,
              logger: options.logger,
            });

            if (translatedTitle) {
              await withTenantContext(session.shopId, async (client) => {
                await client.query(
                  `UPDATE shopify_collections SET title_en = $1, updated_at = now() WHERE id = $2 AND shop_id = $3`,
                  [translatedTitle, col.id, session.shopId]
                );
              });
              translated++;
              emit({
                type: 'translate_progress',
                collectionId: col.id,
                step: 'translate',
                status: 'done',
                message: `${progress} „${translatedTitle}"`,
              });
              emit({
                type: 'translate_collection_result',
                collectionId: col.id,
                collectionTitle: col.title,
                status: 'translated',
                titleEn: translatedTitle,
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
      };
      const taxonomyId =
        typeof body.taxonomyId === 'string' && body.taxonomyId.trim().length > 0
          ? body.taxonomyId.trim()
          : null;
      const isPrimary = body.isPrimary === undefined ? true : Boolean(body.isPrimary);
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
          await deleteCollectionMetafieldsForTaxonomy({
            shopId: session.shopId,
            collectionId,
            taxonomyId: row.taxonomy_id,
            logger: options.logger,
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

      const jobId = await enqueueCollectionMetafieldPushJob({
        shopId: session.shopId,
        collectionId,
        trigger: 'category_classifier',
      });

      return reply.send(
        successEnvelope(request.id, {
          assigned: true,
          metafieldsPushJobId: jobId,
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
      await deleteCollectionMetafieldsForTaxonomy({
        shopId: session.shopId,
        collectionId,
        taxonomyId,
        logger: options.logger,
      });
      const keysToRemove = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{ ns: string; k: string }>(
          `SELECT shopify_namespace AS ns, shopify_key AS k
           FROM pim_taxonomy_metafield_schema WHERE taxonomy_id = $1`,
          [taxonomyId]
        );
        return r.rows.map((row) => `${row.ns}.${row.k}`);
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

      if (keysToRemove.length > 0) {
        await withTenantContext(session.shopId, async (client) => {
          await client.query(
            `UPDATE shopify_collections
             SET metafields = metafields ${keysToRemove.map((_, i) => `- $${i + 3}`).join(' ')},
                 updated_at = now()
             WHERE id = $1 AND shop_id = $2`,
            [collectionId, session.shopId, ...keysToRemove]
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

      const jobId = await enqueueCollectionMetafieldPushJob({
        shopId: session.shopId,
        collectionId,
        trigger: 'manual',
      });
      return reply.status(202).send(successEnvelope(request.id, { queued: true, jobId }));
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
