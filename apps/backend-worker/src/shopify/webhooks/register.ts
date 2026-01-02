/**
 * Webhook Registration
 *
 * CONFORM: Plan_de_implementare F3.3.4
 * - Registers all required webhook topics upon app install
 * - Idempotent
 */

import { shopifyApi } from '../../shopify/client.js';
import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import { SHOPIFY_API_VERSION } from '@app/config';

interface UserError {
  field?: string[];
  message: string;
}

interface WebhookSubscriptionCreateResponse {
  webhookSubscriptionCreate?: {
    userErrors?: UserError[];
    webhookSubscription?: { id: string };
  };
}

interface WebhookSubscriptionDeleteResponse {
  webhookSubscriptionDelete?: {
    deletedWebhookSubscriptionId?: string;
    userErrors?: UserError[];
  };
}

interface WebhookSubscriptionsQueryResponse {
  webhookSubscriptions?: {
    edges?: {
      node?: {
        id: string;
        topic: string;
        format?: string;
        endpoint?: {
          __typename?: string;
          callbackUrl?: string;
        };
      };
    }[];
  };
}

// Exhaustive list of topics to register
export const REQUIRED_TOPICS = [
  // App Lifecycle
  'app/uninstalled',
  'shop/update',

  // Products
  'products/create',
  'products/update',
  'products/delete',

  // Orders
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'orders/paid',
  'orders/partially_fulfilled',

  // Inventory
  'inventory_levels/update',
  'inventory_levels/connect',
  'inventory_levels/disconnect',

  // Collections
  'collections/create',
  'collections/update',
  'collections/delete',

  // Customers
  'customers/create',
  'customers/update',
  'customers/delete',

  // Metaobjects
  'metaobjects/create',
  'metaobjects/update',
  'metaobjects/delete',

  // Bulk Operations
  'bulk_operations/finish',
];

function topicToEnum(topic: string): string {
  return topic.toUpperCase().replace(/\//g, '_');
}

function enumToTopic(topicEnum: string): string {
  return topicEnum.toLowerCase().replace(/_/g, '/');
}

async function upsertWebhookRecord(
  shopId: string,
  record: {
    shopifyGid: string;
    topic: string;
    address: string;
    format: string;
    apiVersion: string;
  }
): Promise<void> {
  await withTenantContext(shopId, async (client) => {
    await client.query(
      `INSERT INTO shopify_webhooks (shop_id, shopify_gid, topic, address, format, api_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (shopify_gid)
       DO UPDATE SET
         topic = EXCLUDED.topic,
         address = EXCLUDED.address,
         format = EXCLUDED.format,
         api_version = EXCLUDED.api_version`,
      [shopId, record.shopifyGid, record.topic, record.address, record.format, record.apiVersion]
    );
  });
}

async function listWebhookSubscriptions(
  client: ReturnType<typeof shopifyApi.createClient>
): Promise<{ id: string; topic: string; callbackUrl: string; format: string }[]> {
  const query = `
    query WebhookSubscriptions {
      webhookSubscriptions(first: 250) {
        edges {
          node {
            id
            topic
            format
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    }
  `;

  const response = await client.request<WebhookSubscriptionsQueryResponse>(query);
  const edges = response.data?.webhookSubscriptions?.edges ?? [];

  const result: { id: string; topic: string; callbackUrl: string; format: string }[] = [];
  for (const edge of edges) {
    const node = edge.node;
    if (!node?.id || !node.topic) continue;
    const callbackUrl = node.endpoint?.callbackUrl;
    if (!callbackUrl) continue;
    result.push({
      id: node.id,
      topic: enumToTopic(node.topic),
      callbackUrl,
      format: (node.format ?? 'JSON').toLowerCase(),
    });
  }
  return result;
}

async function deleteWebhookSubscription(
  client: ReturnType<typeof shopifyApi.createClient>,
  id: string,
  logger: Logger
): Promise<void> {
  const mutation = `
    mutation webhookSubscriptionDelete($id: ID!) {
      webhookSubscriptionDelete(id: $id) {
        deletedWebhookSubscriptionId
        userErrors { field message }
      }
    }
  `;
  const response = await client.request<WebhookSubscriptionDeleteResponse>(mutation, { id });
  const errors = response.data?.webhookSubscriptionDelete?.userErrors;
  if (errors?.length) {
    logger.warn({ id, errors }, 'Webhook delete returned errors');
  }
}

async function createWebhookSubscription(
  client: ReturnType<typeof shopifyApi.createClient>,
  topic: string,
  callbackUrl: string
): Promise<{ id: string } | null> {
  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        userErrors { field message }
        webhookSubscription { id }
      }
    }
  `;

  const response = await client.request<WebhookSubscriptionCreateResponse>(mutation, {
    topic: topicToEnum(topic),
    webhookSubscription: {
      callbackUrl,
      format: 'JSON',
    },
  });

  const errors = response.data?.webhookSubscriptionCreate?.userErrors;
  if (errors?.length) return null;

  const id = response.data?.webhookSubscriptionCreate?.webhookSubscription?.id;
  if (!id) return null;
  return { id };
}

/**
 * Reconcile webhooks: ensure all required topics exist and point to the correct callbackUrl.
 * Idempotent: lists existing, deletes mismatched, creates missing.
 */
export async function reconcileWebhooks(
  shopId: string,
  shopDomain: string,
  accessToken: string,
  host: string,
  logger: Logger
): Promise<void> {
  const client = shopifyApi.createClient({ shopDomain, accessToken });
  const expectedByTopic = new Map<string, string>();
  for (const topic of REQUIRED_TOPICS) {
    expectedByTopic.set(topic, `${host}/webhooks/${topic}`);
  }

  const existing = await listWebhookSubscriptions(client);
  const existingByTopic = new Map<string, { id: string; callbackUrl: string; format: string }>();
  for (const sub of existing) {
    // Keep the first seen; if multiple exist for a topic, we treat as already registered.
    if (!existingByTopic.has(sub.topic)) {
      existingByTopic.set(sub.topic, {
        id: sub.id,
        callbackUrl: sub.callbackUrl,
        format: sub.format,
      });
    }
  }

  for (const topic of REQUIRED_TOPICS) {
    const expectedUrl = expectedByTopic.get(topic);
    if (!expectedUrl) continue;

    const existingSub = existingByTopic.get(topic);
    if (existingSub?.callbackUrl === expectedUrl) {
      await upsertWebhookRecord(shopId, {
        shopifyGid: existingSub.id,
        topic,
        address: expectedUrl,
        format: existingSub.format,
        apiVersion: SHOPIFY_API_VERSION,
      });
      continue;
    }

    // If subscription exists but points elsewhere, delete it before re-creating.
    if (existingSub?.callbackUrl && existingSub.callbackUrl !== expectedUrl) {
      logger.warn(
        { topic, existingUrl: existingSub.callbackUrl, expectedUrl },
        'Webhook callbackUrl mismatch; re-registering'
      );
      try {
        await deleteWebhookSubscription(client, existingSub.id, logger);
      } catch (err) {
        logger.warn({ err, topic }, 'Failed to delete mismatched webhook; continuing');
      }
    }

    const created = await createWebhookSubscription(client, topic, expectedUrl);
    if (!created) {
      logger.warn(
        { topic, callbackUrl: expectedUrl },
        'Webhook registration failed (will not persist)'
      );
      continue;
    }

    await upsertWebhookRecord(shopId, {
      shopifyGid: created.id,
      topic,
      address: expectedUrl,
      format: 'json',
      apiVersion: SHOPIFY_API_VERSION,
    });
    logger.debug({ topic }, 'Webhook registered and persisted');
  }
}

/**
 * Registers all webhooks for the shop
 */
export async function registerWebhooks(
  shopId: string,
  shopDomain: string,
  accessToken: string,
  host: string,
  logger: Logger
): Promise<void> {
  logger.info(
    { shop: shopDomain, topicsCount: REQUIRED_TOPICS.length },
    'Starting webhook reconciliation'
  );
  await reconcileWebhooks(shopId, shopDomain, accessToken, host, logger);
}
