/**
 * ScoreTable — spreadsheet-style score entry for one test, shared by every flow
 * (initial and historical `ScorePage`, re-evaluation `Step1Scores`).
 *
 * Only the metric the practitioner types is stored (`{ value, unit }`); the
 * other columns show values derived from it (dimmed) — see utils/scoring.ts.
 * Rows adapt to the subtest's input model: standardized (NS/ET/%),
 * qualitative category or free observation.
 */

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import type { ScoreResult } from '../../../types';
import type { SubtestDef } from '../../../data/testCatalog';
import { useCatalog } from '../../../contexts/CatalogContext';
import { type Metric, describeScore } from '../../../utils/resolvedScore';
import { type ScoreMetric, hasScoreValue, metricToUnit, unitToMetric } from '../../../utils/scoring';
import { zoneRowClass, zoneTextClass } from './zoneStyles';
import { getScaleLabel } from '../../../utils/subtestOrdering';

export const ALL_METRICS: ScoreMetric[] = ['standard', 'z', 'percentile'];
const METRIC_HEADER: Record<ScoreMetric, Metric> = { standard: 'NS', z: 'ET', percentile: '%' };

type DragListeners = ReturnType<typeof useSortable>['listeners'];

interface ScoreTableProps {
  testId: string;
  subtests: SubtestDef[];
  scores: Record<string, ScoreResult> | undefined;
  /** Omit for a read-only table. */
  onChange?: (subtestId: string, patch: Partial<ScoreResult>) => void;
  /** Metric columns to show (re-evaluation shows only the metric used in the previous assessment). */
  metrics?: ScoreMetric[];
  /** Rows can be reordered with drag-and-drop (requires a DndContext ancestor). Ids: `sub:${testId}:${subtestId}`. */
  sortable?: boolean;
  /** Shows a remove button on each row (editable tables only). */
  onRemoveSubtest?: (subtestId: string) => void;
  /** With `onRemoveSubtest`: rows that get the remove button (all by default). */
  canRemoveSubtest?: (subtestId: string) => boolean;
}

const cellInput =
  'w-full text-center text-xs font-semibold bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors tabular-nums';
const cellDisplay = 'text-center text-xs font-medium text-[var(--text-secondary)] py-1.5 tabular-nums';
const noteInput =
  'w-full text-xs bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] transition-colors resize-none leading-snug';

export const subtestDragId = (testId: string, subtestId: string) => `sub:${testId}:${subtestId}`;

const SortableRow: React.FC<{ id: string; className?: string; children: (listeners: DragListeners) => React.ReactNode }> = ({
  id,
  className,
  children,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
  };
  return (
    <tr ref={setNodeRef} style={style} {...attributes} className={className}>
      {children(listeners)}
    </tr>
  );
};

const StaticRow: React.FC<{ id: string; className?: string; children: (listeners: DragListeners) => React.ReactNode }> = ({
  className,
  children,
}) => <tr className={className}>{children(undefined)}</tr>;

/** Auto-growing note field. */
const NoteCell: React.FC<{ value: string; readOnly: boolean; onChange: (v: string) => void }> = ({ value, readOnly, onChange }) =>
  readOnly ? (
    <div className="text-xs text-[var(--text-secondary)] py-1.5 italic whitespace-pre-wrap">{value}</div>
  ) : (
    <textarea
      value={value}
      rows={1}
      placeholder="Note..."
      className={noteInput}
      onChange={(e) => {
        onChange(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
      }}
    />
  );

export const ScoreTable: React.FC<ScoreTableProps> = ({
  testId,
  subtests,
  scores,
  onChange,
  metrics = ALL_METRICS,
  sortable = false,
  onRemoveSubtest,
  canRemoveSubtest = () => true,
}) => {
  const readOnly = !onChange;
  const { index } = useCatalog();
  const Row = sortable ? SortableRow : StaticRow;
  const colCount = metrics.length + 2 + (sortable ? 1 : 0) + (readOnly ? 0 : 1);
  const freeTextOnly = subtests.length > 0 && subtests.every((st) => st.inputModel === 'custom_text');
  const getScore = (id: string): ScoreResult => scores?.[id] ?? {};
  const update = (id: string, patch: Partial<ScoreResult>) => onChange?.(id, patch);

  const dragCell = (listeners: DragListeners) =>
    sortable ? (
      <td className="py-1 px-1 text-center align-top">
        <button
          {...listeners}
          type="button"
          className="cursor-grab active:cursor-grabbing touch-none p-1 rounded text-[var(--text-disabled)] hover:text-[var(--text-secondary)]"
          title="Réordonner"
          aria-label="Réordonner"
        >
          <GripVertical size={12} />
        </button>
      </td>
    ) : null;

  const statusCell = (filled: boolean, subtestId: string) =>
    readOnly ? null : (
      <td className="py-2 px-1 text-center">
        <div className="flex items-center justify-center gap-1">
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${filled ? 'bg-emerald-400' : 'bg-[var(--border-color)]'}`} />
          {onRemoveSubtest && canRemoveSubtest(subtestId) && (
            <button
              type="button"
              onClick={() => onRemoveSubtest(subtestId)}
              className="p-0.5 rounded text-[var(--text-disabled)] hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
              title="Retirer cette épreuve"
              aria-label="Retirer cette épreuve"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </td>
    );

  const nameCell = (st: SubtestDef) => (
    <td className="py-2 px-3 font-medium text-[var(--text-heading)]">
      <span className="block break-words">{st.name}</span>
      {st.inputModel === 'numeric_4mode' && getScaleLabel(st.scoreType) && (
        <span className="text-[9px] font-medium text-[var(--text-secondary)]">{getScaleLabel(st.scoreType)}</span>
      )}
    </td>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        {/* Free-observation blocks have no score columns: no header (#102). */}
        {!freeTextOnly && (
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              {sortable && <th className="w-[3%]" />}
              <th className="text-left py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[28%]">
                Épreuve
              </th>
              {metrics.map((m) => (
                <th
                  key={m}
                  className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[11%]"
                >
                  {METRIC_HEADER[m]}
                </th>
              ))}
              <th className="text-left py-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Observation
              </th>
              {!readOnly && <th className={onRemoveSubtest ? 'w-[5%]' : 'w-[3%]'} />}
            </tr>
          </thead>
        )}
        <tbody>
          {subtests.map((st) => {
            const res = getScore(st.id);
            const filled = hasScoreValue(res);
            const rowKey = subtestDragId(testId, st.id);
            const baseRow = 'border-b border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors';

            if (st.inputModel === 'custom_text') {
              return (
                <Row key={st.id} id={rowKey} className="border-b border-[var(--border-color)]">
                  {(listeners) => (
                    <>
                      {dragCell(listeners)}
                      <td colSpan={colCount - (sortable ? 1 : 0)} className="py-3 px-3">
                        {readOnly ? (
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-heading)]">{res.customLabel || 'Observation libre'}</p>
                            <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{res.observation}</p>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <input
                              type="text"
                              value={res.customLabel || ''}
                              onChange={(e) => update(st.id, { customLabel: e.target.value })}
                              placeholder="Titre de l'observation (ex : Bilan écologique, Questionnaire...)"
                              className="w-full text-sm font-semibold bg-transparent outline-none border-b border-transparent focus:border-[var(--primary)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] py-1"
                            />
                            <textarea
                              value={res.observation || ''}
                              onChange={(e) => update(st.id, { observation: e.target.value })}
                              placeholder="Notes libres..."
                              rows={5}
                              className="w-full text-xs bg-transparent outline-none border border-[var(--border-color)] rounded-lg px-3 py-2 focus:border-[var(--primary)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] resize-none"
                            />
                          </div>
                        )}
                      </td>
                    </>
                  )}
                </Row>
              );
            }

            if (st.inputModel === 'qualitative_category') {
              const options = st.inputConfig?.options ?? [];
              return (
                <Row key={st.id} id={rowKey} className={baseRow}>
                  {(listeners) => (
                    <>
                      {dragCell(listeners)}
                      {nameCell(st)}
                      <td colSpan={metrics.length} className="py-2 px-1">
                        {readOnly ? (
                          <div className={cellDisplay}>{res.qualitativeLabel || res.value || '—'}</div>
                        ) : (
                          <select
                            value={res.unit === 'qualitative' ? res.value || '' : ''}
                            onChange={(e) => {
                              const option = options.find((o) => o.code === e.target.value);
                              update(st.id, { value: e.target.value, unit: 'qualitative', qualitativeLabel: option?.label || '' });
                            }}
                            className="w-full text-xs bg-transparent border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-[var(--primary)] text-[var(--text-heading)]"
                          >
                            <option value="">—</option>
                            {options.map((o) => (
                              <option key={o.code} value={o.code}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-1 px-2">
                        <NoteCell value={res.observation || ''} readOnly={readOnly} onChange={(v) => update(st.id, { observation: v })} />
                      </td>
                      {statusCell(filled, st.id)}
                    </>
                  )}
                </Row>
              );
            }

            // Standardized score (NS / ET / %)
            const resolved = describeScore(index, testId, st.id, res);
            const activeMetric = unitToMetric(res.unit);
            const shownValue = (m: ScoreMetric): string => {
              if (activeMetric === m) return res.value || '';
              const value = resolved.valueIn(METRIC_HEADER[m]);
              return value !== null ? String(value) : '';
            };
            const zTone = zoneTextClass(resolved.zone);

            return (
              <Row key={st.id} id={rowKey} className={`group ${baseRow} ${zoneRowClass(resolved.zone)}`}>
                {(listeners) => (
                  <>
                    {dragCell(listeners)}
                    {nameCell(st)}
                    {metrics.map((m) => (
                      <td key={m} className="py-1 px-1">
                        {readOnly ? (
                          <div className={`${cellDisplay} ${m === 'z' ? zTone : ''}`}>{shownValue(m) || '—'}</div>
                        ) : (
                          <input
                            value={shownValue(m)}
                            inputMode="decimal"
                            onChange={(e) => update(st.id, { value: e.target.value, unit: metricToUnit(m) })}
                            className={`${cellInput} ${activeMetric === m ? 'border-b-[var(--primary)]' : 'opacity-60'} ${m === 'z' ? zTone : ''}`}
                            placeholder="—"
                          />
                        )}
                      </td>
                    ))}
                    <td className="py-1 px-2">
                      <NoteCell value={res.observation || ''} readOnly={readOnly} onChange={(v) => update(st.id, { observation: v })} />
                    </td>
                    {statusCell(filled, st.id)}
                  </>
                )}
              </Row>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
