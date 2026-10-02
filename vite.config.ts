import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = globalThis.process?.env ?? {};
const appRelease = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || env.COMMIT_SHA || env.VITE_SENTRY_RELEASE || 'local';
// Vercel: production | preview | development. Overridden at runtime by VITE_SENTRY_ENVIRONMENT.
const appEnv = env.VERCEL_ENV || '';
// Source maps are only built when they can be uploaded to Sentry, then deleted from dist (never served).
const uploadSourceMaps = Boolean(env.SENTRY_AUTH_TOKEN);

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [
    react(),
    // Test builds (Vercel preview = dev.ergobilan.com) must not be indexed by search engines.
    {
      name: 'noindex-test-builds',
      transformIndexHtml: (html) =>
        appEnv === 'production' ? html : html.replace('<head>', '<head>\n    <meta name="robots" content="noindex, nofollow" />'),
    },
    ...(uploadSourceMaps
      ? [
          sentryVitePlugin({
            org: env.SENTRY_ORG || 'ergobilan',
            project: env.SENTRY_PROJECT || 'ergobilan-frontend',
            url: env.SENTRY_URL || 'https://de.sentry.io/',
            authToken: env.SENTRY_AUTH_TOKEN,
            release: { name: appRelease },
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
  ],
  define: {
    __APP_RELEASE__: JSON.stringify(appRelease),
    __APP_ENV__: JSON.stringify(appEnv),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // @react-pdf/renderer compatibility: resolve pako and other Node-style imports
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
  build: {
    sourcemap: uploadSourceMaps ? 'hidden' : false,
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
