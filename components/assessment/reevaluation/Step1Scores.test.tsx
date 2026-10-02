// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TestData } from '../../../types';
import { Step1Scores } from './Step1Scores';
import { buildCatalogIndex } from '../../../utils/catalogIndex';
import { DEMO_CATALOG } from '../../../data/demoCatalog';

const index = buildCatalogIndex(DEMO_CATALOG);
vi.mock('../../../contexts/CatalogContext', () => ({ useCatalog: () => ({ index }) }));
// The catalogue modal is the one of the initial flow; here it only has to hand back a selection.
vi.mock('../pages/score/TestCatalogModal', () => ({
  TestCatalogModal: ({ isOpen, onAddTests }: { isOpen: boolean; onAddTests: (s: Record<string, string[]>) => void }) =>
    isOpen ? (
      <button onClick={() => onAddTests({ 'mabc-2': ['mabc-2__manual-dexterity-total'], bhk: ['bhk__extra'] })}>
        Choisir dans le catalogue
      </button>
    ) : null,
}));

const previousTests: TestData = { bhk: { bhk__quality: { value: '-1.2', unit: 'ET' }, bhk__speed: {} } };

const Harness: React.FC<{ onUpdate: (t: TestData) => void }> = ({ onUpdate }) => {
  const [tests, setTests] = useState<TestData>({ bhk: { bhk__quality: {}, bhk__speed: {} } });
  return (
    <Step1Scores
      tests={tests}
      previousTests={previousTests}
      updateTests={(t) => {
        onUpdate(t);
        setTests(t);
      }}
      onNext={() => {}}
      onBack={() => {}}
    />
  );
};

const rowNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent ?? '');

describe('Step1Scores : retrait d’un sous-test en réévaluation (#48)', () => {
  it('la croix n’apparaît que sur le sous-test sans score précédent', () => {
    render(<Harness onUpdate={() => {}} />);
    const buttons = screen.getAllByRole('button', { name: 'Retirer cette épreuve' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('tr')?.textContent).toContain('Vitesse');
  });

  it('le retrait enlève la ligne des deux tableaux, qui restent alignés', async () => {
    const onUpdate = vi.fn();
    render(<Harness onUpdate={onUpdate} />);
    const [prevTable] = screen.getAllByRole('table');
    expect(rowNames(prevTable)).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Retirer cette épreuve' }));

    expect(onUpdate).toHaveBeenCalledWith({ bhk: { bhk__quality: {} } });
    const [prevAfter, newAfter] = screen.getAllByRole('table');
    expect(rowNames(prevAfter)).toHaveLength(1);
    expect(rowNames(newAfter)).toHaveLength(1);
    expect(rowNames(prevAfter)[0]).toContain('Qualité');
    expect(rowNames(newAfter)[0]).toContain('Qualité');
    expect(screen.queryByRole('button', { name: 'Retirer cette épreuve' })).toBeNull();
  });
});

describe('Step1Scores : ajout d’un test absent du bilan de référence (#62)', () => {
  it('le test ajouté s’affiche seul, sans comparaison, et se saisit', async () => {
    const onUpdate = vi.fn();
    render(<Harness onUpdate={onUpdate} />);
    await userEvent.click(screen.getByRole('button', { name: /Ajouter un test/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Choisir dans le catalogue' }));

    expect(onUpdate).toHaveBeenLastCalledWith({
      bhk: { bhk__quality: {}, bhk__speed: {}, bhk__extra: {} },
      'mabc-2': { 'mabc-2__manual-dexterity-total': {} },
    });
    expect(screen.getByText(/pas de comparaison possible/)).toBeTruthy();
    // BHK: two tables side by side; MABC-2 (new): one table, the new scores only.
    expect(screen.getAllByRole('table')).toHaveLength(3);
    const newTable = screen.getAllByRole('table')[2];
    expect(rowNames(newTable)).toHaveLength(1);
    expect(rowNames(newTable)[0]).toContain('dextérité manuelle');
  });
});
