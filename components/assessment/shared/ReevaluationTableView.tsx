import React, { useState } from 'react';
import type { ScoreResult, TestData } from '../../../types';
import type { SubtestDef } from '../../../data/testCatalog';
import { AlertCircle } from 'lucide-react';
import {
  isManualOnlyScoreType,
  deriveDisplayScores,
  scoreToneFromZ,
  zToneClass,
  hasScoreValue,
  unitToMetric,
} from '../../../utils/scoring';
import { getSubtestDisplayName, getScaleLabel } from '../../../utils/subtestOrdering';
import { ScoreTypeReportModal } from './ScoreTypeReportModal';

/**
 * ReevaluationTableView.tsx
 *
 * Read-only-capable spreadsheet-style score table, shared by the reevaluation
 * flow (`reevaluation/Step1Scores.tsx`) for its side-by-side previous/new
 * score comparison. Extracted from the legacy `Step2Tests.tsx` (which also
 * contained a full drag-and-drop test-catalog editing UI that is no longer
 * used anywhere — only this table view, its `Metric` type, and
 * `compareSubtestsForDisplay` — now in `utils/subtestOrdering.ts` — were ever
 * imported elsewhere).
 */

export type Metric = 'standard' | 'z' | 'percentile';

const hasValue = hasScoreValue;
const emptyScore = (): ScoreResult => ({});
// Legacy call sites pass (current, patch) — the merge with `current` now happens
// entirely in updateSubtest(), so this is just a passthrough for the patch itself.
const mergePatch = (_current: ScoreResult, patch: Partial<ScoreResult>): Partial<ScoreResult> => patch;

/* ─── Table View: spreadsheet-style quick entry ─── */
export const TableView: React.FC<{
  testId: string;
  subtests: SubtestDef[];
  tests: TestData;
  updateSubtest: (testId: string, subId: string, patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  singleMetric?: Metric | null;
}> = ({ testId, subtests, tests, updateSubtest, readOnly = false, singleMetric = null }) => {
  const [localZ, setLocalZ] = useState<Record<string, string>>({});
  const [reportingSubtest, setReportingSubtest] = useState<SubtestDef | null>(null);

  const getResult = (subId: string): ScoreResult => tests[testId]?.[subId] || emptyScore();

  const handleInput = (subId: string, metric: Metric, text: string, _subtest: SubtestDef) => {
    const current = getResult(subId);
    const setPatch = (patch: Partial<ScoreResult>) => updateSubtest(testId, subId, mergePatch(current, patch));

    if (metric === 'z') {
      setLocalZ(prev => ({ ...prev, [subId]: text }));
      setPatch({ value: text, unit: 'ET' });
      return;
    }
    setLocalZ(prev => { const next = { ...prev }; delete next[subId]; return next; });

    if (metric === 'standard') { setPatch({ value: text, unit: 'NS' }); return; }
    if (metric === 'percentile') { setPatch({ value: text, unit: '%' }); }
  };

  const cellInput = 'w-full text-center text-xs font-semibold bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors tabular-nums';
  const cellDisplay = 'text-center text-xs font-medium text-[var(--text-secondary)] py-1.5 tabular-nums';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-color)]">
            <th className="text-left py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[28%]">Épreuve</th>
            {(!singleMetric || singleMetric === 'standard') && <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[12%]">NS</th>}
            {(!singleMetric || singleMetric === 'z') && <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[12%]">ET</th>}
            {(!singleMetric || singleMetric === 'percentile') && <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)] w-[8%]">%</th>}
            <th className="text-left py-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-auto">Observation</th>
            {!readOnly && <th className="text-center py-2 px-1 w-[3%]" />}
          </tr>
        </thead>
        <tbody>
          {subtests.map(st => {
            const res = getResult(st.id);
            const isQual = st.inputModel === 'qualitative_category';
            // raw_only model OR score_type='none': no standardized scale → NS/ET/% not applicable
            const isUnscored = st.inputModel === 'raw_only' || isManualOnlyScoreType(st.scoreType);
            const hasData = hasValue(res);
            const scoreType = String(st.scoreType || 'standard');
            const derived = deriveDisplayScores(res, scoreType);
            const activeMetric = unitToMetric(res.unit);
            const hasZ = typeof derived.zScore === 'number' && Number.isFinite(derived.zScore);
            const tone = scoreToneFromZ(hasZ ? derived.zScore! : null);

            if (isQual) {
              const options = [...(st.inputConfig?.options || [])].sort((a, b) => a.order - b.order);
              const metricColCount = singleMetric ? 1 : 3;
              return (
                <tr key={st.id} className="border-b border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors">
                  <td className="py-2 px-3 font-medium text-[var(--text-heading)]">{getSubtestDisplayName(st)}</td>
                  <td colSpan={metricColCount} className="py-2 px-1">
                    {readOnly ? (
                      <div className={cellDisplay}>{res.qualitativeLabel || res.value || '—'}</div>
                    ) : (
                      <select
                        value={res.unit === 'qualitative' ? (res.value || '') : ''}
                        onChange={(e) => {
                          const opt = options.find(o => o.code === e.target.value);
                          updateSubtest(testId, st.id, mergePatch(res, {
                            value: e.target.value, unit: 'qualitative', qualitativeLabel: opt?.label || '',
                          }));
                        }}
                        className="w-full text-xs bg-transparent border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-[var(--primary)] text-[var(--text-heading)]"
                      >
                        <option value="">—</option>
                        {options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="py-1 px-2">
                    {readOnly ? (
                      <div className="text-xs text-[var(--text-secondary)] py-1.5 italic">{res.observation || ''}</div>
                    ) : (
                      <input
                        value={res.observation || ''}
                        onChange={(e) => updateSubtest(testId, st.id, mergePatch(res, { observation: e.target.value }))}
                        className="w-full text-xs bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] transition-colors"
                        placeholder="Note..."
                      />
                    )}
                  </td>
                  {!readOnly && (
                    <td className="py-2 px-1 text-center">
                      <span className={`inline-block h-2 w-2 rounded-full ${hasData ? 'bg-emerald-400' : 'bg-[var(--border-color)]'}`} />
                    </td>
                  )}
                </tr>
              );
            }

            return (
              <tr key={st.id} className={`group border-b border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors ${tone === 'bad' ? 'bg-rose-50/30 dark:bg-rose-900/10' : tone === 'warn' ? 'bg-amber-50/30 dark:bg-amber-900/10' : tone === 'good' ? 'bg-emerald-50/20 dark:bg-emerald-900/5' : ''}`}>
                <td className="py-2 px-3 font-medium text-[var(--text-heading)]">
                  <span className="truncate block max-w-[180px]">{getSubtestDisplayName(st)}</span>
                  {getScaleLabel(st.scoreType) && (
                    <span className="text-[9px] font-medium text-[var(--text-secondary)]">{getScaleLabel(st.scoreType)}</span>
                  )}
                </td>
                {/* NS */}
                {(!singleMetric || singleMetric === 'standard') && (
                  <td className="py-1 px-1">
                    {isUnscored ? (
                      <div className={cellDisplay}>—</div>
                    ) : readOnly ? (
                      <div className={cellDisplay}>{(activeMetric === 'standard' ? res.value : derived.standard) || '—'}</div>
                    ) : (
                      <input
                        value={activeMetric === 'standard' ? (res.value || '') : (derived.standard || '')}
                        inputMode="decimal"
                        onChange={(e) => handleInput(st.id, 'standard', e.target.value, st)}
                        className={`${cellInput} ${activeMetric === 'standard' ? 'border-b-[var(--primary)]' : 'opacity-60'}`}
                        placeholder="—"
                      />
                    )}
                  </td>
                )}
                {/* ET — colored by z score */}
                {(!singleMetric || singleMetric === 'z') && (
                  <td className="py-1 px-1">
                    {isUnscored ? (
                      <div className={cellDisplay}>—</div>
                    ) : readOnly ? (
                      <div className={`${cellDisplay} ${hasZ ? zToneClass(derived.zScore!) : ''}`}>
                        {activeMetric === 'z' ? (res.value || '—') : (hasZ ? String(derived.zScore) : '—')}
                      </div>
                    ) : (
                      <input
                        value={localZ[st.id] !== undefined ? localZ[st.id] : (activeMetric === 'z' ? (res.value || '') : (hasZ ? String(derived.zScore) : ''))}
                        inputMode="decimal"
                        onChange={(e) => handleInput(st.id, 'z', e.target.value, st)}
                        onBlur={() => {
                          if (localZ[st.id] !== undefined) {
                            setLocalZ(prev => { const next = { ...prev }; delete next[st.id]; return next; });
                          }
                        }}
                        className={`${cellInput} ${activeMetric === 'z' ? 'border-b-[var(--primary)]' : 'opacity-60'} ${hasZ ? zToneClass(derived.zScore!) : ''}`}
                        placeholder="—"
                      />
                    )}
                  </td>
                )}
                {/* % */}
                {(!singleMetric || singleMetric === 'percentile') && (
                  <td className="py-1 px-1">
                    {isUnscored ? (
                      <div className={cellDisplay}>—</div>
                    ) : readOnly ? (
                      <div className={cellDisplay}>{(activeMetric === 'percentile' ? res.value : derived.percentile) || '—'}</div>
                    ) : (
                      <input
                        value={activeMetric === 'percentile' ? (res.value || '') : (derived.percentile || '')}
                        inputMode="decimal"
                        onChange={(e) => handleInput(st.id, 'percentile', e.target.value, st)}
                        className={`${cellInput} ${activeMetric === 'percentile' ? 'border-b-[var(--primary)]' : 'opacity-60'}`}
                        placeholder="—"
                      />
                    )}
                  </td>
                )}
                {/* Observation */}
                <td className="py-1 px-2">
                  {readOnly ? (
                    <div className="text-xs text-[var(--text-secondary)] py-1.5 italic">{res.observation || ''}</div>
                  ) : (
                    <input
                      value={res.observation || ''}
                      onChange={(e) => updateSubtest(testId, st.id, mergePatch(res, { observation: e.target.value }))}
                      className="w-full text-xs bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] transition-colors"
                      placeholder="Note..."
                    />
                  )}
                </td>
                {/* Status dot + report */}
                {!readOnly && (
                  <td className="py-1 px-1 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className={`inline-block h-2 w-2 rounded-full ${hasData ? 'bg-emerald-400' : 'bg-[var(--border-color)]'}`} />
                      <button
                        type="button"
                        title="Signaler un score type incorrect"
                        onClick={() => setReportingSubtest(st)}
                        className="p-0.5 rounded text-amber-400 hover:text-amber-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      >
                        <AlertCircle size={11} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {reportingSubtest && (() => {
        const r = tests[testId]?.[reportingSubtest.id];
        const rDerived = deriveDisplayScores(r, String(reportingSubtest.scoreType || 'standard'));
        return (
          <ScoreTypeReportModal
            subtest={reportingSubtest}
            enteredNS={rDerived.standard ? parseFloat(rDerived.standard) : null}
            enteredET={typeof rDerived.zScore === 'number' ? rDerived.zScore : null}
            enteredPct={rDerived.percentile ? parseFloat(rDerived.percentile) : null}
            onClose={() => setReportingSubtest(null)}
          />
        );
      })()}
    </div>
  );
};

export default TableView;
