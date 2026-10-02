// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ScoreTable } from '../components/assessment/shared/ScoreTable';
import { demoIndex, fictivePatient, fictiveTests, renderWithToast } from './testing';

vi.mock('../contexts/CatalogContext', () => ({ useCatalog: () => ({ index: demoIndex }) }));

describe('fixtures des tests de composants', () => {
  it('un patient fictif complet et ses scores sur le catalogue démo', () => {
    expect(fictivePatient('leo')).toMatchObject({ id: 'fictif-leo', firstName: 'Léo', lastName: 'FICTIF' });
    const tests = fictiveTests('leo');
    expect(Object.keys(tests.bhk)).toEqual(['bhk__quality', 'bhk__speed']);
    expect(fictiveTests('leo', { fill: 'vide' }).bhk.bhk__quality).toEqual({});
  });

  it('se rendent dans un composant réel', () => {
    const bhk = demoIndex.testById.get('bhk')!;
    const scores = fictiveTests('leo').bhk;
    renderWithToast(<ScoreTable testId="bhk" subtests={bhk.subtests} scores={scores} onChange={() => {}} />);
    expect(screen.getByText('Qualité')).toBeInTheDocument();
    expect(screen.getByDisplayValue(scores.bhk__quality.value!)).toBeInTheDocument();
  });
});
