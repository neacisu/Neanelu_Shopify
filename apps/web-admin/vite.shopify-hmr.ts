import type { Plugin } from 'vite';

export function shopifyHmr(): Plugin {
  return {
    name: 'neanelu-shopify-hmr',
    config: () => {
      const hostname = process.env['APP_HOSTNAME'];
      const httpsPort = Number(process.env['TRAEFIK_HTTPS_PORT'] ?? '443');

      if (!hostname) {
        return;
      }

      return {
        server: {
          hmr: {
            protocol: 'wss',
            host: hostname,
            clientPort: httpsPort,
            path: '/app',
          },
        },
      };
    },
  };
}
