import { describe, expect, it, vi } from 'vitest';

const rows: Record<string, unknown> = {};
const query = (table: string) => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: rows[table], error: null }),
    maybeSingle: async () => ({ data: rows[table], error: null }),
  };
  return chain;
};
vi.mock('./db', () => ({ supabase: { from: (table: string) => query(table) } }));

import { ProfileService } from './profile';

const inTenDays = () => new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();

const practitioner = (trialDenied: boolean, credits: number) => ({
  email: 'cliente@example.test',
  credits,
  monthly_credits: 0,
  trial_denied: trialDenied,
  is_admin: false,
  first_name: 'Cliente',
  last_name: 'FICTIF',
  phone_pro: null,
  siret: null,
  address_pro: null,
  branding_config: null,
});

describe('ProfileService.getUserProfile : essai (#112)', () => {
  it('un essai en cours est un essai, avec ses jours restants', async () => {
    rows.practitioners = practitioner(false, 3);
    rows.subscriptions = {
      plan_id: 'free',
      status: 'trialing',
      trial_ends_at: inTenDays(),
      current_period_end: null,
      billing_source: null,
    };
    const profile = await ProfileService.getUserProfile('u1');
    expect(profile).toMatchObject({ isTrial: true, trialDaysRemaining: 10 });
  });

  it("un essai refusé (adresse déjà utilisée) n'est pas présenté comme un essai", async () => {
    rows.practitioners = practitioner(true, 0);
    rows.subscriptions = {
      plan_id: 'free',
      status: 'trialing',
      trial_ends_at: inTenDays(),
      current_period_end: null,
      billing_source: null,
    };
    const profile = await ProfileService.getUserProfile('u1');
    expect(profile).toMatchObject({ isTrial: false, trialDaysRemaining: 0, trialDenied: true, status: 'trialing' });
  });
});
