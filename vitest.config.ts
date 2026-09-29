import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Component tests declare `// @vitest-environment jsdom` in their header.
    include: ['utils/**/*.test.ts', 'components/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['default'],
  },
});
