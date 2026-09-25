/**
 * ScorePage — "Tests & mesures" step (initial and historical flows).
 *
 * The practitioner picks tests/subtests from the catalogue and types scores
 * in one ScoreTable per test. Tests and subtests can be reordered by
 * drag-and-drop; the order is persisted as the key order of `tests`, which
 * every downstream consumer (report, PDF, AI payload) reads as-is.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Activity, ArrowRight, ChevronDown, ChevronRight, GripVertical, Layers, Plus, Trash2 } from 'lucide-react';
import type { ScoreResult, TestData } from '../../../types';
import { ICON_MAP, type SubtestDef, type TestDef } from '../../../data/testCatalog';
import { useCatalog } from '../../../contexts/CatalogContext';
import { useFavoriteTests } from '../../../hooks/useFavoriteTests';
import { hasScoreValue } from '../../../utils/scoring';
import { CUSTOM_OBSERVATIONS_TEST_ID, resolveTestDef } from '../../../utils/catalogIndex';
import { ScoreTable, subtestDragId } from '../shared/ScoreTable';
import { StepNavFooter } from '../shared/StepNavFooter';
import { TestCatalogModal } from './score/TestCatalogModal';
import { ScoreSummaryPanel } from './score/ScoreSummaryPanel';

interface Props {
  tests: TestData;
  updateTests: (data: TestData) => void;
  onNext: () => void;
  onBack: () => void;
  nextLabel?: string;
}

type DragListeners = ReturnType<typeof useSortable>['listeners'];

const SortableTestCard: React.FC<{ id: string; children: (listeners: DragListeners) => React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children(listeners)}
    </div>
  );
};

export const ScorePage: React.FC<Props> = ({ tests, updateTests, onNext, onBack, nextLabel = 'Passer au diagnostic' }) => {
  const { index, ensureCatalogLoaded } = useCatalog();
  const { pushRecent } = useFavoriteTests();
  const [showCatalog, setShowCatalog] = useState(false);
  const [collapsedTests, setCollapsedTests] = useState<Record<string, boolean>>({});

  useEffect(() => {
    ensureCatalogLoaded();
  }, [ensureCatalogLoaded]);

  const testOrder = Object.keys(tests);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      // Subtest ids are namespaced `sub:${testId}:${subId}` so they never collide with test ids.
      if (activeId.startsWith('sub:') && overId.startsWith('sub:')) {
        const [, testId, activeSubId] = activeId.split(':');
        const [, overTestId, overSubId] = overId.split(':');
        if (testId !== overTestId) return;
        const subIds = Object.keys(tests[testId] || {});
        const reordered = arrayMove(subIds, subIds.indexOf(activeSubId), subIds.indexOf(overSubId));
        updateTests({ ...tests, [testId]: Object.fromEntries(reordered.map((id) => [id, tests[testId][id]])) });
        return;
      }

      const reordered = arrayMove(testOrder, testOrder.indexOf(activeId), testOrder.indexOf(overId));
      updateTests(Object.fromEntries(reordered.map((id) => [id, tests[id]])));
    },
    [tests, testOrder, updateTests],
  );

  const addTests = useCallback(
    (selection: Record<string, string[]>) => {
      const next: TestData = { ...tests };
      const newTestIds: string[] = [];
      for (const [testId, subtestIds] of Object.entries(selection)) {
        if (!next[testId]) newTestIds.push(testId);
        next[testId] = { ...(next[testId] ?? {}) };
        for (const id of subtestIds) next[testId][id] ??= {};
      }
      if (newTestIds.length > 0) pushRecent(newTestIds.filter((id) => id !== CUSTOM_OBSERVATIONS_TEST_ID));
      updateTests(next);
    },
    [tests, updateTests, pushRecent],
  );

  const removeTest = useCallback(
    (testId: string) => {
      const { [testId]: _removed, ...rest } = tests;
      updateTests(rest);
    },
    [tests, updateTests],
  );

  const updateSubtest = useCallback(
    (testId: string, subId: string, patch: Partial<ScoreResult>) => {
      updateTests({ ...tests, [testId]: { ...tests[testId], [subId]: { ...(tests[testId]?.[subId] ?? {}), ...patch } } });
    },
    [tests, updateTests],
  );

  const stats = useMemo(() => {
    const all = Object.values(tests).flatMap((subtests) => Object.values(subtests));
    return { total: all.length, filled: all.filter((s) => hasScoreValue(s)).length };
  }, [tests]);
  const completion = stats.total > 0 ? Math.round((stats.filled / stats.total) * 100) : 0;

  const testDef = (testId: string): TestDef => resolveTestDef(index, testId, Object.keys(tests[testId] ?? {}));

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-10">
      <div className="mb-8 border-b border-[var(--border-color)] pb-6 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)] flex items-center gap-3">
            <Activity size={24} className="text-[var(--primary)]" />
            Tests & mesures
          </h2>
          <p className="text-[var(--text-secondary)] font-medium mt-2">Saisissez les mesures avant la synthèse clinique.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${stats.filled === stats.total ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
          >
            {stats.filled}/{stats.total} saisis
          </div>
          <button
            onClick={() => setShowCatalog(true)}
            className="flex items-center gap-2 bg-[var(--secondary)] text-white px-5 py-2.5 rounded-xl font-bold hover:brightness-90 transition-all text-sm"
          >
            <Plus size={16} />
            Ajouter
          </button>
        </div>
      </div>

      <div className="mb-8 h-2 rounded-full bg-[var(--progress-bg)] overflow-hidden">
        <div className="h-full bg-[#81B29A]" style={{ width: `${completion}%` }} />
      </div>

      <div className="flex gap-8">
        <div className="flex-1 min-w-0 space-y-10">
          {testOrder.length === 0 && (
            <div className="rounded-[30px] border-2 border-dashed border-[var(--border-color)] bg-[var(--card-bg)] p-16 text-center shadow-sm">
              <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-[var(--primary-opacity-10)] text-[var(--primary)] flex items-center justify-center">
                <Layers size={24} />
              </div>
              <p className="text-[var(--text-heading)] font-bold text-lg">Aucun test sélectionné</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Ajoutez des tests depuis le catalogue pour démarrer la saisie.</p>
              <button
                type="button"
                onClick={() => setShowCatalog(true)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--secondary)] px-4 py-2 text-sm font-bold text-white hover:brightness-90"
              >
                <Plus size={16} />
                Ouvrir le catalogue
              </button>
            </div>
          )}

          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={testOrder} strategy={verticalListSortingStrategy}>
              {testOrder.map((testId) => {
                const def = testDef(testId);
                const category = index.categoryByTestId.get(testId);
                const CatIcon = ICON_MAP[category?.iconKey || 'Box'] ?? ICON_MAP.Box;
                const collapsed = collapsedTests[testId];
                const defById = new Map(def.subtests.map((st) => [st.id, st] as const));
                // Keep the persisted (drag-and-drop) order of tests[testId]
                const subtests = Object.keys(tests[testId] || {})
                  .map((id) => defById.get(id))
                  .filter((st): st is SubtestDef => Boolean(st));
                const filledCount = subtests.filter((st) => hasScoreValue(tests[testId]?.[st.id])).length;

                return (
                  <SortableTestCard key={testId} id={testId}>
                    {(listeners) => (
                      <div className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                        <div className="px-5 py-4 border-b border-[var(--border-color)] bg-[var(--hover-bg)] flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <button
                              {...listeners}
                              className="cursor-grab active:cursor-grabbing touch-none text-[var(--text-secondary)] rounded-xl p-1.5 hover:bg-[var(--card-bg)] hover:shadow-sm transition-all"
                              title="Réordonner"
                              aria-label="Réordonner"
                            >
                              <GripVertical size={16} />
                            </button>
                            <button
                              onClick={() => setCollapsedTests((p) => ({ ...p, [testId]: !p[testId] }))}
                              className="text-[var(--text-secondary)] rounded-xl p-1.5 hover:bg-[var(--card-bg)] hover:shadow-sm transition-all"
                              aria-label={collapsed ? 'Déplier' : 'Replier'}
                            >
                              {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            </button>
                            <div className="min-w-0">
                              {category && (
                                <div className="flex items-center gap-1 mb-0.5">
                                  <CatIcon size={10} className="text-[var(--text-secondary)]" />
                                  <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-widest">{category.name}</span>
                                </div>
                              )}
                              <h4 className="font-bold text-[var(--text-heading)] truncate">{def.name}</h4>
                              <p className="text-[11px] text-[var(--text-secondary)]">
                                {subtests.length} épreuve(s) · {filledCount} saisie(s)
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => removeTest(testId)}
                            className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-rose-500 hover:border-rose-200"
                            title="Retirer ce test"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {!collapsed && (
                          <div className="p-3">
                            {subtests.length === 0 ? (
                              <div className="p-6 text-center text-sm text-[var(--text-secondary)]">Aucune épreuve sélectionnée.</div>
                            ) : (
                              <SortableContext items={subtests.map((s) => subtestDragId(testId, s.id))} strategy={verticalListSortingStrategy}>
                                <ScoreTable
                                  testId={testId}
                                  subtests={subtests}
                                  scores={tests[testId]}
                                  onChange={(subId, patch) => updateSubtest(testId, subId, patch)}
                                  sortable
                                />
                              </SortableContext>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </SortableTestCard>
                );
              })}
            </SortableContext>
          </DndContext>
        </div>

        {testOrder.length > 0 && (
          <div className="hidden lg:block w-72 shrink-0">
            <ScoreSummaryPanel tests={tests} />
          </div>
        )}
      </div>

      <StepNavFooter onBack={onBack}>
        <button
          onClick={onNext}
          className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all bg-[var(--secondary)] hover:bg-[var(--primary)]"
        >
          <span>{nextLabel}</span>
          <ArrowRight size={20} />
        </button>
      </StepNavFooter>

      <TestCatalogModal isOpen={showCatalog} onClose={() => setShowCatalog(false)} existingTests={tests} onAddTests={addTests} />
    </div>
  );
};
