/**
 * Shopify Client (Lightweight)
 *
 * Wraps fetch for GraphQL requests to avoid heavy dependency on @shopify/shopify-api
 * Matches the manual fetch style used in auth.callback.ts
 */

export interface ShopifyClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
}

export type ShopifyGraphQlError = Readonly<{ message: string }>;

export type ShopifyGraphQlResponse<TData> = Readonly<{
  data?: TData;
  errors?: readonly ShopifyGraphQlError[];
}>;

export const shopifyApi = {
  createClient(options: ShopifyClientOptions) {
    const apiVersion = options.apiVersion ?? '2024-01'; // Default to a recent version

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

        return (await response.json()) as ShopifyGraphQlResponse<TData>;
      },
    };
  },
};
