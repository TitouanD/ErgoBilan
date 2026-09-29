import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// jsdom does not implement window.scrollTo and logs "Not implemented" on every call.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}

// Testing Library only auto-cleans with Vitest globals, which this repo does not enable.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
