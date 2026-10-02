import { defineConfig } from 'vitest/config';

/**
 * End-to-end test of the AI generation (`npm run e2e:ai`), kept out of
 * `npm test` and `npm run check`: in live mode it calls the production edge
 * function `generate`, hence Gemini, which is paid. See docs/AI_PIPELINE.md §9.
 */
export default defineConfig({
  define: {
    __APP_RELEASE__: JSON.stringify('e2e'),
    __APP_ENV__: JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 300_000,
    // One file, run once: never retried (each retry could be a paid call).
    retry: 0,
    fileParallelism: false,
    // Trust the Windows/macOS certificate store too (TLS-inspecting corporate proxies).
    execArgv: ['--use-system-ca'],
    reporters: ['default'],
  },
});
