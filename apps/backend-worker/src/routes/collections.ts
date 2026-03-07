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

  const candidateList = params.candidates.map((c, i) => `${i + 1}. [${c.id}] ${c.name}`).join('\n');

  const titlePart = params.collectionTitleEn
    ? `"${params.collectionTitle}" (English: "${params.collectionTitleEn}")`
    : `"${params.collectionTitle}"`;
  const collectionText = params.collectionDescription
    ? `${titlePart} — ${params.collectionDescription}`
    : titlePart;
  const userPrompt = `Collection: ${collectionText}\n\nCandidate categories:\n${candidateList}`;
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
            content: `You are an expert product taxonomy classifier for Shopify stores. Your task:

1. The user gives you a product collection name (possibly in a non-English language like Romanian, French, German, etc.) and a numbered list of candidate Shopify taxonomy categories (in English).
2. You must identify which candidate BEST matches the collection's product domain.
3. Return a JSON object with:
   - "selectedId": the [id] of the best matching candidate (exact string from brackets)
   - "selectedName": the name of the selected candidate
   - "confidence": a float 0.0–1.0 representing how confident you are (0.9+ = very confident, 0.7–0.89 = confident, 0.5–0.69 = uncertain, <0.5 = poor match)
   - "reasoning": one sentence explaining WHY this category matches (in English)
   - "translatedQuery": the English translation of the collection name (for logging)
   - "language": ISO 639-1 code of the detected source language (e.g. "ro", "en")

Rules:
- Match based on PRODUCT DOMAIN, not literal word translation. "Camere supraveghere" = surveillance cameras, not just "cameras".
- If none of the candidates is a good match, set confidence below 0.3 and pick the least-bad option.
- Be strict: only give confidence ≥ 0.8 if the match is clearly correct.`,
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

    const matched = params.candidates.find((c) => c.id === parsed.selectedId);
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
          image_url: string | null;
          total_count: string;
        }>(
          `SELECT sc.id,
                  sc.shopify_gid,
                  sc.legacy_resource_id,
                  sc.title,
                  sc.handle,
                  sc.collection_type,
                  sc.products_count,
                  COALESCE(COUNT(ptcm.taxonomy_id), 0)::int AS taxonomy_count,
                  MAX(pt.name) AS taxonomy_name,
                  sc.synced_at::text,
                  sc.description,
                  sc.description_html,
                  sc.image_url,
                  COUNT(*) OVER()::text AS total_count
           FROM shopify_collections sc
           LEFT JOIN pim_taxonomy_collection_map ptcm
             ON ptcm.collection_id = sc.id
            AND ptcm.shop_id = sc.shop_id
           LEFT JOIN prod_taxonomy pt ON pt.id = ptcm.taxonomy_id
           WHERE ${whereClause}
           GROUP BY sc.id, sc.shopify_gid, sc.legacy_resource_id, sc.title, sc.handle,
                    sc.collection_type, sc.products_count, sc.synced_at, sc.description,
                    sc.description_html, sc.image_url, sc.updated_at
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
        handle: r.handle,
        collection_type: r.collection_type,
        products_count: r.products_count,
        taxonomy_count: r.taxonomy_count,
        taxonomy_name: r.taxonomy_name,
        synced_at: r.synced_at,
        description: r.description,
        description_html: r.description_html,
        image_url: r.image_url,
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
          paramIdx += 1; // eslint-disable-line no-useless-assignment -- keeps paramIdx in sync for future conditions
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
          totalProducts: statsRow.total_products,
          lastSyncedAt: statsRow.last_synced_at,
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

      const provider = await resolveEmbeddingsProvider({
        shopId: session.shopId,
        env: options.env,
        logger: options.logger,
      });
      const hasEmbeddings = await withTenantContext(session.shopId, async (client) => {
        const r = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM prod_taxonomy
            WHERE is_active = true
              AND embedding IS NOT NULL
              AND (model_version IS NULL OR model_version = $1)`,
          [provider.model.name]
        );
        return parseInt(r.rows[0]?.count ?? '0', 10);
      });
      if (hasEmbeddings === 0) {
        return reply
          .status(400)
          .send(
            errorEnvelope(
              request.id,
              400,
              'BAD_REQUEST',
              `Taxonomia nu are embedding-uri pentru modelul ${provider.model.name}.`
            )
          );
      }

      const CONFIDENCE_THRESHOLD = 0.65;
      const VECTOR_CANDIDATES = 40;
      interface ResultItem {
        collectionId: string;
        taxonomyId: string | null;
        taxonomyName: string | null;
        confidence: number | null;
        status: 'assigned' | 'low_confidence' | 'error';
        translatedText?: string | undefined;
        detectedLanguage?: string | undefined;
        reasoning?: string | undefined;
        candidates?: { name: string; similarity: number }[] | undefined;
      }
      const results: ResultItem[] = [];

      for (const collectionId of collectionIds) {
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
          if (!collectionRow) {
            results.push({
              collectionId,
              taxonomyId: null,
              taxonomyName: null,
              confidence: null,
              status: 'error',
            });
            continue;
          }

          if (!collectionRow.title) {
            results.push({
              collectionId,
              taxonomyId: null,
              taxonomyName: null,
              confidence: null,
              status: 'error',
            });
            continue;
          }

          const embeddingText = collectionRow.titleEn
            ? [collectionRow.titleEn, collectionRow.description ?? '']
                .filter(Boolean)
                .join(' — ')
                .trim()
            : [collectionRow.title, collectionRow.description ?? '']
                .filter(Boolean)
                .join(' — ')
                .trim();

          const [embedding] = await provider.embedTexts([embeddingText]);
          if (!embedding || embedding.length === 0) {
            results.push({
              collectionId,
              taxonomyId: null,
              taxonomyName: null,
              confidence: null,
              status: 'error',
            });
            continue;
          }

          const vectorCandidates = await withTenantContext(session.shopId, async (client) => {
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
          });

          if (vectorCandidates.length === 0) {
            results.push({
              collectionId,
              taxonomyId: null,
              taxonomyName: null,
              confidence: null,
              status: 'error',
            });
            continue;
          }

          const classificationCreds = await resolveChatTaskCredentials({
            shopId: session.shopId,
            taskType: 'classification',
            env: options.env,
            logger: options.logger,
          });
          if (!classificationCreds) {
            results.push({
              collectionId,
              taxonomyId: null,
              taxonomyName: null,
              confidence: null,
              status: 'error',
            });
            continue;
          }

          const resolvedBaseUrl = classificationCreds.baseUrl;
          const classification = await classifyWithLLM({
            shopId: session.shopId,
            env: options.env,
            collectionTitle: collectionRow.title,
            collectionTitleEn: collectionRow.titleEn,
            collectionDescription: collectionRow.description,
            candidates: vectorCandidates,
            ...(classificationCreds.apiKey ? { apiKey: classificationCreds.apiKey } : {}),
            ...(resolvedBaseUrl != null ? { baseUrl: resolvedBaseUrl } : {}),
            model: classificationCreds.model,
            timeoutMs: options.env.openAiTimeoutMs,
            logger: options.logger,
          });

          const topCandidates = vectorCandidates.slice(0, 5).map((c) => ({
            name: c.name,
            similarity: Math.round(c.similarity * 1000) / 1000,
          }));

          if (!classification) {
            const fallback = vectorCandidates[0];
            results.push({
              collectionId,
              taxonomyId: fallback?.id ?? null,
              taxonomyName: fallback?.name ?? null,
              confidence: fallback?.similarity ?? null,
              status: 'low_confidence',
              candidates: topCandidates,
            });
            continue;
          }

          options.logger.info(
            {
              collectionId,
              collectionTitle: collectionRow.title,
              classification: {
                taxonomyName: classification.taxonomyName,
                confidence: classification.confidence,
                reasoning: classification.reasoning,
                translatedQuery: classification.translatedQuery,
                detectedLanguage: classification.detectedLanguage,
              },
              vectorTop5: topCandidates,
              threshold: CONFIDENCE_THRESHOLD,
            },
            'AI taxonomy assignment: LLM classification result'
          );

          if (classification.confidence < CONFIDENCE_THRESHOLD) {
            results.push({
              collectionId,
              taxonomyId: classification.taxonomyId,
              taxonomyName: classification.taxonomyName,
              confidence: classification.confidence,
              status: 'low_confidence',
              translatedText: classification.translatedQuery,
              detectedLanguage: classification.detectedLanguage,
              reasoning: classification.reasoning,
              candidates: topCandidates,
            });
            continue;
          }

          const existingMappingsBulk = await withTenantContext(session.shopId, async (client) => {
            const r = await client.query<{ taxonomy_id: string }>(
              `SELECT taxonomy_id FROM pim_taxonomy_collection_map
               WHERE shop_id = $1 AND collection_id = $2`,
              [session.shopId, collectionId]
            );
            return r.rows;
          });

          if (mode === 'replace' && existingMappingsBulk.length > 0) {
            for (const row of existingMappingsBulk) {
              await deleteCollectionMetafieldsForTaxonomy({
                shopId: session.shopId,
                collectionId,
                taxonomyId: row.taxonomy_id,
                logger: options.logger,
              });
            }
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
               VALUES ($1, $2, $3, true, now())
               ON CONFLICT (shop_id, taxonomy_id, collection_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
              [session.shopId, classification.taxonomyId, collectionId]
            );
          });

          void enqueueCollectionMetafieldPushJob({
            shopId: session.shopId,
            collectionId,
            trigger: 'category_classifier',
          });

          results.push({
            collectionId,
            taxonomyId: classification.taxonomyId,
            taxonomyName: classification.taxonomyName,
            confidence: classification.confidence,
            status: 'assigned',
            translatedText: classification.translatedQuery,
            detectedLanguage: classification.detectedLanguage,
            reasoning: classification.reasoning,
            candidates: topCandidates,
          });
        } catch {
          results.push({
            collectionId,
            taxonomyId: null,
            taxonomyName: null,
            confidence: null,
            status: 'error',
          });
        }
      }

      return reply.send(successEnvelope(request.id, { results }));
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

      const body = (request.body ?? {}) as { collectionIds?: unknown };
      const scopeIds = Array.isArray(body.collectionIds)
        ? body.collectionIds.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0
          )
        : null;

      const untranslated = await withTenantContext(session.shopId, async (client) => {
        if (scopeIds && scopeIds.length > 0) {
          const r = await client.query<{ id: string; title: string }>(
            `SELECT id, title FROM shopify_collections
             WHERE shop_id = $1 AND id = ANY($2::uuid[]) AND (title_en IS NULL OR title_en = '')
             ORDER BY title ASC`,
            [session.shopId, scopeIds]
          );
          return r.rows;
        }
        const r = await client.query<{ id: string; title: string }>(
          `SELECT id, title FROM shopify_collections
           WHERE shop_id = $1 AND (title_en IS NULL OR title_en = '')
           ORDER BY title ASC`,
          [session.shopId]
        );
        return r.rows;
      });

      if (untranslated.length === 0) {
        return reply.send(
          successEnvelope(request.id, {
            translated: 0,
            total: 0,
            message: 'Toate colecțiile sunt deja traduse',
          })
        );
      }

      const BATCH_SIZE = 25;
      let translated = 0;

      const translateCreds = await resolveChatTaskCredentials({
        shopId: session.shopId,
        taskType: 'translation',
        env: options.env,
        logger: options.logger,
      });
      if (!translateCreds) {
        return reply
          .status(400)
          .send(
            errorEnvelope(request.id, 400, 'BAD_REQUEST', 'Credențialele AI nu sunt configurate')
          );
      }
      const translateApiKey = translateCreds.apiKey;
      const translateBaseRaw = translateCreds.baseUrl.replace(/\/$/, '');
      const translateBase = translateBaseRaw.endsWith('/v1')
        ? translateBaseRaw
        : `${translateBaseRaw}/v1`;
      const translateModel = translateCreds.model;

      for (let i = 0; i < untranslated.length; i += BATCH_SIZE) {
        const batch = untranslated.slice(i, i + BATCH_SIZE);
        const numberedList = batch.map((c, idx) => `${idx + 1}. ${c.title}`).join('\n');
        const inputScan = await scanInput({
          shopId: session.shopId,
          text: numberedList,
          env: options.env,
          logger: options.logger,
        });
        if (!inputScan.isValid) {
          options.logger.warn(
            { shopId: session.shopId, batchStart: i, reason: inputScan.reason },
            'guardrails_blocked_bulk_translate_input'
          );
          continue;
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30_000);

          const res = await fetch(`${translateBase}/chat/completions`, {
            method: 'POST',
            headers: {
              ...(translateApiKey ? { authorization: `Bearer ${translateApiKey}` } : {}),
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: translateModel,
              temperature: 0,
              max_tokens: 2000,
              response_format: { type: 'json_object' },
              messages: [
                {
                  role: 'system',
                  content: `You translate product collection names to English for Shopify taxonomy matching. Input: a numbered list of collection names (may be in any language). Output: a JSON object with key "translations" containing an array of objects, each with "index" (1-based) and "en" (English translation). Translate the product category meaning, not marketing text. Keep it concise. If already in English, return unchanged.`,
                },
                { role: 'user', content: inputScan.sanitizedText },
              ],
            }),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!res.ok) {
            options.logger.warn({ status: res.status }, 'Bulk translate batch failed');
            continue;
          }

          const json = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const contentRaw = json.choices?.[0]?.message?.content ?? '';
          const outputScan = await scanOutput({
            shopId: session.shopId,
            prompt: inputScan.sanitizedText,
            output: contentRaw,
            env: options.env,
            logger: options.logger,
          });
          if (!outputScan.isValid) {
            options.logger.warn(
              { shopId: session.shopId, batchStart: i, reason: outputScan.reason },
              'guardrails_blocked_bulk_translate_output'
            );
            continue;
          }
          const content = outputScan.sanitizedText;
          const parsed = JSON.parse(content) as {
            translations?: { index?: number; en?: string }[];
          };

          const translations = parsed.translations ?? [];

          await withTenantContext(session.shopId, async (client) => {
            for (const t of translations) {
              if (typeof t.index !== 'number' || !t.en) continue;
              const item = batch[t.index - 1];
              if (!item) continue;
              await client.query(
                `UPDATE shopify_collections SET title_en = $1, updated_at = now()
                 WHERE id = $2 AND shop_id = $3`,
                [t.en.trim(), item.id, session.shopId]
              );
              translated++;
            }
          });

          options.logger.info(
            { batchStart: i, batchSize: batch.length, translated: translations.length },
            'Bulk translate batch completed'
          );
        } catch (err) {
          options.logger.warn({ err, batchStart: i }, 'Bulk translate batch error');
        }
      }

      return reply.send(
        successEnvelope(request.id, {
          translated,
          total: untranslated.length,
          message: `${translated} din ${untranslated.length} colecții traduse`,
        })
      );
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
