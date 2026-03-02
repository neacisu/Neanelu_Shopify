import { createEmbeddingsProvider } from '@app/ai-engine';
import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { getShopOpenAiConfig } from '../../runtime/openai-config.js';
import {
  PIM_CATEGORY_CLASSIFIER_JOB,
  PIM_CATEGORY_CLASSIFIER_QUEUE_NAME,
} from '../../queue/category-classifier-queue.js';
import { enqueueCollectionMetafieldPushJob } from '../../queue/collection-metafield-push-queue.js';
import { loadXAICredentials } from '../../services/xai-credentials.js';
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

type XaiCredentials = Readonly<{
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokensPerRequest: number;
}>;

type XaiResponse = Readonly<{
  choices?: readonly Readonly<{
    message?: Readonly<{
      content?: string | null;
    }> | null;
  }>[];
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
  const openAiConfig = await getShopOpenAiConfig({
    shopId: payload.shopId,
    env,
    logger,
  });
  if (!openAiConfig.enabled || !openAiConfig.openAiApiKey) {
    return;
  }

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
  if (!product) return;

  const provider = createEmbeddingsProvider({
    openAiApiKey: openAiConfig.openAiApiKey,
    ...(openAiConfig.openAiBaseUrl ? { openAiBaseUrl: openAiConfig.openAiBaseUrl } : {}),
    openAiEmbeddingsModel: openAiConfig.openAiEmbeddingsModel,
    openAiTimeoutMs: env.openAiTimeoutMs,
  });
  if (!provider.isAvailable()) {
    return;
  }

  const classificationText = buildClassificationText(product);
  if (!classificationText) {
    return;
  }

  let selectedTaxonomyId: string | null = null;
  let selectedMethod: 'embedding' | 'llm' | 'manual' = 'manual';
  let selectedConfidence: number | null = null;

  const [embedding] = await provider.embedTexts([classificationText]);
  if (embedding && embedding.length > 0) {
    const candidates = await withTenantContext(payload.shopId, async (client) => {
      return await findTaxonomyByEmbedding(client, embedding);
    });
    const top = candidates[0];
    if (top && top.similarity >= EMBEDDING_CONFIDENCE_THRESHOLD) {
      selectedTaxonomyId = top.id;
      selectedMethod = 'embedding';
      selectedConfidence = Number(top.similarity.toFixed(2));
    } else {
      const xaiResult = await classifyWithXaiFallback({
        shopId: payload.shopId,
        classificationText,
        options: candidates.slice(0, 15),
        encryptionKeyHex: env.encryptionKeyHex,
      });
      if (xaiResult) {
        selectedTaxonomyId = xaiResult.taxonomyId;
        selectedMethod = 'llm';
        selectedConfidence = xaiResult.confidence;
      }
    }
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

        await enqueueCollectionMetafieldPushJob({
          shopId: payload.shopId,
          collectionId,
          trigger: 'category_classifier',
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
  embedding: readonly number[]
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
     ORDER BY embedding <=> $1::vector(2000)
     LIMIT 25`,
    [vec]
  );
  return res.rows;
}

async function classifyWithXaiFallback(params: {
  shopId: string;
  classificationText: string;
  options: readonly TaxonomyCandidate[];
  encryptionKeyHex: string;
}): Promise<{ taxonomyId: string; confidence: number } | null> {
  if (params.options.length === 0) return null;
  const creds = (await loadXAICredentials({
    shopId: params.shopId,
    encryptionKeyHex: params.encryptionKeyHex,
  })) as XaiCredentials | null;
  if (!creds?.apiKey) return null;

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

  const response = await fetch(`${creds.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: creds.model,
      temperature: creds.temperature,
      max_tokens: Math.max(200, Math.min(creds.maxTokensPerRequest, 1200)),
      messages: [
        {
          role: 'system',
          content: 'Esti un clasificator de taxonomie produse. Raspunzi doar JSON valid.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as XaiResponse;
  const raw = payload.choices?.[0]?.message?.content?.trim() ?? '';
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
