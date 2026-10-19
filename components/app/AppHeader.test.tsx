// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppHeader } from './AppHeader';
import { ToastProvider } from '../../contexts/ToastContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import type { UserProfile } from '../../types';

const profile = (isAdmin: boolean) =>
  ({ email: 'recette@example.test', credits: 5, isAdmin, branding: { practitionerName: 'Bot Recette' } }) as unknown as UserProfile;

const renderHeader = (isAdmin: boolean) => {
  const handlers = { onShowPricing: vi.fn(), onOpenAdmin: vi.fn() };
  render(
    <ThemeProvider>
      <ToastProvider>
        <AppHeader
          isAssessment={false}
          isAutoSaving={false}
          onSaveAndQuit={vi.fn()}
          userProfile={profile(isAdmin)}
          practitioner={null}
          isDemoMode={false}
          onHome={vi.fn()}
          onOpenProfile={vi.fn()}
          onLogout={vi.fn()}
          onImported={vi.fn()}
          {...handlers}
        />
      </ToastProvider>
    </ThemeProvider>,
  );
  return handlers;
};

describe('AppHeader : pastille de crédits', () => {
  it('ouvre les offres avec le solde du compte', () => {
    const h = renderHeader(false);
    fireEvent.click(screen.getByRole('button', { name: /5 Crédits/ }));
    expect(h.onShowPricing).toHaveBeenCalled();
  });

  it('admin : un badge, et un seul bouton « Admin », celui du menu', () => {
    const h = renderHeader(true);
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Menu du compte' }));
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(h.onOpenAdmin).toHaveBeenCalled();
  });
});
