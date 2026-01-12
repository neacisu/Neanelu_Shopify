import type { BulkOperationType } from '@app/types';

export const BULK_METAFIELDS_SET_V1 = `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key ownerType }
    userErrors { field message code }
  }
}`;

export const BULK_METAFIELDS_SET_V1_META = {
  operationType: 'PRODUCTS_IMPORT' as BulkOperationType,
  mutationType: 'metafieldsSet',
  version: 'v1',
} as const;
