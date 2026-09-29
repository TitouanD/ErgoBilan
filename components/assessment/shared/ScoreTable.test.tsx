// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScoreTable } from './ScoreTable';
import { buildCatalogIndex } from '../../../utils/catalogIndex';
import { DEMO_CATALOG } from '../../../data/demoCatalog';

const index = buildCatalogIndex(DEMO_CATALOG);
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
