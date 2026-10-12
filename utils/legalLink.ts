/** Legal documents of the LegalModal tabs. */
export type LegalTab = 'cgu' | 'cgv' | 'privacy';

const LEGAL_TABS: readonly LegalTab[] = ['cgu', 'cgv', 'privacy'];

/**
 * Document asked by the address (`/?legal=cgv`): the public URL of the terms of sale that
 * Stripe Checkout links to. Read once at load, then removed from the address bar.
 */
export const readLegalTabFromUrl = (): LegalTab | null => {
  const url = new URL(window.location.href);
  const tab = url.searchParams.get('legal') as LegalTab | null;
  if (!tab || !LEGAL_TABS.includes(tab)) return null;
  url.searchParams.delete('legal');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return tab;
};
