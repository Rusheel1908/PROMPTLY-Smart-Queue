import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

declare const process: { env: Record<string, string | undefined> }; // Node runs this file; the app's tsconfig has no Node types

/** The dev server proxies /api and /ws to the backend; another port (e.g. a test API on 4100) via VITE_PROXY_TARGET. */
const API = process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // React + router change rarely, so they get one long-cached vendor chunk; everything else is split automatically per page.
        manualChunks(id) {
          // top-level packages only: nested copies (e.g. the older scheduler inside @react-three/fiber) stay with the page that uses them
          const topLevel = id.split(/[\\/]node_modules[\\/]/).length === 2;
          if (topLevel && /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router)[\\/]/.test(id)) return 'vendor';
          // Recharts alone is ~380 kB; its lodash/d3 internals go in their own chunk (still only loaded by Ops and Lab) so no chunk passes ~300 kB.
          if (/[\\/]node_modules[\\/](lodash|victory-vendor|d3-[^\\/]+|internmap)[\\/]/.test(id)) return 'charts-deps';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
});
