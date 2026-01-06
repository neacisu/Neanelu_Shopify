import { useCallback, useMemo, useState } from 'react';

import type { ApiClientOptions } from '../lib/api-client';
import { createApiClient } from '../lib/api-client';
import { getSessionAuthHeaders } from '../lib/session-auth';

export function useApiClient(options?: ApiClientOptions) {
  const baseUrl = options?.baseUrl;
  const fetchImpl = options?.fetchImpl;
  const getAuthHeaders = options?.getAuthHeaders;

  return useMemo(() => {
    const merged: ApiClientOptions = {
      baseUrl,
      fetchImpl,
      getAuthHeaders: getAuthHeaders ?? getSessionAuthHeaders,
    };

    return createApiClient(merged);
  }, [baseUrl, fetchImpl, getAuthHeaders]);
}

export function useApiRequest<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
) {
  const [data, setData] = useState<TResult | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (...args: TArgs) => {
      setLoading(true);
      setError(undefined);

      try {
        const result = await fn(...args);
        setData(result);
        return result;
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [fn]
  );

  return { run, data, error, loading };
}
