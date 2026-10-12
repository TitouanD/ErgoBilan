/**
 * billing — opens Stripe pages for the signed-in practitioner (#107, ADR 0002).
 *
 * POST { action: 'subscribe', plan }  -> Checkout (subscription) of the Solo plan, or the customer
 *                                      portal when a paid plan already exists (cancellation
 *                                      goes through the portal).
 * POST { action: 'buy_credits' }      -> Checkout (one-off payment) of purchased credits, only
 *                                      without an active plan (quantity chosen on the Stripe page).
 * POST { action: 'portal' }           -> customer portal (invoices, card, plan, cancellation).
 * Answer: { url } to redirect to. Credits are granted by `stripe-webhook`, never here.
 *
 * `verify_jwt` is disabled at the gateway: the JWT is verified here (same as `generate`).
 * Allowed origins: AI_ALLOWED_ORIGINS (the app's domains), used for the return URLs.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@23.0.0';
import { captureEdgeException, captureEdgeMessage } from '../_shared/sentry.ts';
import { isAllowedOrigin, planLookupKey, SOLD_PLAN, UNIT_LOOKUP_KEY } from '../_shared/billing.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const IS_PRODUCTION = !!Deno.env.get('DENO_DEPLOYMENT_ID');
const ALLOW_LOOPBACK = (Deno.env.get('AI_ALLOW_LOOPBACK_ORIGINS') ?? String(!IS_PRODUCTION)).trim().toLowerCase() === 'true';
const ALLOWED_ORIGINS = (Deno.env.get('AI_ALLOWED_ORIGINS') || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const MAX_UNITS_PER_PURCHASE = 20;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const allowed = (origin: string) => isAllowedOrigin(origin, ALLOWED_ORIGINS, ALLOW_LOOPBACK);

const corsHeaders = (origin: string): Record<string, string> => ({
  ...(allowed(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

const json = (origin: string, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });

type Account = {
  email: string;
  name: string;
  planId: string;
  status: string;
  billingSource: string | null;
  customerId: string | null;
};

const readAccount = async (admin: SupabaseClient, userId: string): Promise<Account | null> => {
  const [{ data: prac }, { data: sub }] = await Promise.all([
    admin.from('practitioners').select('email, first_name, last_name').eq('id', userId).maybeSingle(),
    admin.from('subscriptions').select('plan_id, status, billing_source, stripe_customer_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (!prac || !sub) return null;
  return {
    email: prac.email,
    name: `${prac.first_name ?? ''} ${prac.last_name ?? ''}`.trim(),
    planId: sub.plan_id,
    status: sub.status,
    billingSource: sub.billing_source,
    customerId: sub.stripe_customer_id,
  };
};

/**
 * The practitioner's Stripe customer, created on first use. A stored id unknown to the
 * current Stripe mode (test customer after the switch to live) is replaced.
 */
const ensureCustomer = async (admin: SupabaseClient, userId: string, account: Account): Promise<string> => {
  if (account.customerId) {
    try {
      const existing = await stripe!.customers.retrieve(account.customerId);
      if (!('deleted' in existing && existing.deleted)) return existing.id;
    } catch (err) {
      if ((err as { code?: string }).code !== 'resource_missing') throw err;
    }
  }
  const customer = await stripe!.customers.create({
    email: account.email,
    ...(account.name ? { name: account.name } : {}),
    preferred_locales: ['fr'],
    metadata: { user_id: userId },
  });
  const { error } = await admin.rpc('billing_set_customer', { p_user_id: userId, p_customer_id: customer.id });
  if (error) throw new Error(`billing_set_customer: ${error.message}`);
  return customer.id;
};

const priceId = async (lookupKey: string): Promise<string> => {
  const prices = await stripe!.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (!prices.data[0]) throw new Error(`No active Stripe price for lookup key ${lookupKey}`);
  return prices.data[0].id;
};

const portalUrl = async (customer: string, origin: string) =>
  (await stripe!.billingPortal.sessions.create({ customer, return_url: `${origin}/`, locale: 'fr' })).url;

/**
 * Terms of sale: a required checkbox in live mode, which needs the terms URL in the account's
 * public details (Stripe refuses the session otherwise). The test sandbox cannot set it: there,
 * a line under the pay button states the terms instead.
 */
const IS_TEST_MODE = (STRIPE_SECRET_KEY ?? '').startsWith('sk_test_');
const TERMS_URL = 'https://app.ergobilan.com/?legal=cgv';

/**
 * Settings shared by both kinds of Checkout: invoice identity, terms of sale accepted.
 * Payment methods (card only, with Apple Pay / Google Pay) are those enabled in the Stripe
 * account settings: this API version no longer takes payment_method_types.
 */
const checkoutBase = (customer: string, userId: string, origin: string): Stripe.Checkout.SessionCreateParams => ({
  customer,
  client_reference_id: userId,
  locale: 'fr',
  billing_address_collection: 'required',
  customer_update: { address: 'auto', name: 'auto' },
  // App theme (index.css: --app-bg, --primary); Nunito is Stripe's closest font to Quicksand.
  branding_settings: {
    display_name: 'ErgoBilan',
    background_color: '#faf8f4',
    button_color: '#e07a5f',
    border_style: 'rounded',
    font_family: 'nunito',
  },
  ...(IS_TEST_MODE
    ? { custom_text: { submit: { message: `En payant, vous acceptez les Conditions Générales de Vente : ${TERMS_URL}` } } }
    : { consent_collection: { terms_of_service: 'required' } }),
  success_url: `${origin}/?paiement=ok`,
  cancel_url: `${origin}/?paiement=annule`,
});

Deno.serve(async (req: Request) => {
  const origin = (req.headers.get('origin') || '').trim();
  if (req.method === 'OPTIONS') {
    return allowed(origin) ? new Response('ok', { headers: corsHeaders(origin) }) : new Response('forbidden', { status: 403 });
  }

  let userId: string | null = null;
  try {
    if (!allowed(origin)) return json(origin, 403, { error: 'FORBIDDEN_ORIGIN' });
    if (req.method !== 'POST') return json(origin, 405, { error: 'METHOD_NOT_ALLOWED' });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(origin, 401, { error: 'Missing authorization' });
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return json(origin, 401, { error: 'Unauthorized' });
    userId = user.id;

    if (!stripe || !SUPABASE_SERVICE_ROLE_KEY) {
      await captureEdgeMessage('SERVER_MISCONFIGURED: missing STRIPE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY', {
        functionName: 'billing',
        level: 'fatal',
        userId,
      });
      return json(origin, 500, { error: 'SERVER_MISCONFIGURED' });
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = (await req.json().catch(() => ({}))) as { action?: unknown; plan?: unknown };
    const account = await readAccount(admin, userId);
    if (!account) return json(origin, 404, { error: 'ACCOUNT_NOT_FOUND' });
    const customer = await ensureCustomer(admin, userId, account);

    if (body.action === 'portal') return json(origin, 200, { url: await portalUrl(customer, origin) });

    if (body.action === 'subscribe') {
      if (body.plan !== SOLD_PLAN) return json(origin, 400, { error: 'INVALID_PLAN' });
      // A paid plan is changed or cancelled in the portal, never by a second subscription.
      if (account.billingSource === 'stripe') return json(origin, 200, { url: await portalUrl(customer, origin) });
      const session = await stripe.checkout.sessions.create({
        ...checkoutBase(customer, userId, origin),
        mode: 'subscription',
        line_items: [{ price: await priceId(planLookupKey(SOLD_PLAN)), quantity: 1 }],
        subscription_data: { metadata: { user_id: userId } },
      });
      return json(origin, 200, { url: session.url });
    }

    if (body.action === 'buy_credits') {
      // A plan already includes its monthly credits (« illimité* »): unit purchases are for accounts without one.
      if ((account.status === 'active' || account.status === 'past_due') && account.planId !== 'free') {
        return json(origin, 409, { error: 'PLAN_ACTIVE' });
      }
      const session = await stripe.checkout.sessions.create({
        ...checkoutBase(customer, userId, origin),
        mode: 'payment',
        line_items: [
          {
            price: await priceId(UNIT_LOOKUP_KEY),
            quantity: 1,
            adjustable_quantity: { enabled: true, minimum: 1, maximum: MAX_UNITS_PER_PURCHASE },
          },
        ],
        invoice_creation: { enabled: true },
        metadata: { kind: 'credits', user_id: userId },
      });
      return json(origin, 200, { url: session.url });
    }

    return json(origin, 400, { error: 'INVALID_ACTION' });
  } catch (err) {
    await captureEdgeException(err, { functionName: 'billing', userId, request: req });
    return json(origin, 500, { error: 'Internal server error' });
  }
});
