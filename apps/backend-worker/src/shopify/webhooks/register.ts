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
        filter?: string | null;
        endpoint?: {
          __typename?: string;
          callbackUrl?: string;
        };
      };
    }[];
  };
}

interface MetaobjectDefinitionsQueryResponse {
  metaobjectDefinitions?: {
    edges?: {
      node?: {
        id: string;
        type: string;
      };
    }[];
  };
}

function normalizeCallbackUrl(value: string): string {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    return url.toString();
  } catch {
    return value.replace(/([^:]\/)\/+/g, '$1');
  }
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

const REQUIRED_TOPIC_ENUM_MAP = new Map<string, string>(
  REQUIRED_TOPICS.map((topic) => [topicToEnum(topic), topic])
);

function topicToEnum(topic: string): string {
  return topic.toUpperCase().replace(/\//g, '_');
}

function enumToTopic(topicEnum: string): string {
  const normalized = topicEnum.toUpperCase();
  return REQUIRED_TOPIC_ENUM_MAP.get(normalized) ?? topicEnum.toLowerCase().replace(/_/g, '/');
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
       ON CONFLICT (shop_id, shopify_gid)
       DO UPDATE SET
         topic = EXCLUDED.topic,
         address = EXCLUDED.address,
         format = EXCLUDED.format,
         api_version = EXCLUDED.api_version`,
      [shopId, record.shopifyGid, record.topic, record.address, record.format, record.apiVersion]
    );
  });
}

async function deleteWebhookRecord(shopId: string, shopifyGid: string): Promise<void> {
  await withTenantContext(shopId, async (client) => {
    await client.query(`DELETE FROM shopify_webhooks WHERE shop_id = $1 AND shopify_gid = $2`, [
      shopId,
      shopifyGid,
    ]);
  });
}

async function syncWebhookRecords(
  shopId: string,
  rows: { id: string; topic: string; callbackUrl: string; format: string }[]
): Promise<void> {
  await withTenantContext(shopId, async (client) => {
    await client.query(`DELETE FROM shopify_webhooks WHERE shop_id = $1`, [shopId]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO shopify_webhooks (shop_id, shopify_gid, topic, address, format, api_version)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (shop_id, shopify_gid)
         DO UPDATE SET
           topic = EXCLUDED.topic,
           address = EXCLUDED.address,
           format = EXCLUDED.format,
           api_version = EXCLUDED.api_version`,
        [shopId, row.id, row.topic, row.callbackUrl, row.format, SHOPIFY_API_VERSION]
      );
    }
  });
}

async function listWebhookSubscriptions(
  client: ReturnType<typeof shopifyApi.createClient>
): Promise<{ id: string; topic: string; callbackUrl: string; format: string; filter?: string }[]> {
  const query = `
    query WebhookSubscriptions {
      webhookSubscriptions(first: 250) {
        edges {
          node {
            id
            topic
            format
            filter
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

  const result: {
    id: string;
    topic: string;
    callbackUrl: string;
    format: string;
    filter?: string;
  }[] = [];
  for (const edge of edges) {
    const node = edge.node;
    if (!node?.id || !node.topic) continue;
    const callbackUrl = node.endpoint?.callbackUrl;
    if (!callbackUrl) continue;
    const filter = typeof node.filter === 'string' ? node.filter : undefined;
    result.push({
      id: node.id,
      topic: enumToTopic(node.topic),
      callbackUrl,
      format: (node.format ?? 'JSON').toLowerCase(),
      ...(filter ? { filter } : {}),
    });
  }
  return result;
}

async function listMetaobjectDefinitions(
  client: ReturnType<typeof shopifyApi.createClient>
): Promise<{ id: string; type: string }[]> {
  const query = `
    query MetaobjectDefinitions {
      metaobjectDefinitions(first: 250) {
        edges {
          node {
            id
            type
          }
        }
      }
    }
  `;

  const response = await client.request<MetaobjectDefinitionsQueryResponse>(query);
  const edges = response.data?.metaobjectDefinitions?.edges ?? [];
  const definitions: { id: string; type: string }[] = [];
  for (const edge of edges) {
    const node = edge.node;
    if (!node?.id || !node.type) continue;
    definitions.push({ id: node.id, type: node.type });
  }
  return definitions;
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
  callbackUrl: string,
  filter: string | undefined,
  logger: Logger
): Promise<{ id: string } | null> {
  const mutation = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        userErrors { field message }
        webhookSubscription { id }
      }
    }
  `;

  const webhookSubscription: { callbackUrl: string; format: string; filter?: string } = {
    callbackUrl,
    format: 'JSON',
  };
  if (filter) {
    webhookSubscription.filter = filter;
  }

  const response = await client.request<WebhookSubscriptionCreateResponse>(mutation, {
    topic: topicToEnum(topic),
    webhookSubscription,
  });

  const errors = response.data?.webhookSubscriptionCreate?.userErrors;
  if (errors?.length) {
    logger.warn({ topic, callbackUrl, errors }, 'Webhook create returned errors');
    return null;
  }

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
  const baseUrl = host.replace(/\/+$/, '');
  const expectedByTopic = new Map<string, string>();
  for (const topic of REQUIRED_TOPICS) {
    expectedByTopic.set(topic, `${baseUrl}/webhooks/${topic}`);
  }

  const existing = await listWebhookSubscriptions(client);
  const existingByTopic = new Map<
    string,
    { id: string; callbackUrl: string; format: string; filter?: string }[]
  >();
  for (const sub of existing) {
    const list = existingByTopic.get(sub.topic) ?? [];
    list.push({
      id: sub.id,
      callbackUrl: sub.callbackUrl,
      format: sub.format,
      ...(sub.filter ? { filter: sub.filter } : {}),
    });
    existingByTopic.set(sub.topic, list);
  }

  const metaobjectDefinitions = await listMetaobjectDefinitions(client);
  const metaobjectFilters = metaobjectDefinitions.map((def) => `type:${def.type}`);

  for (const topic of REQUIRED_TOPICS) {
    const expectedUrl = expectedByTopic.get(topic);
    if (!expectedUrl) continue;
    const expectedUrlNormalized = normalizeCallbackUrl(expectedUrl);

    if (topic.startsWith('metaobjects/')) {
      if (metaobjectFilters.length === 0) {
        logger.warn({ topic }, 'No metaobject definitions found; skipping webhook registration');
        continue;
      }

      const existingSubs = existingByTopic.get(topic) ?? [];
      const expectedFilterSet = new Set(metaobjectFilters);

      for (const sub of existingSubs) {
        const normalized = normalizeCallbackUrl(sub.callbackUrl);
        if (
          normalized !== expectedUrlNormalized ||
          sub.callbackUrl !== expectedUrl ||
          (sub.filter && !expectedFilterSet.has(sub.filter))
        ) {
          try {
            await deleteWebhookSubscription(client, sub.id, logger);
            await deleteWebhookRecord(shopId, sub.id);
          } catch (err) {
            logger.warn({ err, topic, filter: sub.filter }, 'Failed to delete stale webhook');
          }
        }
      }

      for (const filter of metaobjectFilters) {
        const matchingSubs = existingSubs.filter(
          (sub) => sub.callbackUrl === expectedUrl && sub.filter === filter
        );
        if (matchingSubs.length > 0) {
          const [keep, ...extras] = matchingSubs;
          if (!keep) continue;
          await upsertWebhookRecord(shopId, {
            shopifyGid: keep.id,
            topic,
            address: expectedUrl,
            format: keep.format,
            apiVersion: SHOPIFY_API_VERSION,
          });
          for (const extra of extras) {
            try {
              await deleteWebhookSubscription(client, extra.id, logger);
              await deleteWebhookRecord(shopId, extra.id);
            } catch (err) {
              logger.warn({ err, topic, filter }, 'Failed to delete duplicate webhook');
            }
          }
          continue;
        }

        const created = await createWebhookSubscription(client, topic, expectedUrl, filter, logger);
        if (!created) {
          logger.warn(
            { topic, filter, callbackUrl: expectedUrl },
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
        logger.debug({ topic, filter }, 'Webhook registered and persisted');
      }
      continue;
    }

    const existingSubs = existingByTopic.get(topic) ?? [];
    const matchingSubs = existingSubs.filter((sub) => sub.callbackUrl === expectedUrl);
    const mismatchedSubs = existingSubs.filter((sub) => sub.callbackUrl !== expectedUrl);
    for (const sub of mismatchedSubs) {
      logger.warn(
        { topic, existingUrl: sub.callbackUrl, expectedUrl },
        'Webhook callbackUrl mismatch; re-registering'
      );
      try {
        await deleteWebhookSubscription(client, sub.id, logger);
        await deleteWebhookRecord(shopId, sub.id);
      } catch (err) {
        logger.warn({ err, topic }, 'Failed to delete mismatched webhook; continuing');
      }
    }

    if (matchingSubs.length > 0) {
      const [keep, ...extras] = matchingSubs;
      if (!keep) continue;
      await upsertWebhookRecord(shopId, {
        shopifyGid: keep.id,
        topic,
        address: expectedUrl,
        format: keep.format,
        apiVersion: SHOPIFY_API_VERSION,
      });
      for (const extra of extras) {
        try {
          await deleteWebhookSubscription(client, extra.id, logger);
          await deleteWebhookRecord(shopId, extra.id);
        } catch (err) {
          logger.warn({ err, topic }, 'Failed to delete duplicate webhook');
        }
      }
      continue;
    }

    const created = await createWebhookSubscription(client, topic, expectedUrl, undefined, logger);
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

  const finalSubscriptions = await listWebhookSubscriptions(client);
  await syncWebhookRecords(shopId, finalSubscriptions);
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
