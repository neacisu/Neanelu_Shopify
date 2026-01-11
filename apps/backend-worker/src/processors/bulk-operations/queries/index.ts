import type { BulkOperationType } from '@app/types';

import {
  PRODUCTS_EXPORT_CORE_QUERY_V1,
  PRODUCTS_EXPORT_INVENTORY_QUERY_V1,
  PRODUCTS_EXPORT_META_QUERY_V1,
} from './products-export.v1.js';

import {
  PRODUCTS_EXPORT_CORE_QUERY_V2,
  PRODUCTS_EXPORT_INVENTORY_QUERY_V2,
  PRODUCTS_EXPORT_META_QUERY_V2,
} from './products-export.v2.js';

export const BULK_QUERY_VERSIONS = ['v1', 'v2'] as const;
export type BulkQueryVersion = (typeof BULK_QUERY_VERSIONS)[number];

export const BULK_QUERY_SETS = ['core', 'meta', 'inventory'] as const;
export type BulkQuerySet = (typeof BULK_QUERY_SETS)[number];

export type BulkQueryContract = Readonly<{
  operationType: BulkOperationType;
  querySet: BulkQuerySet;
  version: BulkQueryVersion;
  /** GraphQL query string passed to Shopify bulkOperationRunQuery(query: $query). */
  graphqlQuery: string;
  /** Human-readable stitching contract (keys + invariants). */
  stitching: Readonly<{
    keys: readonly string[];
    invariants: readonly string[];
    executionOrder: readonly BulkQuerySet[];
  }>;
}>;

const PRODUCTS_EXPORT_CONTRACTS_V1: Readonly<Record<BulkQuerySet, BulkQueryContract>> = {
  core: {
    operationType: 'PRODUCTS_EXPORT',
    querySet: 'core',
    version: 'v1',
    graphqlQuery: PRODUCTS_EXPORT_CORE_QUERY_V1,
    stitching: {
      keys: [
        'Product → Variant: product.id = variant.product.id (logical contract)',
        'Product → Variant: product.id = variant.__parentId (Shopify bulk JSONL projection)',
      ],
      invariants: [
        'Output is flat JSONL; parent/child reconstruction uses __parentId.',
        'Do not assume ordering or grouping of lines; stitching must be streaming-safe.',
      ],
      executionOrder: ['core', 'meta', 'inventory'],
    },
  },
  meta: {
    operationType: 'PRODUCTS_EXPORT',
    querySet: 'meta',
    version: 'v1',
    graphqlQuery: PRODUCTS_EXPORT_META_QUERY_V1,
    stitching: {
      keys: [
        'Product → Metafield: product.id = metafield.owner.id (logical contract)',
        'Product → Metafield: product.id = metafield.__parentId (Shopify bulk JSONL projection)',
      ],
      invariants: [
        'Metafields are fetched in app context; app-owned namespaces may be invisible outside owner app.',
      ],
      executionOrder: ['core', 'meta', 'inventory'],
    },
  },
  inventory: {
    operationType: 'PRODUCTS_EXPORT',
    querySet: 'inventory',
    version: 'v1',
    graphqlQuery: PRODUCTS_EXPORT_INVENTORY_QUERY_V1,
    stitching: {
      keys: [
        'Variant → InventoryItem: variant.inventoryItem.id = inventoryItem.id (logical contract)',
        'Variant → InventoryQuantity: variant.inventoryQuantity is used as v1 inventory signal',
      ],
      invariants: [
        'v1 does not include per-location inventoryLevels; add a v2 contract if needed.',
      ],
      executionOrder: ['core', 'meta', 'inventory'],
    },
  },
} as const;

const PRODUCTS_EXPORT_CONTRACTS_V2: Readonly<Record<BulkQuerySet, BulkQueryContract>> = {
  core: {
    operationType: 'PRODUCTS_EXPORT',
    querySet: 'core',
    version: 'v2',
    graphqlQuery: PRODUCTS_EXPORT_CORE_QUERY_V2,
    stitching: {
      keys: [
        'Product → Variant: product.id = variant.product.id',
        'Product → Variant: product.id = variant.__parentId (Shopify bulk JSONL)',
      ],
      invariants: [
        'Output is flat JSONL; parent/child reconstruction uses __parentId.',
        'Do not assume ordering or grouping of lines; stitching must be streaming-safe.',
      ],
      executionOrder: ['core', 'meta', 'inventory'],
    },
  },
  meta: {
    operationType: 'PRODUCTS_EXPORT',
    querySet: 'meta',
    version: 'v2',
    graphqlQuery: PRODUCTS_EXPORT_META_QUERY_V2,
    stitching: {
      keys: [
        'Product → Metafield: product.id = metafield.owner.id',
        'Product → Metafield: product.id = metafield.__parentId (Shopify bulk JSONL)',
      ],
      invariants: [
        'Metafields are fetched in app context; app-owned namespaces may be invisible outside owner app.',
        'Metaobject expansion is best-effort via metafield reference(s); large graphs may be truncated by first:N limits.',
      ],
      executionOrder: ['core', 'meta', 'inventory'],
    },
  },
  inventory: {
    operationType: 'PRODUCTS_EXPORT',
    querySet: 'inventory',
    version: 'v2',
    graphqlQuery: PRODUCTS_EXPORT_INVENTORY_QUERY_V2,
    stitching: {
      keys: [
        'Variant → InventoryItem: variant.inventoryItem.id = inventoryItem.id',
        'InventoryItem → InventoryLevel: inventoryItem.id = inventoryLevel.__parentId (Shopify bulk JSONL)',
      ],
      invariants: [
        'Per-location inventoryLevels are included; treat missing locations as best-effort (Shopify may restrict access).',
      ],
      executionOrder: ['core', 'meta', 'inventory'],
    },
  },
} as const;

export function getBulkQueryContract(input: {
  operationType: BulkOperationType;
  querySet: BulkQuerySet;
  version?: string;
}): BulkQueryContract {
  const version = input.version ?? 'v2';

  if (input.operationType !== 'PRODUCTS_EXPORT') {
    throw new Error(`bulk_query_contract_not_supported:${input.operationType}`);
  }

  if (version === 'v1') return PRODUCTS_EXPORT_CONTRACTS_V1[input.querySet];
  if (version === 'v2') return PRODUCTS_EXPORT_CONTRACTS_V2[input.querySet];

  throw new Error(`bulk_query_contract_version_not_supported:${String(version)}`);
}
