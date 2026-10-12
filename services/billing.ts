/**
 * BillingService — opens the Stripe pages (edge function `billing`, #107).
 *
 * Every action answers with a Stripe URL the browser is sent to; the practitioner comes
 * back to `/?paiement=ok` or `/?paiement=annule` (see readPaymentReturn). Credits are
 * granted by the Stripe webhook, never by the client.
 */

import { supabase } from './db';
import type { UserProfile } from '../types';

/** The only plan sold since 2026-10-12. Mirrors the Stripe price `formule_solo`. */
export const SOLO_PRICE_EUR = 21.99;
/** « Illimité* » : fair-use limit of the Solo plan, in monthly credits (plan_monthly_credits). */
export const SOLO_FAIR_USE_PER_MONTH = 30;
/** Price of a purchased credit, sold only without an active plan. Mirrors `unite_sans_formule`. */
export const UNIT_PRICE_EUR = 9;

type BillingRequest = { action: 'subscribe'; plan: 'solo' } | { action: 'buy_credits' } | { action: 'portal' };

const openStripe = async (request: BillingRequest): Promise<void> => {
  const { data, error } = await supabase.functions.invoke<{ url?: string }>('billing', { body: request });
  if (error || !data?.url) throw error ?? new Error('Stripe URL missing');
  window.location.assign(data.url);
};

export const BillingService = {
  /** Checkout of the Solo plan; the portal instead when a paid plan already exists. */
  subscribe: () => openStripe({ action: 'subscribe', plan: 'solo' }),
  /** Checkout of purchased credits (accounts without an active plan). */
  buyCredits: () => openStripe({ action: 'buy_credits' }),
  /** Stripe customer portal: invoices, card, cancellation. */
  openPortal: () => openStripe({ action: 'portal' }),
};

/** Plan whose rights apply: none unless the plan is active (or awaiting a payment retry). */
export const effectivePlan = (profile: Pick<UserProfile, 'subscriptionPlan' | 'status'>): UserProfile['subscriptionPlan'] =>
  profile.status === 'active' || profile.status === 'past_due' ? profile.subscriptionPlan : 'free';

/** A plan (paid or offered) is active: its monthly credits replace unit purchases. */
export const hasActivePlan = (profile: Pick<UserProfile, 'subscriptionPlan' | 'status'>): boolean => effectivePlan(profile) !== 'free';

/** Return from a Stripe page: reads and removes `?paiement=` from the address bar. */
export const readPaymentReturn = (): 'ok' | 'annule' | null => {
  const url = new URL(window.location.href);
  const value = url.searchParams.get('paiement');
  if (value !== 'ok' && value !== 'annule') return null;
  url.searchParams.delete('paiement');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return value;
};

/** Report branding (logo, colours) comes with any active plan (Solo; formerly Performance and Expert). */
export const hasBrandingPlan = (profile: Pick<UserProfile, 'subscriptionPlan' | 'status' | 'isAdmin'>): boolean =>
  profile.isAdmin || ['solo', 'performance', 'expert'].includes(effectivePlan(profile));
