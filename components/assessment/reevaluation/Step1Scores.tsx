/**
 * reevaluation/Step1Scores.tsx — side-by-side score entry for a re-evaluation.
 *
 * Left: the previous assessment's scores (read-only). Right: the new scores,
 * in the metric the previous assessment used so both sides compare directly.
 * The new scores start empty (see `buildEmptyTestsFrom`): a subtest that is not
 * re-measured stays "non mesuré" instead of producing a fake 0 delta.
 */

import React, { useCallback, useMemo } from 'react';
import { Activity, ArrowRight, Lock, Trash2 } from 'lucide-react';
import type { ScoreResult, TestData } from '../../../types';
import { useCatalog } from '../../../contexts/CatalogContext';
import { resolveTestDef } from '../../../utils/catalogIndex';
import { type ScoreMetric, unitToMetric } from '../../../utils/scoring';
import { compareSubtestsForDisplay } from '../../../utils/subtestOrdering';
import { ScoreTable } from '../shared/ScoreTable';
import { StepNavFooter } from '../shared/StepNavFooter';

interface Props {
  tests: TestData;
  updateTests: (data: TestData) => void;
  onNext: () => void;
  onBack: () => void;
  previousAssessmentDate?: string;
  previousTests: TestData;
}

/** Most used standardized metric among the previous scores of a test (ET on ties, the usual ergo convention). */
const dominantMetric = (scores: Record<string, ScoreResult>): ScoreMetric => {
  const counts: Record<ScoreMetric, number> = { standard: 0, z: 0, percentile: 0 };
  for (const score of Object.values(scores)) {
    const metric = unitToMetric(score.unit);
    if (metric) counts[metric]++;
  }
  if (counts.z >= counts.standard && counts.z >= counts.percentile) return 'z';
  return counts.percentile > counts.standard ? 'percentile' : 'standard';
};

export const Step1Scores: React.FC<Props> = ({ tests, updateTests, previousAssessmentDate, previousTests, onNext, onBack }) => {
  const { index } = useCatalog();

  // Tests still part of this re-evaluation (the practitioner can drop some).
  const testIds = useMemo(() => Object.keys(previousTests).filter((id) => id in tests), [previousTests, tests]);

  const formattedDate = previousAssessmentDate
    ? new Date(previousAssessmentDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const handleDeleteTest = useCallback(
    (testId: string) => {
      const { [testId]: _removed, ...rest } = tests;
      updateTests(rest);
    },
    [tests, updateTests],
  );

  const handleUpdateSubtest = useCallback(
    (testId: string, subId: string, patch: Partial<ScoreResult>) => {
      updateTests({ ...tests, [testId]: { ...tests[testId], [subId]: { ...(tests[testId]?.[subId] ?? {}), ...patch } } });
    },
    [tests, updateTests],
  );

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-10">
      <div className="mb-8 border-b border-[var(--border-color)] pb-6">
        <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)] flex items-center gap-3">
          <Activity size={24} className="text-[var(--primary)]" />
          Saisie des nouvelles mesures
        </h2>
        {formattedDate && (
          <p className="text-[var(--text-secondary)] font-medium mt-2">
            Comparaison avec le bilan du <strong>{formattedDate}</strong>. Saisissez les nouveaux scores à droite ; une épreuve non repassée reste « non
            mesurée ».
          </p>
        )}
      </div>

      {testIds.length === 0 && (
        <div className="rounded-[30px] border-2 border-dashed border-[var(--border-color)] bg-[var(--card-bg)] p-16 text-center shadow-sm">
          <p className="text-[var(--text-heading)] font-bold text-lg">Aucun test à comparer</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Le bilan précédent ne contient pas de scores de tests.</p>
        </div>
      )}

      <div className="space-y-6">
        {testIds.map((testId) => {
          const prevScores = previousTests[testId] ?? {};
          const test = resolveTestDef(index, testId, Object.keys(prevScores));
          const subtests = test.subtests.filter((st) => st.id in prevScores).sort(compareSubtestsForDisplay);
          if (subtests.length === 0) return null;
          const metrics = [dominantMetric(prevScores)];

          return (
            <div
              key={testId}
              className="overflow-hidden rounded-[28px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
            >
              <div className="px-5 py-4 border-b border-[var(--border-color)] bg-[var(--hover-bg)] flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-[var(--text-heading)]">{test.name}</h4>
                  <p className="text-[11px] text-[var(--text-secondary)]">{subtests.length} épreuve(s)</p>
                </div>
                <button
                  onClick={() => handleDeleteTest(testId)}
                  className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-rose-500 hover:border-rose-200 transition-colors shrink-0"
                  title="Retirer ce test de la réévaluation"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid grid-cols-2 divide-x divide-[var(--border-color)]">
                <div className="p-3">
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    <Lock size={10} className="text-[var(--text-disabled)]" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                      {formattedDate ? `Bilan du ${formattedDate}` : 'Bilan précédent'}
                    </span>
                  </div>
                  <ScoreTable testId={testId} subtests={subtests} scores={prevScores} metrics={metrics} />
                </div>
                <div className="p-3">
                  <div className="mb-2 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--primary)]">Nouveaux résultats</span>
                  </div>
                  <ScoreTable
                    testId={testId}
                    subtests={subtests}
                    scores={tests[testId]}
                    metrics={metrics}
                    onChange={(subId, patch) => handleUpdateSubtest(testId, subId, patch)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <StepNavFooter onBack={onBack}>
        <button
          onClick={onNext}
          className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all bg-[var(--secondary)] hover:bg-[var(--primary)]"
        >
          <span>Voir l'évolution</span>
          <ArrowRight size={20} />
        </button>
      </StepNavFooter>
    </div>
  );
};
