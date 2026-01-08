import type createApp from '@shopify/app-bridge';

export type AppBridgeApp = ReturnType<typeof createApp>;

let appBridgeApp: AppBridgeApp | null = null;

export function setAppBridgeApp(app: AppBridgeApp | null): void {
  appBridgeApp = app;
}

export function getAppBridgeApp(): AppBridgeApp | null {
  return appBridgeApp;
}
