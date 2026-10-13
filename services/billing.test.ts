// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { billingSignature, readEdgeErrorBody, rememberBillingState, takeRememberedBillingState, waitForBillingChange } from './billing';

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
