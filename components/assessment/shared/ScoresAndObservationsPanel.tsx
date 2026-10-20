/**
 * ScoresAndObservationsPanel — scores, observations and interview notes kept in view
 * while the practitioner writes (diagnostic step, #118) or proofreads the report (#121).
 */

import React, { useState, useMemo } from 'react';
import type { TestData } from '../../../types';
import { Activity, Quote } from 'lucide-react';
import { useCatalog } from '../../../contexts/CatalogContext';
import { zoneFromZ } from '../../../utils/scoring';
import { type ResolvedScore, resolveScores } from '../../../utils/resolvedScore';
import { zoneColor } from './zoneStyles';

/** Score as typed by the practitioner (NS/ET/% or category); null for an observation without score. */
const enteredScoreLabel = (r: ResolvedScore): string | null => (r.score.value?.trim() ? r.display() : null);

// --- SCORES & OBSERVATIONS PANEL (merged, expandable) ---
export const ScoresAndObservationsPanel: React.FC<{ tests: TestData; interviewNotes?: string }> = ({ tests, interviewNotes }) => {
  const { index } = useCatalog();
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);

  // Subtests keep the insertion order of tests[testId] (drag-and-drop order of the score page).
  const groupedData = useMemo(
    () =>
      resolveScores(tests, index)
        .filter((test) => test.subtests.length > 0)
        .map((test) => ({ testId: test.testId, name: test.testName, avg: test.meanZ, subtests: test.subtests })),
    [tests, index],
  );

  const hasContent = groupedData.length > 0;
  if (!hasContent && !interviewNotes) return null;

  return (
    <>
      {panelExpanded && (
        <div
          className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPanelExpanded(false)}
        >
          <div
            className="w-full max-w-6xl max-h-[85vh] overflow-y-auto bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-3 pb-2.5 border-b border-[var(--border-color)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-stone-400" />
                <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider">Scores & Observations</h4>
              </div>
              <button
                onClick={() => setPanelExpanded(false)}
                className="p-1.5 rounded-lg hover:bg-[var(--hover-bg)] text-stone-400 hover:text-[var(--text-heading)] transition-colors"
                title="Fermer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="divide-y divide-[var(--border-color)]">
              {groupedData.length === 0 && <p className="text-center text-xs text-[var(--text-secondary)] py-8">Aucun score enregistré.</p>}
              {groupedData.map(({ testId, name: testName, avg, subtests }, testIdx) => {
                const testColor = zoneColor(zoneFromZ(avg));
                return (
                  <div key={testId} className={`p-4 ${testIdx % 2 === 1 ? 'bg-stone-50/80 dark:bg-stone-900/30' : ''}`}>
                    <h5 className="text-xs font-bold text-[var(--text-heading)] mb-2 leading-tight flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: testColor }} />
                      {testName}
                    </h5>
                    <div className="space-y-1.5 pl-3">
                      {subtests.map((r) => {
                        const { subtestId: subId, label: subName, score: res } = r;
                        const col = zoneColor(r.zone);
                        const scoreStr = enteredScoreLabel(r);
                        const hasObs = !!res.observation?.trim();
                        return (
                          <div key={subId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs py-0.5">
                            <span className="text-[var(--text-secondary)]">{subName}</span>
                            {scoreStr && (
                              <span className="font-bold tabular-nums" style={{ color: col }}>
                                {scoreStr}
                              </span>
                            )}
                            {hasObs && <span className="italic text-[var(--text-secondary)]">« {res.observation} »</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {interviewNotes && (
              <div className="p-4 border-t border-[var(--border-color)]">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Notes d'entretien</p>
                <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{interviewNotes}</p>
              </div>
            )}
          </div>
        </div>
      )}
      {/* On wide screens the panel stays in view and scrolls on its own (#118): the practitioner reads the scores
          while writing on the left without losing her place. On mobile it is a plain block in the page flow. */}
      <div
        data-testid="scores-panel"
        className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-sm overflow-hidden flex flex-col lg:max-h-[calc(100vh-8rem)]"
      >
        {/* Panel header */}
        <div className="shrink-0 px-4 pt-3 pb-2.5 border-b border-[var(--border-color)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity size={13} className="text-stone-400" />
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider">Scores & Observations</h4>
          </div>
          <button
            onClick={() => setPanelExpanded((v) => !v)}
            className="p-1 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[#E07A5F] transition-colors"
            title={panelExpanded ? 'Réduire' : 'Agrandir'}
          >
            {panelExpanded ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            )}
          </button>
        </div>

        <div data-testid="scores-panel-scroll" className="min-h-0 overflow-y-auto overscroll-contain">
          {/* Interview notes */}
          {interviewNotes && (
            <div className="px-4 py-2.5 border-b border-[var(--border-color)] bg-amber-50/60 dark:bg-amber-950/20 flex items-start gap-2">
              <Quote size={10} className="text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p
                  className={`text-[10px] text-amber-900 dark:text-amber-200/80 italic leading-relaxed ${!notesExpanded && interviewNotes.length > 120 ? 'line-clamp-2' : ''}`}
                >
                  {interviewNotes}
                </p>
                {interviewNotes.length > 120 && (
                  <button
                    onClick={() => setNotesExpanded((p) => !p)}
                    className="text-[9px] text-amber-600 dark:text-amber-400 font-bold mt-0.5 hover:underline"
                  >
                    {notesExpanded ? 'Réduire' : 'Voir tout'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Table */}
          <table className="w-full border-collapse text-left">
            <tbody>
              {groupedData.map(({ testId, name, avg, subtests }) => {
                const color = zoneColor(zoneFromZ(avg));
                return (
                  <React.Fragment key={testId}>
                    {/* Test row */}
                    <tr className="bg-[var(--app-bg)]">
                      <td colSpan={2} className="px-4 pt-3 pb-1.5 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-[11px] font-bold text-[var(--text-heading)] flex-1">{name}</span>
                      </td>
                    </tr>

                    {/* Subtest rows */}
                    {subtests.map((r) => {
                      const { subtestId: subId, label: subName, score: res, z } = r;
                      const col = zoneColor(r.zone);
                      const hasObs = !!res.observation?.trim();
                      const hasZ = typeof z === 'number' && Number.isFinite(z);
                      const barW = hasZ ? Math.min(100, Math.max(2, ((z! + 3.5) / 7) * 100)) : null;
                      const scoreLabel = enteredScoreLabel(r);

                      return (
                        <tr
                          key={subId}
                          className={`border-t border-[var(--border-color)]/40 ${hasObs ? 'bg-violet-50/30 dark:bg-violet-950/15' : ''}`}
                        >
                          {/* Name + obs */}
                          <td className="pl-7 pr-3 py-1.5" colSpan={2}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="w-[2px] h-3 rounded-full shrink-0" style={{ backgroundColor: col }} />
                              <span className="text-[10px] text-[var(--text-secondary)] leading-tight flex-1">{subName}</span>
                              {/* score badge replaces the bar when no z can be computed */}
                              {!hasZ && scoreLabel && (
                                <span
                                  className="text-[9px] font-bold px-2 py-0.5 rounded-full border shrink-0"
                                  style={{ color: col, borderColor: col + '60', backgroundColor: col + '18' }}
                                >
                                  {scoreLabel}
                                </span>
                              )}
                            </div>
                            {/* Mini ET bar — color/position derived from z-score, label reflects entered unit */}
                            {hasZ && (
                              <div className="flex items-center gap-2 pl-3.5">
                                <div className="flex-1 h-[3px] bg-[var(--progress-bg)] rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${barW}%`, backgroundColor: col }}
                                  />
                                </div>
                                <span className="text-[9px] font-bold tabular-nums shrink-0" style={{ color: col }}>
                                  {scoreLabel}
                                </span>
                              </div>
                            )}
                            {hasObs && (
                              <div className="mt-1 pl-3.5">
                                <p className="text-[9px] text-violet-600 dark:text-violet-300 italic leading-snug">« {res.observation} »</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
