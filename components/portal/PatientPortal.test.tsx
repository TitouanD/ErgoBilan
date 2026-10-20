// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { PatientPortal } from './PatientPortal';
import { portalSignature } from './PortalIntroduction';
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

describe('PatientPortal : introduction (#149)', () => {
  it('ouvre le questionnaire par la lettre de l’ergothérapeute, signée de son nom', () => {
    renderWithToast(<PatientPortal onBack={() => {}} previewPatient={fictivePatient('leo')} previewPractitionerName="Sophie FICTIF" />);
    expect(screen.getByText('Monsieur, Madame,')).toBeInTheDocument();
    expect(screen.getByText('Le stylo habituel de votre enfant')).toBeInTheDocument();
    expect(screen.getByText('Sophie FICTIF, ergothérapeute')).toBeInTheDocument();
  });

  it('ne répète plus « Documents à apporter » sous le questionnaire ; signature générique sans nom', () => {
    renderWithToast(<PatientPortal onBack={() => {}} previewPatient={fictivePatient('leo')} />);
    expect(screen.queryByText('Documents à apporter')).toBeNull();
    expect(screen.getByText('Votre ergothérapeute')).toBeInTheDocument();
  });

  it('ne double pas le titre quand le nom le contient déjà', () => {
    expect(portalSignature('Pauline FICTIF, ergothérapeute DE')).toBe('Pauline FICTIF, ergothérapeute DE');
    expect(portalSignature('')).toBe('Votre ergothérapeute');
  });
});
