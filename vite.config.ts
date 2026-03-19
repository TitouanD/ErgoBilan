import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = globalThis.process?.env ?? {};
const appRelease =
  env.VERCEL_GIT_COMMIT_SHA ||
  env.GITHUB_SHA ||
  env.COMMIT_SHA ||
  env.VITE_SENTRY_RELEASE ||
  'local';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  define: {
    __APP_RELEASE__: JSON.stringify(appRelease),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  // @react-pdf/renderer compatibility: resolve pako and other Node-style imports
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
  build: {
    commonjsOptions: {
      // Allow CJS modules used by @react-pdf/pdfkit
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('@react-pdf/') ||
              id.includes('pdfkit') ||
              id.includes('fontkit') ||
              id.includes('yoga-layout') ||
              id.includes('pako')
            ) {
              return 'pdf-vendor';
            }

            if (id.includes('recharts') || id.includes('/d3-')) {
              return 'charts-vendor';
            }

            if (id.includes('@tiptap/')) {
              return 'editor-vendor';
            }

            if (id.includes('@supabase/')) {
              return 'supabase-vendor';
            }

            if (id.includes('@sentry/')) {
              return 'sentry-vendor';
            }
          }
        },
      },
    },
  },
});
