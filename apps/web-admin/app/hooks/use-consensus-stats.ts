import { useApiClient, useApiRequest } from './use-api';
import type { ConsensusStats } from '../types/consensus';

export function useConsensusStats() {
  const api = useApiClient();
  return useApiRequest(() => api.getApi<ConsensusStats>('/pim/stats/consensus'));
}
