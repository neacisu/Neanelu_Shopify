import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import { shopifyHmr } from './vite.shopify-hmr';

const frontendPort = Number(process.env['FRONTEND_PORT'] ?? '65001');
const isDocker = process.env['DOCKER'] === '1' || process.env['DOCKER'] === 'true';

export default defineConfig({
  base: '/app/',
  plugins: [react(), shopifyHmr(), tsconfigPaths()],
  server: {
    host: true,
    port: frontendPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: isDocker ? 'http://backend-worker:65000' : 'http://localhost:65000',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    target: 'esnext',
  },
});
