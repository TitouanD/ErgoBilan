import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Build-time globals injected by vite.config.ts; without them, anything importing
  // services/sentryService (via utils/logger) throws a ReferenceError under Vitest.
  define: {
    __APP_RELEASE__: JSON.stringify('test'),
    __APP_ENV__: JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    // Component tests declare `// @vitest-environment jsdom` in their header.
    include: ['utils/**/*.test.ts', 'services/**/*.test.ts', 'components/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['default'],
  },
});
