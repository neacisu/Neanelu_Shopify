import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { shopifyApi } from '../../shopify/client.js';
import {
  PIM_METAFIELD_PUSH_JOB,
  PIM_METAFIELD_PUSH_QUEUE_NAME,
} from '../../queue/metafield-push-queue.js';

type MetafieldPushPayload = Readonly<{
  shopId: string;
  productId: string;
  trigger: 'consensus' | 'manual';
}>;

type ProductDataRow = Readonly<{
  product_id: string;
  shopify_product_gid: string | null;
  specs: Record<string, unknown> | null;
}>;

type MappingRow = Readonly<{
  shop_id: string | null;
  attr_code: string;
  shopify_namespace: string;
  shopify_key: string;
  shopify_type: string;
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

export interface MetafieldPushWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startMetafieldPushWorker(logger: Logger): MetafieldPushWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_METAFIELD_PUSH_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('pim-metafield-push-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });
          try {
            if (job.name !== PIM_METAFIELD_PUSH_JOB) {
              throw new Error(`unknown_metafield_push_job:${job.name}`);
            }

            const payload = job.data as MetafieldPushPayload | null;
            if (!payload?.shopId || !payload.productId) {
              throw new Error('invalid_metafield_push_payload');
            }

            await processMetafieldPush(payload, logger);
          } finally {
            clearWorkerCurrentJob('pim-metafield-push-worker');
          }
        }),
    }
  );
  return { worker, close: async () => await worker.close() };
}

async function processMetafieldPush(payload: MetafieldPushPayload, logger: Logger): Promise<void> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const [product, mappings] = await withTenantContext(payload.shopId, async (client) => {
    const productRes = await client.query<ProductDataRow>(
      `SELECT pm.id AS product_id,
              pcm.external_id AS shopify_product_gid,
              psn.specs
       FROM prod_master pm
       LEFT JOIN prod_specs_normalized psn
         ON psn.product_id = pm.id
        AND psn.is_current = true
       LEFT JOIN prod_channel_mappings pcm
         ON pcm.product_id = pm.id
        AND pcm.shop_id = $1
        AND pcm.channel = 'shopify'
       WHERE pm.id = $2
       LIMIT 1`,
      [payload.shopId, payload.productId]
    );

    const mappingsRes = await client.query<MappingRow>(
      `SELECT shop_id, attr_code, shopify_namespace, shopify_key, shopify_type
       FROM pim_metafield_mappings
       WHERE is_active = true
         AND (shop_id = $1 OR shop_id IS NULL)
       ORDER BY (shop_id IS NULL) ASC, updated_at DESC`,
      [payload.shopId]
    );
    return [productRes.rows[0] ?? null, mappingsRes.rows] as const;
  });

  if (!product?.shopify_product_gid) {
    await writePushLog({
      shopId: payload.shopId,
      productId: payload.productId,
      shopifyProductGid: null,
      metafieldsCount: 0,
      status: 'failed',
      errorMessage: 'shopify_product_gid_missing',
    });
    return;
  }

  const selectedMappings = new Map<string, MappingRow>();
  for (const mapping of mappings) {
    if (!selectedMappings.has(mapping.attr_code)) {
      selectedMappings.set(mapping.attr_code, mapping);
    }
  }

  const specs = product.specs ?? {};
  const metafields: MetafieldsSetInput[] = [];
  for (const [attrCode, mapping] of selectedMappings.entries()) {
    const value = toMetafieldValue(specs[attrCode], mapping.shopify_type);
    if (value === null) continue;
    metafields.push({
      ownerId: product.shopify_product_gid,
      namespace: mapping.shopify_namespace,
      key: mapping.shopify_key,
      type: mapping.shopify_type,
      value,
    });
  }

  if (metafields.length === 0) {
    await writePushLog({
      shopId: payload.shopId,
      productId: payload.productId,
      shopifyProductGid: product.shopify_product_gid,
      metafieldsCount: 0,
      status: 'partial',
      errorMessage: 'no_mappable_specs',
    });
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

  try {
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
    const errorMessage = userErrors
      .map((e) => e.message)
      .filter(Boolean)
      .join('; ');
    const status = errorMessage ? 'partial' : 'success';

    await writePushLog({
      shopId: payload.shopId,
      productId: payload.productId,
      shopifyProductGid: product.shopify_product_gid,
      metafieldsCount: metafields.length,
      status,
      errorMessage: errorMessage || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writePushLog({
      shopId: payload.shopId,
      productId: payload.productId,
      shopifyProductGid: product.shopify_product_gid,
      metafieldsCount: metafields.length,
      status: 'failed',
      errorMessage: message,
    });
  }
}

function toMetafieldValue(value: unknown, shopifyType: string): string | null {
  if (value === null || value === undefined) return null;

  if (shopifyType.startsWith('list.')) {
    if (Array.isArray(value)) {
      const list = value.map((v) => String(v)).filter((v) => v.trim().length > 0);
      if (list.length === 0) return null;
      return JSON.stringify(list);
    }
    const asString = typeof value === 'string' ? value.trim() : JSON.stringify(value);
    if (!asString) return null;
    return JSON.stringify([asString]);
  }

  const asString = typeof value === 'string' ? value.trim() : JSON.stringify(value);
  if (!asString) return null;
  return asString;
}

async function writePushLog(params: {
  shopId: string;
  productId: string;
  shopifyProductGid: string | null;
  metafieldsCount: number;
  status: 'success' | 'partial' | 'failed';
  errorMessage: string | null;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO pim_metafield_push_log
         (shop_id, product_id, shopify_product_gid, metafields_count, status, error_message, pushed_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [
        params.shopId,
        params.productId,
        params.shopifyProductGid,
        params.metafieldsCount,
        params.status,
        params.errorMessage,
      ]
    );
  });
}
