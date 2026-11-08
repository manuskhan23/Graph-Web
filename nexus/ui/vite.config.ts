import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.NEXUS_API_TARGET ?? 'http://127.0.0.1:4400';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: false,
    allowedHosts: true,
    // The browser must never call the backend directly: the dev server proxies
    // /api so the UI works from any preview host without CORS.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        ws: false,
      },
    },
    hmr: { clientPort: 443, protocol: 'wss' },
  },
  preview: { host: '0.0.0.0', port: 5174, allowedHosts: true },
});
