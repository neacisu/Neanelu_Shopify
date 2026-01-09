import type { PropsWithChildren } from 'react';
import { createContext, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import createApp from '@shopify/app-bridge';

import { setAppBridgeApp } from './app-bridge-singleton';
import { isProbablyEmbedded, readShopifyParams } from './shopify-url';

export interface ShopifyAppBridgeContextValue {
  apiKey: string | null;
  host: string | null;
  shop: string | null;
  isEmbedded: boolean;
  missingHost: boolean;
  app: ReturnType<typeof createApp> | null;
}

export const ShopifyAppBridgeContext = createContext<ShopifyAppBridgeContextValue>({
  apiKey: null,
  host: null,
  shop: null,
  isEmbedded: false,
  missingHost: false,
  app: null,
});

export function ShopifyAppBridgeProvider({ children }: PropsWithChildren) {
  const location = useLocation();

  const apiKey = (import.meta.env['VITE_SHOPIFY_API_KEY'] as string | undefined) ?? null;

  const params = useMemo(() => readShopifyParams(location.search), [location.search]);
  const isEmbedded = useMemo(() => isProbablyEmbedded(params), [params]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Persist last known Shopify params to help recovery when navigation drops query params.
    if (params.shop) window.localStorage.setItem('neanelu_last_shop', params.shop);
    if (params.host) window.localStorage.setItem('neanelu_last_host', params.host);
    if (params.embedded) window.localStorage.setItem('neanelu_last_embedded', params.embedded);
  }, [params.embedded, params.host, params.shop]);

  const missingHost = Boolean(isEmbedded && !params.host);

  const app = useMemo<ReturnType<typeof createApp> | null>(() => {
    if (!apiKey) return null;
    // Important: only initialize App Bridge in embedded context.
    // If Shopify (or a user) opens the app top-level (not in an iframe) but the URL still
    // contains a `host` param, App Bridge with `forceRedirect: true` will continuously
    // bounce between our domain and Shopify Admin.
    if (!isEmbedded) return null;
    if (!params.host) return null;

    return createApp({ apiKey, host: params.host, forceRedirect: true });
  }, [apiKey, isEmbedded, params.host]);

  useEffect(() => {
    setAppBridgeApp(app);
    return () => setAppBridgeApp(null);
  }, [app]);

  const value: ShopifyAppBridgeContextValue = {
    apiKey,
    host: params.host,
    shop: params.shop,
    isEmbedded,
    missingHost,
    app,
  };

  return (
    <ShopifyAppBridgeContext.Provider value={value}>{children}</ShopifyAppBridgeContext.Provider>
  );
}
