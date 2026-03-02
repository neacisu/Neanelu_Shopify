import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { shopifyApi } from '../../shopify/client.js';
import {
  PIM_COLLECTIONS_SYNC_JOB,
  PIM_COLLECTIONS_SYNC_QUEUE_NAME,
} from '../../queue/collections-sync-queue.js';

type CollectionsSyncPayload = Readonly<{
  shopId: string;
  trigger: 'manual' | 'scheduled';
}>;

export interface CollectionsSyncWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startCollectionsSyncWorker(logger: Logger): CollectionsSyncWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_COLLECTIONS_SYNC_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('pim-collections-sync-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });
          try {
            if (job.name !== PIM_COLLECTIONS_SYNC_JOB) {
              throw new Error(`unknown_collections_sync_job:${job.name}`);
            }
            const payload = job.data as CollectionsSyncPayload | null;
            if (!payload?.shopId) {
              throw new Error('invalid_collections_sync_payload');
            }
            await syncCollections(payload, logger);
          } finally {
            clearWorkerCurrentJob('pim-collections-sync-worker');
          }
        }),
    }
  );
  return { worker, close: async () => await worker.close() };
}

interface ShopifyCollectionNode {
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
  description: string;
  descriptionHtml: string;
  sortOrder: string;
  ruleSet?: {
    appliedDisjunctively: boolean;
    rules: { column: string; relation: string; condition: string }[];
  } | null;
  seo?: { title?: string; description?: string } | null;
  image?: { url?: string } | null;
  productsCount?: { count?: number } | null;
  templateSuffix?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
}

interface ShopifyCollectionsResponse {
  collections?: {
    edges?: { cursor: string; node: ShopifyCollectionNode }[];
    pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
  };
}

async function syncCollections(payload: CollectionsSyncPayload, logger: Logger): Promise<void> {
  const env = loadEnv();
  const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

  const query = `#graphql
    query CollectionsPage($first: Int!, $after: String) {
      collections(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            legacyResourceId
            title
            handle
            description
            descriptionHtml
            sortOrder
            ruleSet {
              appliedDisjunctively
              rules {
                column
                relation
                condition
              }
            }
            seo {
              title
              description
            }
            image {
              url
            }
            productsCount {
              count
            }
            templateSuffix
            updatedAt
            publishedAt
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`;

  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await withTokenRetry(
      payload.shopId,
      encryptionKey,
      logger,
      async (token, domain) => {
        const client = shopifyApi.createClient({ shopDomain: domain, accessToken: token });
        return await client.request<ShopifyCollectionsResponse>(query, {
          first: 250,
          after: cursor,
        });
      }
    );

    const edges = page.data?.collections?.edges ?? [];
    if (edges.length > 0) {
      await withTenantContext(payload.shopId, async (client) => {
        for (const edge of edges) {
          const node = edge.node;
          const legacyResourceIdNum = Number(node.legacyResourceId ?? 0);
          if (!node.id || !Number.isFinite(legacyResourceIdNum) || legacyResourceIdNum <= 0) {
            continue;
          }
          const rules = node.ruleSet?.rules ?? [];
          const collectionType = rules.length > 0 ? 'SMART' : 'MANUAL';

          await client.query(
            `INSERT INTO shopify_collections (
               shop_id,
               shopify_gid,
               legacy_resource_id,
               title,
               handle,
               description,
               description_html,
               collection_type,
               sort_order,
               rules,
               disjunctive,
               seo,
               image_url,
               products_count,
               template_suffix,
               published_at,
               synced_at,
               updated_at
             )
             VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16::timestamptz, now(), now()
             )
             ON CONFLICT (shop_id, shopify_gid) DO UPDATE SET
               legacy_resource_id = EXCLUDED.legacy_resource_id,
               title = EXCLUDED.title,
               handle = EXCLUDED.handle,
               description = EXCLUDED.description,
               description_html = EXCLUDED.description_html,
               collection_type = EXCLUDED.collection_type,
               sort_order = EXCLUDED.sort_order,
               rules = EXCLUDED.rules,
               disjunctive = EXCLUDED.disjunctive,
               seo = EXCLUDED.seo,
               image_url = EXCLUDED.image_url,
               products_count = EXCLUDED.products_count,
               template_suffix = EXCLUDED.template_suffix,
               published_at = EXCLUDED.published_at,
               synced_at = now(),
               updated_at = now()`,
            [
              payload.shopId,
              node.id,
              legacyResourceIdNum,
              node.title,
              node.handle,
              node.description,
              node.descriptionHtml,
              collectionType,
              node.sortOrder,
              JSON.stringify(rules),
              Boolean(node.ruleSet?.appliedDisjunctively ?? false),
              JSON.stringify(node.seo ?? {}),
              node.image?.url ?? null,
              Number(node.productsCount?.count ?? 0),
              node.templateSuffix,
              node.publishedAt,
            ]
          );
        }
      });
    }

    hasNextPage = Boolean(page.data?.collections?.pageInfo?.hasNextPage);
    cursor = page.data?.collections?.pageInfo?.endCursor ?? null;
    if (!cursor) hasNextPage = false;
  }
}
