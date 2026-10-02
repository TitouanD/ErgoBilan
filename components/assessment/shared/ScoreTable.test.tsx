// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScoreTable } from './ScoreTable';
import { buildCatalogIndex } from '../../../utils/catalogIndex';
import { DEMO_CATALOG } from '../../../data/demoCatalog';
import type { CategoryDef, SubtestDef } from '../../../data/testCatalog';

// Rows added by 20261002120000_catalogue_ajouts.sql (#90), as CatalogContext maps them.
const BARRAGE_STRATEGIE: SubtestDef = {
  id: 'barrage-h__strategie',
  name: "Stratégie d'exploration",
  unit: 'pts',
  scoreType: 'none',
  inputModel: 'qualitative_category',
  inputConfig: {
    groupKey: 'barrageh_01_scores',
    options: [
      { code: 'anarchique', label: 'Anarchique', order: 1 },
      { code: 'lineaire-retour', label: 'Linéaire, avec retour à la ligne', order: 2 },
    ],
  },
};
const VINELAND_RECEPTIF: SubtestDef = {
  id: 'vineland-3__receptive',
  name: 'Réceptif (Receptive)',
  unit: 'pts',
  scoreType: 'v-scale',
  inputModel: 'numeric_4mode',
};
const ADDED: CategoryDef = {
  id: 'ajouts-90',
  name: 'Ajouts #90',
  iconKey: 'Brain',
  sortOrder: 99,
  tests: [
    { id: 'barrage-h', name: 'Barrage des H', subtests: [BARRAGE_STRATEGIE] },
    { id: 'vineland-3', name: 'Vineland-3', subtests: [VINELAND_RECEPTIF] },
  ],
};

const index = buildCatalogIndex([...DEMO_CATALOG, ADDED]);
vi.mock('../../../contexts/CatalogContext', () => ({ useCatalog: () => ({ index }) }));

const bhk = DEMO_CATALOG.flatMap((c) => c.tests).find((t) => t.id === 'bhk')!;

describe('ScoreTable : retrait d’un sous-test (#41)', () => {
  it('une croix par ligne appelle onRemoveSubtest avec le bon sous-test', async () => {
    const onRemove = vi.fn();
    render(<ScoreTable testId="bhk" subtests={bhk.subtests} scores={{}} onChange={() => {}} onRemoveSubtest={onRemove} />);
    const buttons = screen.getAllByRole('button', { name: 'Retirer cette épreuve' });
    expect(buttons).toHaveLength(bhk.subtests.length);
    await userEvent.click(buttons[1]);
    expect(onRemove).toHaveBeenCalledWith(bhk.subtests[1].id);
  });

  it('pas de croix sans onRemoveSubtest ni en lecture seule', () => {
    const { rerender } = render(<ScoreTable testId="bhk" subtests={bhk.subtests} scores={{}} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Retirer cette épreuve' })).toBeNull();
    rerender(<ScoreTable testId="bhk" subtests={bhk.subtests} scores={{}} onRemoveSubtest={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Retirer cette épreuve' })).toBeNull();
  });
});

describe('ScoreTable : retrait conditionnel par ligne (#48)', () => {
  it('canRemoveSubtest limite la croix aux lignes autorisées', () => {
    render(
      <ScoreTable
        testId="bhk"
        subtests={bhk.subtests}
        scores={{}}
        onChange={() => {}}
        onRemoveSubtest={() => {}}
        canRemoveSubtest={(id) => id === bhk.subtests[1].id}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Retirer cette épreuve' })).toHaveLength(1);
  });
});

describe('ScoreTable : sous-tests ajoutés au catalogue (#90)', () => {
  it('la stratégie du Barrage des H se choisit dans la liste de la feuille de passation', async () => {
    const onChange = vi.fn();
    render(<ScoreTable testId="barrage-h" subtests={[BARRAGE_STRATEGIE]} scores={{}} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'lineaire-retour');
    expect(onChange).toHaveBeenCalledWith('barrage-h__strategie', {
      value: 'lineaire-retour',
      unit: 'qualitative',
      qualitativeLabel: 'Linéaire, avec retour à la ligne',
    });
  });

  it('un sous-domaine Vineland en note v est converti en ET (m=15, σ=3)', () => {
    render(
      <ScoreTable testId="vineland-3" subtests={[VINELAND_RECEPTIF]} scores={{ 'vineland-3__receptive': { value: '9', unit: 'NS' } }} />,
    );
    expect(screen.getByText('Note v (m=15, σ=3)')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
  });
});
