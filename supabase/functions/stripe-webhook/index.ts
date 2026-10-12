/**
 * stripe-webhook — applies Stripe billing events to the database (#107, ADR 0002).
 *
 * - customer.subscription.created/updated/deleted : the subscription is re-read in
 *   Stripe (events may arrive out of order) and applied by billing_apply_subscription
 *   (plan, status, upgrade difference, trial credits kept as purchased credits).
 * - invoice.paid (subscription_create, subscription_cycle) : billing_renew_credits
 *   resets the monthly credits to the plan's quota.
 * - checkout.session.completed (unit purchase) : billing_add_credits adds the quantity.
 *
 * No JWT (`verify_jwt = false`): the request is authenticated by its Stripe signature.
 * Every RPC is idempotent (billing_events): a 5xx makes Stripe retry, a 2xx never does.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@23.0.0';
import { captureEdgeException, captureEdgeMessage } from '../_shared/sentry.ts';
import { dedupKey, describeSubscription, routeEvent, type StripeSubscriptionLike } from '../_shared/billing.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

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

    if (action.kind === 'credits') {
      const items = await stripe.checkout.sessions.listLineItems(action.sessionId, { limit: 100 });
      const quantity = items.data.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      rpc = await admin.rpc('billing_add_credits', { p_event_id: key, p_customer_id: action.customerId, p_quantity: quantity });
    } else {
      const subscription = await stripe.subscriptions.retrieve(action.subscriptionId, { expand: ['items.data.price'] });
      const state = describeSubscription(subscription as unknown as StripeSubscriptionLike);
      if (!state) return reply(200, { result: 'ignored', status: subscription.status });
      rpc =
        action.kind === 'renewal'
          ? await admin.rpc('billing_renew_credits', {
              p_event_id: key,
              p_customer_id: state.customerId,
              p_subscription_id: state.subscriptionId,
              p_plan_id: state.plan,
              p_current_period_end: state.currentPeriodEnd,
            })
          : await admin.rpc('billing_apply_subscription', {
              p_event_id: key,
              p_customer_id: state.customerId,
              p_subscription_id: state.subscriptionId,
              p_plan_id: state.plan,
              p_status: state.status,
              p_current_period_end: state.currentPeriodEnd,
            });
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
