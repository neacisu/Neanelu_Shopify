import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
  type QueryKey,
} from '@tanstack/react-query';

interface UsePollingOptions<TData, TError, TQueryKey extends QueryKey = QueryKey> extends Omit<
  UseQueryOptions<TData, TError, TData, TQueryKey>,
  'refetchInterval'
> {
  interval?: number;
  stopCondition?: (data: TData) => boolean;
}

/**
 * Hook pentru polling (long-running operations).
 *
 * @param options - Configurarea polling-ului.
 * @param options.interval - Intervalul de polling în ms (default: 2000).
 * @param options.stopCondition - Funcție care returnează true când polling-ul trebuie să se oprească.
 *
 * @example
 * const { data } = usePolling({
 *   queryKey: ['job', id],
 *   queryFn: () => fetchJob(id),
 *   interval: 1000,
 *   stopCondition: (job) => job.status === 'COMPLETED' || job.status === 'FAILED',
 * });
 */
export function usePolling<
  TData = unknown,
  TError = unknown,
  TQueryKey extends QueryKey = QueryKey,
>(options: UsePollingOptions<TData, TError, TQueryKey>): UseQueryResult<TData, TError> {
  const { interval = 2000, stopCondition, ...queryOptions } = options;

  return useQuery({
    ...queryOptions,
    // Polling smart: Verificăm ultima dată primită.
    // Dacă stopCondition e îndeplinită, oprim polling-ul (return false).
    refetchInterval: (query) => {
      // Dacă nu avem date încă, continuăm polling-ul.
      if (!query.state.data) {
        return interval;
      }

      // Verificăm condiția de stop
      if (stopCondition?.(query.state.data)) {
        return false;
      }

      return interval;
    },
    // Continuăm polling-ul chiar dacă fereastra nu e focusată (background processing)
    refetchIntervalInBackground: true,
  });
}
