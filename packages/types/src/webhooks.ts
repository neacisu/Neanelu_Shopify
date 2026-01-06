/**
 * Webhook Job Contract
 *
 * CONFORM: Plan_de_implementare F3.3.2
 * Defines payload structure for queue jobs and runtime validation.
 */

export enum WebhookTopic {
  // App Lifecycle
  APP_UNINSTALLED = 'app/uninstalled',
  SHOP_UPDATE = 'shop/update',

  // Products
  PRODUCTS_CREATE = 'products/create',
  PRODUCTS_UPDATE = 'products/update',
  PRODUCTS_DELETE = 'products/delete',

  // Orders
  ORDERS_CREATE = 'orders/create',
  ORDERS_UPDATED = 'orders/updated',
  ORDERS_CANCELLED = 'orders/cancelled',
  ORDERS_FULFILLED = 'orders/fulfilled',
  ORDERS_PAID = 'orders/paid',
  ORDERS_PARTIALLY_FULFILLED = 'orders/partially_fulfilled',

  // Inventory
  INVENTORY_LEVELS_UPDATE = 'inventory_levels/update',
  INVENTORY_LEVELS_CONNECT = 'inventory_levels/connect',
  INVENTORY_LEVELS_DISCONNECT = 'inventory_levels/disconnect',

  // Collections
  COLLECTIONS_CREATE = 'collections/create',
  COLLECTIONS_UPDATE = 'collections/update',
  COLLECTIONS_DELETE = 'collections/delete',

  // Customers
  CUSTOMERS_CREATE = 'customers/create',
  CUSTOMERS_UPDATE = 'customers/update',
  CUSTOMERS_DELETE = 'customers/delete',

  // Metaobjects
  METAOBJECTS_CREATE = 'metaobjects/create',
  METAOBJECTS_UPDATE = 'metaobjects/update',
  METAOBJECTS_DELETE = 'metaobjects/delete',

  // Bulk Operations
  BULK_OPERATIONS_FINISH = 'bulk_operations/finish',
}

export interface WebhookJobPayload {
  /** Internal tenant identifier (UUID). Required for PR-022 Groups fairness and RLS enforcement. */
  shopId: string;
  shopDomain: string;
  topic: string;
  webhookId: string | null;
  receivedAt: string; // ISO timestamp
  payloadRef: string | null; // Reference to stored payload (Redis/DB) with TTL
  payloadSha256?: string; // Optional integrity/audit hash
}

function isCanonicalUuid(value: string): boolean {
  // Canonical UUID format (lowercase hex).
  // Postgres typically returns UUIDs in lowercase; enforcing canonical form avoids group-id drift.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

/**
 * Valiadeaza payload-ul job-ului la runtime
 * (Simple check, in F4 se poate folosi Zod daca e cazul)
 */
export function validateWebhookJobPayload(data: unknown): data is WebhookJobPayload {
  if (!data || typeof data !== 'object') return false;

  const job = data as Partial<WebhookJobPayload>;

  if (typeof job.shopId !== 'string' || !job.shopId) return false;
  if (!isCanonicalUuid(job.shopId)) return false;
  if (typeof job.shopDomain !== 'string' || !job.shopDomain) return false;
  if (typeof job.topic !== 'string' || !job.topic) return false;
  if (typeof job.receivedAt !== 'string') return false;
  // payloadRef is required (may be null in exceptional cases)
  if (!('payloadRef' in job)) return false;
  if (job.payloadRef !== null && typeof job.payloadRef !== 'string') return false;

  if (job.payloadSha256 !== undefined && typeof job.payloadSha256 !== 'string') return false;

  return true;
}
