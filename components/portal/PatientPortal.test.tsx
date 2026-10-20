// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { PatientPortal } from './PatientPortal';
import { fictivePatient, renderWithToast } from '../../dev/testing';

vi.mock('../../services/db', () => ({ supabase: {}, SUPABASE_URL: 'http://localhost', SUPABASE_ANON_KEY: 'anon' }));

describe('PatientPortal : barre de progression (#152)', () => {
  it('est dans l’en-tête collant, une seule fois, avec l’avancement du questionnaire', () => {
    renderWithToast(<PatientPortal onBack={() => {}} previewPatient={fictivePatient('leo')} />);
    const header = screen.getByRole('banner');
    const bar = within(header).getByRole('progressbar', { name: 'Progression' });
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    expect(screen.getAllByText('Progression')).toHaveLength(1);
  });
});
