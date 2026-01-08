import type { LoaderFunctionArgs } from 'react-router-dom';
import { redirect } from 'react-router-dom';

import { createApiClient } from '../lib/api-client';
import { getSessionAuthHeaders } from '../lib/session-auth';
import { withShopifyQuery } from '../shopify';

import { handleApiError } from './handle-api-error';

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

function stripBasenameFromTo(to: string, basename: string): string {
  if (!basename || basename === '/') return to;
  if (to === basename) return '/';
  if (to.startsWith(`${basename}/`)) return to.slice(basename.length);
  return to;
}

function isSafeInternalPath(to: string): boolean {
  if (!to.startsWith('/')) return false;
  if (to.startsWith('//')) return false;
  if (to.includes('://')) return false;
  return true;
}

/**
 * Redirect that preserves Shopify embedded query params (host/shop/embedded).
 *
 * Always prefer this in loaders/actions over raw `redirect()`.
 */
export function withShopifyQueryRedirect(args: LoaderFunctionArgs, to: string): Response {
  // The app runs under a router `basename` (`/app`). Loaders often see URLs like
  // `https://host/app/route`, so `url.pathname` includes the basename.
  // If we redirect to that pathname, React Router will prepend basename again.
  // Normalize redirect targets to be relative to the router.
  const normalizedTo = stripBasenameFromTo(to, '/app');

  if (!isSafeInternalPath(normalizedTo)) {
    // Fail closed: never allow open redirects.
    return redirect('/');
  }

  const current = new URL(args.request.url);
  const merged = withShopifyQuery(normalizedTo, current.search);
  if (typeof merged === 'string') {
    return redirect(merged);
  }

  // `To` is a partial Path; be defensive.
  const pathname = merged.pathname ?? '/';
  const search = merged.search ?? '';
  const hash = merged.hash ?? '';
  return redirect(`${pathname}${search}${hash}`);
}
