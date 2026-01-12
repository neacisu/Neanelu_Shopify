import type { BulkOperationType } from '@app/types';

import { BULK_METAFIELDS_SET_V1, BULK_METAFIELDS_SET_V1_META } from './metafields-set.v1.js';

export type BulkMutationVersion = 'v1';
export type BulkMutationType = 'metafieldsSet';

export type BulkMutationContract = Readonly<{
  operationType: BulkOperationType;
  mutationType: BulkMutationType;
  version: BulkMutationVersion;
  graphqlMutation: string;
}>;

export function getBulkMutationContract(params: {
  operationType: BulkOperationType;
  mutationType: BulkMutationType;
  version?: BulkMutationVersion;
}): BulkMutationContract {
  const version = params.version ?? 'v1';

  if (
    params.operationType === BULK_METAFIELDS_SET_V1_META.operationType &&
    params.mutationType === BULK_METAFIELDS_SET_V1_META.mutationType &&
    version === BULK_METAFIELDS_SET_V1_META.version
  ) {
    return {
      operationType: BULK_METAFIELDS_SET_V1_META.operationType,
      mutationType: BULK_METAFIELDS_SET_V1_META.mutationType,
      version: BULK_METAFIELDS_SET_V1_META.version,
      graphqlMutation: BULK_METAFIELDS_SET_V1,
    };
  }

  throw new Error(
    `Unsupported bulk mutation contract: ${params.operationType}/${params.mutationType}/${version}`
  );
}
