/**
 * stripe-webhook — applies Stripe billing events to the database (#107, ADR 0002).
 *
 * - customer.subscription.created/updated/deleted : the subscription is re-read in
 *   Stripe (events may arrive out of order) and applied by billing_apply_subscription
 *   (plan, status, upgrade difference, trial credits kept as purchased credits).
 * - invoice.paid (subscription_create, subscription_cycle) : billing_renew_credits
 *   resets the monthly credits to the plan's quota, only while the subscription is still
 *   active in Stripe (a late retry must not restore a cancelled plan, #111).
 * - End of the retained subscription while another one still bills (double Checkout): the
 *   other one is applied in its place (#111).
 * The account is found by its Stripe customer, or else by the user_id that the billing
 * function sets on the subscription and the checkout session (#111).
 * - checkout.session.completed (unit purchase) : billing_add_credits adds the quantity.
 * - charge.refunded, charge.dispute.created : when the charge paid a unit purchase (found by its
 *   Checkout session), billing_remove_credits takes back the share of the credits that the
 *   refunded + disputed amount pays for, never below 0. Subscription charges are left alone:
 *   a Solo plan ends through its subscription events (#107).
 *
 * No JWT (`verify_jwt = false`): the request is authenticated by its Stripe signature.
 * Every RPC is idempotent (billing_events): a 5xx makes Stripe retry, a 2xx never does.
 * Test events (livemode false) apply only to the test accounts (STRIPE_TEST_ALLOWED_EMAILS)
 * and admins (#110): a test card must not grant a real plan.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@23.0.0';
import { captureEdgeException, captureEdgeMessage } from '../_shared/sentry.ts';
import {
  creditsToReverse,
  dedupKey,
  describeCreditPurchase,
  describeSubscription,
  isPaymentAllowed,
  parseEmailList,
  routeEvent,
  type StripeSubscriptionLike,
  type SubscriptionState,
} from '../_shared/billing.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TEST_ALLOWED_EMAILS = parseEmailList(Deno.env.get('STRIPE_TEST_ALLOWED_EMAILS'));

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

/** A test event may change this account (customer, or else user_id): test account or admin. An unknown one is left to the RPC. */
const isTestAccountAllowed = async (admin: SupabaseClient, customerId: string, userId: string | null): Promise<boolean> => {
  const { data: sub, error } = await admin.from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
  if (error) throw new Error(`subscriptions: ${error.message}`);
  const accountId = sub?.user_id ?? userId;
  if (!accountId) return true;
  const { data: prac, error: pracError } = await admin.from('practitioners').select('email, is_admin').eq('id', accountId).maybeSingle();
  if (pracError) throw new Error(`practitioners: ${pracError.message}`);
  return !prac || isPaymentAllowed({ email: prac.email, isAdmin: prac.is_admin === true }, true, TEST_ALLOWED_EMAILS);
};

const applySubscription = (admin: SupabaseClient, eventKey: string, state: SubscriptionState) =>
  admin.rpc('billing_apply_subscription', {
    p_event_id: eventKey,
    p_customer_id: state.customerId,
    p_subscription_id: state.subscriptionId,
    p_plan_id: state.plan,
    p_status: state.status,
    p_current_period_end: state.currentPeriodEnd,
    p_user_id: state.userId,
  });

/** Another subscription of the same customer still billing an ErgoBilan plan (second Checkout), or null. */
const otherBillingSubscription = async (ended: SubscriptionState): Promise<SubscriptionState | null> => {
  const list = await stripe!.subscriptions.list({ customer: ended.customerId, status: 'active', expand: ['data.items.data.price'] });
  for (const subscription of list.data) {
    if (subscription.id === ended.subscriptionId) continue;
    const state = describeSubscription(subscription as unknown as StripeSubscriptionLike);
    if (state?.status === 'active') return state;
  }
  return null;
};

/** Number of credits bought by a unit purchase Checkout session. */
const purchasedQuantity = async (sessionId: string): Promise<number> => {
  const items = await stripe!.checkout.sessions.listLineItems(sessionId, { limit: 100 });
  return items.data.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!stripe || !STRIPE_WEBHOOK_SECRET || !SUPABASE_SERVICE_ROLE_KEY) {
    await captureEdgeMessage('SERVER_MISCONFIGURED: missing Stripe or service role secret', {
      functionName: 'stripe-webhook',
      level: 'fatal',
    });
    return reply(500, { error: 'SERVER_MISCONFIGURED' });
  }

  const signature = req.headers.get('stripe-signature');
  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature ?? '', STRIPE_WEBHOOK_SECRET);
  } catch {
    return reply(400, { error: 'INVALID_SIGNATURE' });
  }

  const action = routeEvent(event as unknown as Parameters<typeof routeEvent>[0]);
  const key = dedupKey(action, event.id);
  const sentry = (extra: Record<string, unknown> = {}) => ({
    functionName: 'stripe-webhook',
    tags: { stripe_event: event.type, billing_action: action.kind },
    extra: { eventId: event.id, livemode: event.livemode, ...extra },
  });

  try {
    if (action.kind === 'ignore') return reply(200, { result: 'ignored' });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let rpc: { data: unknown; error: { message: string; code?: string } | null };
    const refuseTestEvent = async (customerId: string, userId: string | null) => {
      if (event.livemode || (await isTestAccountAllowed(admin, customerId, userId))) return null;
      await captureEdgeMessage('Stripe test event for a production account: ignored', sentry());
      return reply(200, { result: 'ignored', reason: 'TEST_MODE_ACCOUNT' });
    };

    if (action.kind === 'credits') {
      const refused = await refuseTestEvent(action.customerId, action.userId);
      if (refused) return refused;
      rpc = await admin.rpc('billing_add_credits', {
        p_event_id: key,
        p_customer_id: action.customerId,
        p_quantity: await purchasedQuantity(action.sessionId),
        p_user_id: action.userId,
      });
    } else if (action.kind === 'reversal') {
      // The charge is re-read: amount_refunded is cumulative, whatever the order of the events.
      const charge = await stripe.charges.retrieve(action.chargeId);
      const paymentIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (!paymentIntent) return reply(200, { result: 'ignored', reason: 'NO_PAYMENT_INTENT' });
      const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 1 });
      const session = sessions.data[0];
      const purchase = session ? describeCreditPurchase(session as unknown as Record<string, unknown>) : null;
      // A subscription invoice or any other payment: no purchased credits to take back.
      if (!purchase) return reply(200, { result: 'ignored', reason: 'NOT_A_CREDIT_PURCHASE' });
      const refused = await refuseTestEvent(purchase.customerId, purchase.userId);
      if (refused) return refused;
      const reversed = charge.amount_refunded + (action.disputedAmount ?? 0);
      const count = creditsToReverse(await purchasedQuantity(purchase.sessionId), charge.amount, reversed);
      if (count === 0) return reply(200, { result: 'ignored', reason: 'NO_CREDIT_TO_REVERSE' });
      rpc = await admin.rpc('billing_remove_credits', {
        p_event_id: key,
        p_customer_id: purchase.customerId,
        p_count: count,
        p_user_id: purchase.userId,
      });
    } else {
      const subscription = await stripe.subscriptions.retrieve(action.subscriptionId, { expand: ['items.data.price'] });
      const state = describeSubscription(subscription as unknown as StripeSubscriptionLike);
      if (!state) return reply(200, { result: 'ignored', status: subscription.status });
      const refused = await refuseTestEvent(state.customerId, state.userId);
      if (refused) return refused;
      if (action.kind === 'renewal') {
        // A late retry of a paid invoice: the subscription has been cancelled since.
        if (state.status !== 'active') return reply(200, { result: 'ignored', status: subscription.status });
        rpc = await admin.rpc('billing_renew_credits', {
          p_event_id: key,
          p_customer_id: state.customerId,
          p_subscription_id: state.subscriptionId,
          p_plan_id: state.plan,
          p_current_period_end: state.currentPeriodEnd,
          p_user_id: state.userId,
        });
      } else {
        rpc = await applySubscription(admin, key, state);
        if (!rpc.error && rpc.data === 'applied' && state.status === 'canceled') {
          const replacement = await otherBillingSubscription(state);
          if (replacement) rpc = await applySubscription(admin, `${key}:${replacement.subscriptionId}`, replacement);
        }
      }
    }

    if (rpc.error) {
      await captureEdgeMessage(`DB billing (${action.kind}) failed: ${rpc.error.code ?? ''} ${rpc.error.message}`, {
        ...sentry({ code: rpc.error.code }),
        level: 'error',
      });
      return reply(500, { error: 'DB_ERROR' });
    }
    // Nothing to retry: a customer created outside the app, or a deleted account.
    if (rpc.data === 'unknown_customer') await captureEdgeMessage('Stripe customer not linked to any account', sentry());
    return reply(200, { result: rpc.data });
  } catch (err) {
    await captureEdgeException(err, sentry());
    return reply(500, { error: 'INTERNAL_ERROR' });
  }
});
