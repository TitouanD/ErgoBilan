// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingExperience } from './OnboardingExperience';

const auth = vi.hoisted(() => ({ isDemoMode: false, userProfile: { trialDenied: false, credits: 3 } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));

/** Goes to the last step (welcome offer), as after a sign-up. */
const openWelcomeStep = async () => {
  render(<OnboardingExperience onComplete={vi.fn()} />);
  for (const name of [/c'est parti/i, /j'ai compris/i, /suivant/i]) await userEvent.click(screen.getByRole('button', { name }));
};

describe('OnboardingExperience, welcome step (#113)', () => {
  it('announces the 3 offered assessments when the trial is granted', async () => {
    auth.userProfile = { trialDenied: false, credits: 3 };
    await openWelcomeStep();
    expect(screen.getAllByText(/3 bilans offerts/i).length).toBeGreaterThan(0);
  });

  it('does not announce offered assessments when the trial is denied', async () => {
    auth.userProfile = { trialDenied: true, credits: 0 };
    await openWelcomeStep();
    expect(screen.queryByText(/3 bilans offerts/i)).toBeNull();
    expect(screen.queryByText(/3 crédits offerts/i)).toBeNull();
    expect(screen.getByText(/essai gratuit a déjà été utilisé/i)).toBeInTheDocument();
  });

  it.each([false, true])(
    'never says premium features get locked, only AI writing needs a credit (trial denied: %s)',
    async (trialDenied) => {
      auth.userProfile = { trialDenied, credits: trialDenied ? 0 : 3 };
      await openWelcomeStep();
      expect(screen.queryByText(/fonctionnalités premium/i)).toBeNull();
      expect(screen.getAllByText(/rédaction par l'IA/i).length).toBeGreaterThan(0);
    },
  );
});
