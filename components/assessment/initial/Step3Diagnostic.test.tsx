// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Step3BisDiagnostic } from './Step3Diagnostic';
import { buildCatalogIndex } from '../../../utils/catalogIndex';
import { DEMO_CATALOG } from '../../../data/demoCatalog';
import type { TestData } from '../../../types';

const catalogValue = { catalog: DEMO_CATALOG, index: buildCatalogIndex(DEMO_CATALOG) };
vi.mock('../../../contexts/CatalogContext', () => ({ useCatalog: () => catalogValue }));

const tests = {
  bhk: { bhk__quality: { value: '-1.5', unit: 'ET', observation: 'Lettres irrégulières' }, bhk__speed: { value: '8', unit: 'NS' } },
} as unknown as TestData;

const renderStep = () =>
  render(
    <Step3BisDiagnostic
      synthesis={{ diagnosticInput: '', projectInput: '', recommendationsInput: '' }}
      updateSynthesis={() => {}}
      tests={tests}
      onNext={() => {}}
      onBack={() => {}}
      isGenerating={false}
    />,
  );

describe('Step3Diagnostic : le panneau des scores défile seul (#118)', () => {
  it('reste visible à côté de la rédaction sur grand écran, hauteur bornée à la fenêtre', () => {
    renderStep();
    const panel = screen.getByTestId('scores-panel');
    expect(panel.className).toContain('lg:max-h-[calc(100vh-8rem)]');
    expect(panel.parentElement!.className).toMatch(/lg:sticky.*lg:self-start/);
  });

  it('fait défiler les scores dans le panneau, sans entraîner la page, en gardant l’en-tête', () => {
    renderStep();
    const scroll = screen.getByTestId('scores-panel-scroll');
    expect(scroll.className).toContain('overflow-y-auto');
    expect(scroll.className).toContain('overscroll-contain');
    expect(within(scroll).getByText('Qualité')).toBeInTheDocument();
    expect(within(scroll).queryByText('Scores & Observations')).toBeNull();
  });
});
