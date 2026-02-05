import { useApiClient, useApiRequest } from './use-api';
import type { ConsensusProductItem } from '../types/consensus';

export type ConsensusProductsParams = Readonly<{
  status?: 'pending' | 'computed' | 'conflicts' | 'manual_review' | 'all';
}>;

export function useConsensusProducts() {
  const api = useApiClient();
  return useApiRequest((params: ConsensusProductsParams = {}) => {
    const search = new URLSearchParams();
    if (params.status && params.status !== 'all') {
      search.set('status', params.status);
    }
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return api.getApi<{
      items: ConsensusProductItem[];
      total: number;
      page: number;
      limit: number;
    }>(`/pim/consensus/products${suffix}`);
  });
}
