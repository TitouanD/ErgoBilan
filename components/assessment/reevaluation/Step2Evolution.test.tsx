// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Step2Evolution } from './Step2Evolution';
import { buildCatalogIndex } from '../../../utils/catalogIndex';
import { DEMO_CATALOG } from '../../../data/demoCatalog';

const index = buildCatalogIndex(DEMO_CATALOG);
vi.mock('../../../contexts/CatalogContext', () => ({ useCatalog: () => ({ index }) }));

const renderStep = (terms: string[]) => {
  const onGenerate = vi.fn().mockResolvedValue(false);
  render(
    <Step2Evolution
      previousAssessment={null}
      newTests={{}}
      sections={[]}
      onSetSections={() => {}}
      onGenerate={onGenerate}
      findSuspectTerms={async () => terms}
      isGenerating={false}
      hasCredits
      isDemoMode
      onNeedCredits={() => {}}
      onNext={() => {}}
      onBack={() => {}}
    />,
  );
  return { onGenerate };
};

const PSEUDONYMS = /les noms et coordonnées sont remplacés par des pseudonymes/;

describe('Step2Evolution : mots repérés dans la modale de réévaluation (#54 B4)', () => {
  it('affiche les mots repérés, cochés ; un mot décoché part en « autorisé »', async () => {
    const { onGenerate } = renderStep(['Josette', 'lefort']);
    await userEvent.click(screen.getByRole('button', { name: /Générer avec l’IA/ }));

    expect(screen.getByText('Noms possibles dans vos notes.')).toBeInTheDocument();
    expect(screen.getByText(PSEUDONYMS)).toBeInTheDocument();
    const josette = screen.getByRole('checkbox', { name: 'Josette' });
    const lefort = screen.getByRole('checkbox', { name: 'lefort' });
    expect(josette).toBeChecked();
    expect(lefort).toBeChecked();

    await userEvent.click(lefort);
    expect(lefort).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Générer (simulation)' }));
    expect(onGenerate).toHaveBeenCalledWith({ masked: ['Josette'], allowed: ['lefort'] });
  });

  it('sans mot repéré, pas de bloc : la modale est celle d’avant', async () => {
    const { onGenerate } = renderStep([]);
    await userEvent.click(screen.getByRole('button', { name: /Générer avec l’IA/ }));

    expect(screen.getByText('Générer la synthèse')).toBeInTheDocument();
    expect(screen.getByText(PSEUDONYMS)).toBeInTheDocument();
    expect(screen.queryByText('Noms possibles dans vos notes.')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Générer (simulation)' }));
    expect(onGenerate).toHaveBeenCalledWith({ masked: [], allowed: [] });
  });
});
