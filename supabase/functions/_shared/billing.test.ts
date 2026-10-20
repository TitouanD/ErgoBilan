import { describe, expect, it } from 'vitest';
import {
  creditsToReverse,
  dedupKey,
  describeCreditPurchase,
  describeSubscription,
  isBillingSubscription,
  isPaymentAllowed,
  parseEmailList,
  planFromLookupKey,
  routeEvent,
} from './billing';

const subscription = (status: string, lookupKey: string | null = 'formule_performance') => ({
  id: 'sub_1',
  status,
  customer: { id: 'cus_1' },
  items: { data: [{ current_period_end: 1_800_000_000, price: { lookup_key: lookupKey } }] },
});

const event = (type: string, object: Record<string, unknown>) => ({ id: 'evt_1', type, data: { object } });

describe('prix Stripe', () => {
  it("retrouve la formule d'un prix d'abonnement et ignore les autres prix", () => {
    expect(planFromLookupKey('formule_expert')).toBe('expert');
    expect(planFromLookupKey('unite_expert')).toBeNull();
    expect(planFromLookupKey('formule_illimitee')).toBeNull();
    expect(planFromLookupKey(null)).toBeNull();
  });

  it('reconnaît la formule Solo et les anciennes formules', () => {
    expect(planFromLookupKey('formule_solo')).toBe('solo');
    expect(planFromLookupKey('formule_performance')).toBe('performance');
  });
});

describe('describeSubscription', () => {
  it("décrit l'état à reporter en base", () => {
    expect(describeSubscription(subscription('active'))).toEqual({
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
      plan: 'performance',
      status: 'active',
      currentPeriodEnd: new Date(1_800_000_000_000).toISOString(),
      userId: null,
    });
  });

  it('traduit les statuts Stripe et attend la fin du premier paiement', () => {
    expect(describeSubscription(subscription('unpaid'))?.status).toBe('past_due');
    expect(describeSubscription(subscription('incomplete_expired'))?.status).toBe('canceled');
    expect(describeSubscription(subscription('incomplete'))).toBeNull();
  });

  it('ignore un abonnement sans formule ErgoBilan', () => {
    expect(describeSubscription(subscription('active', 'autre_produit'))).toBeNull();
  });
});

describe('routeEvent', () => {
  it('relit l’abonnement à chaque changement', () => {
    expect(routeEvent(event('customer.subscription.updated', { id: 'sub_1' }))).toEqual({ kind: 'subscription', subscriptionId: 'sub_1' });
    expect(routeEvent(event('customer.subscription.deleted', { id: 'sub_1' }))).toEqual({ kind: 'subscription', subscriptionId: 'sub_1' });
  });

  it('renouvelle les crédits sur une facture de création ou de renouvellement, pas sur un prorata', () => {
    const invoice = (billing_reason: string) =>
      event('invoice.paid', { id: 'in_1', billing_reason, customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } } });
    const renewal = { kind: 'renewal', invoiceId: 'in_1', subscriptionId: 'sub_1', customerId: 'cus_1' };
    expect(routeEvent(invoice('subscription_cycle'))).toEqual(renewal);
    expect(routeEvent(invoice('subscription_create'))).toEqual(renewal);
    expect(routeEvent(invoice('subscription_update'))).toEqual({ kind: 'ignore' });
  });

  it("n'ajoute des crédits que pour un achat à l'unité payé", () => {
    const session = (overrides: Record<string, unknown>) =>
      event('checkout.session.completed', {
        id: 'cs_1',
        customer: 'cus_1',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { kind: 'credits' },
        ...overrides,
      });
    expect(routeEvent(session({}))).toEqual({ kind: 'credits', sessionId: 'cs_1', customerId: 'cus_1', userId: null });
    expect(routeEvent(session({ payment_status: 'unpaid' }))).toEqual({ kind: 'ignore' });
    expect(routeEvent(session({ mode: 'subscription' }))).toEqual({ kind: 'ignore' });
    expect(routeEvent(session({ metadata: {} }))).toEqual({ kind: 'ignore' });
  });

  it('applique une seule fois une facture ou un achat, même reçus par plusieurs événements', () => {
    const paid = event('checkout.session.completed', {
      id: 'cs_1',
      customer: 'cus_1',
      mode: 'payment',
      payment_status: 'paid',
      metadata: { kind: 'credits' },
    });
    const async = { ...paid, id: 'evt_2', type: 'checkout.session.async_payment_succeeded' };
    expect(dedupKey(routeEvent(paid), paid.id)).toBe(dedupKey(routeEvent(async), async.id));
    expect(dedupKey({ kind: 'subscription', subscriptionId: 'sub_1' }, 'evt_7')).toBe('evt_7');
  });
});

describe('paiement de test réservé aux comptes de test (#110)', () => {
  const list = parseEmailList(' Testeuse@Exemple.fr , e2e@exemple.fr,, ');
  const account = (email: string, isAdmin = false) => ({ email, isAdmin });

  it('lit la liste sans espaces ni majuscules', () => {
    expect(list).toEqual(['testeuse@exemple.fr', 'e2e@exemple.fr']);
    expect(parseEmailList(undefined)).toEqual([]);
  });

  it('en mode test, refuse un compte de production et accepte les comptes de test et les admins', () => {
    expect(isPaymentAllowed(account('cliente@cabinet.fr'), true, list)).toBe(false);
    expect(isPaymentAllowed(account('TESTEUSE@exemple.fr'), true, list)).toBe(true);
    expect(isPaymentAllowed(account('admin@ergobilan.com', true), true, list)).toBe(true);
  });

  it('en mode réel, accepte tout le monde', () => {
    expect(isPaymentAllowed(account('cliente@cabinet.fr'), false, [])).toBe(true);
  });
});

describe('robustesse Stripe (#111)', () => {
  it("retrouve l'utilisateur d'un abonnement ou d'un achat, pour un client Stripe non rattaché", () => {
    expect(describeSubscription({ ...subscription('active'), metadata: { user_id: 'u_1' } })?.userId).toBe('u_1');
    const paid = event('checkout.session.completed', {
      id: 'cs_1',
      customer: 'cus_1',
      mode: 'payment',
      payment_status: 'paid',
      client_reference_id: 'u_2',
      metadata: { kind: 'credits', user_id: 'u_3' },
    });
    expect(routeEvent(paid)).toMatchObject({ kind: 'credits', userId: 'u_2' });
  });

  it('renvoie vers le portail tant qu’un abonnement facture encore', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete']) expect(isBillingSubscription(status)).toBe(true);
    for (const status of ['canceled', 'incomplete_expired', 'paused']) expect(isBillingSubscription(status)).toBe(false);
  });
});

describe('remboursement ou litige d’un achat à l’unité (#107)', () => {
  it('relit la charge remboursée ou contestée', () => {
    expect(routeEvent(event('charge.refunded', { id: 'ch_1', amount: 2700, amount_refunded: 900 }))).toEqual({
      kind: 'reversal',
      chargeId: 'ch_1',
      disputedAmount: null,
    });
    expect(routeEvent(event('charge.dispute.created', { id: 'dp_1', charge: 'ch_1', amount: 2700 }))).toEqual({
      kind: 'reversal',
      chargeId: 'ch_1',
      disputedAmount: 2700,
    });
    expect(routeEvent(event('charge.dispute.created', { id: 'dp_1', amount: 2700 }))).toEqual({ kind: 'ignore' });
  });

  it('compte les crédits retirés par charge : un remboursement puis un litige ne se cumulent pas deux fois', () => {
    const refund = routeEvent(event('charge.refunded', { id: 'ch_1' }));
    const dispute = routeEvent({ ...event('charge.dispute.created', { id: 'dp_1', charge: { id: 'ch_1' }, amount: 900 }), id: 'evt_2' });
    expect(dedupKey(refund, 'evt_1')).toBe('reversal:ch_1');
    expect(dedupKey(dispute, 'evt_2')).toBe('reversal:ch_1');
  });

  it('retire la part remboursée de la quantité achetée, arrondie à l’inférieur', () => {
    expect(creditsToReverse(3, 2700, 2700)).toBe(3);
    expect(creditsToReverse(3, 2700, 1800)).toBe(2);
    // Geste commercial de 5 € sur un crédit à 9 € : le crédit reste.
    expect(creditsToReverse(1, 900, 500)).toBe(0);
    expect(creditsToReverse(3, 2700, 2000)).toBe(2);
    // Remboursement et litige cumulés au-delà de la charge : plafonné à la quantité.
    expect(creditsToReverse(3, 2700, 5400)).toBe(3);
    expect(creditsToReverse(3, 0, 900)).toBe(0);
    expect(creditsToReverse(0, 2700, 2700)).toBe(0);
  });

  it("ne retient qu'une session Checkout d'achat à l'unité, quel que soit son statut de paiement", () => {
    const session = {
      id: 'cs_1',
      customer: 'cus_1',
      mode: 'payment',
      payment_status: 'paid',
      metadata: { kind: 'credits', user_id: 'u_1' },
    };
    expect(describeCreditPurchase(session)).toEqual({ sessionId: 'cs_1', customerId: 'cus_1', userId: 'u_1' });
    expect(describeCreditPurchase({ ...session, mode: 'subscription' })).toBeNull();
    expect(describeCreditPurchase({ ...session, metadata: {} })).toBeNull();
  });
});
