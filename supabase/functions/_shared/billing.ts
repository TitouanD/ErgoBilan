/**
 * billing.ts — Stripe ↔ ErgoBilan rules shared by the `billing` and `stripe-webhook`
 * edge functions (#107, ADR 0002). Pure: no Stripe SDK, no Deno API, tested by Vitest.
 *
 * Prices are found by lookup key, never by id: the same keys exist in test and live mode.
 *   formule_solo       : the monthly Solo plan, the only one sold since 2026-10-12
 *   unite_sans_formule : one purchased credit, sold only to accounts without a plan
 * Essential, Performance and Expert (formule_<plan>) are no longer sold but still recognized.
 */

export type PlanId = 'solo' | 'essential' | 'performance' | 'expert';

export const PLANS: readonly PlanId[] = ['solo', 'essential', 'performance', 'expert'];

/** The plan a new subscription can be taken on. */
export const SOLD_PLAN: PlanId = 'solo';

export const isPlan = (value: unknown): value is PlanId => PLANS.includes(value as PlanId);

export const planLookupKey = (plan: PlanId): string => `formule_${plan}`;

export const UNIT_LOOKUP_KEY = 'unite_sans_formule';

export const planFromLookupKey = (key: string | null | undefined): PlanId | null => {
  const plan = key?.startsWith('formule_') ? key.slice('formule_'.length) : null;
  return isPlan(plan) ? plan : null;
};

/** Stripe subscription status → subscriptions.status written by billing_apply_subscription; null = not applied. */
export const mapSubscriptionStatus = (status: string): 'active' | 'past_due' | 'canceled' | null => {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      // incomplete (first payment pending), paused: nothing to apply yet
      return null;
  }
};

/**
 * Stripe subscription statuses that still bill (or are about to): a new Checkout would create a
 * second subscription, so the practitioner is sent to the portal instead (#111).
 */
export const BILLING_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'] as const;

export const isBillingSubscription = (status: string): boolean => (BILLING_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

/** Minimal shape of a Stripe subscription read with its items' prices. */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  /** user_id is set by the billing function (subscription_data.metadata). */
  metadata?: Record<string, string> | null;
  items: { data: Array<{ current_period_end: number; price: { lookup_key: string | null } }> };
}

export interface SubscriptionState {
  subscriptionId: string;
  customerId: string;
  plan: PlanId;
  status: 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: string;
  /** The ErgoBilan account, from the subscription metadata: finds it when the customer is not linked (#111). */
  userId: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const customerId = (customer: string | { id: string }): string => (typeof customer === 'string' ? customer : customer.id);

/** What the database must reflect for this subscription; null when it carries no ErgoBilan plan or no state to apply. */
export const describeSubscription = (subscription: StripeSubscriptionLike): SubscriptionState | null => {
  const item = subscription.items.data.find((i) => planFromLookupKey(i.price.lookup_key));
  const plan = item ? planFromLookupKey(item.price.lookup_key) : null;
  const status = mapSubscriptionStatus(subscription.status);
  if (!item || !plan || !status) return null;
  return {
    subscriptionId: subscription.id,
    customerId: customerId(subscription.customer),
    plan,
    status,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
    userId: str(subscription.metadata?.user_id),
  };
};

/** Minimal shape of a Stripe event. */
export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type BillingAction =
  /** Re-read the subscription in Stripe and apply its current state. */
  | { kind: 'subscription'; subscriptionId: string }
  /** A subscription invoice was paid (creation or renewal): reset the monthly credits. */
  | { kind: 'renewal'; invoiceId: string; subscriptionId: string; customerId: string }
  /** A unit purchase was paid: add its quantity to the purchased credits. */
  | { kind: 'credits'; sessionId: string; customerId: string; userId: string | null }
  /**
   * A charge was refunded or disputed: re-read the charge in Stripe and take back the credits
   * of the unit purchase it paid. disputedAmount: the disputed amount (dispute), else null.
   */
  | { kind: 'reversal'; chargeId: string; disputedAmount: number | null }
  | { kind: 'ignore' };

const idOf = (value: unknown): string | null =>
  str(value) ?? (value && typeof value === 'object' ? str((value as { id?: unknown }).id) : null);

/** A Checkout session of a unit purchase (mode payment, metadata kind=credits), whatever its payment status; null otherwise. */
export const describeCreditPurchase = (
  session: Record<string, unknown>,
): { sessionId: string; customerId: string; userId: string | null } | null => {
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  if (session.mode !== 'payment' || metadata.kind !== 'credits') return null;
  const sessionId = str(session.id);
  const customer = idOf(session.customer);
  const userId = str(session.client_reference_id) ?? str(metadata.user_id);
  return sessionId && customer ? { sessionId, customerId: customer, userId } : null;
};

/**
 * Purchased credits to take back for a refunded or disputed unit purchase (#107): the share of
 * the quantity bought that the reversed amount pays for, rounded down. A full refund or dispute
 * takes back every credit; a partial one only the credits it fully pays back (a 5 € goodwill
 * refund on a 9 € credit takes nothing). reversedAmount = amount refunded + amount disputed.
 */
export const creditsToReverse = (quantity: number, chargeAmount: number, reversedAmount: number): number => {
  if (quantity <= 0 || chargeAmount <= 0 || reversedAmount <= 0) return 0;
  return Math.floor((quantity * Math.min(reversedAmount, chargeAmount)) / chargeAmount);
};

/**
 * Which billing action a webhook event triggers. Renewals and purchases are applied
 * once per invoice / checkout session (dedupKey), whatever the number of events.
 */
export const routeEvent = (event: StripeEventLike): BillingAction => {
  const object = event.data.object;
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscriptionId = str(object.id);
      return subscriptionId ? { kind: 'subscription', subscriptionId } : { kind: 'ignore' };
    }
    case 'invoice.paid': {
      // Proration invoices (subscription_update) do not reset the monthly credits:
      // the upgrade difference is granted by billing_apply_subscription.
      const reason = str(object.billing_reason);
      if (reason !== 'subscription_create' && reason !== 'subscription_cycle') return { kind: 'ignore' };
      const parent = object.parent as { subscription_details?: { subscription?: unknown } } | null | undefined;
      const subscriptionId = idOf(parent?.subscription_details?.subscription);
      const invoiceId = str(object.id);
      const customer = idOf(object.customer);
      return invoiceId && subscriptionId && customer
        ? { kind: 'renewal', invoiceId, subscriptionId, customerId: customer }
        : { kind: 'ignore' };
    }
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const purchase = describeCreditPurchase(object);
      return purchase && object.payment_status === 'paid' ? { kind: 'credits', ...purchase } : { kind: 'ignore' };
    }
    case 'charge.refunded': {
      const chargeId = str(object.id);
      return chargeId ? { kind: 'reversal', chargeId, disputedAmount: null } : { kind: 'ignore' };
    }
    case 'charge.dispute.created': {
      const chargeId = idOf(object.charge);
      const amount = typeof object.amount === 'number' ? object.amount : null;
      return chargeId && amount !== null ? { kind: 'reversal', chargeId, disputedAmount: amount } : { kind: 'ignore' };
    }
    default:
      return { kind: 'ignore' };
  }
};

/** Key under which billing_events remembers an applied action (one per invoice, checkout session, charge or event). */
export const dedupKey = (action: BillingAction, eventId: string): string => {
  if (action.kind === 'renewal') return `invoice:${action.invoiceId}`;
  if (action.kind === 'credits') return `checkout:${action.sessionId}`;
  // billing_remove_credits appends the rank of each credit taken back: a refund then a dispute
  // of the same charge, or the same event received twice, never take a credit back twice.
  if (action.kind === 'reversal') return `reversal:${action.chargeId}`;
  return eventId;
};

/**
 * While Stripe runs in test mode (sk_test_ key), payment pages are reserved to test accounts:
 * admins and the comma-separated STRIPE_TEST_ALLOWED_EMAILS. Otherwise any production account
 * could take a real Solo plan with the test card 4242 (#110). Live mode allows everyone.
 */
export const isPaymentAllowed = (
  account: { email: string; isAdmin: boolean },
  testMode: boolean,
  testAllowedEmails: readonly string[],
): boolean => !testMode || account.isAdmin || testAllowedEmails.includes(account.email.trim().toLowerCase());

/** STRIPE_TEST_ALLOWED_EMAILS → normalized list. */
export const parseEmailList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

/** Origins allowed to open a checkout and to receive its redirect (same list as the `generate` function). */
export const isAllowedOrigin = (origin: string, allowed: readonly string[], allowLoopback: boolean): boolean => {
  if (!origin) return false;
  if (allowLoopback) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
    } catch {
      return false;
    }
  }
  return allowed.includes(origin);
};
