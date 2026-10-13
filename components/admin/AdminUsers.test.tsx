// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminUserRow } from '../../types';

const listUsers = vi.fn();
const updateUser = vi.fn();
vi.mock('../../services/admin', () => ({
  AdminService: { listUsers: () => listUsers(), updateUser: (payload: unknown) => updateUser(payload) },
}));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import { AdminUsers } from './AdminUsers';

const row = (patch: Partial<AdminUserRow> = {}): AdminUserRow => ({
  user_id: 'u1',
  email: 'cliente@example.test',
  first_name: 'Cliente',
  last_name: 'FICTIF',
  is_admin: false,
  credits: 5,
  monthly_credits: 0,
  billing_source: null,
  organization_id: null,
  organization_name: null,
  organization_role: null,
  subscription_plan: 'free',
  subscription_status: 'inactive',
  trial_ends_at: null,
  current_period_end: null,
  monthly_extraction_quota: 0,
  created_at: '2026-10-01T00:00:00Z',
  ...patch,
});

const renderWith = async (user: AdminUserRow) => {
  listUsers.mockResolvedValue([user]);
  render(<AdminUsers />);
  await screen.findByText('cliente@example.test');
};

const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
  await waitFor(() => expect(updateUser).toHaveBeenCalled());
  return updateUser.mock.calls[0][0] as Record<string, unknown>;
};

describe('AdminUsers : enregistrement (#112)', () => {
  beforeEach(() => {
    listUsers.mockReset();
    updateUser.mockReset().mockResolvedValue({ ok: true, user_id: 'u1' });
  });

  it("n'envoie pas le solde de crédits achetés quand il n'a pas été touché", async () => {
    // Bought in between: sending the loaded balance (5) would erase them.
    await renderWith(row());
    fireEvent.change(screen.getByLabelText('Formule'), { target: { value: 'solo' } });
    const payload = await save();
    expect(payload).not.toHaveProperty('credits');
    expect(payload).not.toHaveProperty('isAdmin');
    expect(payload).toMatchObject({ userId: 'u1', planId: 'solo' });
  });

  it('envoie les crédits achetés quand ils ont été modifiés', async () => {
    await renderWith(row());
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '12' } });
    expect(await save()).toEqual({ userId: 'u1', credits: 12 });
  });

  it('offrir une formule à un compte en essai la passe en active', async () => {
    await renderWith(row({ subscription_status: 'trialing' }));
    fireEvent.change(screen.getByLabelText('Formule'), { target: { value: 'solo' } });
    expect((screen.getByLabelText('Statut') as HTMLSelectElement).value).toBe('active');
    expect(await save()).toEqual({ userId: 'u1', planId: 'solo', status: 'active' });
  });

  it('retirer une formule offerte remet ses crédits du mois à 0', async () => {
    await renderWith(row({ subscription_plan: 'solo', subscription_status: 'active', billing_source: 'offerte', monthly_credits: 30 }));
    fireEvent.change(screen.getByLabelText('Formule'), { target: { value: 'free' } });
    expect(await save()).toEqual({ userId: 'u1', planId: 'free', monthlyCredits: 0 });
  });

  it('garde les crédits du mois saisis à la main en retirant la formule', async () => {
    await renderWith(row({ subscription_plan: 'solo', subscription_status: 'active', billing_source: 'offerte', monthly_credits: 30 }));
    fireEvent.change(screen.getByLabelText('Statut'), { target: { value: 'canceled' } });
    fireEvent.change(screen.getByLabelText('Crédits du mois'), { target: { value: '4' } });
    expect(await save()).toEqual({ userId: 'u1', status: 'canceled', monthlyCredits: 4 });
  });

  it("grise formule et statut d'un compte payé par Stripe", async () => {
    await renderWith(row({ subscription_plan: 'solo', subscription_status: 'active', billing_source: 'stripe', monthly_credits: 30 }));
    expect((screen.getByLabelText('Formule') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Statut') as HTMLSelectElement).disabled).toBe(true);
  });

  it("n'attribue que Solo (ou aucune formule)", async () => {
    await renderWith(row());
    const options = () => Array.from((screen.getByLabelText('Formule') as HTMLSelectElement).options).map((o) => o.value);
    expect(options()).toEqual(['free', 'solo']);
  });

  it("affiche l'ancienne formule d'un compte qui l'a encore", async () => {
    await renderWith(row({ subscription_plan: 'performance', subscription_status: 'active', billing_source: 'offerte' }));
    const select = screen.getByLabelText('Formule') as HTMLSelectElement;
    expect(select.value).toBe('performance');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['free', 'solo', 'performance']);
  });
});
