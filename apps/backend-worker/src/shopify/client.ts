/**
 * Shopify Client (Lightweight)
 *
 * Wraps fetch for GraphQL requests to avoid heavy dependency on @shopify/shopify-api
 * Matches the manual fetch style used in auth.callback.ts
 */

import { SHOPIFY_API_VERSION } from '@app/config';
import {
  ShopifyRateLimitedError,
  type ShopifyGraphqlExtensions,
  computeGraphqlDelayMs,
} from '@app/shopify-client';
import { recordShopifyApiUsage } from '../otel/metrics.js';

export interface ShopifyClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
}

export type ShopifyGraphQlError = Readonly<{ message: string }>;

export type ShopifyGraphQlResponse<TData> = Readonly<{
  data?: TData;
  errors?: readonly ShopifyGraphQlError[];
  extensions?: ShopifyGraphqlExtensions;
}>;

function isThrottledGraphql(errors: readonly ShopifyGraphQlError[] | undefined): boolean {
  if (!errors?.length) return false;
  return errors.some(
    (e) => typeof e.message === 'string' && e.message.toLowerCase().includes('throttled')
  );
}

export const shopifyApi = {
  createClient(options: ShopifyClientOptions) {
    // Default to the centrally configured Shopify API version (2025-10 by default).
    const apiVersion = options.apiVersion ?? SHOPIFY_API_VERSION;

    return {
      /**
       * Execute a GraphQL query against the Shopify Admin API
       */
      request: async <TData = unknown>(
        query: string,
        variables?: Record<string, unknown>
      ): Promise<ShopifyGraphQlResponse<TData>> => {
        const url = `https://${options.shopDomain}/admin/api/${apiVersion}/graphql.json`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': options.accessToken,
          },
          body: JSON.stringify({ query, variables }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Shopify GraphQL Error: ${response.status} ${text}`);
        }

        const body = (await response.json()) as ShopifyGraphQlResponse<TData>;

        const actualCost = body.extensions?.cost?.actualQueryCost;
        if (typeof actualCost === 'number' && Number.isFinite(actualCost) && actualCost >= 0) {
          recordShopifyApiUsage(actualCost);
        }

        // Reactive throttling: Shopify may return HTTP 200 with GraphQL errors.
        if (isThrottledGraphql(body.errors)) {
          const status = body.extensions?.cost?.throttleStatus;
          const costNeeded =
            body.extensions?.cost?.requestedQueryCost ??
            body.extensions?.cost?.actualQueryCost ??
            1;

          if (
            status &&
            typeof status.currentlyAvailable === 'number' &&
            typeof status.restoreRate === 'number'
          ) {
            const delayMs = computeGraphqlDelayMs({
              costNeeded,
              currentlyAvailable: status.currentlyAvailable,
              restoreRate: status.restoreRate,
            });

            recordShopifyApiUsage(typeof actualCost === 'number' ? actualCost : 0, true);

            throw new ShopifyRateLimitedError({
              kind: 'graphql_throttled',
              delayMs,
              details: {
                costNeeded,
                currentlyAvailable: status.currentlyAvailable,
                restoreRate: status.restoreRate,
              },
            });
          }
        }

        return body;
      },
    };
  },
};
