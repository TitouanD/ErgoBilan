// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step1Admin } from './Step1Admin';
import type { Patient } from '../../../types';

vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../../../contexts/AssessmentContext', () => ({ useAssessment: () => ({ ensurePatient: vi.fn() }) }));

const patient = (overrides: Partial<Patient> = {}) =>
  ({ id: 'p1', firstName: 'Léa', lastName: 'Test', dob: '2018-05-04', ...overrides }) as Patient;

const renderStep = (data: Patient) => {
  const props = { updateData: () => {}, onQuit: () => {}, onNext: () => {}, onPatientCreated: () => {} };
  const utils = render(<Step1Admin data={data} {...props} />);
  return { ...utils, rerenderWith: (next: Patient) => utils.rerender(<Step1Admin data={next} {...props} />) };
};

const SUMMARY_TITLE = 'Résumé du questionnaire famille';

beforeEach(() => sessionStorage.clear());

describe('Step1Admin : la vue ne bascule pas en condensé pendant la saisie (#46)', () => {
  it('reste en formulaire quand on remplit Situation familiale d’un dossier vide', () => {
    const { rerenderWith } = renderStep(patient());
    expect(screen.queryByText(SUMMARY_TITLE)).toBeNull();
    rerenderWith(patient({ parent1Name: 'Marie Test', parentNames: 'Marie Test' }));
    expect(screen.queryByText(SUMMARY_TITLE)).toBeNull();
    expect(screen.getByText('Situation familiale')).toBeInTheDocument();
  });

  it('ouvre en condensé un dossier déjà rempli par la famille', () => {
    renderStep(patient({ parentNames: 'Marie Test' }));
    expect(screen.getByText(SUMMARY_TITLE)).toBeInTheDocument();
  });
});

describe('Step1Admin : résumé du Dossier', () => {
  it('affiche le suivi par la PCO (#36)', async () => {
    renderStep(patient({ parentNames: 'Marie Test', pcoFollowup: 'oui', pcoFollowupDate: '2026-03-01' }));
    await userEvent.click(screen.getByText('Suivi Médical'));
    expect(screen.getByText('Suivi par la PCO')).toBeInTheDocument();
    expect(screen.getByText('Oui — 2026-03-01')).toBeInTheDocument();
  });

  it('affiche le libellé des puces de langage, pas leur code (#38)', async () => {
    renderStep(patient({ parentNames: 'Marie Test', walkingAge: '12 mois', languageStatus: 'vocabulaire_riche,manque_du_mot' }));
    await userEvent.click(screen.getByText('Développement'));
    expect(screen.getByText('Vocabulaire riche / Manque du mot')).toBeInTheDocument();
    expect(screen.queryByText(/vocabulaire_riche/)).toBeNull();
  });
});
