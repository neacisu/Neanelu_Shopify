import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import { shopifyHmr } from './vite.shopify-hmr';
import { proxyQueuesWs } from './vite.proxy-ws';

const frontendPort = Number(process.env['FRONTEND_PORT'] ?? '65001');
const isDocker = process.env['DOCKER'] === '1' || process.env['DOCKER'] === 'true';
const backendTarget = isDocker ? 'http://backend-worker:65000' : 'http://localhost:65000';

export default defineConfig({
  base: '/app/',
  plugins: [proxyQueuesWs(backendTarget), tailwindcss(), react(), shopifyHmr(), tsconfigPaths()],
  server: {
    host: true,
    port: frontendPort,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 500,
    },
    // In Docker behind Traefik, requests come with the public Host header.
    // Vite dev server blocks unknown hosts by default.
    ...(isDocker ? { allowedHosts: true as const } : {}),
    proxy: {
      // WebSocket: context regex ca să match-uiască exact la upgrade
      '^/api/queues/ws': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
        rewriteWsOrigin: true,
      },
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
  },
});
