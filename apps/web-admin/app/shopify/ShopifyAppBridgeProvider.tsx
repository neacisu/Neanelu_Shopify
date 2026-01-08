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

  const missingHost = Boolean(isEmbedded && !params.host);

  const app = useMemo<ReturnType<typeof createApp> | null>(() => {
    if (!apiKey) return null;
    if (!params.host) return null;

    return createApp({ apiKey, host: params.host, forceRedirect: true });
  }, [apiKey, params.host]);

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
