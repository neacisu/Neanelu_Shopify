import { createEmbeddingsProvider, sha256Hex } from '@app/ai-engine';
import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import { OTEL_ATTR, type Logger } from '@app/logger';
import { BudgetExceededError, enforceBudget } from '@app/pim';
import { getShopOpenAiConfig } from '../../../runtime/openai-config.js';

import { enqueueConsensusJob } from '../../../queue/consensus-queue.js';
import { createSuspiciousDedupeCluster } from '../deduplication.js';
import { isFeatureFlagEnabled } from '../feature-flags.js';
import { insertBulkError } from '../state-machine.js';
import { decidePimTarget } from './decision.js';
import { normalizeText, toPgVectorLiteral } from './vector.js';

const FLAG_PIM_SYNC = 'bulk.pim_sync.enabled';
const FLAG_SEMANTIC_DEDUP = 'bulk.semantic_dedup.enabled';
const FLAG_CONSENSUS = 'bulk.consensus.enabled';

type ShopifyTouchedProduct = Readonly<{
  shopify_product_id: string;
  shopify_gid: string;
  legacy_resource_id: number;
  title: string;
  vendor: string | null;
  gtin: string | null;
  updated_at_shopify: string | null;
}>;

type SimilarProductRow = Readonly<{
  product_id: string;
  similarity: number;
  title: string | null;
  brand: string | null;
}>;

export async function runPimSyncFromBulkRun(params: {
  shopId: string;
  bulkRunId: string;
  logger: Logger;
}): Promise<void> {
  const env = loadEnv();

  // Global kill switches first.
  if (!env.bulkPimSyncEnabled && !env.bulkSemanticDedupEnabled && !env.bulkConsensusEnabled) {
    return;
  }

  const [pimSyncEnabled, semanticEnabled, consensusEnabled] = await Promise.all([
    env.bulkPimSyncEnabled
      ? isFeatureFlagEnabled({ shopId: params.shopId, flagKey: FLAG_PIM_SYNC, fallback: false })
      : Promise.resolve(false),
    env.bulkSemanticDedupEnabled
      ? isFeatureFlagEnabled({
          shopId: params.shopId,
          flagKey: FLAG_SEMANTIC_DEDUP,
          fallback: false,
        })
      : Promise.resolve(false),
    env.bulkConsensusEnabled
      ? isFeatureFlagEnabled({ shopId: params.shopId, flagKey: FLAG_CONSENSUS, fallback: false })
      : Promise.resolve(false),
  ]);

  // PIM sync is the root feature: without it, we do not write into PIM at all.
  if (!pimSyncEnabled) {
    return;
  }

  const openAiConfig = await getShopOpenAiConfig({
    shopId: params.shopId,
    env,
    logger: params.logger,
  });
  if (!openAiConfig.enabled || !openAiConfig.openAiApiKey) {
    params.logger.info({ [OTEL_ATTR.SHOP_ID]: params.shopId }, 'OpenAI disabled for PIM sync');
    return;
  }

  const provider = createEmbeddingsProvider({
    openAiApiKey: openAiConfig.openAiApiKey,
    ...(openAiConfig.openAiBaseUrl ? { openAiBaseUrl: openAiConfig.openAiBaseUrl } : {}),
    openAiEmbeddingsModel: openAiConfig.openAiEmbeddingsModel,
    openAiTimeoutMs: env.openAiTimeoutMs,
  });

  const highThreshold = env.bulkDedupeHighThreshold;
  const suspiciousThreshold = env.bulkDedupeSuspiciousThreshold;
  const maxResults = env.bulkDedupeMaxResults;

  await withTenantContext(params.shopId, async (client) => {
    const sourceId = await ensureProdSource({
      client,
      name: 'shopify_bulk_import',
      sourceType: 'bulk_import',
      priority: 40,
      trustScore: 0.6,
    });

    const touched = await loadTouchedShopifyProducts({
      client,
      shopId: params.shopId,
      bulkRunId: params.bulkRunId,
    });

    if (touched.length === 0) {
      params.logger.info(
        { [OTEL_ATTR.SHOP_ID]: params.shopId, bulkRunId: params.bulkRunId },
        'PIM sync skipped (no touched products)'
      );
      return;
    }

    params.logger.info(
      {
        [OTEL_ATTR.SHOP_ID]: params.shopId,
        bulkRunId: params.bulkRunId,
        touchedProducts: touched.length,
        pimSyncEnabled,
        semanticEnabled,
        consensusEnabled,
        embeddingsProvider: provider.kind,
      },
      'PIM sync started'
    );

    // Preload existing channel mappings for the touched external IDs.
    const existingMappingsByExternalId = await loadExistingChannelMappings({
      client,
      shopId: params.shopId,
      externalIds: touched.map((t) => t.shopify_gid),
    });

    // Preload GTIN exact matches.
    const gtins = touched
      .map((t) => normalizeText(t.gtin) || null)
      .filter((g): g is string => Boolean(g));
    const prodByGtin = await loadProdMasterIdsByGtin({ client, gtins });

    // 1) Handle items already mapped or GTIN-linked.
    for (const p of touched) {
      if (existingMappingsByExternalId.has(p.shopify_gid)) continue;

      const gtin = normalizeText(p.gtin) || null;
      if (!gtin) continue;

      const matchId = prodByGtin.get(gtin);
      if (!matchId) continue;

      await upsertProdChannelMapping({
        client,
        shopId: params.shopId,
        externalId: p.shopify_gid,
        productId: matchId,
        channelMeta: {
          source: 'bulk_import',
          reason: 'gtin_exact_match',
          gtin,
        },
      });

      existingMappingsByExternalId.set(p.shopify_gid, matchId);

      if (consensusEnabled) {
        await enqueueConsensusJob({
          shopId: params.shopId,
          productId: matchId,
          trigger: 'batch',
        });
      }
    }

    // 2) Semantic dedup (Plan requirement: embed in batches of 100).
    const semanticCandidates = touched.filter((p) => {
      if (existingMappingsByExternalId.has(p.shopify_gid)) return false;
      const gtin = normalizeText(p.gtin) || null;
      if (gtin && prodByGtin.has(gtin)) return false;
      return true;
    });

    if (semanticEnabled && provider.isAvailable() && semanticCandidates.length > 0) {
      const batchSize = 100;

      for (let offset = 0; offset < semanticCandidates.length; offset += batchSize) {
        const batch = semanticCandidates.slice(offset, offset + batchSize);
        const batchTexts = batch.map((b) => {
          const t = normalizeText(b.title);
          const br = normalizeText(b.vendor);
          return `${t} ${br}`.trim();
        });

        let embeddings: readonly (readonly number[])[] = [];
        try {
          await enforceBudget({ provider: 'openai', shopId: params.shopId });
          embeddings = await provider.embedTexts(batchTexts);
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            params.logger.warn(
              { [OTEL_ATTR.SHOP_ID]: params.shopId, bulkRunId: params.bulkRunId, err: err.message },
              'OpenAI budget exceeded; stopping semantic dedup for remaining items'
            );
            break;
          }
          await insertBulkError({
            shopId: params.shopId,
            bulkRunId: params.bulkRunId,
            errorType: 'pim_embeddings_failed',
            errorCode: 'AI_6003',
            errorMessage: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);

          params.logger.warn(
            { [OTEL_ATTR.SHOP_ID]: params.shopId, bulkRunId: params.bulkRunId, err },
            'Embeddings provider failed; continuing with exact-match-only'
          );
          break; // fallback for remaining items
        }

        for (let i = 0; i < batch.length; i += 1) {
          const item = batch[i]!;
          const emb = embeddings[i];
          if (!emb) continue;

          // Persist per-tenant embeddings for Shopify products (builds future capability).
          await upsertShopProductEmbedding({
            client,
            shopId: params.shopId,
            shopifyProductId: item.shopify_product_id,
            embedding: emb,
            contentHash: sha256Hex(`${normalizeText(item.title)}|${normalizeText(item.vendor)}`),
            modelVersion: provider.model.name,
          });

          const matches = await findSimilarProducts({
            client,
            queryEmbedding: emb,
            similarityThreshold: suspiciousThreshold,
            maxResults,
          });

          const decision = decidePimTarget({
            existingChannelMappingProductId: null,
            gtinExactMatchProductId: null,
            semanticMatches: matches.map((m) => ({
              productId: m.product_id,
              similarity: m.similarity,
              title: m.title,
              brand: m.brand,
            })),
            thresholds: { highConfidence: highThreshold, suspicious: suspiciousThreshold },
          });

          if (decision.kind === 'use_existing') {
            await upsertProdChannelMapping({
              client,
              shopId: params.shopId,
              externalId: item.shopify_gid,
              productId: decision.productId,
              channelMeta: {
                source: 'bulk_import',
                reason: decision.reason,
                matched: matches.slice(0, 5),
              },
            });

            existingMappingsByExternalId.set(item.shopify_gid, decision.productId);

            if (consensusEnabled) {
              await enqueueConsensusJob({
                shopId: params.shopId,
                productId: decision.productId,
                trigger: 'batch',
              });
            }

            continue;
          }

          const gtin = normalizeText(item.gtin) || null;
          const internalSku = gtin
            ? `gtin:${gtin}`
            : `shopify:${params.shopId}:${String(item.legacy_resource_id)}`;

          const newId = await upsertProdMasterFromShopify({
            client,
            internalSku,
            canonicalTitle: normalizeText(item.title),
            brand: normalizeText(item.vendor) || null,
            gtin,
            primarySourceId: sourceId,
            dedupeStatus: decision.needsReview ? 'suspicious' : 'unique',
            needsReview: decision.needsReview,
            reviewNotes: decision.needsReview ? 'semantic_suspicious' : null,
          });

          await upsertProdChannelMapping({
            client,
            shopId: params.shopId,
            externalId: item.shopify_gid,
            productId: newId,
            channelMeta: { source: 'bulk_import', reason: decision.reason },
          });

          existingMappingsByExternalId.set(item.shopify_gid, newId);

          if (decision.needsReview) {
            const best = matches[0];
            if (best) {
              const clusterId = await createSuspiciousDedupeCluster({
                client,
                canonicalProductId: best.product_id,
                newProductId: newId,
                similarity: best.similarity,
                matchCriteria: {
                  method: 'semantic',
                  embedding_type: 'title_brand',
                  threshold: suspiciousThreshold,
                  similarity: best.similarity,
                },
                matchFields: {
                  title: normalizeText(item.title),
                  vendor: normalizeText(item.vendor),
                },
              });

              await markProdMasterSuspicious({
                client,
                productId: newId,
                clusterId,
                reviewNotes: JSON.stringify({
                  reason: decision.reason,
                  canonicalCandidateId: best.product_id,
                  similarity: best.similarity,
                  shopify: { gid: item.shopify_gid, updatedAtShopify: item.updated_at_shopify },
                }),
              });
            }
          }

          await upsertProdEmbedding({
            client,
            productId: newId,
            embeddingType: 'title_brand',
            embedding: emb,
            contentHash: sha256Hex(`${normalizeText(item.title)}|${normalizeText(item.vendor)}`),
            modelVersion: provider.model.name,
          });

          if (consensusEnabled) {
            await enqueueConsensusJob({
              shopId: params.shopId,
              productId: newId,
              trigger: 'batch',
            });
          }
        }
      }
    }

    // 3) Remaining items: exact-only create + optional mapping.
    for (const p of touched) {
      if (existingMappingsByExternalId.has(p.shopify_gid)) continue;

      const createdId = await upsertProdMasterFromShopify({
        client,
        internalSku: normalizeText(p.gtin)
          ? `gtin:${String(normalizeText(p.gtin))}`
          : `shopify:${params.shopId}:${String(p.legacy_resource_id)}`,
        canonicalTitle: normalizeText(p.title),
        brand: normalizeText(p.vendor) || null,
        gtin: normalizeText(p.gtin) || null,
        primarySourceId: sourceId,
        dedupeStatus: 'unique',
        needsReview: false,
        reviewNotes: null,
      });

      await upsertProdChannelMapping({
        client,
        shopId: params.shopId,
        externalId: p.shopify_gid,
        productId: createdId,
        channelMeta: { source: 'bulk_import', reason: 'created_exact_only' },
      });

      if (consensusEnabled) {
        await enqueueConsensusJob({
          shopId: params.shopId,
          productId: createdId,
          trigger: 'batch',
        });
      }
    }

    params.logger.info(
      { [OTEL_ATTR.SHOP_ID]: params.shopId, bulkRunId: params.bulkRunId },
      'PIM sync completed'
    );
  });
}

async function loadExistingChannelMappings(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  shopId: string;
  externalIds: readonly string[];
}): Promise<Map<string, string>> {
  if (params.externalIds.length === 0) return new Map();
  const res = await params.client.query<Readonly<{ external_id: string; product_id: string }>>(
    `SELECT external_id, product_id
     FROM prod_channel_mappings
     WHERE channel = 'shopify'
       AND shop_id = $1
       AND external_id = ANY($2::text[])`,
    [params.shopId, params.externalIds]
  );
  const map = new Map<string, string>();
  for (const r of res.rows) map.set(r.external_id, r.product_id);
  return map;
}

async function loadProdMasterIdsByGtin(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  gtins: readonly string[];
}): Promise<Map<string, string>> {
  if (params.gtins.length === 0) return new Map();
  const res = await params.client.query<Readonly<{ gtin: string; id: string }>>(
    `SELECT gtin, id
     FROM prod_master
     WHERE gtin = ANY($1::text[])`,
    [params.gtins]
  );
  const map = new Map<string, string>();
  for (const r of res.rows) map.set(r.gtin, r.id);
  return map;
}

async function loadTouchedShopifyProducts(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  shopId: string;
  bulkRunId: string;
}): Promise<readonly ShopifyTouchedProduct[]> {
  const res = await params.client.query<ShopifyTouchedProduct>(
    `SELECT
       p.id as shopify_product_id,
       p.shopify_gid,
       p.legacy_resource_id,
       p.title,
       p.vendor,
       p.updated_at_shopify,
       v.barcode as gtin
     FROM staging_products sp
     JOIN shopify_products p
       ON p.id = sp.target_product_id
     LEFT JOIN LATERAL (
       SELECT sv.barcode
       FROM shopify_variants sv
       WHERE sv.shop_id = $2
         AND sv.product_id = p.id
         AND sv.barcode IS NOT NULL
         AND sv.barcode <> ''
       ORDER BY sv.barcode
       LIMIT 1
     ) v ON true
     WHERE sp.bulk_run_id = $1
       AND sp.shop_id = $2
       AND sp.validation_status = 'valid'
       AND sp.merge_status = 'merged'`,
    [params.bulkRunId, params.shopId]
  );
  return res.rows;
}

async function ensureProdSource(params: {
  client: {
    query: (
      sql: string,
      values?: readonly unknown[]
    ) => Promise<{ rows: { id: string; priority: number | null }[] }>;
  };
  name: string;
  sourceType: string;
  priority: number;
  trustScore: number;
}): Promise<string> {
  const res = await params.client.query(
    `INSERT INTO prod_sources (name, source_type, priority, trust_score, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, now(), now())
     ON CONFLICT (name)
     DO UPDATE SET
       source_type = EXCLUDED.source_type,
       priority = EXCLUDED.priority,
       trust_score = EXCLUDED.trust_score,
       updated_at = now()
     RETURNING id`,
    [params.name, params.sourceType, params.priority, String(params.trustScore)]
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error('pim_source_upsert_failed');
  return id;
}

async function findSimilarProducts(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  queryEmbedding: readonly number[];
  similarityThreshold: number;
  maxResults: number;
}): Promise<readonly SimilarProductRow[]> {
  const vec = toPgVectorLiteral(params.queryEmbedding);
  const res = await params.client.query<SimilarProductRow>(
    `SELECT product_id, similarity, title, brand
     FROM find_similar_products($1::vector(2000), $2::float, $3::int)`,
    [vec, params.similarityThreshold, params.maxResults]
  );
  return res.rows;
}

async function upsertProdMasterFromShopify(params: {
  client: {
    query: (sql: string, values?: readonly unknown[]) => Promise<{ rows: { id: string }[] }>;
  };
  internalSku: string;
  canonicalTitle: string;
  brand: string | null;
  gtin: string | null;
  primarySourceId: string;
  dedupeStatus: 'unique' | 'merged' | 'suspicious' | 'pending';
  needsReview: boolean;
  reviewNotes: string | null;
}): Promise<string> {
  const res = await params.client.query(
    `INSERT INTO prod_master (
       internal_sku,
       canonical_title,
       brand,
       gtin,
       primary_source_id,
       dedupe_status,
       data_quality_level,
       needs_review,
       review_notes,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'bronze', $7, $8, now(), now())
     ON CONFLICT (internal_sku)
     DO UPDATE SET
       gtin = COALESCE(prod_master.gtin, EXCLUDED.gtin),
       dedupe_status = CASE
         WHEN prod_master.dedupe_status = 'suspicious' THEN prod_master.dedupe_status
         ELSE EXCLUDED.dedupe_status
       END,
       needs_review = (prod_master.needs_review OR EXCLUDED.needs_review),
       review_notes = COALESCE(EXCLUDED.review_notes, prod_master.review_notes),
       updated_at = now()
     RETURNING id`,
    [
      params.internalSku,
      params.canonicalTitle,
      params.brand,
      params.gtin,
      params.primarySourceId,
      params.dedupeStatus,
      params.needsReview,
      params.reviewNotes,
    ]
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error('pim_master_upsert_failed');
  return id;
}

async function markProdMasterSuspicious(params: {
  client: {
    query: (sql: string, values?: readonly unknown[]) => Promise<{ rows: { id: string }[] }>;
  };
  productId: string;
  clusterId: string;
  reviewNotes: string;
}): Promise<void> {
  await params.client.query(
    `UPDATE prod_master
     SET
       dedupe_status = 'suspicious',
       dedupe_cluster_id = $2,
       needs_review = true,
       review_notes = COALESCE(prod_master.review_notes, $3),
       data_quality_level = 'review_needed',
       updated_at = now()
     WHERE id = $1`,
    [params.productId, params.clusterId, params.reviewNotes]
  );
}

async function upsertProdChannelMapping(params: {
  client: { query: (sql: string, values?: readonly unknown[]) => Promise<unknown> };
  shopId: string;
  externalId: string;
  productId: string;
  channelMeta: Record<string, unknown>;
}): Promise<void> {
  await params.client.query(
    `INSERT INTO prod_channel_mappings (
       product_id,
       channel,
       shop_id,
       external_id,
       sync_status,
       last_pulled_at,
       channel_meta,
       created_at,
       updated_at
     )
     VALUES ($1, 'shopify', $2, $3, 'synced', now(), $4::jsonb, now(), now())
     ON CONFLICT (channel, shop_id, external_id)
     DO UPDATE SET
       product_id = EXCLUDED.product_id,
       sync_status = EXCLUDED.sync_status,
       last_pulled_at = EXCLUDED.last_pulled_at,
       channel_meta = (prod_channel_mappings.channel_meta || EXCLUDED.channel_meta),
       updated_at = now()`,
    [params.productId, params.shopId, params.externalId, JSON.stringify(params.channelMeta)]
  );
}

async function upsertProdEmbedding(params: {
  client: { query: (sql: string, values?: readonly unknown[]) => Promise<unknown> };
  productId: string;
  embeddingType: 'title_brand';
  embedding: readonly number[];
  contentHash: string;
  modelVersion: string;
}): Promise<void> {
  const vec = toPgVectorLiteral(params.embedding);
  // PR-047: Updated to vector(2000) with new columns
  await params.client.query(
    `INSERT INTO prod_embeddings (
       product_id,
       variant_id,
       embedding_type,
       embedding,
       content_hash,
       model_version,
       dimensions,
       quality_level,
       source,
       lang,
       created_at,
       updated_at
     )
     VALUES ($1, NULL, $2, $3::vector(2000), $4, $5, 2000, 'bronze', 'shopify', 'ro', now(), now())
     ON CONFLICT (product_id, variant_id, quality_level, embedding_type)
     DO UPDATE SET
       embedding = EXCLUDED.embedding,
       content_hash = EXCLUDED.content_hash,
       model_version = EXCLUDED.model_version,
       updated_at = now()`,
    [params.productId, params.embeddingType, vec, params.contentHash, params.modelVersion]
  );
}

async function upsertShopProductEmbedding(params: {
  client: { query: (sql: string, values?: readonly unknown[]) => Promise<unknown> };
  shopId: string;
  shopifyProductId: string;
  embedding: readonly number[];
  contentHash: string;
  modelVersion: string;
}): Promise<void> {
  const vec = toPgVectorLiteral(params.embedding);
  // PR-047: Updated to vector(2000) with new columns
  await params.client.query(
    `INSERT INTO shop_product_embeddings (
       shop_id,
       product_id,
       embedding_type,
       embedding,
       content_hash,
       model_version,
       dimensions,
       quality_level,
       source,
       lang,
       status,
       generated_at,
       created_at,
       updated_at
     )
     VALUES ($1, $2, 'combined', $3::vector(2000), $4, $5, 2000, 'bronze', 'shopify', 'ro', 'ready', now(), now(), now())
    ON CONFLICT (shop_id, product_id, content_hash, embedding_type, model_version)
     DO UPDATE SET
       embedding = EXCLUDED.embedding,
       content_hash = EXCLUDED.content_hash,
       quality_level = EXCLUDED.quality_level,
       status = 'ready',
       generated_at = now(),
       updated_at = now()`,
    [params.shopId, params.shopifyProductId, vec, params.contentHash, params.modelVersion]
  );
}
