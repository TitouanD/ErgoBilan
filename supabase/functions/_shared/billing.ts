/**
 * billing.ts — Stripe ↔ ErgoBilan rules shared by the `billing` and `stripe-webhook`
 * edge functions (#107, ADR 0002). Pure: no Stripe SDK, no Deno API, tested by Vitest.
 *
 * Prices are found by lookup key, never by id: the same keys exist in test and live mode.
 *   formule_<plan> : monthly subscription of a plan
 *   unite_<plan>   : one purchased credit at the plan's price (unite_essential without a plan)
 */

export type PlanId = 'essential' | 'performance' | 'expert';

export const PLANS: readonly PlanId[] = ['essential', 'performance', 'expert'];

export const isPlan = (value: unknown): value is PlanId => PLANS.includes(value as PlanId);

export const planLookupKey = (plan: PlanId): string => `formule_${plan}`;

/** Unit price of the practitioner's plan; without an active plan, the highest one (Essential's). */
export const unitLookupKey = (plan: string | null | undefined): string => `unite_${isPlan(plan) ? plan : 'essential'}`;

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

/** Minimal shape of a Stripe subscription read with its items' prices. */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  items: { data: Array<{ current_period_end: number; price: { lookup_key: string | null } }> };
}

export interface SubscriptionState {
  subscriptionId: string;
  customerId: string;
  plan: PlanId;
  status: 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: string;
}

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
  | { kind: 'credits'; sessionId: string; customerId: string }
  | { kind: 'ignore' };

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const idOf = (value: unknown): string | null =>
  str(value) ?? (value && typeof value === 'object' ? str((value as { id?: unknown }).id) : null);

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
      const metadata = (object.metadata ?? {}) as Record<string, unknown>;
      if (object.mode !== 'payment' || object.payment_status !== 'paid' || metadata.kind !== 'credits') return { kind: 'ignore' };
      const sessionId = str(object.id);
      const customer = idOf(object.customer);
      return sessionId && customer ? { kind: 'credits', sessionId, customerId: customer } : { kind: 'ignore' };
    }
    default:
      return { kind: 'ignore' };
  }
};

/** Key under which billing_events remembers an applied action (one per invoice, checkout session or event). */
export const dedupKey = (action: BillingAction, eventId: string): string => {
  if (action.kind === 'renewal') return `invoice:${action.invoiceId}`;
  if (action.kind === 'credits') return `checkout:${action.sessionId}`;
  return eventId;
};

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
