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

declare const __APP_ENV__: string;

/**
 * Stripe is still in test mode (#110): the billing edge only serves test accounts, so the
 * production build shows « Paiement bientôt disponible » instead of the payment buttons.
 * Set VITE_PAYMENT_OPEN=true on production when Stripe switches to live mode.
 */
export const IS_PAYMENT_OPEN = __APP_ENV__ !== 'production' || import.meta.env.VITE_PAYMENT_OPEN === 'true';

type BillingRequest = { action: 'subscribe'; plan: 'solo' } | { action: 'buy_credits' } | { action: 'portal' };

/** Payment refused because Stripe is still in test mode and the account is not a test account (#110). */
export class PaymentUnavailableError extends Error {
  constructor() {
    super('PAYMENT_NOT_AVAILABLE');
    this.name = 'PaymentUnavailableError';
  }
}

/** JSON body of a failed edge call (`FunctionsHttpError.context` is the Response), or null. */
export const readEdgeErrorBody = async (error: unknown): Promise<{ error?: string } | null> => {
  const response = (error as { context?: unknown } | null)?.context;
  if (!(response instanceof Response)) return null;
  try {
    return (await response.clone().json()) as { error?: string };
  } catch {
    return null;
  }
};

const openStripe = async (request: BillingRequest): Promise<void> => {
  const { data, error } = await supabase.functions.invoke<{ url?: string }>('billing', { body: request });
  if (error) {
    if ((await readEdgeErrorBody(error))?.error === 'PAYMENT_NOT_AVAILABLE') throw new PaymentUnavailableError();
    throw error;
  }
  if (!data?.url) throw new Error('Stripe URL missing');
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

/** Monthly credits of a plan. Mirrors plan_monthly_credits (SQL); the former plans are no longer sold. */
export const planMonthlyCredits = (plan: UserProfile['subscriptionPlan']): number =>
  ({ free: 0, solo: SOLO_FAIR_USE_PER_MONTH, essential: 2, performance: 6, expert: 20 })[plan];

/** Dashboard banner about the subscription: none with an active plan, or for the admin who generates without credits (#112). */
export const subscriptionBanner = (
  profile: Pick<UserProfile, 'isAdmin' | 'isTrial' | 'trialDenied' | 'status' | 'subscriptionPlan' | 'credits'>,
): 'none' | 'trialUsed' | 'trial' | 'noPlan' => {
  if (profile.isAdmin || (!profile.isTrial && effectivePlan(profile) !== 'free')) return 'none';
  // One trial per real e-mail address (#107): never a block, only no free credits.
  if (profile.trialDenied && profile.status === 'trialing' && profile.credits === 0) return 'trialUsed';
  return profile.isTrial ? 'trial' : 'noPlan';
};

/** Plan whose rights apply: none unless the plan is active (or awaiting a payment retry). */
export const effectivePlan = (profile: Pick<UserProfile, 'subscriptionPlan' | 'status'>): UserProfile['subscriptionPlan'] =>
  profile.status === 'active' || profile.status === 'past_due' ? profile.subscriptionPlan : 'free';

/** A plan (paid or offered) is active: its monthly credits replace unit purchases. */
export const hasActivePlan = (profile: Pick<UserProfile, 'subscriptionPlan' | 'status'>): boolean => effectivePlan(profile) !== 'free';

const BILLING_STATE_KEY = 'ergobilan.billingStateBeforeStripe';

type BillingProfile = Pick<UserProfile, 'subscriptionPlan' | 'status' | 'billingSource' | 'monthlyCredits' | 'purchasedCredits'>;

/** What a payment changes in the profile: plan, status, both balances. */
export const billingSignature = (profile: BillingProfile): string =>
  [profile.subscriptionPlan, profile.status, profile.billingSource ?? '', profile.monthlyCredits, profile.purchasedCredits].join('|');

/** Kept for the return from Stripe (same tab): the webhook's change is detected against it (#111). */
export const rememberBillingState = (profile: BillingProfile): void => {
  try {
    sessionStorage.setItem(BILLING_STATE_KEY, billingSignature(profile));
  } catch {
    // Storage unavailable: the return only re-reads the profile once.
  }
};

export const takeRememberedBillingState = (): string | null => {
  try {
    const value = sessionStorage.getItem(BILLING_STATE_KEY);
    sessionStorage.removeItem(BILLING_STATE_KEY);
    return value;
  } catch {
    return null;
  }
};

/**
 * After a payment, the webhook updates the account a few seconds later: re-reads the profile
 * every `intervalMs` until it differs from `before` (#111). Without `before`, one read is enough.
 * Resolves true once the change is seen, false after `attempts` reads or when cancelled.
 */
export const waitForBillingChange = async (
  refresh: () => Promise<BillingProfile | null>,
  before: string | null,
  {
    intervalMs = 3_000,
    attempts = 20,
    isCancelled = () => false,
  }: { intervalMs?: number; attempts?: number; isCancelled?: () => boolean } = {},
): Promise<boolean> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (isCancelled()) return false;
    const profile = await refresh();
    if (profile && (before === null || billingSignature(profile) !== before)) return true;
  }
  return false;
};

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
