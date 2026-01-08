import { useContext } from 'react';

import { ShopifyAppBridgeContext } from './ShopifyAppBridgeProvider';

export function useShopifyAppBridge() {
  return useContext(ShopifyAppBridgeContext);
}
