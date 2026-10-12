/**
 * BillingService — opens the Stripe pages (edge function `billing`, #107).
 *
 * Every action answers with a Stripe URL the browser is sent to; the practitioner comes
 * back to `/?paiement=ok` or `/?paiement=annule` (see readPaymentReturn). Credits are
 * granted by the Stripe webhook, never by the client.
 */

import { supabase } from './db';
import type { UserProfile } from '../types';

export type PaidPlan = Exclude<UserProfile['subscriptionPlan'], 'free'>;

type BillingRequest = { action: 'subscribe'; plan: PaidPlan } | { action: 'buy_credits' } | { action: 'portal' };

const openStripe = async (request: BillingRequest): Promise<void> => {
  const { data, error } = await supabase.functions.invoke<{ url?: string }>('billing', { body: request });
  if (error || !data?.url) throw error ?? new Error('Stripe URL missing');
  window.location.assign(data.url);
};

export const BillingService = {
  /** Checkout of a plan; the portal instead when a paid plan already exists. */
  subscribe: (plan: PaidPlan) => openStripe({ action: 'subscribe', plan }),
  /** Checkout of purchased credits at the plan's unit price. */
  buyCredits: () => openStripe({ action: 'buy_credits' }),
  /** Stripe customer portal: invoices, card, plan change, cancellation. */
  openPortal: () => openStripe({ action: 'portal' }),
};

/** Unit price of a purchased credit, by plan (Essential's without a plan). Mirrors the Stripe prices. */
export const UNIT_PRICE_EUR: Record<UserProfile['subscriptionPlan'], number> = {
  free: 15,
  essential: 15,
  performance: 8,
  expert: 5,
};

/** Plan whose prices apply to the practitioner: none unless the plan is active (or awaiting a payment retry). */
export const effectivePlan = (profile: Pick<UserProfile, 'subscriptionPlan' | 'status'>): UserProfile['subscriptionPlan'] =>
  profile.status === 'active' || profile.status === 'past_due' ? profile.subscriptionPlan : 'free';

/** Return from a Stripe page: reads and removes `?paiement=` from the address bar. */
export const readPaymentReturn = (): 'ok' | 'annule' | null => {
  const url = new URL(window.location.href);
  const value = url.searchParams.get('paiement');
  if (value !== 'ok' && value !== 'annule') return null;
  url.searchParams.delete('paiement');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return value;
};

/** Report branding (logo, colours) is part of the Performance and Expert plans, as the pricing grid says. */
export const hasBrandingPlan = (profile: Pick<UserProfile, 'subscriptionPlan' | 'status' | 'isAdmin'>): boolean =>
  profile.isAdmin || ['performance', 'expert'].includes(effectivePlan(profile));
