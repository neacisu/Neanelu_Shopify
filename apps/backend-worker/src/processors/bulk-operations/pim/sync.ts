import { sha256Hex } from '@app/ai-engine';
import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import { OTEL_ATTR, type Logger } from '@app/logger';
import { BudgetExceededError, enforceBudget } from '@app/pim';
import { resolveEmbeddingsProvider } from '../../../services/ai-provider-routing.js';

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

// Maximum products processed in a single DB write transaction.
// Keeps each transaction short (< 5s) even under load.
const WRITE_BATCH_SIZE = 500;

export async function runPimSyncFromBulkRun(params: {
  shopId: string;
  bulkRunId: string;
  logger: Logger;
  limit?: number;
  onProgress?: (processed: number, total: number) => void;
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

  const provider = await resolveEmbeddingsProvider({
    shopId: params.shopId,
    env,
    logger: params.logger,
  });

  const highThreshold = env.bulkDedupeHighThreshold;
  const suspiciousThreshold = env.bulkDedupeSuspiciousThreshold;
  const maxResults = env.bulkDedupeMaxResults;
  const requestedLimit =
    typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0
      ? Math.floor(params.limit)
      : null;

  // ── Tx 1: Ensure prod_source row exists (idempotent upsert, short tx) ──
  const sourceId = await withTenantContext(params.shopId, (client) =>
    ensureProdSource({
      client,
      name: 'shopify_bulk_import',
      sourceType: 'bulk_import',
      priority: 40,
      trustScore: 0.6,
    })
  );

  const totalTouchedProducts = await withTenantContext(params.shopId, (client) =>
    countTouchedShopifyProducts({
      client,
      shopId: params.shopId,
      bulkRunId: params.bulkRunId,
    })
  );

  if (totalTouchedProducts === 0) {
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
      touchedProducts: totalTouchedProducts,
      pimSyncEnabled,
      semanticEnabled,
      consensusEnabled,
      embeddingsProvider: provider.kind,
    },
    'PIM sync started'
  );

  const PAGE_SIZE = 10_000;
  const progressTotal =
    requestedLimit !== null ? Math.min(requestedLimit, totalTouchedProducts) : totalTouchedProducts;

  let pageOffset = 0;
  let processedTouched = 0;
  let remainingProcessed = 0;

  while (true) {
    if (requestedLimit !== null && processedTouched >= requestedLimit) break;
    const remainingLimit =
      requestedLimit !== null ? Math.max(0, requestedLimit - processedTouched) : PAGE_SIZE;
    const pageLimit = Math.min(PAGE_SIZE, remainingLimit);
    if (pageLimit <= 0) break;

    const touched = await withTenantContext(params.shopId, (client) =>
      loadTouchedShopifyProducts({
        client,
        shopId: params.shopId,
        bulkRunId: params.bulkRunId,
        limit: pageLimit,
        offset: pageOffset,
      })
    );
    if (touched.length === 0) break;

    // ── Tx 3: Preload existing channel mappings per page (read-only, short tx) ──
    const existingMappingsByExternalId = await withTenantContext(params.shopId, (client) =>
      loadExistingChannelMappings({
        client,
        shopId: params.shopId,
        externalIds: touched.map((t) => t.shopify_gid),
      })
    );

    // ── Tx 4: Preload GTIN map per page (read-only, short tx) ──
    const gtins = touched
      .map((t) => normalizeText(t.gtin) || null)
      .filter((g): g is string => Boolean(g));
    const prodByGtin = await withTenantContext(params.shopId, (client) =>
      loadProdMasterIdsByGtin({ client, gtins })
    );

    // ── Pass 1: GTIN exact-match linking ──
    for (let batchStart = 0; batchStart < touched.length; batchStart += WRITE_BATCH_SIZE) {
      const chunk = touched.slice(batchStart, batchStart + WRITE_BATCH_SIZE);
      await withTenantContext(params.shopId, async (client) => {
        for (const p of chunk) {
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
            channelMeta: { source: 'bulk_import', reason: 'gtin_exact_match', gtin },
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
      });
    }

    // ── Pass 2: Semantic deduplication ──
    if (semanticEnabled && provider.isAvailable()) {
      const semanticCandidates = touched.filter((p) => {
        if (existingMappingsByExternalId.has(p.shopify_gid)) return false;
        const gtin = normalizeText(p.gtin) || null;
        if (gtin && prodByGtin.has(gtin)) return false;
        return true;
      });

      const EMBED_BATCH = 100;
      for (let offset = 0; offset < semanticCandidates.length; offset += EMBED_BATCH) {
        const batch = semanticCandidates.slice(offset, offset + EMBED_BATCH);
        const batchTexts = batch.map((b) =>
          `${normalizeText(b.title)} ${normalizeText(b.vendor)}`.trim()
        );

        let embeddings: readonly (readonly number[])[];
        try {
          await enforceBudget({ provider: 'openai', shopId: params.shopId });
          embeddings = await provider.embedTexts(batchTexts);
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            params.logger.warn(
              {
                [OTEL_ATTR.SHOP_ID]: params.shopId,
                bulkRunId: params.bulkRunId,
                err: err.message,
              },
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
          break;
        }

        await withTenantContext(params.shopId, async (client) => {
          for (let i = 0; i < batch.length; i += 1) {
            const item = batch[i]!;
            const emb = embeddings[i];
            if (!emb) continue;

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
              modelVersion: provider.model.name,
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
        });
      }
    }

    // ── Pass 3: Remaining items (no semantic match / semantic disabled) ──
    for (let batchStart = 0; batchStart < touched.length; batchStart += WRITE_BATCH_SIZE) {
      const chunk = touched.slice(batchStart, batchStart + WRITE_BATCH_SIZE);
      const remainingChunk = chunk.filter((p) => !existingMappingsByExternalId.has(p.shopify_gid));
      if (remainingChunk.length === 0) continue;

      const createdMappings = await withTenantContext(params.shopId, async (client) =>
        batchUpsertRemainingItems({
          client,
          shopId: params.shopId,
          sourceId,
          items: remainingChunk,
        })
      );

      for (const row of createdMappings) {
        existingMappingsByExternalId.set(row.external_id, row.product_id);
        remainingProcessed += 1;
        if (consensusEnabled) {
          await enqueueConsensusJob({
            shopId: params.shopId,
            productId: row.product_id,
            trigger: 'batch',
          });
        }
      }
    }

    processedTouched += touched.length;
    pageOffset += touched.length;
    params.onProgress?.(Math.min(processedTouched, progressTotal), progressTotal);

    if (touched.length < pageLimit) {
      break;
    }
  }

  params.logger.info(
    {
      [OTEL_ATTR.SHOP_ID]: params.shopId,
      bulkRunId: params.bulkRunId,
      total: progressTotal,
      remainingCreated: remainingProcessed,
    },
    'PIM sync completed'
  );
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
  limit?: number;
  offset?: number;
}): Promise<readonly ShopifyTouchedProduct[]> {
  const hasLimit =
    typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0;
  const hasOffset =
    typeof params.offset === 'number' && Number.isFinite(params.offset) && params.offset >= 0;
  const queryValues: unknown[] = [params.bulkRunId, params.shopId];
  let limitSql = '';
  let offsetSql = '';
  if (hasLimit) {
    queryValues.push(Math.floor(params.limit!));
    limitSql = `LIMIT $${queryValues.length}`;
  }
  if (hasOffset) {
    queryValues.push(Math.floor(params.offset!));
    offsetSql = `OFFSET $${queryValues.length}`;
  }
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
       AND sp.merge_status = 'merged'
     ORDER BY p.id ASC
     ${limitSql}
     ${offsetSql}`,
    queryValues
  );
  return res.rows;
}

async function countTouchedShopifyProducts(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  shopId: string;
  bulkRunId: string;
}): Promise<number> {
  const res = await params.client.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total
     FROM staging_products sp
     WHERE sp.bulk_run_id = $1
       AND sp.shop_id = $2
       AND sp.validation_status = 'valid'
       AND sp.merge_status = 'merged'`,
    [params.bulkRunId, params.shopId]
  );
  return res.rows[0]?.total ?? 0;
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
  modelVersion?: string;
}): Promise<readonly SimilarProductRow[]> {
  const vec = toPgVectorLiteral(params.queryEmbedding);
  const res = await params.client.query<SimilarProductRow>(
    `SELECT
       f.product_id,
       f.similarity,
       pm.canonical_title as title,
       pm.brand
    FROM find_similar_products($1::vector(2000), $2::float, $3::int, $4::varchar) f
     LEFT JOIN prod_master pm
       ON pm.id = f.product_id`,
    [vec, params.similarityThreshold, params.maxResults, params.modelVersion ?? null]
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

type BatchUpsertCreatedMapping = Readonly<{
  product_id: string;
  external_id: string;
}>;

async function batchUpsertRemainingItems(params: {
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  };
  shopId: string;
  sourceId: string;
  items: readonly ShopifyTouchedProduct[];
}): Promise<readonly BatchUpsertCreatedMapping[]> {
  if (params.items.length === 0) return [];

  const internalSkus = params.items.map((p) => {
    const normalizedGtin = normalizeText(p.gtin);
    return normalizedGtin
      ? `gtin:${String(normalizedGtin)}`
      : `shopify:${params.shopId}:${String(p.legacy_resource_id)}`;
  });
  const titles = params.items.map((p) => normalizeText(p.title));
  const brands = params.items.map((p) => normalizeText(p.vendor) || null);
  const gtins = params.items.map((p) => normalizeText(p.gtin) || null);
  const externalIds = params.items.map((p) => p.shopify_gid);

  const res = await params.client.query<BatchUpsertCreatedMapping>(
    `WITH incoming AS (
       SELECT *
       FROM unnest(
         $1::text[],
         $2::text[],
         $3::text[],
         $4::text[],
         $5::text[]
       ) AS t(internal_sku, canonical_title, brand, gtin, external_id)
     ),
     upserted_master AS (
       INSERT INTO prod_master (
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
       SELECT
         i.internal_sku,
         i.canonical_title,
         i.brand,
         i.gtin,
         $6,
         'unique',
         'bronze',
         false,
         NULL,
         now(),
         now()
       FROM incoming i
       ON CONFLICT (internal_sku) DO UPDATE SET
         gtin = COALESCE(prod_master.gtin, EXCLUDED.gtin),
         brand = COALESCE(prod_master.brand, EXCLUDED.brand),
         updated_at = now()
       RETURNING id, internal_sku
     )
     INSERT INTO prod_channel_mappings (
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
     SELECT
       um.id,
       'shopify',
       $7,
       i.external_id,
       'synced',
       now(),
       '{"source":"bulk_import","reason":"created_exact_only"}'::jsonb,
       now(),
       now()
     FROM upserted_master um
     JOIN incoming i
       ON i.internal_sku = um.internal_sku
     ON CONFLICT (channel, shop_id, external_id) DO UPDATE SET
       product_id = EXCLUDED.product_id,
       sync_status = 'synced',
       last_pulled_at = now(),
       channel_meta = (prod_channel_mappings.channel_meta || EXCLUDED.channel_meta),
       updated_at = now()
     RETURNING product_id, external_id`,
    [internalSkus, titles, brands, gtins, externalIds, params.sourceId, params.shopId]
  );
  return res.rows;
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
