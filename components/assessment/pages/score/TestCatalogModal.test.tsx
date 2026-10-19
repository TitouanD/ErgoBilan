// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestCatalogModal } from './TestCatalogModal';
import { CUSTOM_OBSERVATIONS_TEST_ID } from '../../../../utils/catalogIndex';
import { DEMO_CATALOG } from '../../../../data/demoCatalog';

// Stable references: the modal's effects depend on them.
const catalogValue = {
  catalog: DEMO_CATALOG,
  searchTests: () => [],
  ensureCatalogLoaded: () => {},
  reloadCatalog: async () => {},
  loading: false,
};
vi.mock('../../../../contexts/CatalogContext', () => ({ useCatalog: () => catalogValue }));

const bhk = DEMO_CATALOG.flatMap((c) => c.tests).find((t) => t.id === 'bhk')!;

describe('TestCatalogModal : observation libre (#102)', () => {
  it('« Observation libre » ne ferme pas la modale et s’ajoute à la sélection en cours', async () => {
    const onClose = vi.fn();
    const onAddTests = vi.fn();
    render(<TestCatalogModal isOpen onClose={onClose} existingTests={{}} onAddTests={onAddTests} />);

    // Une épreuve du BHK est déjà cochée.
    await userEvent.click(screen.getByText(bhk.name));
    await userEvent.click(screen.getByRole('checkbox', { name: bhk.subtests[0].name }));

    await userEvent.click(screen.getByRole('button', { name: /Observation libre/ }));
    expect(onClose).not.toHaveBeenCalled();
    expect(onAddTests).not.toHaveBeenCalled();
    expect(screen.getByText('2 épreuve(s) sélectionnée(s)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Observation libre/ })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    const selection = onAddTests.mock.calls[0][0] as Record<string, string[]>;
    expect(selection[bhk.id]).toEqual([bhk.subtests[0].id]);
    expect(selection[CUSTOM_OBSERVATIONS_TEST_ID]).toHaveLength(1);
    expect(selection[CUSTOM_OBSERVATIONS_TEST_ID][0]).toMatch(/^custom_/);
    expect(onClose).toHaveBeenCalled();
  });

  it('un second clic retire l’observation libre de la sélection', async () => {
    render(<TestCatalogModal isOpen onClose={() => {}} existingTests={{}} onAddTests={() => {}} />);
    const button = screen.getByRole('button', { name: /Observation libre/ });
    await userEvent.click(button);
    expect(screen.getByText('1 épreuve(s) sélectionnée(s)')).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.getByText('0 épreuve(s) sélectionnée(s)')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});
