// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  billingSignature,
  planMonthlyCredits,
  readEdgeErrorBody,
  rememberBillingState,
  subscriptionBanner,
  takeRememberedBillingState,
  waitForBillingChange,
} from './billing';

describe('readEdgeErrorBody (#110)', () => {
  it("lit le code d'erreur renvoyé par l'edge billing", async () => {
    const error = { context: new Response(JSON.stringify({ error: 'PAYMENT_NOT_AVAILABLE' }), { status: 403 }) };
    expect(await readEdgeErrorBody(error)).toEqual({ error: 'PAYMENT_NOT_AVAILABLE' });
  });

  it('renvoie null sans réponse exploitable', async () => {
    expect(await readEdgeErrorBody(new Error('réseau'))).toBeNull();
    expect(await readEdgeErrorBody({ context: new Response('pas du JSON', { status: 500 }) })).toBeNull();
  });
});

describe('retour de Stripe : attente du webhook (#111)', () => {
  const profile = (monthlyCredits: number, billingSource: 'stripe' | null = null) => ({
    subscriptionPlan: billingSource ? ('solo' as const) : ('free' as const),
    status: billingSource ? ('active' as const) : ('trialing' as const),
    billingSource,
    monthlyCredits,
    purchasedCredits: 0,
  });

  it('relit le profil jusqu’à voir le changement apporté par le webhook', async () => {
    const before = billingSignature(profile(3));
    const reads = [profile(3), profile(3), profile(30, 'stripe')];
    const refresh = vi.fn(async () => reads.shift() ?? null);
    expect(await waitForBillingChange(refresh, before, { intervalMs: 1 })).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('abandonne après le nombre de lectures prévu', async () => {
    const refresh = vi.fn(async () => profile(3));
    expect(await waitForBillingChange(refresh, billingSignature(profile(3)), { intervalMs: 1, attempts: 4 })).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('sans état mémorisé avant Stripe, une lecture suffit', async () => {
    const refresh = vi.fn(async () => profile(3));
    expect(await waitForBillingChange(refresh, null, { intervalMs: 1 })).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('mémorise l’état avant Stripe pour une seule lecture au retour', () => {
    rememberBillingState(profile(3));
    expect(takeRememberedBillingState()).toBe(billingSignature(profile(3)));
    expect(takeRememberedBillingState()).toBeNull();
  });
});

describe('bandeau d’abonnement du dashboard (#112)', () => {
  const base = {
    isAdmin: false,
    isTrial: false,
    trialDenied: false,
    status: 'inactive' as const,
    subscriptionPlan: 'free' as const,
    credits: 0,
  };

  it("annonce l'essai en cours", () => {
    expect(subscriptionBanner({ ...base, isTrial: true, status: 'trialing', credits: 3 })).toBe('trial');
  });

  it("essai refusé : dit que l'essai a déjà été utilisé, pas « en essai »", () => {
    expect(subscriptionBanner({ ...base, trialDenied: true, status: 'trialing' })).toBe('trialUsed');
  });

  it('essai refusé puis crédits achetés, ou compte passé sans formule : solde affiché', () => {
    expect(subscriptionBanner({ ...base, trialDenied: true, status: 'trialing', credits: 10 })).toBe('noPlan');
    expect(subscriptionBanner({ ...base, trialDenied: true, status: 'canceled' })).toBe('noPlan');
  });

  it("rien pour une formule active, ni pour l'admin qui génère sans crédit", () => {
    expect(subscriptionBanner({ ...base, status: 'active', subscriptionPlan: 'solo', credits: 30 })).toBe('none');
    expect(subscriptionBanner({ ...base, isAdmin: true })).toBe('none');
  });
});

describe('planMonthlyCredits (#112)', () => {
  it('reprend les quotas de plan_monthly_credits', () => {
    expect(planMonthlyCredits('solo')).toBe(30);
    expect(planMonthlyCredits('expert')).toBe(20);
    expect(planMonthlyCredits('free')).toBe(0);
  });
});
