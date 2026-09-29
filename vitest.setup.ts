import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans with Vitest globals, which this repo does not enable.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
