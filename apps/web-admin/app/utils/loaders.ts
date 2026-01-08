import type { LoaderFunctionArgs } from 'react-router-dom';

import { createApiClient } from '../lib/api-client';
import { getSessionAuthHeaders } from '../lib/session-auth';
import { handleApiError } from './handle-api-error';
import { withShopifyQueryRedirect } from './actions';

// React Router loaders can return a redirect `Response`, but `useLoaderData()` only ever receives
// the data branch. Exclude `Response` to keep route data typing ergonomic.
export type LoaderData<TLoader> = TLoader extends (...args: infer _Args) => infer R
  ? Exclude<Awaited<R>, Response>
  : never;

export function apiLoader<TResult>(
  fn: (args: LoaderFunctionArgs) => Promise<TResult> | TResult
): (args: LoaderFunctionArgs) => Promise<TResult> {
  return async (args: LoaderFunctionArgs): Promise<TResult> => {
    try {
      return await fn(args);
    } catch (err) {
      handleApiError(err);
    }
  };
}

export function createLoaderApiClient() {
  return createApiClient({ getAuthHeaders: getSessionAuthHeaders });
}

export { withShopifyQueryRedirect };
