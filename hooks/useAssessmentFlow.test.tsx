// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AssessmentContextType } from '../contexts/AssessmentContext';
import { demoIndex, fictivePatient, fictiveTests } from '../dev/testing';
import type { CatalogIndex } from '../utils/catalogIndex';
import { useAssessmentFlow } from './useAssessmentFlow';

const generateInitial = vi.fn(async (_input: { index: CatalogIndex }) => ({ sections: [] }));
vi.mock('../services/ai', () => ({
  getReportGenerator: () => ({ generateInitial }),
  describeGenerationError: (e: unknown) => String(e),
}));
vi.mock('../services/db', () => ({ ensureFreshSession: vi.fn() }));

const assessment = {
  patient: fictivePatient('leo'),
  observations: {},
  tests: fictiveTests('leo'),
  synthesis: {},
  reportType: 'initial',
  beginGeneration: () => 1,
  applyGeneratedReport: () => true,
  setStep: vi.fn(),
  updatePatient: vi.fn(),
} as unknown as AssessmentContextType;

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

describe('useAssessmentFlow', () => {
  // Found by the recette: a draft resumed at the synthesis step, then « Générer »
  // clicked before the catalogue had loaded, sent scores to the AI without test
  // names nor z (« Test personnalisé », « bhk  quality »).
  it('attend le catalogue avant de générer, au lieu de prendre un index encore vide', async () => {
    let resolveCatalog: (index: CatalogIndex) => void = () => {};
    const loadCatalog = vi.fn(() => new Promise<CatalogIndex>((resolve) => (resolveCatalog = resolve)));
    const { result } = renderHook(() =>
      useAssessmentFlow({
        assessment,
        sessionKey: null,
        isDemoMode: true,
        loadCatalog,
        practitioner: null,
        refreshProfile: async () => {},
        loadData: async () => {},
        toast,
      }),
    );

    let generation: Promise<void> = Promise.resolve();
    act(() => {
      generation = result.current.generateInitialReport();
    });
    expect(generateInitial).not.toHaveBeenCalled();
    await act(async () => {
      resolveCatalog(demoIndex);
      await generation;
    });
    expect(generateInitial).toHaveBeenCalledTimes(1);
    expect(generateInitial.mock.calls[0][0].index).toBe(demoIndex);
  });
});
