import React, { useEffect, useMemo, useState } from 'react';
import { X, Save, Info, Zap, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import type { Patient, PatientAssessment, ScoreResult } from '../../types';
import { SubtestRowCheck, TestCatalogModal } from '../assessment/pages/ScorePage';
import type { TestDef } from '../../data/testCatalog';
import { useCatalog } from '../../contexts/CatalogContext';

interface Props {
  onClose: () => void;
  onSave: (assessment: PatientAssessment) => void;
  patient?: Patient;
}

export const QuickEntryModal: React.FC<Props> = ({ onClose, onSave, patient }) => {
  const { catalog, ensureCatalogLoaded } = useCatalog();
  const [showCatalog, setShowCatalog] = useState(false);
  const [selectedTests, setSelectedTests] = useState<TestDef[]>([]);
  const [allResults, setAllResults] = useState<Record<string, Record<string, ScoreResult>>>({});
  const [expandedSubtestId, setExpandedSubtestId] = useState<string | null>(null);

  useEffect(() => {
    ensureCatalogLoaded();
  }, [ensureCatalogLoaded]);

  const hasMeaningfulValue = (result?: Partial<ScoreResult>): boolean => {
    if (!result) return false;
    const hasScoreValue = [result.raw, result.standard, result.percentile].some(
      (value) => typeof value === 'string' && value.trim() !== '',
    );
    const hasZ = typeof result.zScore === 'number' && Number.isFinite(result.zScore);
    const hasQualitative =
      (typeof result.qualitativeCode === 'string' && result.qualitativeCode.trim() !== '') ||
      (typeof result.qualitativeLabel === 'string' && result.qualitativeLabel.trim() !== '');
    const hasObservation = typeof result.observation === 'string' && result.observation.trim() !== '';
    return hasScoreValue || hasZ || hasQualitative || hasObservation;
  };

  const filledScoresCount = useMemo(
    () =>
      Object.values(allResults).reduce<number>((acc, testResults) => {
        const filledInTest = Object.values(testResults).filter((res) => hasMeaningfulValue(res)).length;
        return acc + filledInTest;
      }, 0),
    [allResults],
  );

  const canSave = selectedTests.length > 0 && filledScoresCount > 0;

  const existingTests = useMemo(
    () =>
      selectedTests.reduce<Record<string, Record<string, ScoreResult>>>((acc, test) => {
        acc[test.id] = allResults[test.id] || {};
        return acc;
      }, {}),
    [selectedTests, allResults],
  );

  const handleAddTests = (selection: Record<string, string[]>) => {
    const next = [...selectedTests];
    Object.entries(selection).forEach(([id, subtestIds]) => {
      const def = catalog.flatMap((c) => c.tests).find((t) => t.id === id);
      if (!def) return;

      const filtered = { ...def, subtests: def.subtests.filter((s) => subtestIds.includes(s.id)) };
      const existingIndex = next.findIndex((t) => t.id === id);
      if (existingIndex === -1) {
        next.push(filtered);
        return;
      }

      const mergedSubtests = [
        ...next[existingIndex].subtests,
        ...filtered.subtests.filter((s) => !next[existingIndex].subtests.some((existing) => existing.id === s.id)),
      ];
      next[existingIndex] = { ...next[existingIndex], subtests: mergedSubtests };
    });
    setSelectedTests(next);
  };

  const handleRemoveTest = (id: string) => {
    setSelectedTests((prev) => prev.filter((t) => t.id !== id));
    setAllResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleSubtestChange = (testId: string, subId: string, res: Partial<ScoreResult>) => {
    const currentTestResults = allResults[testId] || {};
    const currentSubResult =
      currentTestResults[subId] || { raw: '', standard: '', percentile: '', status: 'empty' as const, entryMetric: 'raw' as const, conversionMode: 'auto' as const, reviewState: 'not_reviewed' as const };

    setAllResults({
      ...allResults,
      [testId]: {
        ...currentTestResults,
        [subId]: { ...currentSubResult, ...res },
      },
    });
  };

  const handleSave = () => {
    if (!canSave) return;

    const flatResults: Record<string, ScoreResult> = {};

    Object.values(allResults).forEach((testRes) => {
      Object.entries(testRes).forEach(([subId, res]) => {
        if (!hasMeaningfulValue(res)) return;
        flatResults[subId] = {
          raw: res.raw || '',
          standard: res.standard || '',
          percentile: res.percentile || '',
          zScore: typeof res.zScore === 'number' ? res.zScore : undefined,
          status:
            res.status && res.status !== 'empty'
              ? res.status
              : (res.reviewState === 'reviewed' ? 'validated' : 'estimated'),
          observation: res.observation,
          validatedAt: res.validatedAt,
          certifiedAt: res.certifiedAt,
          scoreSource: res.scoreSource,
          entryMetric: res.entryMetric,
          conversionMode: res.conversionMode,
          reviewState: res.reviewState,
          reviewedAt: res.reviewedAt,
          qualitativeCode: res.qualitativeCode,
          qualitativeLabel: res.qualitativeLabel,
          derived: res.derived,
        };
      });
    });

    if (Object.keys(flatResults).length === 0) return;

    const sessionName = selectedTests.length === 1 ? selectedTests[0].name : 'Mini-réévaluation multi-tests';
    const assessment: PatientAssessment = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      kind: 'mini_reevaluation',
      hasFormalReport: false,
      testName: selectedTests.length === 1 ? selectedTests[0].name : sessionName,
      results: flatResults,
    };
    onSave(assessment);
  };

  const safePatient = patient || ({} as Patient);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--secondary)]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-[var(--app-bg)] w-full max-w-5xl h-[90vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col relative">
        <div className="p-8 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--card-bg)] sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[var(--primary)]/10 rounded-2xl text-[var(--primary)]">
              <Zap size={28} fill="currentColor" />
            </div>
            <div>
              <h2 className="font-serif text-3xl font-bold text-[var(--text-heading)]">Mini-réévaluation</h2>
              <p className="text-sm text-[var(--text-secondary)] font-medium mt-1">Capture rapide de scores intermédiaires, sans document final.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-[var(--hover-bg)] rounded-full text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--border-color)] transition-all">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-[var(--app-bg)] p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-[var(--card-bg)] p-5 rounded-2xl border border-[var(--border-color)] flex gap-4 items-start shadow-sm">
              <div className="p-3 bg-blue-50 rounded-full text-blue-600">
                <Info size={20} />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-[var(--text-heading)]">Règle clinique</h4>
                <p className="text-xs text-[var(--text-main)]">
                  La mini-réévaluation enregistre des mesures intermédiaires et n’impacte pas automatiquement le rappel de réévaluation.
                </p>
              </div>
            </div>

            <div className="bg-[var(--card-bg)] rounded-[28px] p-6 border border-[var(--border-color)] shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)]">1. Tests suivis</h3>
                <button
                  onClick={() => setShowCatalog(true)}
                  className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                >
                  <Plus size={14} />
                  Ajouter un test
                </button>
              </div>

              {selectedTests.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">Aucun test sélectionné. Ajoutez au moins un test pour commencer.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selectedTests.map((test) => (
                    <div key={test.id} className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--hover-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--text-heading)]">
                      {test.name}
                      <button onClick={() => handleRemoveTest(test.id)} className="text-[var(--text-secondary)] hover:text-rose-500" aria-label={`Retirer ${test.name}`}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)]">2. Saisir les scores</h3>
              {selectedTests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--hover-bg)] p-8 text-center text-sm text-[var(--text-secondary)]">
                  Selectionnez des tests pour afficher la grille de saisie.
                </div>
              ) : (
                selectedTests.map((test) => (
                  <div key={test.id} className="bg-[var(--card-bg)] rounded-[28px] p-6 border border-[var(--border-color)] shadow-sm animate-in slide-in-from-bottom-4">
                    <div className="flex justify-between items-center mb-5 pb-4 border-b border-[var(--border-color)]">
                      <h4 className="font-serif font-bold text-xl text-[var(--text-heading)] flex items-center gap-3">
                        <span className="w-2 h-7 bg-[#F2CC8F] rounded-full"></span>
                        {test.name}
                      </h4>
                      <span className="rounded-full bg-[var(--progress-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                        {test.subtests.length} sous-tests
                      </span>
                    </div>

                    <div>
                      {test.subtests.map((st) => {
                        const res = allResults[test.id]?.[st.id] || { raw: '', standard: '', percentile: '', status: 'empty' as const, entryMetric: 'raw' as const, conversionMode: 'auto' as const, reviewState: 'not_reviewed' as const };
                        const uniqueId = `${test.id}-${st.id}`;
                        return (
                          <SubtestRowCheck
                            key={st.id}
                            subtest={st}
                            result={res}
                            onChange={(val) => handleSubtestChange(test.id, st.id, val)}
                            isExpanded={expandedSubtestId === uniqueId}
                            onToggleExpand={() => setExpandedSubtestId(expandedSubtestId === uniqueId ? null : uniqueId)}
                            onFocus={() => setExpandedSubtestId(null)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="p-6 bg-[var(--card-bg)] border-t border-[var(--border-color)] flex items-center justify-between gap-4 z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
          <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <CheckCircle2 size={16} className={canSave ? 'text-emerald-600' : 'text-[var(--text-disabled)]'} />
            <span>{filledScoresCount} score{filledScoresCount > 1 ? 's' : ''} saisi{filledScoresCount > 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={onClose} className="px-8 py-4 font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] transition-all uppercase text-xs tracking-widest">
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={`flex items-center gap-3 px-10 py-4 rounded-2xl font-bold transition-all ${canSave ? 'bg-[var(--primary)] text-white shadow-xl shadow-orange-200 dark:shadow-black/30 hover:bg-[#d0694e] hover:-translate-y-1' : 'bg-[var(--card-bg-raised)] text-[var(--text-disabled)] cursor-not-allowed'}`}
            >
              <Save size={20} /> Enregistrer la mini-réévaluation
            </button>
          </div>
        </div>
      </div>

      <TestCatalogModal
        isOpen={showCatalog}
        onClose={() => setShowCatalog(false)}
        existingTests={existingTests}
        onAddTests={handleAddTests}
      />
    </div>
  );
};
