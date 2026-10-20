// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScorePage } from './ScorePage';
import { buildCatalogIndex } from '../../../utils/catalogIndex';
import { DEMO_CATALOG } from '../../../data/demoCatalog';
import type { TestData } from '../../../types';

// Stable references: the page's effects depend on them.
const catalogValue = {
  catalog: DEMO_CATALOG,
  index: buildCatalogIndex(DEMO_CATALOG),
  searchTests: () => [],
  ensureCatalogLoaded: () => {},
  reloadCatalog: async () => {},
  loading: false,
};
vi.mock('../../../contexts/CatalogContext', () => ({ useCatalog: () => catalogValue }));

const tests: TestData = {
  bhk: { bhk__quality: { value: '8', unit: 'NS' }, bhk__speed: {} },
  'mabc-2': { 'mabc-2__manual-dexterity-total': { value: '5', unit: 'NS' } },
  'test-cloches': { 'test-cloches__cibles': {} },
};

const renderPage = () => {
  const updateTests = vi.fn();
  render(<ScorePage tests={tests} updateTests={updateTests} onNext={() => {}} onBack={() => {}} />);
  return updateTests;
};

describe('ScorePage : réordonner les tests sans glisser (#117)', () => {
  it('« Monter » échange le test avec le précédent et garde ses scores', async () => {
    const updateTests = renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Monter MABC-2' }));
    const next = updateTests.mock.calls[0][0] as TestData;
    expect(Object.keys(next)).toEqual(['mabc-2', 'bhk', 'test-cloches']);
    expect(next['mabc-2']).toBe(tests['mabc-2']);
  });

  it('« Descendre » échange le test avec le suivant', async () => {
    const updateTests = renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Descendre BHK' }));
    expect(Object.keys(updateTests.mock.calls[0][0] as TestData)).toEqual(['mabc-2', 'bhk', 'test-cloches']);
  });

  it('le premier test ne monte pas, le dernier ne descend pas', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Monter BHK' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descendre Test des Cloches' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descendre BHK' })).toBeEnabled();
  });
});
