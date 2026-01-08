import { useEffect, useRef } from 'react';

import { TitleBar } from '@shopify/app-bridge/actions';

import { getAppBridgeApp } from './app-bridge-singleton';

export function useShopifyTitleBar(title: string | null): void {
  const titleBarRef = useRef<ReturnType<typeof TitleBar.create> | null>(null);

  useEffect(() => {
    const app = getAppBridgeApp();
    if (!app || !title) return;

    if (!titleBarRef.current) {
      titleBarRef.current = TitleBar.create(app, { title });
      return;
    }

    titleBarRef.current.set({ title });
  }, [title]);
}
