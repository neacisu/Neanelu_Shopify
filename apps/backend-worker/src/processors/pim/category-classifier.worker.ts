import { loadEnv, type AppEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import {
  PIM_CATEGORY_CLASSIFIER_JOB,
  PIM_CATEGORY_CLASSIFIER_QUEUE_NAME,
} from '../../queue/category-classifier-queue.js';
import { upsertTaxonomyAssignPendingChange } from '../../services/collection-pending-changes.js';
import { buildTaxonomyAssignPendingMetadata } from '../../services/collection-sync-back-metadata.js';
import { resolveEmbeddingsProvider } from '../../services/ai-provider-routing.js';
import { consensusChatCompletion } from '../../services/consensus-engine.js';
import { normalizeText, toPgVectorLiteral } from '../bulk-operations/pim/vector.js';

type CategoryClassifierPayload = Readonly<{
  shopId: string;
  productId: string;
  trigger: 'consensus' | 'manual';
}>;

type TaxonomyCandidate = Readonly<{
  id: string;
  name: string;
  slug: string;
  similarity: number;
}>;

type ProductContext = Readonly<{
  id: string;
  canonical_title: string | null;
  brand: string | null;
  specs: Record<string, unknown> | null;
}>;

const EMBEDDING_CONFIDENCE_THRESHOLD = 0.82;
const FALLBACK_CONFIDENCE = 0.65;

export interface CategoryClassifierWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startCategoryClassifierWorker(logger: Logger): CategoryClassifierWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_CATEGORY_CLASSIFIER_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('pim-category-classifier-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });
          try {
            if (job.name !== PIM_CATEGORY_CLASSIFIER_JOB) {
              throw new Error(`unknown_category_classifier_job:${job.name}`);
            }

            const payload = job.data as CategoryClassifierPayload | null;
            if (!payload?.shopId || !payload.productId) {
              throw new Error('invalid_category_classifier_payload');
            }

            await processCategoryClassification(payload, logger);
          } finally {
            clearWorkerCurrentJob('pim-category-classifier-worker');
          }
        }),
    }
  );

  return { worker, close: async () => await worker.close() };
}

async function processCategoryClassification(
  payload: CategoryClassifierPayload,
  logger: Logger
): Promise<void> {
  const env = loadEnv();
  const startedAt = Date.now();
  logger.info(
    { productId: payload.productId, shopId: payload.shopId, trigger: payload.trigger },
    'category_classification_started'
  );

  const product = await withTenantContext(payload.shopId, async (client) => {
    const res = await client.query<ProductContext>(
      `SELECT pm.id,
              pm.canonical_title,
              pm.brand,
              psn.specs
       FROM prod_master pm
       LEFT JOIN prod_specs_normalized psn
         ON psn.product_id = pm.id
        AND psn.is_current = true
       WHERE pm.id = $1
       LIMIT 1`,
      [payload.productId]
    );
    return res.rows[0] ?? null;
  });
  if (!product) {
    logger.warn(
      { productId: payload.productId, shopId: payload.shopId },
      'category_classification_product_not_found'
    );
    return;
  }

  const provider = await resolveEmbeddingsProvider({
    shopId: payload.shopId,
    env,
    logger,
  });
  if (!provider.isAvailable()) {
    logger.warn(
      {
        productId: payload.productId,
        shopId: payload.shopId,
        reason: 'embeddings_provider_unavailable',
      },
      'category_classification_provider_unavailable'
    );
    return;
  }

  const classificationText = buildClassificationText(product);
  if (!classificationText) {
    logger.warn(
      { productId: payload.productId, title: product.canonical_title },
      'category_classification_text_empty'
    );
    return;
  }

  let selectedTaxonomyId: string | null = null;
  let selectedMethod: 'embedding' | 'llm' | 'manual' = 'manual';
  let selectedConfidence: number | null = null;

  const embedStartedAt = Date.now();
  const [embedding] = await provider.embedTexts([classificationText]);
  if (embedding && embedding.length > 0) {
    logger.info(
      {
        productId: payload.productId,
        embeddingDims: embedding.length,
        durationMs: Date.now() - embedStartedAt,
      },
      'category_classification_embedding_generated'
    );
    const candidates = await withTenantContext(payload.shopId, async (client) => {
      return await findTaxonomyByEmbedding(client, embedding, provider.model.name);
    });
    const top = candidates[0];
    if (top && top.similarity >= EMBEDDING_CONFIDENCE_THRESHOLD) {
      selectedTaxonomyId = top.id;
      selectedMethod = 'embedding';
      selectedConfidence = Number(top.similarity.toFixed(2));
      logger.info(
        {
          productId: payload.productId,
          taxonomyId: top.id,
          taxonomyName: top.name,
          similarity: top.similarity,
          method: 'embedding',
        },
        'category_classification_embedding_match'
      );
    } else {
      logger.info(
        {
          productId: payload.productId,
          topSimilarity: top?.similarity ?? 0,
          candidateCount: candidates.length,
        },
        'category_classification_llm_fallback_triggered'
      );
      const xaiResult = await classifyWithLLMFallback({
        shopId: payload.shopId,
        classificationText,
        options: candidates.slice(0, 15),
        env,
        logger,
      });
      if (xaiResult) {
        selectedTaxonomyId = xaiResult.taxonomyId;
        selectedMethod = 'llm';
        selectedConfidence = xaiResult.confidence;
        logger.info(
          {
            productId: payload.productId,
            taxonomyId: xaiResult.taxonomyId,
            confidence: xaiResult.confidence,
            method: 'llm',
          },
          'category_classification_llm_result'
        );
      } else {
        logger.warn(
          { productId: payload.productId, topSimilarity: top?.similarity ?? 0 },
          'category_classification_no_match'
        );
      }
    }
  } else {
    logger.warn(
      {
        productId: payload.productId,
        embeddingDims: 0,
        textLength: classificationText.length,
        durationMs: Date.now() - embedStartedAt,
      },
      'category_classification_embedding_empty'
    );
  }

  await withTenantContext(payload.shopId, async (client) => {
    if (selectedTaxonomyId) {
      await client.query(
        `UPDATE prod_master
         SET taxonomy_id = $2,
             taxonomy_ai_confidence = $3,
             taxonomy_ai_status = 'pending',
             taxonomy_ai_method = $4,
             updated_at = now()
         WHERE id = $1`,
        [payload.productId, selectedTaxonomyId, selectedConfidence, selectedMethod]
      );

      const mapping = await client.query<{ collection_id: string }>(
        `SELECT collection_id
         FROM pim_taxonomy_collection_map
         WHERE shop_id = $1
           AND taxonomy_id = $2
         ORDER BY is_primary DESC, created_at ASC
         LIMIT 1`,
        [payload.shopId, selectedTaxonomyId]
      );
      const collectionId = mapping.rows[0]?.collection_id ?? null;

      if (collectionId) {
        await client.query(
          `INSERT INTO shopify_collection_products (shop_id, collection_id, product_id, position, created_at, updated_at)
           SELECT $1, $2, sp.id, 0, now(), now()
           FROM prod_channel_mappings pcm
           JOIN shopify_products sp
             ON sp.shop_id = pcm.shop_id
            AND sp.shopify_gid = pcm.external_id
           WHERE pcm.channel = 'shopify'
             AND pcm.shop_id = $1
             AND pcm.product_id = $3
           ON CONFLICT (collection_id, product_id) DO NOTHING`,
          [payload.shopId, collectionId, payload.productId]
        );

        const metadata = await buildTaxonomyAssignPendingMetadata({
          shopId: payload.shopId,
          collectionId,
          taxonomyId: selectedTaxonomyId,
        });
        await upsertTaxonomyAssignPendingChange(client, {
          shopId: payload.shopId,
          collectionId,
          metadata,
          source: 'sync',
        });
      }
      return;
    }

    await client.query(
      `UPDATE prod_master
       SET taxonomy_ai_confidence = NULL,
           taxonomy_ai_status = 'manual',
           taxonomy_ai_method = 'manual',
           updated_at = now()
       WHERE id = $1`,
      [payload.productId]
    );
  });
  logger.info(
    {
      productId: payload.productId,
      shopId: payload.shopId,
      selectedMethod,
      selectedTaxonomyId,
      selectedConfidence,
      totalDurationMs: Date.now() - startedAt,
    },
    'category_classification_completed'
  );
}

function buildClassificationText(product: ProductContext): string {
  const title = normalizeText(product.canonical_title);
  const brand = normalizeText(product.brand);
  const specs = product.specs && typeof product.specs === 'object' ? product.specs : {};
  const specsText = Object.entries(specs)
    .slice(0, 25)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' | ');
  return [title, brand, specsText]
    .filter((x) => x && x.length > 0)
    .join(' ')
    .trim();
}

async function findTaxonomyByEmbedding(
  client: {
    query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
  },
  embedding: readonly number[],
  modelVersion: string
): Promise<readonly TaxonomyCandidate[]> {
  const vec = toPgVectorLiteral(embedding);
  const res = await client.query<TaxonomyCandidate>(
    `SELECT id,
            name,
            slug,
            (1 - (embedding <=> $1::vector(2000)))::float AS similarity
     FROM prod_taxonomy
     WHERE is_active = true
       AND embedding IS NOT NULL
       AND (model_version IS NULL OR model_version = $2)
     ORDER BY embedding <=> $1::vector(2000)
     LIMIT 25`,
    [vec, modelVersion]
  );
  return res.rows;
}

async function classifyWithLLMFallback(params: {
  shopId: string;
  classificationText: string;
  options: readonly TaxonomyCandidate[];
  env: AppEnv;
  logger: Logger;
}): Promise<{ taxonomyId: string; confidence: number } | null> {
  if (params.options.length === 0) return null;

  const optionsBlock = params.options.map((o) => `- ${o.id} | ${o.name} | ${o.slug}`).join('\n');
  const prompt = [
    'Alege exact un taxonomyId din lista data.',
    'Raspunde STRICT JSON: {"taxonomyId":"...","confidence":0.00}',
    'Nu inventa taxonomyId in afara listei.',
    '',
    `Produs: ${params.classificationText}`,
    'Optiuni:',
    optionsBlock,
  ].join('\n');
  const consensus = await consensusChatCompletion<{
    taxonomyId?: string;
    confidence?: number;
  }>({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
    taskType: 'classification',
    systemPrompt: 'Esti un clasificator de taxonomie produse. Raspunzi doar JSON valid.',
    userPrompt: prompt,
    responseFormat: { type: 'json_object' },
    keyField: 'taxonomyId',
    maxTokens: 300,
  }).catch(() => null);
  if (!consensus) return null;

  const raw = JSON.stringify(consensus.result).trim();
  if (!raw) return null;

  const extracted = extractJsonObject(raw);
  if (!extracted) return null;

  const taxonomyId =
    typeof extracted['taxonomyId'] === 'string' ? String(extracted['taxonomyId']) : null;
  if (!taxonomyId) return null;
  const validIds = new Set(params.options.map((o) => o.id));
  if (!validIds.has(taxonomyId)) return null;

  const confidenceRaw = extracted['confidence'];
  const confidenceNum =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? confidenceRaw
      : FALLBACK_CONFIDENCE;
  const confidence = Math.max(0.01, Math.min(0.99, Number(confidenceNum.toFixed(2))));
  return { taxonomyId, confidence };
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    // ignore and try to recover fenced JSON
  }

  const match = /\{[\s\S]*\}/.exec(trimmed);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
