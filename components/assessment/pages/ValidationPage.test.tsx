// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ValidationPage } from './ValidationPage';
import { buildCatalogIndex } from '../../../utils/catalogIndex';
import { DEMO_CATALOG } from '../../../data/demoCatalog';
import type { ReportSection, TestData } from '../../../types';

const catalogValue = { catalog: DEMO_CATALOG, index: buildCatalogIndex(DEMO_CATALOG) };
vi.mock('../../../contexts/CatalogContext', () => ({ useCatalog: () => catalogValue }));
vi.mock('../shared/TipTapEditor', () => ({ TipTapEditor: ({ content }: { content: string }) => <div>{content}</div> }));

const tests = {
  bhk: { bhk__quality: { value: '-1.5', unit: 'ET', observation: 'Lettres irrégulières' } },
} as unknown as TestData;

const sections = [{ id: 'diagnostic', title: 'Diagnostic', content: 'Texte généré', status: 'draft' }] as ReportSection[];

describe('ValidationPage : scores et entretien à côté de la relecture (#121)', () => {
  it('affiche les scores, les observations et les notes d’entretien dans le panneau de droite', () => {
    render(
      <ValidationPage
        sections={sections}
        tests={tests}
        interviewNotes="Fatigue en fin de journée"
        onValidateSection={() => {}}
        onNext={() => {}}
        onBack={() => {}}
      />,
    );
    const panel = screen.getByTestId('scores-panel');
    expect(panel.parentElement!.className).toMatch(/lg:sticky.*lg:self-start/);
    expect(within(panel).getByText('Qualité')).toBeInTheDocument();
    expect(within(panel).getByText('« Lettres irrégulières »')).toBeInTheDocument();
    expect(within(panel).getByText('Fatigue en fin de journée')).toBeInTheDocument();
    expect(screen.getByText('Diagnostic')).toBeInTheDocument();
  });
});
