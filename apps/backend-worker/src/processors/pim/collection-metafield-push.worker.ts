import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { shopifyApi } from '../../shopify/client.js';
import {
  PIM_COLLECTION_METAFIELD_PUSH_JOB,
  PIM_COLLECTION_METAFIELD_PUSH_QUEUE_NAME,
} from '../../queue/collection-metafield-push-queue.js';

type CollectionMetafieldPushPayload = Readonly<{
  shopId: string;
  collectionId: string;
  trigger: 'category_classifier' | 'manual';
}>;

type CollectionRow = Readonly<{
  id: string;
  shopify_gid: string;
}>;

type TaxonomySchemaRow = Readonly<{
  attr_code: string;
  shopify_namespace: string;
  shopify_key: string;
  shopify_type: string;
}>;

type ProductSpecsRow = Readonly<{
  specs: Record<string, unknown> | null;
}>;

type MetafieldsSetResponse = Readonly<{
  metafieldsSet?: Readonly<{
    userErrors?: readonly Readonly<{ message?: string | null }>[] | null;
  }> | null;
}>;

type MetafieldsSetInput = Readonly<{
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}>;

export interface CollectionMetafieldPushWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startCollectionMetafieldPushWorker(
  logger: Logger
): CollectionMetafieldPushWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_COLLECTION_METAFIELD_PUSH_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('pim-collection-metafield-push-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });
          try {
            if (job.name !== PIM_COLLECTION_METAFIELD_PUSH_JOB) {
              throw new Error(`unknown_collection_metafield_push_job:${job.name}`);
            }

            const payload = job.data as CollectionMetafieldPushPayload | null;
            if (!payload?.shopId || !payload.collectionId) {
              throw new Error('invalid_collection_metafield_push_payload');
            }

            await processCollectionMetafieldPush(payload, logger);
          } finally {
            clearWorkerCurrentJob('pim-collection-metafield-push-worker');
          }
        }),
    }
  );
  return { worker, close: async () => await worker.close() };
}

async function processCollectionMetafieldPush(
  payload: CollectionMetafieldPushPayload,
  logger: Logger
): Promise<void> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const [collection, schema, productSpecs] = await withTenantContext(
    payload.shopId,
    async (client) => {
      const collectionRes = await client.query<CollectionRow>(
        `SELECT id, shopify_gid
       FROM shopify_collections
       WHERE id = $1
         AND shop_id = $2
       LIMIT 1`,
        [payload.collectionId, payload.shopId]
      );

      const schemaRes = await client.query<TaxonomySchemaRow>(
        `SELECT s.attr_code, s.shopify_namespace, s.shopify_key, s.shopify_type
       FROM pim_taxonomy_collection_map m
       JOIN pim_taxonomy_metafield_schema s
         ON s.taxonomy_id = m.taxonomy_id
       WHERE m.shop_id = $1
         AND m.collection_id = $2`,
        [payload.shopId, payload.collectionId]
      );

      const specsRes = await client.query<ProductSpecsRow>(
        `SELECT psn.specs
       FROM shopify_collection_products scp
       JOIN shopify_products sp
         ON sp.id = scp.product_id
        AND sp.shop_id = scp.shop_id
       JOIN prod_channel_mappings pcm
         ON pcm.channel = 'shopify'
        AND pcm.shop_id = scp.shop_id
        AND pcm.external_id = sp.shopify_gid
       JOIN prod_specs_normalized psn
         ON psn.product_id = pcm.product_id
        AND psn.is_current = true
       WHERE scp.shop_id = $1
         AND scp.collection_id = $2`,
        [payload.shopId, payload.collectionId]
      );

      return [collectionRes.rows[0] ?? null, schemaRes.rows, specsRes.rows] as const;
    }
  );

  if (!collection?.shopify_gid || schema.length === 0) {
    return;
  }

  const aggregated: Record<string, string[]> = {};
  for (const row of productSpecs) {
    const specs = row.specs ?? {};
    for (const mapping of schema) {
      const raw = specs[mapping.attr_code];
      if (raw === null || raw === undefined) continue;
      const values = Array.isArray(raw)
        ? raw.map((v) => String(v))
        : [typeof raw === 'string' ? raw : JSON.stringify(raw)];
      for (const value of values) {
        const normalized = value.trim();
        if (!normalized) continue;
        aggregated[mapping.attr_code] ??= [];
        if (!aggregated[mapping.attr_code]!.includes(normalized)) {
          aggregated[mapping.attr_code]!.push(normalized);
        }
      }
    }
  }

  const metafields: MetafieldsSetInput[] = [];
  for (const mapping of schema) {
    const values = aggregated[mapping.attr_code] ?? [];
    if (values.length === 0) continue;
    const value = mapping.shopify_type.startsWith('list.') ? JSON.stringify(values) : values[0]!;
    metafields.push({
      ownerId: collection.shopify_gid,
      namespace: mapping.shopify_namespace,
      key: mapping.shopify_key,
      type: mapping.shopify_type,
      value,
    });
  }

  if (metafields.length === 0) {
    return;
  }

  const mutation = `#graphql
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          message
        }
      }
    }`;

  const response = await withTokenRetry(
    payload.shopId,
    encryptionKey,
    logger,
    async (accessToken, shopDomain) => {
      const client = shopifyApi.createClient({ shopDomain, accessToken });
      return await client.request<MetafieldsSetResponse>(mutation, { metafields });
    }
  );

  const userErrors = response.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    const message = userErrors
      .map((e) => e.message)
      .filter(Boolean)
      .join('; ');
    throw new Error(message || 'collection_metafield_push_failed');
  }

  await withTenantContext(payload.shopId, async (client) => {
    await client.query(
      `UPDATE shopify_collections
       SET metafields = COALESCE(metafields, '{}'::jsonb) || $3::jsonb,
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [
        payload.collectionId,
        payload.shopId,
        JSON.stringify(
          Object.fromEntries(
            metafields.map((m) => [`${m.namespace}.${m.key}`, { type: m.type, value: m.value }])
          )
        ),
      ]
    );
  });
}
