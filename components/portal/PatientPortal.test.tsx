// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PatientPortal } from './PatientPortal';
import { portalSignature } from './PortalIntroduction';

vi.mock('../../services/db', () => ({ supabase: {}, SUPABASE_URL: 'http://localhost', SUPABASE_ANON_KEY: 'anon' }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('../shared/SharedQuestionnaire', () => ({ SharedQuestionnaire: () => <div>questionnaire</div> }));

describe('Portail famille : introduction (#149)', () => {
  it('ouvre le questionnaire par la lettre de l’ergothérapeute, signée de son nom', () => {
    render(<PatientPortal onBack={() => {}} preview={{ practitionerName: 'Sophie FICTIF' }} />);
    expect(screen.getByText('Monsieur, Madame,')).toBeInTheDocument();
    expect(screen.getByText('Le stylo habituel de votre enfant')).toBeInTheDocument();
    expect(screen.getByText('Sophie FICTIF, ergothérapeute')).toBeInTheDocument();
  });

  it('ne répète plus « Documents à apporter » sous le questionnaire', () => {
    render(<PatientPortal onBack={() => {}} preview={{}} />);
    expect(screen.queryByText('Documents à apporter')).toBeNull();
    expect(screen.getByText('Votre ergothérapeute')).toBeInTheDocument();
  });

  it('ne double pas le titre quand le nom le contient déjà', () => {
    expect(portalSignature('Pauline FICTIF, ergothérapeute DE')).toBe('Pauline FICTIF, ergothérapeute DE');
    expect(portalSignature('')).toBe('Votre ergothérapeute');
  });
});
