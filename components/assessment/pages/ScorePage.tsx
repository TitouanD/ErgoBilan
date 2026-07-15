import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Observations, Patient, ScoreResult, TestData, UserProfile } from '../../../types';
import { ICON_MAP, type ScoreType, type SubtestDef, type TestDef, type SubtestInputModel, type SubtestItem, type ItemsAggregation } from '../../../data/testCatalog';
import {
  parseNum,
  isManualOnlyScoreType,
  deriveDisplayScores,
  getZFromScore,
  scoreToneFromZ,
  zToneClass,
  hasScoreValue,
  unitToMetric,
  type DerivedScores,
} from '../../../utils/scoring';
import { useCatalog } from '../../../contexts/CatalogContext';
import { useVoiceDictation } from '../../../hooks/useVoiceDictation';
import { useFavoriteTests } from '../../../hooks/useFavoriteTests';
import { useToast } from '../../../contexts/ToastContext';
import { Logger } from '../../../utils/logger';
import { CustomTestEditor as CustomTestEditorLazy } from '../shared/CustomTestEditor';
import { getSubtestDisplayName, compareSubtestsForDisplay, getDisplayGroupKey, getDisplayGroupLabel, getScaleLabel, clamp } from '../../../utils/subtestOrdering';
import { ScoreTypeReportModal } from '../shared/ScoreTypeReportModal';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Layers,
  MessageSquare,
  Mic,
  MicOff,
  Plus,
  Search,
  Star,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { StepNavFooter } from '../shared/StepNavFooter';

interface Props {
  patient: Patient;
  tests: TestData;
  updateTests: (data: TestData) => void;
  observations: Observations;
  updateObservations: (data: Partial<Observations>) => void;
  onNext: () => void;
  onBack: () => void;
  userProfile?: UserProfile;
}

type Metric = 'raw' | 'standard' | 'z' | 'percentile';

// Parametric conversion engine, CDF helpers, deriveScores, zToneClass live in
// utils/scoring.ts; subtest display/grouping/ordering helpers live in
// utils/subtestOrdering.ts — both shared with the reevaluation TableView.

const METRIC_LABEL: Record<string, string> = { standard: 'NS', z: 'ET', percentile: '%' };

const getMetricDisplayLabel = (metric: Metric, scoreType?: ScoreType | string): string => {
  if (metric === 'standard') {
    if (scoreType === 'percentile') return '%ile';
    if (scoreType === 'standard') return 'QI';
    return 'NS'; // 'scaled' and others
  }
  return METRIC_LABEL[metric] || metric.toUpperCase();
};


const hasValue = hasScoreValue;
// Simplified: a score used to have a separate "reviewed" workflow (status/reviewState).
// That distinction is removed — a score is either filled in or it isn't.
const reviewed = hasScoreValue;

const emptyScore = (): ScoreResult => ({});

// Legacy call sites pass (current, patch) — the merge with `current` now happens
// entirely in updateSubtest(), so this is just a passthrough for the patch itself.
const mergePatch = (_current: ScoreResult, patch: Partial<ScoreResult>): Partial<ScoreResult> => patch;


const VoiceObservation: React.FC<{
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  onFocus?: () => void;
}> = ({ value, onChange, readOnly, onFocus }) => {
  const onTranscript = useCallback(
    (text: string) => {
      onChange(value ? `${value} ${text}` : text);
    },
    [value, onChange],
  );

  const { isListening, isSupported, interimText, toggleListening } = useVoiceDictation({ onTranscript });

  return (
    <div className="relative mt-3">
      <textarea
        value={isListening && interimText ? (value ? `${value} ${interimText}` : interimText) : value}
        onChange={(e) => !readOnly && onChange(e.target.value)}
        onFocus={onFocus}
        placeholder="Observation clinique rapide..."
        className="w-full p-3 pl-9 pr-10 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-main)] focus:border-[var(--primary)] focus:bg-[var(--card-bg)] outline-none resize-none transition-all placeholder:text-[var(--text-disabled)]"
        rows={2}
      />
      <MessageSquare size={14} className="absolute top-3 left-3 text-[var(--text-disabled)]" />
      {isSupported && !readOnly && (
        <button
          type="button"
          onClick={toggleListening}
          className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg transition-all ${isListening ? 'bg-red-100 text-red-500 animate-pulse' : 'text-[var(--text-disabled)] hover:text-[var(--primary)] hover:bg-[var(--hover-bg)]'
            }`}
        >
          {isListening ? <Mic size={12} /> : <MicOff size={12} />}
        </button>
      )}
    </div>
  );
};



// ─── Aggregate computation for computed_items subtests ───
const computeAggregate = (
  items: SubtestItem[],
  values: Record<string, number | undefined>,
  agg: ItemsAggregation,
): number | null => {
  const vals = items
    .filter((it) => !it.isMaster)
    .map((it) => values[it.id])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  if (agg === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (agg === 'best_of') return Math.max(...vals);
  if (agg === 'mean') return vals.reduce((a, b) => a + b, 0) / vals.length;
  return null; // 'custom' — manual entry
};

// ─── Shared row header + collapse button ───
const RowHeader: React.FC<{
  subtest: SubtestDef;
  badge?: React.ReactNode;
  onToggleExpand?: () => void;
}> = ({ subtest, badge, onToggleExpand }) => (
  <div className="flex items-start gap-1.5 mb-4">
    <button
      type="button"
      onClick={() => onToggleExpand?.()}
      className="mt-0.5 rounded p-0.5 text-[var(--text-secondary)] hover:text-[var(--primary)] hover:bg-[var(--hover-bg)] shrink-0"
      aria-label="Refermer le sous-test"
    >
      <ChevronDown size={12} className="rotate-180" />
    </button>
    <div className="min-w-0 flex-1">
      <h4 className="font-semibold text-[var(--text-heading)] text-sm md:text-base leading-tight break-words">
        {getSubtestDisplayName(subtest)}
      </h4>
      <div className="flex items-center flex-wrap gap-1.5 mt-1">
        {subtest.unit && <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{subtest.unit}</span>}
        {getScaleLabel(subtest.scoreType) && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-300">
            {getScaleLabel(subtest.scoreType)}
          </span>
        )}
        {badge}
      </div>
    </div>
  </div>
);

// ─── NumericRow: NS-centric entry with auto-conversion ───────────────────────
const NumericRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onToggleExpand?: () => void;
  preferredMetric?: Metric;
  onPreferredMetricChange?: (m: Metric) => void;
  onAdvance?: () => void;
}> = ({
  subtest, result, onChange, readOnly, onFocus, onToggleExpand,
  preferredMetric, onPreferredMetricChange, onAdvance,
}) => {
  const scoreType = String(subtest.scoreType || 'standard');
  const conversionLocked = isManualOnlyScoreType(subtest.scoreType);
  const cfg = subtest.inputConfig || {};
  const items: SubtestItem[] = cfg.items || [];
  const aggregation: ItemsAggregation = (cfg.itemsAggregation || 'sum') as ItemsAggregation;
  const hasItems = items.length > 0 && subtest.inputModel === 'computed_items';

  const [localItemValues, setLocalItemValues] = useState<Record<string, number | undefined>>(
    () => (result.rawItems as Record<string, number | undefined> | undefined) || {},
  );
  const [itemsExpanded, setItemsExpanded] = useState(true);

  React.useEffect(() => {
    if (result.rawItems && Object.keys(result.rawItems).length > 0) {
      setLocalItemValues(result.rawItems as Record<string, number | undefined>);
    }
  }, []);

  const activeMetric: Metric = (() => {
    const storedMetric = unitToMetric(result.unit);
    if (storedMetric) return storedMetric;
    if (!hasValue(result) && preferredMetric && preferredMetric !== 'raw') return preferredMetric;
    return 'standard';
  })();

  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));

  // Switching the metric selector before typing anything is a transient UI
  // preference only — nothing is persisted until the practitioner enters a value.
  const handleSetMetric = (m: Metric) => {
    onPreferredMetricChange?.(m);
  };

  const handleItemChange = (itemId: string, text: string) => {
    if (readOnly) return;
    const n = parseNum(text);
    const newVals = { ...localItemValues, [itemId]: n ?? undefined };
    setLocalItemValues(newVals);
    setPatch({ rawItems: newVals });
  };

  // "Last wins": whichever metric the practitioner types into becomes the
  // single stored value+unit, overwriting whatever was there before.
  const handleInput = (text: string) => {
    if (readOnly) return;
    if (activeMetric === 'z') { setPatch({ value: text, unit: 'ET' }); return; }
    if (activeMetric === 'percentile') { setPatch({ value: text, unit: '%' }); return; }
    setPatch({ value: text, unit: 'NS' });
  };

  const handleBlur = () => {
    if (hasValue(result)) {
      setTimeout(() => onAdvance?.(), 200);
    }
  };

  const displayDerived: DerivedScores = deriveDisplayScores(result, scoreType);

  const getInputValue = (): string => {
    const storedMetric = unitToMetric(result.unit);
    if (storedMetric === activeMetric) return result.value || '';
    // Not the stored metric: show the computed conversion as an editable prefill.
    if (activeMetric === 'z') return typeof displayDerived.zScore === 'number' ? String(displayDerived.zScore) : '';
    if (activeMetric === 'percentile') return displayDerived.percentile || '';
    return displayDerived.standard || '';
  };

  const filledCount = items.filter((it) => !it.isMaster && localItemValues[it.id] !== undefined).length;
  const displayGroup = cfg.displayGroup ?? 'column';
  const gridClass =
    displayGroup === 'grid_2' ? 'grid grid-cols-2 gap-2' :
    displayGroup === 'grid_3' ? 'grid grid-cols-3 gap-2' :
    displayGroup === 'table' ? 'divide-y divide-[var(--border-color)]' : 'space-y-2';

  const metrics: Metric[] = conversionLocked ? [] : ['standard', 'z', 'percentile'];
  const metricLabel = (m: Metric): string => {
    if (m === 'standard') return getScaleLabel(subtest.scoreType) || 'NS';
    if (m === 'z') return 'ET';
    if (m === 'percentile') return '%';
    return m.toUpperCase();
  };

  const hasZ = typeof displayDerived.zScore === 'number' && Number.isFinite(displayDerived.zScore);
  const displayedZ = hasZ ? displayDerived.zScore! : null;
  const displayedPct = displayDerived.percentile ? parseInt(displayDerived.percentile) : null;
  const nsLabel = subtest.scoreType === 'standard' ? 'QI' : 'NS';
  const derivedBadges: { label: string; value: string; z: number | null }[] = [];
  if (!conversionLocked && result.value) {
    if (activeMetric !== 'standard' && displayDerived.standard) derivedBadges.push({ label: nsLabel, value: displayDerived.standard, z: null });
    if (activeMetric !== 'z' && displayedZ !== null) derivedBadges.push({ label: 'ET', value: `${displayedZ > 0 ? '+' : ''}${displayedZ.toFixed(2)}`, z: displayedZ });
    if (activeMetric !== 'percentile' && displayedPct !== null) derivedBadges.push({ label: '%', value: `${displayedPct}\u202f%`, z: null });
  }
  const [showReportModal, setShowReportModal] = useState(false);

  return (
    <div className="bg-[var(--card-bg)]">
      <div className="p-4 md:p-5">
        <RowHeader
          subtest={subtest}
          onToggleExpand={onToggleExpand}
          badge={hasItems ? (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-500 dark:bg-violet-900/30 dark:text-violet-300">
              <Layers size={9} className="inline mr-0.5" />Items
            </span>
          ) : undefined}
        />

        {/* Items section (computed_items) */}
        {hasItems && (
          <div className="mb-4 rounded-xl border border-[var(--border-color)] overflow-hidden">
            <button
              type="button"
              onClick={() => setItemsExpanded((e) => !e)}
              className="w-full flex items-center justify-between px-3 py-2 bg-[var(--hover-bg)] text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--border-color)] transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Layers size={11} />Items
                <span className="rounded-full bg-[var(--border-color)] px-1.5 py-0.5 text-[9px] font-medium">
                  {filledCount}/{items.filter((it) => !it.isMaster).length}
                </span>
              </span>
              {itemsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {itemsExpanded && (
              <div className={`p-3 ${gridClass}`}>
                {items.map((item) => {
                  const val = localItemValues[item.id];
                  const strVal = val !== undefined ? String(val) : '';
                  if (item.type === 'boolean') {
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="text-xs text-[var(--text-main)] font-medium">{item.label}</span>
                        <button type="button" disabled={readOnly}
                          onClick={() => handleItemChange(item.id, String(val === 1 ? 0 : 1))}
                          className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${val === 1 ? 'bg-emerald-500 text-white border-emerald-500' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}
                        >{val === 1 ? 'Oui' : 'Non'}</button>
                      </div>
                    );
                  }
                  return (
                    <div key={item.id} className={`flex items-center gap-2 ${item.wide ? 'col-span-full' : ''}`}>
                      <label className="text-xs text-[var(--text-main)] font-medium flex-1 min-w-0 truncate">{item.label}</label>
                      <div className="flex items-center gap-1 shrink-0">
                        <input type="number" value={strVal} min={item.min} max={item.max}
                          step={item.decimals !== undefined ? Math.pow(10, -item.decimals) : 1}
                          disabled={readOnly || item.isMaster} onFocus={() => onFocus?.()}
                          onChange={(e) => handleItemChange(item.id, e.target.value)}
                          placeholder="—"
                          className="w-20 text-center text-sm font-bold bg-[var(--input-bg)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary-opacity-20)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors disabled:opacity-50"
                          aria-label={item.label}
                        />
                        {item.unit && <span className="text-[10px] text-[var(--text-secondary)] font-medium w-8">{item.unit}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Metric selector + primary input */}
        <div className="mb-3">
          {metrics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {metrics.map((m) => (
                <button key={m} type="button" disabled={readOnly} onClick={() => handleSetMetric(m)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                    activeMetric === m
                      ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
                  } ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                >{metricLabel(m)}</button>
              ))}
            </div>
          )}
          <input
            value={getInputValue()} disabled={readOnly} inputMode="decimal"
            onFocus={() => onFocus?.()} onBlur={handleBlur}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="—"
            className={`w-32 text-center text-3xl font-bold bg-transparent border-b-2 border-[var(--primary)] outline-none py-2 text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors ${readOnly ? 'cursor-not-allowed opacity-70' : ''}`}
            aria-label={`${metricLabel(activeMetric)} pour ${getSubtestDisplayName(subtest)}`}
          />
          {derivedBadges.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] font-medium items-center">
              {derivedBadges.map((b) => (
                <span key={b.label} className={b.label === 'ET' ? zToneClass(b.z) : 'text-[var(--text-secondary)]'}>
                  {b.label}&nbsp;{b.value}
                </span>
              ))}
              {!readOnly && (
                <button
                  type="button"
                  title="Signaler un score type incorrect"
                  onClick={() => setShowReportModal(true)}
                  className="ml-auto p-0.5 rounded text-amber-400 hover:text-amber-600 transition-colors opacity-50 hover:opacity-100"
                >
                  <AlertCircle size={13} />
                </button>
              )}
            </div>
          )}
        </div>

        <VoiceObservation value={result.observation || ''} onChange={(v) => setPatch({ observation: v })} readOnly={readOnly} onFocus={onFocus} />
      </div>
      {showReportModal && (
        <ScoreTypeReportModal
          subtest={subtest}
          enteredNS={displayDerived.standard ? parseFloat(displayDerived.standard) : null}
          enteredET={typeof displayDerived.zScore === 'number' ? displayDerived.zScore : null}
          enteredPct={displayDerived.percentile ? parseFloat(displayDerived.percentile) : null}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
};

// ─── CustomTextRow: free text / observation entry ───
const CustomTextRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onToggleExpand?: () => void;
  onAdvance?: () => void;
}> = ({ subtest, result, onChange, readOnly, onFocus, onToggleExpand, onAdvance }) => {
  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));
  const handleBlur = () => {
    if (hasValue(result)) {
      setTimeout(() => onAdvance?.(), 200);
    }
  };
  return (
    <div className="bg-[var(--card-bg)] p-4 md:p-5">
      <RowHeader subtest={subtest} onToggleExpand={onToggleExpand} />
      <div className="mb-3">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Titre de l&apos;observation</label>
        <input
          type="text"
          value={result.customLabel || ''}
          disabled={readOnly}
          onFocus={onFocus}
          onBlur={handleBlur}
          onChange={(e) => setPatch({ customLabel: e.target.value })}
          placeholder="Ex : Observation en classe, Bilan écologique..."
          className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-4 py-2.5 text-sm font-medium text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-opacity-10)] transition-colors"
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Notes libres</label>
        <VoiceObservation
          value={result.observation || ''}
          onChange={(v) => { setPatch({ observation: v }); }}
          readOnly={readOnly}
          onFocus={onFocus}
        />
      </div>
    </div>
  );
};

// ─── QualitativeRow: qualitative category selection ───
const QualitativeRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onToggleExpand?: () => void;
  onAdvance?: () => void;
}> = ({ subtest, result, onChange, readOnly, onFocus, onToggleExpand, onAdvance }) => {
  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));
  const options = [...(subtest.inputConfig?.options || [])].sort((a, b) => a.order - b.order);
  const layout = subtest.inputConfig?.qualitativeLayout || 'toggle';
  const selected = result.unit === 'qualitative' ? (result.value || '') : '';

  const selectOption = (code: string) => {
    if (readOnly) return;
    const opt = options.find((o) => o.code === code);
    onChange(mergePatch(result, {
      value: code, unit: 'qualitative', qualitativeLabel: opt?.label || '',
    }));
    setTimeout(() => onAdvance?.(), 250);
  };

  return (
    <div className="bg-[var(--card-bg)] p-4 md:p-5">
      <RowHeader subtest={subtest} onToggleExpand={onToggleExpand} />
      {layout === 'toggle' ? (
        <div className="flex flex-wrap gap-2 mb-3">
          {options.map((opt) => (
            <button
              key={opt.code}
              type="button"
              disabled={readOnly}
              onFocus={onFocus}
              onClick={() => selectOption(opt.code)}
              className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all ${selected === opt.code ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm' : 'border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--primary)]'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : (
        <select
          value={selected}
          disabled={readOnly}
          onFocus={onFocus}
          onChange={(e) => selectOption(e.target.value)}
          className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-heading)] outline-none focus:border-[var(--primary)] mb-3"
        >
          <option value="">— Sélectionner —</option>
          {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      )}
      <VoiceObservation value={result.observation || ''} onChange={(v) => setPatch({ observation: v })} readOnly={readOnly} onFocus={onFocus} />
    </div>
  );
};

// ─── RawOnlyRow: single value entry for scoreType=none ───
const RawOnlyRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  onToggleExpand?: () => void;
  onAdvance?: () => void;
}> = ({ subtest, result, onChange, readOnly, onFocus, onToggleExpand, onAdvance }) => {
  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));
  const cfg = subtest.inputConfig || {};
  const rawLabel = cfg.rawValueLabel || 'Valeur';
  const showFraction = cfg.showRawFraction && cfg.maxRawScore != null;

  const handleBlur = () => {
    if (hasValue(result)) {
      setTimeout(() => onAdvance?.(), 200);
    }
  };

  return (
    <div className="bg-[var(--card-bg)] p-4 md:p-5">
      <RowHeader subtest={subtest} onToggleExpand={onToggleExpand} />
      <div className="mb-4">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">{rawLabel}</span>
        <div className="flex items-baseline gap-2">
          <input
            value={result.value || ''}
            disabled={readOnly}
            inputMode="decimal"
            onFocus={onFocus}
            onBlur={handleBlur}
            onChange={(e) => setPatch({ value: e.target.value, unit: 'raw' })}
            placeholder="—"
            className="w-32 text-center text-3xl font-bold bg-transparent border-b-2 border-[var(--primary)] outline-none py-2 text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors"
          />
          {showFraction && <span className="text-xl font-semibold text-[var(--text-secondary)]">/ {cfg.maxRawScore}</span>}
          {subtest.unit && !showFraction && <span className="text-sm text-[var(--text-secondary)] font-medium">{subtest.unit}</span>}
        </div>
      </div>
      <VoiceObservation value={result.observation || ''} onChange={(v) => setPatch({ observation: v })} readOnly={readOnly} onFocus={onFocus} />
    </div>
  );
};

const FlexibleSubtestRow = React.memo((props: {
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  preferredMetric?: Metric;
  onPreferredMetricChange?: (m: Metric) => void;
  onAdvance?: () => void;
}) => {
  const { subtest, result, onChange, readOnly, onFocus, onToggleExpand, preferredMetric, onPreferredMetricChange, onAdvance } = props;
  const model = subtest.inputModel || 'numeric_4mode';
  if (model === 'custom_text') return <CustomTextRow subtest={subtest} result={result} onChange={onChange} readOnly={readOnly} onFocus={onFocus} onToggleExpand={onToggleExpand} onAdvance={onAdvance} />;
  if (model === 'qualitative_category') return <QualitativeRow subtest={subtest} result={result} onChange={onChange} readOnly={readOnly} onFocus={onFocus} onToggleExpand={onToggleExpand} onAdvance={onAdvance} />;
  if (model === 'raw_only') return <RawOnlyRow subtest={subtest} result={result} onChange={onChange} readOnly={readOnly} onFocus={onFocus} onToggleExpand={onToggleExpand} onAdvance={onAdvance} />;
  return (
    <NumericRow
      subtest={subtest}
      result={result}
      onChange={onChange}
      readOnly={readOnly}
      onFocus={onFocus}
      onToggleExpand={onToggleExpand}
      preferredMetric={preferredMetric}
      onPreferredMetricChange={onPreferredMetricChange}
      onAdvance={onAdvance}
    />
  );
});

const CompactSubtestRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onClick: () => void;
  onDelete?: () => void;
  onInlineChange?: (patch: Partial<ScoreResult>) => void;
}> = ({ subtest, result, onClick, onDelete, onInlineChange }) => {
  const hasData = hasValue(result);
  const scoreType = String(subtest.scoreType || 'standard');
  const derived = deriveDisplayScores(result, scoreType);
  const displayZ = typeof derived.zScore === 'number' && Number.isFinite(derived.zScore) ? derived.zScore : null;
  const tone = scoreToneFromZ(displayZ);

  const parts: string[] = [];
  const standardLabel = subtest.scoreType === 'standard' ? 'QI' : 'NS';
  if (derived.standard) parts.push(`${standardLabel} ${derived.standard}`);
  if (displayZ !== null) parts.push(`ET ${displayZ > 0 ? '+' : ''}${displayZ.toFixed(2)}`);
  if (derived.percentile) parts.push(`${derived.percentile}\u202F%`);
  if (result.unit === 'qualitative' && result.qualitativeLabel) parts.push(result.qualitativeLabel);
  if (result.unit === 'raw' && result.value) parts.push(`Brut ${result.value}`);

  return (
    <div className="w-full flex items-center group">
      <button
        type="button"
        onClick={onClick}
        className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--hover-bg)] transition-colors min-w-0"
      >
        <ChevronRight size={14} className="text-[var(--text-disabled)] group-hover:text-[var(--primary)] transition-colors shrink-0" />
        <span className="font-medium text-sm text-[var(--text-heading)] truncate min-w-0 flex-1">
          {subtest.inputModel === 'custom_text'
            ? (result.customLabel || 'Observation personnalisée')
            : getSubtestDisplayName(subtest)}
        </span>
        {hasData && parts.length > 0 && (
          <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${tone === 'bad' ? 'text-rose-500' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : 'text-[var(--text-secondary)]'
            }`}>
            {parts.join(' \u00b7 ')}
          </span>
        )}
        <span className={`h-2 w-2 rounded-full shrink-0 transition-colors ${hasData ? 'bg-emerald-400' : 'bg-[var(--border-color)]'
          }`} />
      </button>
      {onInlineChange && subtest.inputModel !== 'custom_text' && subtest.inputModel !== 'qualitative_category' && !isManualOnlyScoreType(subtest.scoreType) && (
        <div className="shrink-0 flex items-center mr-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            inputMode="decimal"
            value={result.unit === 'NS' ? (result.value || '') : ''}
            onChange={(e) => {
              onInlineChange(mergePatch(result, { value: e.target.value, unit: 'NS' }));
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="NS"
            className="w-16 text-center text-sm font-bold bg-[var(--input-bg)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary-opacity-20)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors"
          />
        </div>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 mr-2 p-1.5 rounded-lg bg-rose-50 text-rose-400 hover:bg-rose-100 hover:text-rose-600 transition-colors"
          title="Supprimer ce sous-test"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};

/* â”€â”€â”€ Table View: spreadsheet-style quick entry â”€â”€â”€ */
type DragListeners = ReturnType<typeof useSortable>['listeners'];

/** Wraps a single subtest row so it can be reordered via drag-and-drop within its test
 *  (shares the page-level DndContext with the test-level reordering). */
const SortableSubtestRow: React.FC<{
  id: string;
  className?: string;
  children: (dragListeners: DragListeners) => React.ReactNode;
}> = ({ id, className, children }) => {
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

const TableView: React.FC<{
  testId: string;
  subtests: SubtestDef[];
  tests: TestData;
  updateSubtest: (testId: string, subId: string, patch: Partial<ScoreResult>) => void;
}> = ({ testId, subtests, tests, updateSubtest }) => {
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

  const handleBlurField = (_subId: string) => {
    // No-op: no review workflow to update anymore. Kept for call-site compatibility.
  };

  const cellInput = 'w-full text-center text-xs font-semibold bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors tabular-nums';
  const cellDisplay = 'text-center text-xs font-medium text-[var(--text-secondary)] py-1.5 tabular-nums';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        {testId !== 'custom_observations' && (
        <thead>
          <tr className="border-b border-[var(--border-color)]">
            <th className="w-[3%]" />
            <th className="text-left py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[26%]">Épreuve</th>
            <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[12%]">NS</th>
            <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[12%]">ET</th>
            <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)] w-[8%]">%</th>
            <th className="text-left py-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-auto">Observation</th>
            <th className="text-center py-2 px-1 w-[3%]" />
          </tr>
        </thead>
        )}
        <tbody>
          <SortableContext items={subtests.map((s) => `sub:${testId}:${s.id}`)} strategy={verticalListSortingStrategy}>
          {subtests.map(st => {
            const res = getResult(st.id);
            const isQual = st.inputModel === 'qualitative_category';
            const isRawOnly = st.inputModel === 'raw_only';
            const isCustomText = st.inputModel === 'custom_text';
            const hasData = hasValue(res);
            const scoreType = String(st.scoreType || 'standard');
            const derived = deriveDisplayScores(res, scoreType);
            const activeMetric = unitToMetric(res.unit);
            const hasZ = typeof derived.zScore === 'number' && Number.isFinite(derived.zScore);
            const tone = scoreToneFromZ(hasZ ? derived.zScore! : null);
            const dragId = `sub:${testId}:${st.id}`;
            const dragHandleCell = (dragListeners: DragListeners) => (
              <td className="py-1 px-1 text-center align-top">
                <button
                  {...dragListeners}
                  type="button"
                  className="cursor-grab active:cursor-grabbing touch-none p-1 rounded text-[var(--text-disabled)] hover:text-[var(--text-secondary)]"
                  title="Réordonner"
                  aria-label="Réordonner"
                >
                  <GripVertical size={12} />
                </button>
              </td>
            );

            if (isCustomText) {
              return (
                <SortableSubtestRow key={st.id} id={dragId} className="border-b border-[var(--border-color)]">
                  {(dragListeners) => (
                    <>
                      {dragHandleCell(dragListeners)}
                      <td colSpan={6} className="py-3 px-3">
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            value={res.customLabel || ''}
                            onChange={(e) => updateSubtest(testId, st.id, mergePatch(res, { customLabel: e.target.value }))}
                            placeholder="Titre de l'observation (ex : Bilan écologique, Questionnaire...)"
                            className="w-full text-sm font-semibold bg-transparent outline-none border-b border-transparent focus:border-[var(--primary)] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors py-1"
                          />
                          <textarea
                            value={res.observation || ''}
                            onChange={(e) => updateSubtest(testId, st.id, mergePatch(res, { observation: e.target.value }))}
                            placeholder="Notes libres..."
                            rows={5}
                            className="w-full text-xs bg-transparent outline-none border border-[var(--border-color)] rounded-lg px-3 py-2 focus:border-[var(--primary)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] transition-colors resize-none"
                          />
                        </div>
                      </td>
                    </>
                  )}
                </SortableSubtestRow>
              );
            }

            if (isQual) {
              const options = [...(st.inputConfig?.options || [])].sort((a, b) => a.order - b.order);
              return (
                <SortableSubtestRow key={st.id} id={dragId} className="border-b border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors">
                  {(dragListeners) => (
                    <>
                      {dragHandleCell(dragListeners)}
                      <td className="py-2 px-3 font-medium text-[var(--text-heading)]">{getSubtestDisplayName(st)}</td>
                      <td colSpan={3} className="py-2 px-1">
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
                      </td>
                      <td className="py-1 px-2">
                        <textarea
                          value={res.observation || ''}
                          onChange={(e) => { updateSubtest(testId, st.id, mergePatch(res, { observation: e.target.value })); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                          rows={1}
                          className="w-full text-xs bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] transition-colors resize-none leading-snug"
                          placeholder="Note..."
                        />
                      </td>
                      <td className="py-2 px-1 text-center">
                        <span className={`inline-block h-2 w-2 rounded-full ${hasData ? 'bg-emerald-400' : 'bg-[var(--border-color)]'}`} />
                      </td>
                    </>
                  )}
                </SortableSubtestRow>
              );
            }

            return (
              <SortableSubtestRow
                key={st.id}
                id={dragId}
                className={`group border-b border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors ${tone === 'bad' ? 'bg-rose-50/30 dark:bg-rose-900/10' : tone === 'warn' ? 'bg-amber-50/30 dark:bg-amber-900/10' : tone === 'good' ? 'bg-emerald-50/20 dark:bg-emerald-900/5' : ''}`}
              >
                {(dragListeners) => (
                  <>
                    {dragHandleCell(dragListeners)}
                    <td className="py-2 px-3 font-medium text-[var(--text-heading)]">
                      <span className="truncate block max-w-[180px]">{getSubtestDisplayName(st)}</span>
                      {getScaleLabel(st.scoreType) && (
                        <span className="text-[9px] font-medium text-[var(--text-secondary)]">{getScaleLabel(st.scoreType)}</span>
                      )}
                    </td>
                    {/* NS */}
                    <td className="py-1 px-1">
                      {isRawOnly ? (
                        <div className={cellDisplay}>—</div>
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
                    {/* ET — colored by z score */}
                    <td className="py-1 px-1">
                      {isRawOnly ? (
                        <div className={cellDisplay}>—</div>
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
                    {/* % — editable */}
                    <td className="py-1 px-1">
                      {isRawOnly ? (
                        <div className={cellDisplay}>—</div>
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
                    {/* Observation */}
                    <td className="py-1 px-2">
                      <textarea
                        value={res.observation || ''}
                        onChange={(e) => { updateSubtest(testId, st.id, mergePatch(res, { observation: e.target.value })); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                        rows={1}
                        className="w-full text-xs bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[var(--primary)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] transition-colors resize-none leading-snug"
                        placeholder="Note..."
                      />
                    </td>
                    {/* Status dot + report */}
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
                  </>
                )}
              </SortableSubtestRow>
            );
          })}
          </SortableContext>
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

const SummaryPanel: React.FC<{ tests: TestData }> = ({ tests }) => {
  const { catalog } = useCatalog();

  const testRows = useMemo(() => {
    const testNameMap: Record<string, string> = {};
    const scoreTypeMap: Record<string, Record<string, string>> = {};
    catalog.forEach((cat) => {
      cat.tests.forEach((t) => {
        testNameMap[t.id] = t.name;
        scoreTypeMap[t.id] = {};
        t.subtests.forEach((st) => { scoreTypeMap[t.id][st.id] = String(st.scoreType || 'standard'); });
      });
    });

    const rows: { testId: string; name: string; avg: number | null; subtestCount: number; zCount: number }[] = [];
    Object.entries(tests).forEach(([testId, subtests]) => {
      const zScores: number[] = [];
      Object.entries(subtests).forEach(([subId, res]) => {
        const z = getZFromScore(res, scoreTypeMap[testId]?.[subId] || 'standard');
        if (z !== null) zScores.push(z);
      });
      const avg = zScores.length > 0 ? zScores.reduce((a, b) => a + b, 0) / zScores.length : null;

      // For custom_observations, build a display name from the customLabels of subtests
      let displayName = testNameMap[testId];
      if (!displayName && testId === 'custom_observations') {
        const labels = Object.values(subtests)
          .map((res) => res.customLabel?.trim())
          .filter(Boolean);
        displayName = labels.length > 0 ? labels.join(', ') : 'Observations libres';
      }

      rows.push({
        testId,
        name: displayName || testId,
        avg,
        subtestCount: Object.keys(subtests).length,
        zCount: zScores.length,
      });
    });

    return rows;
  }, [tests, catalog]);

  return (
    <div className="sticky top-24 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 shadow-sm space-y-3">
      <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
        <Activity size={14} />
        Résumé par test
      </h4>

      {testRows.length === 0 ? (
        <div className="h-2 rounded-full bg-[var(--progress-bg)]" />
      ) : (
        <div className="space-y-2">
          {testRows.map(({ testId, name, avg, subtestCount }) => {
            const hasAvg = typeof avg === 'number' && Number.isFinite(avg);
            const markerLeft = hasAvg ? ((clamp(avg!, -3.5, 3.5) + 3.5) / 7) * 100 : null;
            const tone = scoreToneFromZ(hasAvg ? avg! : null);
            return (
              <div key={testId}>
                <div className="mb-1 flex items-center justify-between text-[10px]">
                  <span className="truncate font-medium text-[var(--text-secondary)] max-w-[160px]">{name}</span>
                  {hasAvg ? (
                    <span className={`font-bold ${tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {avg! > 0 ? '+' : ''}
                      {avg!.toFixed(2)} ET
                    </span>
                  ) : (
                    <span className="font-bold text-[var(--text-disabled)]">--</span>
                  )}
                </div>
                {hasAvg ? (
                  <div
                    className="relative h-2 rounded-full"
                    style={{
                      background:
                        'linear-gradient(to right, #f87171 0%, #f87171 21.4%, #fbbf24 21.4%, #fbbf24 35.7%, #34d399 35.7%, #34d399 100%)',
                    }}
                  >
                    <span
                      className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-[var(--secondary)] shadow"
                      style={{ left: `${markerLeft}%` }}
                    />
                  </div>
                ) : (
                  <div className="h-2 rounded-full bg-[var(--progress-bg)]" />
                )}
                <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                  <span>{subtestCount} épreuve(s)</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const TestCatalogModal: React.FC<{ isOpen: boolean; onClose: () => void; existingTests: TestData; onAddTests: (selection: Record<string, string[]>) => void; initialExpandedTestId?: string | null }> = ({ isOpen, onClose, existingTests, onAddTests, initialExpandedTestId }) => {
  const { catalog, searchTests, ensureCatalogLoaded, loading } = useCatalog();
  const { favorites, recentTests, toggleFavorite, isFavorite } = useFavoriteTests();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [subtestSearchByTest, setSubtestSearchByTest] = useState<Record<string, string>>({});
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    ensureCatalogLoaded();
    setExpandedTestId(initialExpandedTestId || null);
    setActiveCategoryId('all');
    setSubtestSearchByTest({});
  }, [isOpen, ensureCatalogLoaded, initialExpandedTestId]);

  const toggleSubtest = (testId: string, subtestId: string) => {
    setSelected((prev) => {
      const current = prev[testId] || [];
      if (current.includes(subtestId)) {
        const next = current.filter((id) => id !== subtestId);
        if (next.length === 0) {
          const { [testId]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [testId]: next };
      }
      return { ...prev, [testId]: [...current, subtestId] };
    });
  };

  const totalSelected = Object.values(selected).reduce((acc: number, ids: string[]) => acc + ids.length, 0);
  const categoryTabs = useMemo(() => [{ id: 'all', label: 'Tous' }, ...catalog.map((c) => ({ id: c.id, label: c.name }))], [catalog]);
  const allTests = useMemo(() => catalog.flatMap((c) => c.tests), [catalog]);
  const testsToRender = useMemo(() => {
    if (searchTerm.trim()) return searchTests(searchTerm.trim());
    if (activeCategoryId === 'all') return allTests;
    return catalog.find((c) => c.id === activeCategoryId)?.tests || [];
  }, [searchTerm, searchTests, activeCategoryId, catalog, allTests]);
  const favoriteTests = useMemo(() => allTests.filter(t => isFavorite(t.id)), [allTests, isFavorite]);
  const recentTestObjects = useMemo(() => recentTests.map(id => allTests.find(t => t.id === id)).filter(Boolean) as typeof allTests, [recentTests, allTests]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[var(--secondary)]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-6xl h-[88vh] rounded-[34px] overflow-hidden bg-[var(--card-bg)] shadow-[0_35px_80px_rgba(0,0,0,0.28)] border border-[var(--border-color)] flex flex-col">
        <div className="px-6 py-5 border-b border-[var(--border-color)] bg-[var(--card-bg)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif font-bold text-2xl flex items-center gap-3">
                <Layers size={24} className="text-[var(--primary)]" />
                Catalogue tests
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Sélection rapide des tests et sous-tests.</p>
            </div>
            <div className="flex items-center gap-2">
              {totalSelected > 0 && (
                <span className="rounded-full bg-[var(--primary)] text-white px-3 py-1 text-xs font-bold">{totalSelected} sélectionné(s)</span>
              )}
              <button onClick={onClose} className="p-2 rounded-full bg-[var(--hover-bg)] hover:bg-[var(--border-color)] transition-colors text-[var(--text-secondary)]">
                <X size={20} />
              </button>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {searchTerm.trim() && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[var(--hover-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] text-sm font-bold hover:border-[var(--secondary)] hover:text-[var(--text-heading)] transition-colors"
              >
                <ChevronLeft size={16} />
                Catégories
              </button>
            )}
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher un test ou un sous-test..."
                className="w-full pl-12 pr-4 py-3 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-xl outline-none text-[var(--text-heading)] font-semibold focus:ring-2 focus:ring-[var(--primary-opacity-20)]"
                autoFocus
              />
            </div>
          </div>
          {!searchTerm.trim() && (
            <div className="mt-3 flex flex-wrap gap-2">
              {categoryTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveCategoryId(tab.id)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${activeCategoryId === tab.id
                      ? 'bg-[var(--secondary)] text-white shadow-sm'
                      : 'bg-[var(--progress-bg)] text-[var(--text-main)] hover:bg-[var(--border-color)]'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-[var(--app-bg)] custom-scrollbar">
          {loading && testsToRender.length === 0 && <p className="text-sm text-[var(--text-secondary)]">Chargement...</p>}
          {testsToRender.length === 0 && !loading && <p className="text-sm text-[var(--text-secondary)]">Aucun test trouvé pour ce filtre.</p>}

          {/* Favorites section */}
          {!searchTerm.trim() && favoriteTests.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                <Star size={11} className="text-amber-400 fill-amber-400" />Favoris
              </h3>
              <div className="flex flex-wrap gap-2">
                {favoriteTests.map(t => {
                  const sc = (selected[t.id] || []).length;
                  return (
                    <button key={t.id} type="button" onClick={() => setExpandedTestId(prev => prev === t.id ? null : t.id)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${sc > 0 ? 'bg-[var(--primary-opacity-5)] border-[var(--primary)]/40 text-[var(--primary)]' : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--primary)]'}`}>
                      {t.name}{sc > 0 && <span className="ml-1.5 rounded-full bg-[var(--primary)] text-white px-1.5 text-[10px]">{sc}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent tests section */}
          {!searchTerm.trim() && recentTestObjects.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Récemment utilisés</h3>
              <div className="flex flex-wrap gap-2">
                {recentTestObjects.map(t => {
                  const sc = (selected[t.id] || []).length;
                  return (
                    <button key={t.id} type="button" onClick={() => setExpandedTestId(prev => prev === t.id ? null : t.id)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${sc > 0 ? 'bg-[var(--primary-opacity-5)] border-[var(--primary)]/40 text-[var(--primary)]' : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--primary)]'}`}>
                      {t.name}{sc > 0 && <span className="ml-1.5 rounded-full bg-[var(--primary)] text-white px-1.5 text-[10px]">{sc}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            {testsToRender.map((test) => {
              const isExpanded = expandedTestId === test.id;
              const selectedCount = (selected[test.id] || []).length;
              const alreadyCount = Object.keys(existingTests[test.id] || {}).length;
              const subtestSearch = (subtestSearchByTest[test.id] || '').trim().toLowerCase();
              const filteredSubtests = subtestSearch
                ? test.subtests.filter((st) => getSubtestDisplayName(st).toLowerCase().includes(subtestSearch))
                : test.subtests;
              return (
                <div
                  key={test.id}
                  className={`rounded-2xl border overflow-hidden transition-all ${selectedCount > 0
                      ? 'border-[var(--primary)]/40 bg-[var(--primary-opacity-5)] shadow-sm'
                      : 'border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--text-secondary)]'
                    } ${isExpanded ? 'xl:col-span-2' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedTestId((prev) => (prev === test.id ? null : test.id))}
                    className="w-full px-4 py-3 text-left flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-[var(--text-heading)] truncate">{test.name}</p>
                      <p className="text-[11px] text-[var(--text-secondary)]">{test.subtests.length} sous-tests</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(test.id); }}
                        className="p-1 rounded-lg hover:bg-[var(--hover-bg)] transition-colors"
                        aria-label={isFavorite(test.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                      >
                        <Star size={14} className={isFavorite(test.id) ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-disabled)]'} />
                      </button>
                      {alreadyCount > 0 && <span className="rounded-full bg-[var(--progress-bg)] text-[var(--text-secondary)] px-2 py-0.5 text-[10px] font-bold">{alreadyCount} déjà</span>}
                      {selectedCount > 0 && <span className="rounded-full bg-[var(--primary)] text-white px-2 py-0.5 text-[10px] font-bold">{selectedCount}</span>}
                      {isExpanded ? <ChevronDown size={16} className="text-[var(--text-secondary)]" /> : <ChevronRight size={16} className="text-[var(--text-secondary)]" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[var(--border-color)] px-3 pb-3 pt-2 grid grid-cols-1 gap-2">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
                        <input
                          value={subtestSearchByTest[test.id] || ''}
                          onChange={(e) => setSubtestSearchByTest(prev => ({ ...prev, [test.id]: e.target.value }))}
                          placeholder="Filtrer les sous-tests..."
                          className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--input-bg)] border border-[var(--border-color)] rounded-xl outline-none focus:ring-1 focus:ring-[var(--primary-opacity-20)] text-[var(--text-main)] placeholder:text-[var(--text-disabled)]"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                        {(() => {
                          const sortedSTs = [...filteredSubtests].sort(compareSubtestsForDisplay);
                          const selItems: Array<{ type: 'header'; gkey: string; label: string } | { type: 'sub'; st: SubtestDef }> = [];
                          let lastSelGKey = '';
                          for (const st of sortedSTs) {
                            const gKey = getDisplayGroupKey(st);
                            if (gKey && gKey !== lastSelGKey && !subtestSearch) {
                              selItems.push({ type: 'header', gkey: gKey, label: getDisplayGroupLabel(st) || gKey });
                              lastSelGKey = gKey;
                            }
                            selItems.push({ type: 'sub', st });
                          }
                          return selItems.map((item) => {
                            if (item.type === 'header') {
                              return (
                                <div key={`grp-${item.gkey}`} className="col-span-full mt-2 first:mt-0 flex items-center gap-2 px-1">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--primary)]">{item.label}</span>
                                  <div className="flex-1 h-px bg-[var(--border-color)]" />
                                </div>
                              );
                            }
                            const { st } = item;
                            const already = existingTests[test.id]?.[st.id] !== undefined;
                            const checked = already || (selected[test.id] || []).includes(st.id);
                            return (
                              <label
                                key={st.id}
                                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${already
                                    ? 'bg-[var(--hover-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                    : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-main)] hover:border-[var(--primary)]'
                                  }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={already}
                                  onChange={() => toggleSubtest(test.id, st.id)}
                                  className="accent-[var(--primary)]"
                                />
                                <span className="truncate">{getSubtestDisplayName(st)}</span>
                                {already && <span className="ml-auto text-[10px] uppercase font-bold">ajouté</span>}
                              </label>
                            );
                          });
                        })()}
                      </div>
                      {filteredSubtests.length === 0 && (
                        <p className="text-xs text-[var(--text-secondary)] px-1 py-2">Aucun sous-test ne correspond à la recherche.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border-color)] bg-[var(--card-bg)] flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-secondary)] font-semibold">{totalSelected} épreuve(s) sélectionnée(s)</span>
            <button
              type="button"
              onClick={() => setShowCustomEditor(true)}
              className="flex items-center gap-1.5 text-xs font-bold text-[var(--primary)] hover:underline"
            >
              <Plus size={13} /> Créer un test
            </button>
            <button
              type="button"
              onClick={() => { const customId = `custom_${Date.now()}`; onAddTests({ custom_observations: [customId] }); onClose(); }}
              className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--primary)] hover:underline transition-colors"
            >
              <MessageSquare size={13} /> Observation libre
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 font-bold text-[var(--text-secondary)]">Annuler</button>
            <button
              onClick={() => {
                onAddTests(selected);
                setSelected({});
                onClose();
              }}
              disabled={totalSelected === 0}
              className="px-5 py-2 rounded-xl bg-[var(--secondary)] text-white font-bold disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
        </div>
      </div>
      {showCustomEditor && (
        <CustomTestEditorLazy onClose={() => setShowCustomEditor(false)} onCreated={() => ensureCatalogLoaded()} />
      )}
    </div>
  );
};

const SortableTestWrapper: React.FC<{
  id: string;
  children: (dragListeners: DragListeners) => React.ReactNode;
}> = ({ id, children }) => {
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


export const ScorePage: React.FC<Props> = ({ patient, tests, updateTests, observations, updateObservations, onNext, onBack }) => {
  const { catalog, ensureCatalogLoaded } = useCatalog();
  const { pushRecent } = useFavoriteTests();
  const toast = useToast();
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogTargetTestId, setCatalogTargetTestId] = useState<string | null>(null);
  const [collapsedTests, setCollapsedTests] = useState<Record<string, boolean>>({});
  const [subtestFilters, setSubtestFilters] = useState<Record<string, string>>({});
  const [expandedSubKey, setExpandedSubKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<Record<string, 'accordion' | 'table'>>({});
  const [testOrder, setTestOrder] = useState<string[]>(() => Object.keys(tests));
  const [preferredMetricByTest, setPreferredMetricByTest] = useState<Record<string, Metric>>({});
  const prevExpandedTestIdRef = useRef<string | null>(null);

  // Keep testOrder in sync when tests keys change externally (e.g. initial load)
  useEffect(() => {
    setTestOrder((prev) => {
      const currentKeys = Object.keys(tests);
      // Remove IDs that no longer exist
      const filtered = prev.filter((id) => currentKeys.includes(id));
      // Append new IDs that aren't tracked yet
      const missing = currentKeys.filter((id) => !filtered.includes(id));
      if (missing.length === 0 && filtered.length === prev.length) return prev;
      return [...filtered, ...missing];
    });
  }, [tests]);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Subtest-level reorder: ids are namespaced as `sub:${testId}:${subId}` so they
    // never collide with test-level ids (plain testId strings).
    if (activeId.startsWith('sub:') && overId.startsWith('sub:')) {
      const [, activeTestId, activeSubId] = activeId.split(':');
      const [, overTestId, overSubId] = overId.split(':');
      if (activeTestId !== overTestId) return; // only allow reordering within the same test
      const subIds = Object.keys(tests[activeTestId] || {});
      const oldIndex = subIds.indexOf(activeSubId);
      const newIndex = subIds.indexOf(overSubId);
      if (oldIndex === -1 || newIndex === -1) return;
      const reorderedIds = arrayMove(subIds, oldIndex, newIndex);
      // Persist the new order as the insertion order of `tests[testId]`'s keys — this
      // is read back (unsorted) by ScoresAndObservationsPanel and the PDF/report export.
      const reorderedSubMap: Record<string, ScoreResult> = {};
      reorderedIds.forEach((subId) => { reorderedSubMap[subId] = tests[activeTestId][subId]; });
      updateTests({ ...tests, [activeTestId]: reorderedSubMap });
      return;
    }

    // Test-level reorder — also persist the new order into `tests` itself (not just
    // local UI state) so downstream consumers reading `Object.entries(tests)` see it.
    setTestOrder((prev) => {
      const oldIndex = prev.indexOf(activeId);
      const newIndex = prev.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const reorderedOrder = arrayMove(prev, oldIndex, newIndex);
      const reorderedTests: TestData = {};
      reorderedOrder.forEach((id) => { reorderedTests[id] = tests[id]; });
      updateTests(reorderedTests);
      return reorderedOrder;
    });
  }, [tests, updateTests]);

  // Auto-collapse the previously active test when the user opens a subtest in a different test
  useEffect(() => {
    if (!expandedSubKey) {
      prevExpandedTestIdRef.current = null;
      return;
    }
    const currentTestId = expandedSubKey.split('__')[0];
    const prevTestId = prevExpandedTestIdRef.current;
    if (prevTestId && prevTestId !== currentTestId) {
      setCollapsedTests((prev) => ({ ...prev, [prevTestId]: true }));
    }
    prevExpandedTestIdRef.current = currentTestId;
  }, [expandedSubKey]);

  useEffect(() => {
    ensureCatalogLoaded();
  }, [ensureCatalogLoaded]);

  const addTests = useCallback((selection: Record<string, string[]>) => {
    const next = { ...tests };
    const newTestIds: string[] = [];
    Object.entries(selection).forEach(([testId, subtestIds]) => {
      if (!next[testId]) {
        next[testId] = {};
        newTestIds.push(testId);
      }
      subtestIds.forEach((id) => {
        if (!next[testId][id]) next[testId][id] = emptyScore();
      });
    });
    if (newTestIds.length > 0) {
      setTestOrder((prev) => [...prev, ...newTestIds.filter((id) => !prev.includes(id))]);
      setViewMode((prev) => {
        const patch: Record<string, 'accordion' | 'table'> = {};
        newTestIds.forEach((id) => { if (!prev[id]) patch[id] = 'table'; });
        return { ...prev, ...patch };
      });
      pushRecent(newTestIds);
    }
    updateTests(next);
  }, [tests, updateTests, pushRecent]);

  const removeTest = useCallback((testId: string) => {
    const next = { ...tests };
    delete next[testId];
    setTestOrder((prev) => prev.filter((id) => id !== testId));
    updateTests(next);
  }, [tests, updateTests]);

  const removeSubtest = useCallback((testId: string, subId: string) => {
    const next = { ...tests };
    if (!next[testId]) return;
    delete next[testId][subId];
    updateTests(next);
  }, [tests, updateTests]);

  const updateSubtest = useCallback((testId: string, subId: string, patch: Partial<ScoreResult>) => {
    const next = { ...tests };
    if (!next[testId]) next[testId] = {};
    const current = next[testId][subId] || emptyScore();
    next[testId][subId] = { ...current, ...patch };
    updateTests(next);
  }, [tests, updateTests]);

  const stat = useMemo(() => {
    let total = 0;
    let filled = 0;
    Object.values(tests).forEach((subtests) => {
      Object.values(subtests).forEach((res) => {
        total += 1;
        if (hasValue(res)) filled += 1;
      });
    });
    return { total, filled };
  }, [tests]);
  const completion = stat.total > 0 ? Math.round((stat.filled / stat.total) * 100) : 0;

  const grouped = useMemo(() => {
    const groups: Record<string, TestDef[]> = {};
    Object.keys(tests).forEach((testId) => {
      const cat = catalog.find((c) => c.tests.some((t) => t.id === testId));
      if (!cat) {
        if (!groups.autre) groups.autre = [];
        const fallbackSubtests: SubtestDef[] = Object.keys(tests[testId] || {}).map((subId) => ({
          id: subId,
          name: subId.startsWith('custom_') ? 'Observation personnalisée' : subId,
          unit: 'pts',
          scoreType: 'none' as ScoreType,
          inputModel: (subId.startsWith('custom_') ? 'custom_text' : 'numeric_4mode') as SubtestInputModel,
        }));
        groups.autre.push({ id: testId, name: testId === 'custom_observations' ? 'Observations personnalisées' : testId, subtests: fallbackSubtests });
        return;
      }
      if (!groups[cat.id]) groups[cat.id] = [];
      const def = cat.tests.find((t) => t.id === testId);
      if (def) groups[cat.id].push(def);
    });
    return groups;
  }, [tests, catalog]);

  const testDefMap = useMemo(() => {
    type CatDef = (typeof catalog)[number];
    const map: Record<string, { cat: CatDef | undefined; def: TestDef }> = {};
    (Object.entries(grouped) as [string, TestDef[]][]).forEach(([catId, defs]) => {
      const cat = catalog.find((c) => c.id === catId);
      defs.forEach((def) => { map[def.id] = { cat, def }; });
    });
    return map;
  }, [grouped, catalog]);

  const orderedSubKeys = useMemo(() => {
    const keys: string[] = [];
    testOrder.forEach((testId) => {
      const entry = testDefMap[testId];
      if (!entry) return;
      const { def: test } = entry;
      const subtestDefById = new Map(test.subtests.map((st) => [st.id, st] as const));
      // Natural insertion order of `tests[testId]` reflects the drag-and-drop order
      // defined by the user on this page (persisted directly on the ScoreResult map).
      Object.keys(tests[testId] || {}).forEach((subId) => {
        if (subtestDefById.has(subId)) keys.push(`${testId}__${subId}`);
      });
    });
    return keys;
  }, [testOrder, testDefMap, tests]);

  const handleAdvance = useCallback(() => {
    if (!expandedSubKey) return;
    const idx = orderedSubKeys.indexOf(expandedSubKey);
    if (idx >= 0 && idx < orderedSubKeys.length - 1) {
      setExpandedSubKey(orderedSubKeys[idx + 1]);
    } else {
      setExpandedSubKey(null);
    }
  }, [expandedSubKey, orderedSubKeys]);

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-10">
      <div className="mb-8 border-b border-[var(--border-color)] pb-6 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)] flex items-center gap-3">
            <Activity size={24} className="text-[var(--primary)]" />
            Tests & mesures
          </h2>
          <p className="text-[var(--text-secondary)] font-medium mt-2">
            Saisissez et validez les mesures avant la synthèse clinique.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${stat.filled === stat.total ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
            {stat.filled}/{stat.total} saisis
          </div>
          <button
            onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }}
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
          {Object.keys(tests).length === 0 && (
            <div className="rounded-[30px] border-2 border-dashed border-[var(--border-color)] bg-[var(--card-bg)] p-16 text-center shadow-sm">
              <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-[var(--primary-opacity-10)] text-[var(--primary)] flex items-center justify-center">
                <Layers size={24} />
              </div>
              <p className="text-[var(--text-heading)] font-bold text-lg">Aucun test sélectionné</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Ajoutez des tests depuis le catalogue pour démarrer la saisie guidée.</p>
              <button
                type="button"
                onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }}
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
                const entry = testDefMap[testId];
                if (!entry) return null;
                const { cat, def: test } = entry;
                const CatIcon = ICON_MAP[cat?.iconKey || 'Box'];
                const collapsed = collapsedTests[test.id];
                const selectedIds = Object.keys(tests[test.id] || {});
                // Preserve the persisted (drag-and-drop) order: subtests follow the
                // insertion order of `tests[testId]`'s keys rather than the catalog's
                // static order, so a manual reorder here propagates everywhere else
                // (Step3Diagnostic panel, PDF/report export) without extra plumbing.
                const subtestDefById = new Map(test.subtests.map((st) => [st.id, st] as const));
                const visibleSubtests = selectedIds
                  .map((id) => subtestDefById.get(id))
                  .filter((st): st is SubtestDef => Boolean(st));
                const subtestQuery = (subtestFilters[test.id] || '').trim().toLowerCase();
                const filteredSubtests = subtestQuery
                  ? visibleSubtests.filter((st) => getSubtestDisplayName(st).toLowerCase().includes(subtestQuery))
                  : visibleSubtests;
                const testFilledCount = visibleSubtests.filter((st) => hasValue(tests[test.id]?.[st.id])).length;
                return (
                  <SortableTestWrapper key={testId} id={testId}>
                    {(dragListeners) => (
                    <div className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                      <div className="px-5 py-4 border-b border-[var(--border-color)] bg-[var(--hover-bg)]">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <button {...dragListeners} className="cursor-grab active:cursor-grabbing touch-none text-[var(--text-secondary)] rounded-xl p-1.5 hover:bg-[var(--card-bg)] hover:shadow-sm transition-all" title="Réordonner" aria-label="Réordonner">
                              <GripVertical size={16} />
                            </button>
                            <button onClick={() => setCollapsedTests((p) => ({ ...p, [test.id]: !p[test.id] }))} className="text-[var(--text-secondary)] rounded-xl p-1.5 hover:bg-[var(--card-bg)] hover:shadow-sm transition-all">
                              {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            </button>
                            <div className="min-w-0">
                              {cat && (
                                <div className="flex items-center gap-1 mb-0.5">
                                  <CatIcon size={10} className="text-[var(--text-secondary)]" />
                                  <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-widest">{cat.name}</span>
                                </div>
                              )}
                              <h4 className="font-bold text-[var(--text-heading)] truncate">{test.name}</h4>
                              <p className="text-[11px] text-[var(--text-secondary)]">{visibleSubtests.length} épreuve(s) · {testFilledCount} saisie(s)</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => removeTest(test.id)} className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-rose-500 hover:border-rose-200">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {!collapsed && (
                        <div>
                
                          {visibleSubtests.length === 0 && <div className="p-6 text-center text-sm text-[var(--text-secondary)]">Aucune épreuve sélectionnée.</div>}

                          <div className="p-3">
                            <TableView
                              testId={test.id}
                              subtests={filteredSubtests}
                              tests={tests}
                              updateSubtest={updateSubtest}
                            />
                          </div>

                        </div>
                      )}
                    </div>
                    )}
                  </SortableTestWrapper>
                );
              })}
            </SortableContext>
          </DndContext>
        </div>

        {Object.keys(tests).length > 0 && <div className="hidden lg:block w-72 shrink-0"><SummaryPanel tests={tests} /></div>}
      </div>

      <StepNavFooter onBack={onBack}>
          <button
            onClick={() => onNext()}
            className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all bg-[var(--secondary)] hover:bg-[var(--primary)]"
          >
            <span>Passer au diagnostic</span>
            <ArrowRight size={20} />
          </button>
      </StepNavFooter>

      <TestCatalogModal isOpen={showCatalog} onClose={() => setShowCatalog(false)} existingTests={tests} onAddTests={addTests} initialExpandedTestId={catalogTargetTestId} />
    </div>
  );
};

