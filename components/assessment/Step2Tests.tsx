import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Observations, Patient, ScoreResult, TestData, UserProfile } from '../../types';
import { ICON_MAP, type ScoreType, type SubtestDef, type TestDef } from '../../data/testCatalog';
import { ScoringEngine } from '../../services/scoringEngine';
import { calculateFromPercentile, calculateFromStandard, calculateFromZ } from '../../utils/scoring';
import { getNormStatusMessage, resolveEffectiveDirection, type EffectiveDirection, type NormsStatusCode } from '../../utils/scoreDirection';
import { useCatalog } from '../../contexts/CatalogContext';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { supabase } from '../../services/db';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleCheck,
  FilePlus,
  Layers,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  PenTool,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from 'lucide-react';

interface Props {
  patient: Patient;
  tests: TestData;
  updateTests: (data: TestData) => void;
  observations: Observations;
  updateObservations: (data: Partial<Observations>) => void;
  onNext: () => void;
  onBack: () => void;
  userProfile?: UserProfile;
  onContribute?: () => void;
}

type Metric = 'raw' | 'standard' | 'z' | 'percentile';
type ConversionMode = 'auto' | 'manual';

type NormsStatus = {
  hasNorms: boolean;
  hasApplicableNorms: boolean;
  statusCode: NormsStatusCode;
};

const parseNum = (value: string): number | null => {
  const n = parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const isManualOnlyScoreType = (scoreType?: ScoreType | string): boolean => (
  String(scoreType || '').toLowerCase() === 'none'
);

const isStandardizedMetric = (metric: Metric): metric is 'standard' | 'z' | 'percentile' => (
  metric === 'standard' || metric === 'z' || metric === 'percentile'
);

const resolveConversionMode = (result: Partial<ScoreResult>, scoreType?: ScoreType): ConversionMode => (
  isManualOnlyScoreType(scoreType) ? 'manual' : (result.conversionMode === 'manual' ? 'manual' : 'auto')
);

const hasStandardizedValue = (
  result: Partial<ScoreResult>,
  metric: 'standard' | 'z' | 'percentile',
): boolean => {
  if (metric === 'z') {
    return typeof result.zScore === 'number' && Number.isFinite(result.zScore);
  }
  const raw = metric === 'standard' ? result.standard : result.percentile;
  return parseNum(String(raw || '').trim()) !== null;
};

const shouldSwitchToManualMode = (
  result: ScoreResult,
  nextMetric: Metric,
  scoreType?: ScoreType,
): boolean => {
  if (resolveConversionMode(result, scoreType) === 'manual') return false;
  if (!isStandardizedMetric(nextMetric)) return false;
  const previousMetric = result.entryMetric;
  if (previousMetric === 'standard' || previousMetric === 'z' || previousMetric === 'percentile') {
    return previousMetric !== nextMetric;
  }

  // Legacy rows or asynchronous updates may miss entryMetric.
  // If another standardized metric already has a value, switch to manual
  // to prevent destructive cross-reconversion when user overrides fields.
  if (nextMetric !== 'standard' && hasStandardizedValue(result, 'standard')) return true;
  if (nextMetric !== 'z' && hasStandardizedValue(result, 'z')) return true;
  if (nextMetric !== 'percentile' && hasStandardizedValue(result, 'percentile')) return true;
  return false;
};

const SCALE_LABELS: Record<string, string> = {
  scaled: 'NS (m=10, \u03c3=3)',
  standard: 'QI (m=100, \u03c3=15)',
  't-score': 'T (m=50, \u03c3=10)',
  sten: 'Sten (m=5.5, \u03c3=2)',
  stanine: 'Stanine (m=5, \u03c3=2)',
};

const getScaleLabel = (scoreType?: ScoreType): string | null => {
  if (!scoreType) return null;
  return SCALE_LABELS[scoreType] || null;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getDirectionBadgeLabel = (direction: EffectiveDirection): string => (
  direction === 'lower_better' ? 'Brut croissant -> score decroissant' : 'Brut croissant -> score croissant'
);

const getDirectionBadgeTooltip = (direction: EffectiveDirection, interactive: boolean): string => {
  const base = direction === 'lower_better'
    ? 'Sens brut: plus le brut augmente, plus le score baisse.'
    : 'Sens brut: plus le brut augmente, plus le score augmente.';
  return interactive ? `${base} Cliquer pour inverser ce sens.` : base;
};

const DirectionBadge: React.FC<{
  direction: EffectiveDirection;
  pending?: boolean;
  interactive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}> = ({
  direction,
  pending = false,
  interactive = false,
  disabled = false,
  onClick,
}) => {
    const isLower = direction === 'lower_better';
    const Icon = isLower ? ArrowDown : ArrowUp;
    const toneClass = isLower
      ? 'text-rose-500 bg-rose-500/10 border-rose-500/30'
      : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
    const title = getDirectionBadgeTooltip(direction, interactive);
    const commonClass = `inline-flex items-center justify-center rounded-full border transition-colors ${toneClass} ${pending ? 'ring-1 ring-[#E07A5F]/50' : ''}`;

    if (interactive) {
      return (
        <button
          type="button"
          disabled={disabled || !onClick}
          onClick={onClick}
          title={title}
          aria-label={getDirectionBadgeLabel(direction)}
          className={`${commonClass} h-6 w-6 hover:brightness-110 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <Icon size={13} strokeWidth={2.8} />
        </button>
      );
    }

    return (
      <span
        title={title}
        aria-label={getDirectionBadgeLabel(direction)}
        className={`${commonClass} h-5 w-5`}
      >
        <Icon size={12} strokeWidth={2.8} />
      </span>
    );
  };

const humanizeComputeWarning = (warning: string): string => {
  if (warning === 'direction_auto_applied') return 'Sens brut auto appliqué.';
  if (warning === 'direction_override_clone_applied') return 'Sens brut personnalisé organisation appliqué.';
  if (warning === 'score_type_unset') return 'Type de score non défini (calcul auto désactivé).';
  return warning;
};

/** Infer the preferred display metric (NS or ET) for a given subtest */
const getPreferredMetric = (subtest: SubtestDef): 'standard' | 'z' => {
  const dm = subtest.inputConfig?.defaultMetric;
  if (dm === 'standard' || dm === 'z') return dm;
  // Infer from scoreType: most clinical scales prefer NS
  const st = subtest.scoreType || 'standard';
  if (st === 'scaled' || st === 'standard' || st === 't-score' || st === 'sten' || st === 'stanine' || st === 'none') return 'standard';
  return 'z';
};

const getSubtestDisplayName = (subtest: Pick<SubtestDef, 'name' | 'displayName'>): string => (
  subtest.displayName || subtest.name
);

const METRIC_LABEL: Record<string, string> = { raw: 'BRUT', standard: 'NS', z: 'ET', percentile: '%' };

const getMetricDisplayLabel = (metric: Metric, scoreType?: ScoreType | string): string => {
  if (metric === 'standard') {
    return scoreType === 'percentile' ? 'PERCENTILE' : 'NS';
  }
  return METRIC_LABEL[metric] || metric.toUpperCase();
};

const scoreToneFromZ = (z: number | null): 'good' | 'warn' | 'bad' | 'neutral' => {
  if (z === null || !Number.isFinite(z)) return 'neutral';
  if (z <= -2) return 'bad';
  if (z < -1) return 'warn';
  return 'good';
};

const ageMonths = (dob?: string): number => {
  if (!dob) return 96;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return 96;
  const now = new Date();
  return Math.max(1, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
};

const hasValue = (r?: Partial<ScoreResult>): boolean => {
  if (!r) return false;
  return Boolean(
    (r.raw && r.raw.trim()) ||
    (r.standard && r.standard.trim()) ||
    (r.percentile && r.percentile.trim()) ||
    (typeof r.zScore === 'number' && Number.isFinite(r.zScore)) ||
    (r.qualitativeCode && r.qualitativeCode.trim()) ||
    (r.qualitativeLabel && r.qualitativeLabel.trim()) ||
    (r.observation && r.observation.trim()),
  );
};

const reviewed = (r?: Partial<ScoreResult>): boolean => {
  if (!r) return false;
  return r.reviewState === 'reviewed' || r.status === 'validated' || r.status === 'certified';
};

const emptyScore = (): ScoreResult => ({
  raw: '',
  standard: '',
  percentile: '',
  status: 'empty',
  entryMetric: 'raw',
  conversionMode: 'auto',
  reviewState: 'not_reviewed',
});

const mergePatch = (current: ScoreResult, patch: Partial<ScoreResult>): Partial<ScoreResult> => {
  const merged = { ...emptyScore(), ...current, ...patch };
  if (!hasValue(merged)) {
    return { ...patch, status: 'empty', reviewState: 'not_reviewed', reviewedAt: undefined };
  }
  const scoreTouched = ['raw', 'standard', 'percentile', 'zScore', 'qualitativeCode', 'qualitativeLabel', 'derived', 'entryMetric'].some((k) => k in patch);
  if (scoreTouched) {
    return { ...patch, status: patch.status || 'estimated', reviewState: 'not_reviewed', reviewedAt: undefined };
  }
  return { ...patch, status: current.status === 'empty' ? 'draft' : current.status };
};

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
        value={value}
        onChange={(e) => !readOnly && onChange(e.target.value)}
        onFocus={onFocus}
        placeholder="Observation clinique rapide..."
        className="w-full p-3 pl-9 pr-10 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-main)] focus:border-[#E07A5F] focus:bg-[var(--card-bg)] outline-none resize-none transition-all placeholder:text-[var(--text-disabled)]"
        rows={2}
      />
      <MessageSquare size={14} className="absolute top-3 left-3 text-[var(--text-disabled)]" />
      {isSupported && !readOnly && (
        <button
          type="button"
          onClick={toggleListening}
          className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg transition-all ${isListening ? 'bg-red-100 text-red-500 animate-pulse' : 'text-[var(--text-disabled)] hover:text-[#E07A5F] hover:bg-[var(--hover-bg)]'
            }`}
        >
          {isListening ? <MicOff size={12} /> : <Mic size={12} />}
        </button>
      )}
      {isListening && interimText && <div className="mt-1 px-2 py-1 bg-red-50 border border-red-100 rounded text-[10px] text-red-500 italic">Dictée : {interimText}…</div>}
    </div>
  );
};

const ReviewButton: React.FC<{ result: ScoreResult; onChange: (patch: Partial<ScoreResult>) => void }> = ({ result, onChange }) => {
  const isReviewed = reviewed(result);
  const canReview = hasValue(result);
  const reviewedAtText = result.reviewedAt
    ? new Date(result.reviewedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <button
      type="button"
      disabled={!canReview}
      onClick={() => {
        if (isReviewed) {
          onChange({ reviewState: 'not_reviewed', reviewedAt: undefined, status: hasValue(result) ? 'estimated' : 'empty' });
          return;
        }
        onChange({ reviewState: 'reviewed', reviewedAt: new Date().toISOString(), status: hasValue(result) ? 'validated' : 'empty', certifiedAt: undefined });
      }}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all ${isReviewed
          ? 'bg-emerald-50 text-emerald-600'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--hover-bg)]'
        } ${!canReview ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {isReviewed ? <CircleCheck size={12} /> : <Circle size={12} />}
      {isReviewed ? 'Revu' : 'Valider'}
    </button>
  );
};

const GaussBand: React.FC<{ z: number | null }> = ({ z }) => {
  if (z === null || !Number.isFinite(z)) {
    return (
      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-1.5 rounded-full bg-[var(--progress-bg)]" />
      </div>
    );
  }

  const clamped = clamp(z, -3.5, 3.5);
  const left = ((clamped + 3.5) / 7) * 100;

  return (
    <div className="flex items-center gap-3 py-1">
      <div
        className="flex-1 relative h-1.5 rounded-full"
        style={{
          background:
            'linear-gradient(to right, #f87171 0%, #f87171 21.4%, #fbbf24 21.4%, #fbbf24 35.7%, #34d399 35.7%, #34d399 100%)',
        }}
      >
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-[#3D405B] shadow-sm"
          style={{ left: `${left}%` }}
        />
      </div>
      <span className="text-[11px] font-bold text-[var(--text-secondary)] tabular-nums shrink-0">
        ET {z > 0 ? '+' : ''}{z.toFixed(2)}
      </span>
    </div>
  );
};

const NumericRow: React.FC<{
  testId: string;
  patient: Patient;
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  hasNorms?: boolean;
  normsStatusCode?: NormsStatusCode;
  effectiveDirection: EffectiveDirection;
  baseDirection: EffectiveDirection;
  onToggleDirection?: () => void;
  hasPendingDirectionOverride?: boolean;
}> = ({
  testId,
  patient,
  subtest,
  result,
  onChange,
  readOnly,
  onFocus,
  hasNorms,
  normsStatusCode,
  effectiveDirection,
  baseDirection,
  onToggleDirection,
  hasPendingDirectionOverride,
}) => {
    const [isComputing, setIsComputing] = useState(false);
    const [warn, setWarn] = useState<string | null>(null);
    const [localZText, setLocalZText] = useState<string | null>(null);
    const preferred = getPreferredMetric(subtest);
    const scoreType = subtest.scoreType || 'standard';
    const conversionMode = resolveConversionMode(result, subtest.scoreType);
    const conversionLocked = isManualOnlyScoreType(subtest.scoreType);
    const canAutoConvert = conversionMode === 'auto' && !conversionLocked;
    const hasAutoNorms = Boolean(hasNorms) && canAutoConvert;
    // The "active entry" metric — which field is the source of truth
    const entryMetric = result.entryMetric || (hasAutoNorms ? 'raw' : preferred);

    const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));

    const computeRaw = async (raw: string, value: number) => {
      if (!canAutoConvert) {
        setWarn(conversionLocked
          ? 'Type de score non défini: calcul et conversion auto désactivés.'
          : 'Mode manuel actif: calcul et conversion auto désactivés.');
        setPatch({ raw, derived: { source: 'manual' } });
        return;
      }
      if ((subtest.computationMode || 'LOOKUP') === 'NONE') {
        setWarn('Pas de calcul automatique pour cette épreuve.');
        setPatch({ raw, derived: { source: 'manual' } });
        return;
      }
      if (!hasAutoNorms) {
        const statusWarn = getNormStatusMessage(normsStatusCode) || 'Normes introuvables - poursuivez en saisie manuelle.';
        setWarn(statusWarn);
        setPatch({ raw, derived: { source: 'manual' } });
        return;
      }

      setIsComputing(true);
      try {
        const dbSubtestId = subtest.id.includes('_') ? subtest.id : `${testId}_${subtest.id}`;
        const out = await ScoringEngine.compute(dbSubtestId, value, ageMonths(patient.dob), patient.gender === 'F' ? 'F' : 'M', patient.classLevel);
        if (!out || !out.normFound) {
          const statusWarn = getNormStatusMessage(normsStatusCode) || 'Normes introuvables - poursuivez en saisie manuelle.';
          setWarn(statusWarn);
          setPatch({ raw, derived: { source: 'manual' } });
          return;
        }

        let zToUse = typeof out.zScore === 'number' ? out.zScore : null;
        let standardToUse = out.standard ?? '';
        let percentileToUse = out.percentile ?? '';

        if (out.method === 'PARAMETRIC' && zToUse !== null && effectiveDirection !== baseDirection) {
          zToUse = -zToUse;
          const recalculated = calculateFromZ(zToUse, scoreType);
          standardToUse = recalculated.standard ?? '';
          percentileToUse = recalculated.percentile ?? '';
        }

        const warningList = out.warnings.map(humanizeComputeWarning);
        if (effectiveDirection !== baseDirection) {
          warningList.push('Sens brut inversé localement (en attente de sauvegarde).');
        }
        setWarn(warningList.length > 0 ? warningList.join(' | ') : null);

        setPatch({
          raw,
          standard: standardToUse,
          percentile: percentileToUse,
          zScore: zToUse ?? undefined,
          derived: {
            standard: standardToUse || undefined,
            percentile: percentileToUse || undefined,
            zScore: zToUse ?? undefined,
            source: 'auto',
          },
          scoreSource: 'auto',
          conversionMode: 'auto',
        });
      } catch (e) {
        setWarn('Erreur lors du calcul automatique.');
        setPatch({ raw, derived: { source: 'manual' } });
        Logger.error('SYSTEM', 'Auto scoring failed', e);
      } finally {
        setIsComputing(false);
      }
    };

    const onMetricInput = async (metric: Metric, text: string) => {
      if (readOnly) return;

      const autoSwitchToManual = shouldSwitchToManualMode(result, metric, subtest.scoreType);
      const nextManualMode = conversionLocked || conversionMode === 'manual' || autoSwitchToManual;
      const conversionPatch: Partial<ScoreResult> = nextManualMode
        ? { conversionMode: 'manual' }
        : { conversionMode: 'auto' };

      if (autoSwitchToManual) {
        setWarn('Mode manuel activé: vos champs NS/ET/% ne seront plus reconvertis.');
      }

      if (metric === 'z') {
        setLocalZText(text);
        const n = parseNum(text);
        if (n === null) {
          if (text === '' || text === '-' || text === '.' || text === '-.' || /^-?\d*\.?$/.test(text)) return;
          setPatch({ entryMetric: 'z', zScore: undefined, derived: { source: 'manual' }, scoreSource: 'manual_et', ...conversionPatch });
          return;
        }
        if (!nextManualMode) {
          const c = calculateFromZ(n, scoreType);
          setWarn(null);
          setPatch({ entryMetric: 'z', zScore: n, standard: c.standard, percentile: c.percentile, derived: { standard: c.standard, percentile: c.percentile, zScore: n, source: 'assisted' }, scoreSource: 'manual_et', ...conversionPatch });
          return;
        }
        setPatch({ entryMetric: 'z', zScore: n, derived: { source: 'manual' }, scoreSource: 'manual_et', ...conversionPatch });
        return;
      }
      setLocalZText(null);
      const n = parseNum(text);
      if (metric === 'raw') {
        setPatch({ entryMetric: 'raw', raw: text, ...conversionPatch });
        if (n !== null) await computeRaw(text, n);
        return;
      }
      if (metric === 'standard') {
        if (n === null) {
          setPatch({ entryMetric: 'standard', standard: text, derived: { source: 'manual' }, scoreSource: 'manual_ns', ...conversionPatch });
          return;
        }
        if (!nextManualMode) {
          const c = calculateFromStandard(n, scoreType);
          setWarn(null);
          setPatch({ entryMetric: 'standard', standard: text, percentile: c.percentile, zScore: c.zScore, derived: { standard: text, percentile: c.percentile, zScore: c.zScore, source: 'assisted' }, scoreSource: 'manual_ns', ...conversionPatch });
          return;
        }
        setPatch({ entryMetric: 'standard', standard: text, derived: { source: 'manual' }, scoreSource: 'manual_ns', ...conversionPatch });
        return;
      }
      if (metric === 'percentile') {
        if (n === null) {
          setPatch({ entryMetric: 'percentile', percentile: text, derived: { source: 'manual' }, scoreSource: 'manual_pct', ...conversionPatch });
          return;
        }
        if (!nextManualMode) {
          const c = calculateFromPercentile(n, scoreType);
          setWarn(null);
          setPatch({
            entryMetric: 'percentile',
            percentile: text,
            standard: c.standard,
            zScore: c.zScore,
            derived: { standard: c.standard, percentile: text, zScore: c.zScore, source: 'assisted' },
            scoreSource: 'manual_pct',
            ...conversionPatch,
          });
          return;
        }
        setPatch({ entryMetric: 'percentile', percentile: text, derived: { source: 'manual' }, scoreSource: 'manual_pct', ...conversionPatch });
        return;
      }
    };

    const hasZ = typeof result.zScore === 'number' && Number.isFinite(result.zScore);

    const metricValue = (metric: Metric): string => {
      if (metric === 'raw') return result.raw || '';
      if (metric === 'standard') return result.standard || '';
      if (metric === 'z') {
        if (localZText !== null && entryMetric === 'z') return localZText;
        return hasZ ? String(result.zScore) : '';
      }
      return result.percentile || '';
    };

    let visualZ: number | null = hasZ ? result.zScore! : null;
    if (visualZ === null && !conversionLocked && result.standard) {
      const s = parseNum(result.standard);
      if (s !== null) visualZ = calculateFromStandard(s, scoreType).zScore;
    }
    if (visualZ === null && !conversionLocked && result.percentile) {
      const p = parseNum(result.percentile);
      if (p !== null) visualZ = calculateFromPercentile(p, scoreType).zScore;
    }

    // Decide which fields are editable inputs vs display-only
    // Regime A (norms): Brut = primary input, NS + ET editable, % = display-only
    // Regime B (no norms): NS + ET editable (preferred highlighted), % = display-only

    const isSource = (m: Metric) => m === entryMetric;

    const inputStyles = (m: Metric, primary?: boolean) => {
      const base = 'w-full text-center font-bold bg-transparent outline-none transition-all placeholder:text-[var(--text-disabled)]';
      const sizeClass = primary ? 'text-2xl py-2' : 'text-lg py-1.5';
      const borderClass = isSource(m)
        ? 'border-b-2 border-[#E07A5F]'
        : 'border-b border-[var(--border-color)] focus:border-[#E07A5F]';
      const colorClass = isSource(m) ? 'text-[var(--text-heading)]' : 'text-[var(--text-main)]';
      return `${base} ${sizeClass} ${borderClass} ${colorClass} ${readOnly ? 'cursor-not-allowed opacity-70' : ''}`;
    };

    const statusMessage = getNormStatusMessage(normsStatusCode);
    const percentileEditable = !canAutoConvert;
    const showDirectionControl = canAutoConvert
      && (subtest.computationMode || 'LOOKUP') === 'PARAMETRIC'
      && subtest.scoreType !== 'none';

    return (
      <div className="bg-[var(--card-bg)]">
        <div className="p-4 md:p-5">
          {/* Header: name + meta badges */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h4 className="font-semibold text-[var(--text-heading)] text-sm md:text-base">{getSubtestDisplayName(subtest)}</h4>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{subtest.unit}</span>
                {getScaleLabel(subtest.scoreType) && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-300">
                    {getScaleLabel(subtest.scoreType)}
                  </span>
                )}
                {hasAutoNorms && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                    Normes
                  </span>
                )}
                {!hasAutoNorms && statusMessage && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {normsStatusCode === 'no_norms' && '0 norme'}
                    {normsStatusCode === 'no_applicable_age_gender' && 'Normes non applicables'}
                    {normsStatusCode === 'onboarding_required' && 'Onboarding requis'}
                    {normsStatusCode === 'access_restricted' && 'Accès restreint'}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--hover-bg)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setPatch({ conversionMode: 'auto' })}
                    disabled={readOnly || conversionLocked}
                    className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${conversionMode === 'auto' ? 'bg-[#3D405B] text-white' : 'text-[var(--text-secondary)]'} ${(readOnly || conversionLocked) ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => setPatch({ conversionMode: 'manual' })}
                    disabled={readOnly}
                    className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${conversionMode === 'manual' ? 'bg-[#E07A5F] text-white' : 'text-[var(--text-secondary)]'} ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    Manuel
                  </button>
                </span>
                {showDirectionControl && (
                  <DirectionBadge
                    direction={effectiveDirection}
                    pending={hasPendingDirectionOverride}
                    interactive
                    disabled={readOnly || !onToggleDirection}
                    onClick={onToggleDirection}
                  />
                )}
              </div>
            </div>
            {isComputing && <Loader2 size={14} className="animate-spin text-[#E07A5F]" />}
          </div>

          {/* === Inline score inputs === */}
          {hasAutoNorms ? (
            /* Regime A: Norms available — Brut (primary) + NS + ET editable + % display */
            <div className="space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                {/* Brut — primary input */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    BRUT
                    {isSource('raw') && <span className="ml-1 text-[#E07A5F]">●</span>}
                  </label>
                  <input
                    value={metricValue('raw')}
                    disabled={readOnly}
                    inputMode="decimal"
                    onFocus={() => onFocus?.()}
                    onChange={(e) => void onMetricInput('raw', e.target.value)}
                    className={inputStyles('raw', true)}
                    placeholder="–"
                    aria-label={`Score brut pour ${getSubtestDisplayName(subtest)}`}
                  />
                </div>
                {/* NS — editable */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    {getMetricDisplayLabel('standard', subtest.scoreType)}
                    {isSource('standard') && <span className="ml-1 text-[#E07A5F]">●</span>}
                  </label>
                  <input
                    value={metricValue('standard')}
                    disabled={readOnly}
                    inputMode="decimal"
                    onFocus={() => onFocus?.()}
                    onChange={(e) => void onMetricInput('standard', e.target.value)}
                    className={inputStyles('standard')}
                    placeholder="–"
                    aria-label={`${getMetricDisplayLabel('standard', subtest.scoreType)} pour ${getSubtestDisplayName(subtest)}`}
                  />
                </div>
                {/* ET — editable */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    ET
                    {isSource('z') && <span className="ml-1 text-[#E07A5F]">●</span>}
                  </label>
                  <input
                    value={metricValue('z')}
                    disabled={readOnly}
                    inputMode="decimal"
                    onFocus={() => onFocus?.()}
                    onChange={(e) => void onMetricInput('z', e.target.value)}
                    onBlur={() => {
                      if (localZText !== null) {
                        const n = parseNum(localZText);
                        if (n === null) setPatch({ entryMetric: 'z', zScore: undefined, derived: { source: 'manual' }, scoreSource: 'manual_et', conversionMode: resolveConversionMode(result, subtest.scoreType) === 'manual' ? 'manual' : undefined });
                        setLocalZText(null);
                      }
                    }}
                    className={inputStyles('z')}
                    placeholder="–"
                    aria-label={`Écart-type pour ${getSubtestDisplayName(subtest)}`}
                  />
                </div>
                {/* Percentile — display only */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)] mb-1">%</label>
                  <div className="w-full text-center text-lg font-bold py-1.5 text-[var(--text-secondary)] tabular-nums border-b border-transparent">
                    {metricValue('percentile') ? `${metricValue('percentile')}` : '–'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Regime B: No auto norms — NS + ET editable (preferred highlighted) + % display/edit depending on mode */
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-3 items-end">
                {/* NS — editable */}
                <div className="col-span-1">
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                      {getMetricDisplayLabel('standard', subtest.scoreType)}
                    </label>
                    {(entryMetric === 'standard' || (!entryMetric && preferred === 'standard') || (entryMetric !== 'z' && preferred === 'standard')) && <span className="text-[#E07A5F] text-[10px]">●</span>}
                  </div>
                  <input
                    value={metricValue('standard')}
                    disabled={readOnly}
                    inputMode="decimal"
                    onFocus={() => onFocus?.()}
                    onChange={(e) => void onMetricInput('standard', e.target.value)}
                    className={inputStyles('standard', preferred === 'standard' || entryMetric === 'standard')}
                    placeholder="–"
                    aria-label={`${getMetricDisplayLabel('standard', subtest.scoreType)} pour ${getSubtestDisplayName(subtest)}`}
                  />
                </div>
                {/* ET — editable */}
                <div className="col-span-1">
                  <div className="flex items-center gap-1 mb-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">ET</label>
                    {(entryMetric === 'z' || (!entryMetric && preferred === 'z') || (entryMetric !== 'standard' && preferred === 'z')) && <span className="text-[#E07A5F] text-[10px]">●</span>}
                  </div>
                  <input
                    value={metricValue('z')}
                    disabled={readOnly}
                    inputMode="decimal"
                    onFocus={() => onFocus?.()}
                    onChange={(e) => void onMetricInput('z', e.target.value)}
                    onBlur={() => {
                      if (localZText !== null) {
                        const n = parseNum(localZText);
                        if (n === null) setPatch({ entryMetric: 'z', zScore: undefined, derived: { source: 'manual' }, scoreSource: 'manual_et', conversionMode: resolveConversionMode(result, subtest.scoreType) === 'manual' ? 'manual' : undefined });
                        setLocalZText(null);
                      }
                    }}
                    className={inputStyles('z', preferred === 'z' || entryMetric === 'z')}
                    placeholder="–"
                    aria-label={`Écart-type pour ${getSubtestDisplayName(subtest)}`}
                  />
                </div>
                {/* Percentile — editable in manual mode */}
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)] mb-1">%</label>
                  {percentileEditable ? (
                    <input
                      value={metricValue('percentile')}
                      disabled={readOnly}
                      inputMode="decimal"
                      onFocus={() => onFocus?.()}
                      onChange={(e) => void onMetricInput('percentile', e.target.value)}
                      className={inputStyles('percentile', entryMetric === 'percentile')}
                      placeholder="–"
                      aria-label={`Percentile pour ${getSubtestDisplayName(subtest)}`}
                    />
                  ) : (
                    <div className="w-full text-center text-lg font-bold py-1.5 text-[var(--text-secondary)] tabular-nums border-b border-transparent">
                      {metricValue('percentile') ? `${metricValue('percentile')}` : '–'}
                    </div>
                  )}
                </div>
              </div>
              {/* Optional raw field for manual note */}
              {result.raw && !conversionLocked && (
                <div className="max-w-[140px]">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)] mb-1">BRUT</label>
                  <input
                    value={metricValue('raw')}
                    disabled={readOnly}
                    inputMode="decimal"
                    onChange={(e) => setPatch({ raw: e.target.value })}
                    onFocus={() => onFocus?.()}
                    className="w-full text-center text-sm font-medium bg-transparent outline-none py-1 border-b border-dashed border-[var(--border-color)] focus:border-[#E07A5F] text-[var(--text-secondary)] placeholder:text-[var(--text-disabled)] transition-colors"
                    placeholder="(optionnel)"
                    aria-label={`Score brut pour ${getSubtestDisplayName(subtest)}`}
                  />
                </div>
              )}
            </div>
          )}

          {!hasAutoNorms && statusMessage && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-800 inline-flex items-center gap-1.5">
              <AlertTriangle size={12} />
              {statusMessage}
            </div>
          )}
          {conversionLocked && (
            <div className="mt-2 rounded-lg border border-[#3D405B]/20 bg-[#3D405B]/5 px-3 py-1.5 text-[11px] font-medium text-[#3D405B] inline-flex items-center gap-1.5">
              <AlertTriangle size={12} />
              score_type = none: saisie manuelle NS/ET/%, conversion auto désactivée.
            </div>
          )}
          {hasPendingDirectionOverride && (
            <div className="mt-2 rounded-lg border border-[#E07A5F]/30 bg-[#E07A5F]/10 px-3 py-1.5 text-[11px] font-medium text-[#A84C34] inline-flex items-center gap-1.5">
              <AlertTriangle size={12} />
              Sens brut local modifié. Il sera enregistré à l&apos;étape suivante.
            </div>
          )}

          {/* Gauss inline */}
          <div className="mt-2">
            <GaussBand z={visualZ} />
          </div>

          {warn && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 px-3 py-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-200 inline-flex items-center gap-1.5">
              <AlertTriangle size={12} />
              {warn}
            </div>
          )}

          <VoiceObservation value={result.observation || ''} onChange={(value) => setPatch({ observation: value })} readOnly={readOnly} onFocus={onFocus} />

          {/* Review toggle */}
          <div className="mt-2 flex items-center justify-end">
            <ReviewButton result={result} onChange={onChange} />
          </div>
        </div>
      </div>
    );
  };

const QualitativeRow: React.FC<{ subtest: SubtestDef; result: ScoreResult; onChange: (patch: Partial<ScoreResult>) => void; readOnly?: boolean; onFocus?: () => void }> = ({ subtest, result, onChange, readOnly, onFocus }) => {
  const options = [...(subtest.inputConfig?.options || [])].sort((a, b) => a.order - b.order);
  const selected = result.qualitativeCode || result.raw;

  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));

  return (
    <div className="bg-[var(--card-bg)]">
      <div className="p-4 md:p-5">
        <div className="mb-4">
          <h4 className="font-semibold text-[var(--text-heading)] text-sm md:text-base leading-tight">{getSubtestDisplayName(subtest)}</h4>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mt-1">Catégorie normative</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {options.map((o, index) => {
            const active = selected === o.code;
            return (
              <button
                key={o.code}
                type="button"
                disabled={readOnly}
                onClick={() =>
                  setPatch({
                    raw: o.code,
                    qualitativeCode: o.code,
                    qualitativeLabel: o.label,
                    standard: '',
                    percentile: '',
                    zScore: undefined,
                    derived: undefined,
                    scoreSource: 'manual_ns',
                  })
                }
                className={`text-left rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all ${active
                    ? 'border-[#3D405B] bg-[#3D405B] text-white shadow-sm'
                    : 'border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-main)] hover:border-[#E07A5F]'
                  } ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-[var(--progress-bg)] text-[var(--text-secondary)]'}`}>
                    {index + 1}
                  </span>
                  <span>{o.label}</span>
                </div>
              </button>
            );
          })}
        </div>

        <VoiceObservation value={result.observation || ''} onChange={(value) => setPatch({ observation: value })} readOnly={readOnly} onFocus={onFocus} />

        <div className="mt-2 flex items-center justify-end">
          <ReviewButton result={result} onChange={onChange} />
        </div>
      </div>
    </div>
  );
};

const RawOnlyRow: React.FC<{ subtest: SubtestDef; result: ScoreResult; onChange: (patch: Partial<ScoreResult>) => void; readOnly?: boolean; onFocus?: () => void }> = ({ subtest, result, onChange, readOnly, onFocus }) => {
  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));
  return (
    <div className="bg-[var(--card-bg)]">
      <div className="p-4 md:p-5">
        <div className="mb-4">
          <h4 className="font-semibold text-[var(--text-heading)] text-sm md:text-base leading-tight">{getSubtestDisplayName(subtest)}</h4>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mt-1">Saisie brute manuelle</p>
        </div>

        <input
          value={result.raw}
          onChange={(e) => setPatch({ raw: e.target.value })}
          onFocus={onFocus}
          disabled={readOnly}
          placeholder="Entrer la valeur brute"
          className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-3 text-center text-3xl font-bold text-[var(--text-heading)] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none transition-colors"
        />
        <VoiceObservation value={result.observation || ''} onChange={(value) => setPatch({ observation: value })} readOnly={readOnly} onFocus={onFocus} />

        <div className="mt-2 flex items-center justify-end">
          <ReviewButton result={result} onChange={onChange} />
        </div>
      </div>
    </div>
  );
};

const FlexibleSubtestRow = React.memo((props: {
  testId: string;
  patient: Patient;
  subtest: SubtestDef;
  result: ScoreResult;
  onChange: (patch: Partial<ScoreResult>) => void;
  readOnly?: boolean;
  onFocus?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  hasNorms?: boolean;
  normsStatusCode?: NormsStatusCode;
  effectiveDirection: EffectiveDirection;
  baseDirection: EffectiveDirection;
  onToggleDirection?: () => void;
  hasPendingDirectionOverride?: boolean;
}) => {
  const model = props.subtest.inputModel || 'numeric_4mode';
  if (model === 'qualitative_category') return <QualitativeRow subtest={props.subtest} result={props.result} onChange={props.onChange} readOnly={props.readOnly} onFocus={props.onFocus} />;
  if (model === 'raw_only') return <RawOnlyRow subtest={props.subtest} result={props.result} onChange={props.onChange} readOnly={props.readOnly} onFocus={props.onFocus} />;
  return (
    <NumericRow
      testId={props.testId}
      patient={props.patient}
      subtest={props.subtest}
      result={props.result}
      onChange={props.onChange}
      readOnly={props.readOnly}
      onFocus={props.onFocus}
      hasNorms={props.hasNorms}
      normsStatusCode={props.normsStatusCode}
      effectiveDirection={props.effectiveDirection}
      baseDirection={props.baseDirection}
      onToggleDirection={props.onToggleDirection}
      hasPendingDirectionOverride={props.hasPendingDirectionOverride}
    />
  );
});

const CompactSubtestRow: React.FC<{
  subtest: SubtestDef;
  result: ScoreResult;
  onClick: () => void;
}> = ({ subtest, result, onClick }) => {
  const isReviewed = reviewed(result);
  const hasData = hasValue(result);
  const hasZ = typeof result.zScore === 'number' && Number.isFinite(result.zScore);
  const tone = scoreToneFromZ(hasZ ? result.zScore! : null);

  const parts: string[] = [];
  if (result.standard) parts.push(`NS ${result.standard}`);
  if (hasZ) parts.push(`ET ${result.zScore! > 0 ? '+' : ''}${result.zScore!.toFixed(2)}`);
  if (result.percentile) parts.push(`${result.percentile}\u202F%`);
  if (result.qualitativeLabel) parts.push(result.qualitativeLabel);
  if (result.raw && parts.length === 0 && result.raw.trim()) parts.push(`Brut\u00a0: ${result.raw}`);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--hover-bg)] transition-colors group"
    >
      <ChevronRight size={14} className="text-[var(--text-disabled)] group-hover:text-[#E07A5F] transition-colors shrink-0" />
      <span className="font-medium text-sm text-[var(--text-heading)] truncate min-w-0 flex-1">{getSubtestDisplayName(subtest)}</span>
      {hasData && parts.length > 0 && (
        <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${tone === 'bad' ? 'text-rose-500' : tone === 'warn' ? 'text-amber-600' : 'text-[var(--text-secondary)]'
          }`}>
          {parts.join(' \u00b7 ')}
        </span>
      )}
      <span className={`h-2 w-2 rounded-full shrink-0 transition-colors ${isReviewed ? 'bg-emerald-400' : hasData ? 'bg-amber-300' : 'bg-[var(--border-color)]'
        }`} />
    </button>
  );
};

/* ─── Table View: spreadsheet-style quick entry ─── */
const TableView: React.FC<{
  testId: string;
  patient: Patient;
  subtests: SubtestDef[];
  tests: TestData;
  normsStatusMap: Record<string, NormsStatus>;
  directionByDbSubtestId: Record<string, EffectiveDirection>;
  updateSubtest: (testId: string, subId: string, patch: Partial<ScoreResult>) => void;
}> = ({ testId, patient, subtests, tests, normsStatusMap, directionByDbSubtestId, updateSubtest }) => {
  const [localZ, setLocalZ] = useState<Record<string, string>>({});

  const getResult = (subId: string): ScoreResult => tests[testId]?.[subId] || emptyScore();

  const handleInput = async (subId: string, metric: Metric, text: string, subtest: SubtestDef) => {
    const current = getResult(subId);
    const scoreType = subtest.scoreType || 'standard';
    const conversionMode = resolveConversionMode(current, subtest.scoreType);
    const conversionLocked = isManualOnlyScoreType(subtest.scoreType);
    const canAutoConvert = conversionMode === 'auto' && !conversionLocked;
    const autoSwitchToManual = shouldSwitchToManualMode(current, metric, subtest.scoreType);
    const nextManualMode = conversionLocked || conversionMode === 'manual' || autoSwitchToManual;
    const conversionPatch: Partial<ScoreResult> = nextManualMode
      ? { conversionMode: 'manual' }
      : { conversionMode: 'auto' };
    const setPatch = (patch: Partial<ScoreResult>) => updateSubtest(testId, subId, mergePatch(current, patch));

    if (metric === 'z') {
      setLocalZ(prev => ({ ...prev, [subId]: text }));
      const n = parseNum(text);
      if (n === null) {
        if (text === '' || text === '-' || text === '.' || text === '-.' || /^-?\d*\.?$/.test(text)) return;
        setPatch({ entryMetric: 'z', zScore: undefined, derived: { source: 'manual' }, scoreSource: 'manual_et', ...conversionPatch });
        return;
      }
      if (!nextManualMode) {
        const c = calculateFromZ(n, scoreType);
        setPatch({ entryMetric: 'z', zScore: n, standard: c.standard, percentile: c.percentile, derived: { standard: c.standard, percentile: c.percentile, zScore: n, source: 'assisted' }, scoreSource: 'manual_et', ...conversionPatch });
        return;
      }
      setPatch({ entryMetric: 'z', zScore: n, derived: { source: 'manual' }, scoreSource: 'manual_et', ...conversionPatch });
      return;
    }
    setLocalZ(prev => { const next = { ...prev }; delete next[subId]; return next; });
    const n = parseNum(text);

    if (metric === 'raw') {
      setPatch({ entryMetric: 'raw', raw: text, ...conversionPatch });
      const dbSubtestId = subId.includes('_') ? subId : `${testId}_${subId}`;
      const status = normsStatusMap[dbSubtestId];
      const canCompute = status?.statusCode === 'ok';
      if (n !== null && canAutoConvert && (subtest.computationMode || 'LOOKUP') !== 'NONE' && canCompute) {
        try {
          const out = await ScoringEngine.compute(dbSubtestId, n, ageMonths(patient.dob), patient.gender === 'F' ? 'F' : 'M', patient.classLevel);
          if (out?.normFound) {
            let zToUse = typeof out.zScore === 'number' ? out.zScore : null;
            let standardToUse = out.standard ?? '';
            let percentileToUse = out.percentile ?? '';
            const baseDirection = resolveEffectiveDirection(subtest.rawDirection, subtest.name);
            const effectiveDirection = directionByDbSubtestId[dbSubtestId] || baseDirection;
            if (out.method === 'PARAMETRIC' && zToUse !== null && effectiveDirection !== baseDirection) {
              zToUse = -zToUse;
              const recalculated = calculateFromZ(zToUse, scoreType);
              standardToUse = recalculated.standard ?? '';
              percentileToUse = recalculated.percentile ?? '';
            }
            setPatch({
              raw: text, standard: standardToUse, percentile: percentileToUse,
              zScore: zToUse ?? undefined,
              derived: { standard: standardToUse || undefined, percentile: percentileToUse || undefined, zScore: zToUse ?? undefined, source: 'auto' },
              scoreSource: 'auto',
              conversionMode: 'auto',
            });
          }
        } catch { /* silent */ }
      }
      return;
    }
    if (metric === 'standard') {
      if (n === null) { setPatch({ entryMetric: 'standard', standard: text, derived: { source: 'manual' }, scoreSource: 'manual_ns', ...conversionPatch }); return; }
      if (!nextManualMode) {
        const c = calculateFromStandard(n, scoreType);
        setPatch({ entryMetric: 'standard', standard: text, percentile: c.percentile, zScore: c.zScore, derived: { standard: text, percentile: c.percentile, zScore: c.zScore, source: 'assisted' }, scoreSource: 'manual_ns', ...conversionPatch });
        return;
      }
      setPatch({ entryMetric: 'standard', standard: text, derived: { source: 'manual' }, scoreSource: 'manual_ns', ...conversionPatch });
      return;
    }
    if (metric === 'percentile') {
      if (n === null) { setPatch({ entryMetric: 'percentile', percentile: text, derived: { source: 'manual' }, scoreSource: 'manual_pct', ...conversionPatch }); return; }
      if (!nextManualMode) {
        const c = calculateFromPercentile(n, scoreType);
        setPatch({
          entryMetric: 'percentile',
          percentile: text,
          standard: c.standard,
          zScore: c.zScore,
          derived: { standard: c.standard, percentile: text, zScore: c.zScore, source: 'assisted' },
          scoreSource: 'manual_pct',
          ...conversionPatch,
        });
        return;
      }
      setPatch({ entryMetric: 'percentile', percentile: text, derived: { source: 'manual' }, scoreSource: 'manual_pct', ...conversionPatch });
    }
  };

  const cellInput = 'w-full text-center text-xs font-semibold bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[#E07A5F] text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] transition-colors tabular-nums';
  const cellDisplay = 'text-center text-xs font-medium text-[var(--text-secondary)] py-1.5 tabular-nums';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-color)]">
            <th className="text-left py-2 px-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[22%]">Épreuve</th>
            <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[10%]">Brut</th>
            <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[10%]">NS</th>
            <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-[10%]">ET</th>
            <th className="text-center py-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)] w-[7%]">%</th>
            <th className="text-left py-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-auto">Observation</th>
            <th className="text-center py-2 px-1 w-[3%]" />
          </tr>
        </thead>
        <tbody>
          {subtests.map(st => {
            const res = getResult(st.id);
            const dbSubId = st.id.includes('_') ? st.id : `${testId}_${st.id}`;
            const stStatus = normsStatusMap[dbSubId];
            const conversionMode = resolveConversionMode(res, st.scoreType);
            const conversionLocked = isManualOnlyScoreType(st.scoreType);
            const canAutoConvert = conversionMode === 'auto' && !conversionLocked;
            const stHasNorms = stStatus?.statusCode === 'ok' && canAutoConvert;
            const pref = getPreferredMetric(st);
            const isQual = st.inputModel === 'qualitative_category';
            const isRawOnly = st.inputModel === 'raw_only';
            const percentileEditable = !canAutoConvert;
            const isRev = reviewed(res);
            const hasData = hasValue(res);
            const hasZ = typeof res.zScore === 'number' && Number.isFinite(res.zScore);
            const tone = scoreToneFromZ(hasZ ? res.zScore! : null);

            if (isQual) {
              const options = [...(st.inputConfig?.options || [])].sort((a, b) => a.order - b.order);
              return (
                <tr key={st.id} className="border-b border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors">
                  <td className="py-2 px-3 font-medium text-[var(--text-heading)]">{getSubtestDisplayName(st)}</td>
                  <td colSpan={4} className="py-2 px-1">
                    <select
                      value={res.qualitativeCode || res.raw || ''}
                      onChange={(e) => {
                        const opt = options.find(o => o.code === e.target.value);
                        updateSubtest(testId, st.id, mergePatch(res, {
                          raw: e.target.value, qualitativeCode: e.target.value,
                          qualitativeLabel: opt?.label || '', standard: '', percentile: '',
                          zScore: undefined, derived: undefined, scoreSource: 'manual_ns',
                        }));
                      }}
                      className="w-full text-xs bg-transparent border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-[#E07A5F] text-[var(--text-heading)]"
                    >
                      <option value="">–</option>
                      {options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="py-1 px-2">
                    <input
                      value={res.observation || ''}
                      onChange={(e) => updateSubtest(testId, st.id, mergePatch(res, { observation: e.target.value }))}
                      className="w-full text-xs bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[#E07A5F] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] transition-colors"
                      placeholder="Note..."
                    />
                  </td>
                  <td className="py-2 px-1 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${isRev ? 'bg-emerald-400' : hasData ? 'bg-amber-300' : 'bg-[var(--border-color)]'}`} />
                  </td>
                </tr>
              );
            }

            return (
              <tr key={st.id} className={`border-b border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors ${tone === 'bad' ? 'bg-rose-50/30 dark:bg-rose-900/10' : tone === 'warn' ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}`}>
                <td className="py-2 px-3 font-medium text-[var(--text-heading)]">
                  <span className="truncate block max-w-[180px]">{getSubtestDisplayName(st)}</span>
                  {canAutoConvert && st.computationMode === 'PARAMETRIC' && (
                    <span className="mt-1 inline-flex">
                      <DirectionBadge
                        direction={directionByDbSubtestId[dbSubId] || resolveEffectiveDirection(st.rawDirection, st.name)}
                      />
                    </span>
                  )}
                  {!isRawOnly && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--hover-bg)] p-0.5">
                      <button
                        type="button"
                        disabled={conversionLocked}
                        onClick={() => updateSubtest(testId, st.id, mergePatch(res, { conversionMode: 'auto' }))}
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${conversionMode === 'auto' ? 'bg-[#3D405B] text-white' : 'text-[var(--text-secondary)]'} ${conversionLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        A
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSubtest(testId, st.id, mergePatch(res, { conversionMode: 'manual' }))}
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${conversionMode === 'manual' ? 'bg-[#E07A5F] text-white' : 'text-[var(--text-secondary)]'}`}
                      >
                        M
                      </button>
                    </div>
                  )}
                </td>
                {/* Brut — disabled/greyed when no norms */}
                <td className="py-1 px-1">
                  {stHasNorms || isRawOnly ? (
                    <input
                      value={res.raw || ''}
                      inputMode="decimal"
                      onChange={(e) => void handleInput(st.id, 'raw', e.target.value, st)}
                      className={`${cellInput} ${res.entryMetric === 'raw' || (!res.entryMetric && stHasNorms) ? 'border-b-[#E07A5F]' : ''}`}
                      placeholder="–"
                    />
                  ) : (
                    <div className="text-center text-xs font-medium text-[var(--text-disabled)] py-1.5 tabular-nums opacity-40">–</div>
                  )}
                </td>
                {/* NS */}
                <td className="py-1 px-1">
                  {isRawOnly ? (
                    <div className={cellDisplay}>–</div>
                  ) : (
                    <input
                      value={res.standard || ''}
                      inputMode="decimal"
                      onChange={(e) => void handleInput(st.id, 'standard', e.target.value, st)}
                      className={`${cellInput} ${res.entryMetric === 'standard' || (!res.entryMetric && !stHasNorms && pref === 'standard') ? 'border-b-[#E07A5F]' : ''}`}
                      placeholder="–"
                    />
                  )}
                </td>
                {/* ET */}
                <td className="py-1 px-1">
                  {isRawOnly ? (
                    <div className={cellDisplay}>–</div>
                  ) : (
                    <input
                      value={localZ[st.id] !== undefined ? localZ[st.id] : (hasZ ? String(res.zScore) : '')}
                      inputMode="decimal"
                      onChange={(e) => void handleInput(st.id, 'z', e.target.value, st)}
                      onBlur={() => {
                        if (localZ[st.id] !== undefined) {
                          const n = parseNum(localZ[st.id]);
                          if (n === null) {
                            updateSubtest(testId, st.id, mergePatch(res, { entryMetric: 'z', zScore: undefined, derived: { source: 'manual' }, scoreSource: 'manual_et', conversionMode: resolveConversionMode(res, st.scoreType) === 'manual' ? 'manual' : undefined }));
                          }
                          setLocalZ(prev => { const next = { ...prev }; delete next[st.id]; return next; });
                        }
                      }}
                      className={`${cellInput} ${res.entryMetric === 'z' || (!res.entryMetric && !stHasNorms && pref === 'z') ? 'border-b-[#E07A5F]' : ''}`}
                      placeholder="–"
                    />
                  )}
                </td>
                {/* % — editable in manual mode */}
                <td className="py-1 px-1">
                  {isRawOnly ? (
                    <div className={cellDisplay}>–</div>
                  ) : percentileEditable ? (
                    <input
                      value={res.percentile || ''}
                      inputMode="decimal"
                      onChange={(e) => void handleInput(st.id, 'percentile', e.target.value, st)}
                      className={`${cellInput} ${res.entryMetric === 'percentile' ? 'border-b-[#E07A5F]' : ''}`}
                      placeholder="–"
                    />
                  ) : (
                    <div className={cellDisplay}>{res.percentile || '–'}</div>
                  )}
                </td>
                {/* Observation — inline text input */}
                <td className="py-1 px-2">
                  <input
                    value={res.observation || ''}
                    onChange={(e) => updateSubtest(testId, st.id, mergePatch(res, { observation: e.target.value }))}
                    className="w-full text-xs bg-transparent outline-none py-1.5 border-b border-transparent focus:border-[#E07A5F] text-[var(--text-main)] placeholder:text-[var(--text-disabled)] transition-colors"
                    placeholder="Note..."
                  />
                </td>
                {/* Review dot */}
                <td className="py-1 px-1 text-center">
                  <span className={`inline-block h-2 w-2 rounded-full ${isRev ? 'bg-emerald-400' : hasData ? 'bg-amber-300' : 'bg-[var(--border-color)]'}`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const SummaryPanel: React.FC<{ tests: TestData }> = ({ tests }) => {
  const { catalog } = useCatalog();

  const testRows = useMemo(() => {
    const testNameMap: Record<string, string> = {};
    catalog.forEach((cat) => {
      cat.tests.forEach((t) => {
        testNameMap[t.id] = t.name;
      });
    });

    const rows: { testId: string; name: string; avg: number | null; subtestCount: number; zCount: number }[] = [];
    Object.entries(tests).forEach(([testId, subtests]) => {
      const zScores: number[] = [];
      Object.values(subtests).forEach((res) => {
        if (typeof res.zScore === 'number' && Number.isFinite(res.zScore)) zScores.push(res.zScore);
      });
      const avg = zScores.length > 0 ? zScores.reduce((a, b) => a + b, 0) / zScores.length : null;
      rows.push({
        testId,
        name: testNameMap[testId] || testId,
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
                      className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-[#3D405B] shadow"
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

export const TestCatalogModal: React.FC<{ isOpen: boolean; onClose: () => void; existingTests: TestData; onAddTests: (selection: Record<string, string[]>) => void; onContribute?: () => void; initialExpandedTestId?: string | null }> = ({ isOpen, onClose, existingTests, onAddTests, onContribute, initialExpandedTestId }) => {
  const { catalog, searchTests, ensureCatalogLoaded, loading } = useCatalog();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [subtestSearchByTest, setSubtestSearchByTest] = useState<Record<string, string>>({});

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
  const testsToRender = useMemo(() => {
    if (searchTerm.trim()) return searchTests(searchTerm.trim());
    if (activeCategoryId === 'all') return catalog.flatMap((c) => c.tests);
    return catalog.find((c) => c.id === activeCategoryId)?.tests || [];
  }, [searchTerm, searchTests, activeCategoryId, catalog]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-6xl h-[88vh] rounded-[34px] overflow-hidden bg-[var(--card-bg)] shadow-[0_35px_80px_rgba(0,0,0,0.28)] border border-[var(--border-color)] flex flex-col">
        <div className="px-6 py-5 border-b border-[var(--border-color)] bg-[var(--card-bg)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif font-bold text-2xl flex items-center gap-3">
                <Layers size={24} className="text-[#E07A5F]" />
                Catalogue tests
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Sélection rapide des tests et sous-tests.</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-full bg-[var(--hover-bg)] hover:bg-[var(--border-color)] transition-colors text-[var(--text-secondary)]">
              <X size={20} />
            </button>
          </div>
          <div className="mt-4 relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher un test..."
              className="w-full pl-12 pr-4 py-3 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-xl outline-none text-[var(--text-heading)] font-semibold focus:ring-2 focus:ring-[#E07A5F]/20"
              autoFocus
            />
          </div>
          {!searchTerm.trim() && (
            <div className="mt-3 flex flex-wrap gap-2">
              {categoryTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveCategoryId(tab.id)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${activeCategoryId === tab.id
                      ? 'bg-[#3D405B] text-white shadow-sm'
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
                      ? 'border-[#E07A5F]/40 bg-[#E07A5F]/5 shadow-sm'
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
                      {alreadyCount > 0 && <span className="rounded-full bg-[var(--progress-bg)] text-[var(--text-secondary)] px-2 py-0.5 text-[10px] font-bold">{alreadyCount} déjà</span>}
                      {selectedCount > 0 && <span className="rounded-full bg-[#E07A5F] text-white px-2 py-0.5 text-[10px] font-bold">{selectedCount}</span>}
                      {isExpanded ? <ChevronUp size={16} className="text-[var(--text-secondary)]" /> : <ChevronDown size={16} className="text-[var(--text-secondary)]" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[var(--border-color)] px-3 pb-3 pt-2 grid grid-cols-1 gap-2">
                      {test.subtests.length > 8 && (
                        <div className="pb-1">
                          <input
                            value={subtestSearchByTest[test.id] || ''}
                            onChange={(e) => setSubtestSearchByTest((prev) => ({ ...prev, [test.id]: e.target.value }))}
                            placeholder="Rechercher un sous-test..."
                            className="w-full rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-heading)] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none bg-[var(--input-bg)]"
                          />
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                        {filteredSubtests.map((st) => {
                          const already = existingTests[test.id]?.[st.id] !== undefined;
                          const checked = already || (selected[test.id] || []).includes(st.id);
                          return (
                            <label
                              key={st.id}
                              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${already
                                  ? 'bg-[var(--hover-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                  : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-main)] hover:border-[#E07A5F]'
                                }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={already}
                                onChange={() => toggleSubtest(test.id, st.id)}
                                className="accent-[#E07A5F]"
                              />
                              <span className="truncate">{getSubtestDisplayName(st)}</span>
                              {already && <span className="ml-auto text-[10px] uppercase font-bold">ajouté</span>}
                            </label>
                          );
                        })}
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

          <div className="mt-4 bg-[var(--card-bg)] border border-[var(--border-color)] p-4 rounded-2xl flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-[var(--text-heading)] flex items-center gap-2"><FilePlus size={16} /> Test manquant ?</h3>
              <p className="text-xs text-[var(--text-secondary)]">Ajoutez-le via le studio contribution.</p>
            </div>
            {onContribute && <button onClick={() => { onClose(); onContribute(); }} className="px-4 py-2 bg-[var(--hover-bg)] border border-[var(--border-color)] rounded-xl text-xs font-bold text-[var(--text-heading)] hover:border-[#3D405B]">Contribuer</button>}
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border-color)] bg-[var(--card-bg)] flex flex-wrap justify-between items-center gap-3">
          <span className="text-xs text-[var(--text-secondary)] font-semibold">{totalSelected} épreuve(s) sélectionnée(s)</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 font-bold text-[var(--text-secondary)]">Annuler</button>
            <button
              onClick={() => {
                onAddTests(selected);
                setSelected({});
                onClose();
              }}
              disabled={totalSelected === 0}
              className="px-5 py-2 rounded-xl bg-[#3D405B] text-white font-bold disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, observations, updateObservations, onNext, onBack, onContribute }) => {
  const toast = useToast();
  const { catalog, ensureCatalogLoaded } = useCatalog();
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogTargetTestId, setCatalogTargetTestId] = useState<string | null>(null);
  const [collapsedTests, setCollapsedTests] = useState<Record<string, boolean>>({});
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const [subtestFilters, setSubtestFilters] = useState<Record<string, string>>({});
  const [showWarning, setShowWarning] = useState(false);
  const [expandedSubKey, setExpandedSubKey] = useState<string | null>(null);
  const [normsStatusMap, setNormsStatusMap] = useState<Record<string, NormsStatus>>({});
  const [pendingDirectionOverrides, setPendingDirectionOverrides] = useState<Record<string, EffectiveDirection>>({});
  const [isPersistingDirectionOverrides, setIsPersistingDirectionOverrides] = useState(false);
  const [viewMode, setViewMode] = useState<Record<string, 'accordion' | 'table'>>({});
  const normsLoadedRef = useRef<string>('');

  useEffect(() => {
    ensureCatalogLoaded();
  }, [ensureCatalogLoaded]);

  // Load norms status for all current subtests (age/gender aware)
  useEffect(() => {
    const allSubtestIds: string[] = [];
    Object.entries(tests).forEach(([testId, subtests]) => {
      Object.keys(subtests).forEach((subId) => {
        const dbId = subId.includes('_') ? subId : `${testId}_${subId}`;
        allSubtestIds.push(dbId);
      });
    });
    const uniqueIds = Array.from(new Set(allSubtestIds));
    const age = ageMonths(patient.dob);
    const gender = patient.gender === 'F' ? 'F' : 'M';
    const key = `${age}|${gender}|${uniqueIds.sort().join(',')}`;
    if (!key || key === normsLoadedRef.current) return;
    normsLoadedRef.current = key;

    let cancelled = false;
    const applyMap = (map: Record<string, NormsStatus>) => {
      if (!cancelled) setNormsStatusMap(map);
    };

    const loadLegacyStatus = async () => {
      try {
        const [availabilityRes, applicabilityRes, onboardRes] = await Promise.all([
          supabase.rpc('check_norms_availability', { p_subtest_ids: uniqueIds }),
          supabase.rpc('check_norms_applicability', { p_subtest_ids: uniqueIds, p_age_months: age, p_gender: gender }),
          supabase.rpc('is_current_user_onboarded'),
        ]);

        const onboarded = onboardRes.data === true;
        const hasNormsById: Record<string, boolean> = {};
        const hasApplicableById: Record<string, boolean> = {};
        (availabilityRes.data as Array<{ subtest_id: string; has_norms: boolean }> | null || []).forEach((row) => {
          hasNormsById[row.subtest_id] = row.has_norms === true;
        });
        (applicabilityRes.data as Array<{ subtest_id: string; has_applicable_norms: boolean }> | null || []).forEach((row) => {
          hasApplicableById[row.subtest_id] = row.has_applicable_norms === true;
        });

        const map: Record<string, NormsStatus> = {};
        uniqueIds.forEach((subtestId) => {
          if (!onboarded) {
            map[subtestId] = { hasNorms: false, hasApplicableNorms: false, statusCode: 'onboarding_required' };
            return;
          }
          const hasNorms = hasNormsById[subtestId] === true;
          const hasApplicableNorms = hasApplicableById[subtestId] === true;
          map[subtestId] = {
            hasNorms,
            hasApplicableNorms,
            statusCode: !hasNorms ? 'no_norms' : hasApplicableNorms ? 'ok' : 'no_applicable_age_gender',
          };
        });
        applyMap(map);
      } catch {
        const map: Record<string, NormsStatus> = {};
        uniqueIds.forEach((subtestId) => {
          map[subtestId] = { hasNorms: false, hasApplicableNorms: false, statusCode: 'access_restricted' };
        });
        applyMap(map);
      }
    };

    const loadStatus = async () => {
      const rows = await ScoringEngine.checkNormsStatus(uniqueIds, age, gender);
      if (!rows) {
        await loadLegacyStatus();
        return;
      }

      const map: Record<string, NormsStatus> = {};
      rows.forEach((row) => {
        map[row.subtestId] = {
          hasNorms: row.hasNorms,
          hasApplicableNorms: row.hasApplicableNorms,
          statusCode: row.statusCode,
        };
      });
      uniqueIds.forEach((subtestId) => {
        if (!map[subtestId]) {
          map[subtestId] = { hasNorms: false, hasApplicableNorms: false, statusCode: 'access_restricted' };
        }
      });
      applyMap(map);
    };

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [tests, patient.dob, patient.gender]);

  useEffect(() => {
    const currentDbIds = new Set<string>();
    Object.entries(tests).forEach(([testId, subtests]) => {
      Object.keys(subtests).forEach((subId) => {
        currentDbIds.add(subId.includes('_') ? subId : `${testId}_${subId}`);
      });
    });
    setPendingDirectionOverrides((prev) => {
      const next: Record<string, EffectiveDirection> = {};
      (Object.entries(prev) as Array<[string, EffectiveDirection]>).forEach(([dbSubtestId, direction]) => {
        if (currentDbIds.has(dbSubtestId)) next[dbSubtestId] = direction;
      });
      return next;
    });
  }, [tests]);

  const getSubtestDefByDbSubtestId = useCallback((dbSubtestId: string): SubtestDef | null => {
    for (const category of catalog) {
      for (const test of category.tests) {
        const match = test.subtests.find((subtest) => {
          const candidate = subtest.id.includes('_') ? subtest.id : `${test.id}_${subtest.id}`;
          return candidate === dbSubtestId;
        });
        if (match) return match;
      }
    }
    return null;
  }, [catalog]);

  const resolveBaseDirectionForDbSubtest = useCallback((dbSubtestId: string, fallbackSubtest?: SubtestDef): EffectiveDirection => {
    const subtest = fallbackSubtest || getSubtestDefByDbSubtestId(dbSubtestId);
    if (!subtest) return 'higher_better';
    return resolveEffectiveDirection(subtest.rawDirection, subtest.name);
  }, [getSubtestDefByDbSubtestId]);

  const toggleSubtestDirection = useCallback((dbSubtestId: string, subtest: SubtestDef) => {
    const baseDirection = resolveBaseDirectionForDbSubtest(dbSubtestId, subtest);
    setPendingDirectionOverrides((prev) => {
      const currentDirection = prev[dbSubtestId] || baseDirection;
      const nextDirection: EffectiveDirection = currentDirection === 'higher_better' ? 'lower_better' : 'higher_better';
      if (nextDirection === baseDirection) {
        const { [dbSubtestId]: _discarded, ...rest } = prev;
        return rest;
      }
      return { ...prev, [dbSubtestId]: nextDirection };
    });

    const scoreType = subtest.scoreType || 'standard';
    if (scoreType === 'none') return;
    let touched = false;
    const nextTests: TestData = { ...tests };

    Object.entries(tests).forEach(([testId, subtests]) => {
      Object.entries(subtests).forEach(([subId, result]) => {
        const candidateDbId = subId.includes('_') ? subId : `${testId}_${subId}`;
        if (candidateDbId !== dbSubtestId) return;

        let zToFlip: number | null = null;
        if (typeof result.zScore === 'number' && Number.isFinite(result.zScore)) {
          zToFlip = result.zScore;
        } else {
          const standardValue = parseNum(result.standard || '');
          if (standardValue !== null) {
            zToFlip = calculateFromStandard(standardValue, scoreType).zScore;
          } else {
            const percentileValue = parseNum(result.percentile || '');
            if (percentileValue !== null) {
              zToFlip = calculateFromPercentile(percentileValue, scoreType).zScore;
            }
          }
        }
        if (zToFlip === null) return;

        const flippedZ = -zToFlip;
        const recalculated = calculateFromZ(flippedZ, scoreType);
        nextTests[testId] = {
          ...nextTests[testId],
          [subId]: {
            ...result,
            standard: recalculated.standard ?? '',
            percentile: recalculated.percentile ?? '',
            zScore: flippedZ,
            derived: {
              standard: recalculated.standard || undefined,
              percentile: recalculated.percentile || undefined,
              zScore: flippedZ,
              source: result.scoreSource === 'auto' ? 'auto' : 'assisted',
            },
          },
        };
        touched = true;
      });
    });

    if (touched) {
      updateTests(nextTests);
    }
  }, [resolveBaseDirectionForDbSubtest, tests, updateTests]);

  const persistPendingDirectionOverrides = useCallback(async (): Promise<boolean> => {
    const entries = Object.entries(pendingDirectionOverrides) as Array<[string, EffectiveDirection]>;
    if (entries.length === 0) return true;

    setIsPersistingDirectionOverrides(true);
    try {
      for (const [dbSubtestId, overrideDirection] of entries) {
        const subtestDef = getSubtestDefByDbSubtestId(dbSubtestId);
        const sourceSubtestId = subtestDef?.sourceSubtestId || dbSubtestId;
        const result = await ScoringEngine.upsertRawDirectionOverrideClone(sourceSubtestId, overrideDirection, 'step2_user_override');
        if (!result) {
          toast.error(`Impossible d'enregistrer le sens brut pour ${getSubtestDisplayName(subtestDef || { name: dbSubtestId, displayName: undefined })}.`);
          return false;
        }
      }
      setPendingDirectionOverrides({});
      return true;
    } finally {
      setIsPersistingDirectionOverrides(false);
    }
  }, [getSubtestDefByDbSubtestId, pendingDirectionOverrides, toast]);

  const handleProceedToNext = useCallback(async () => {
    const ok = await persistPendingDirectionOverrides();
    if (!ok) return;
    onNext();
  }, [onNext, persistPendingDirectionOverrides]);

  const addTests = useCallback((selection: Record<string, string[]>) => {
    const next = { ...tests };
    Object.entries(selection).forEach(([testId, subtestIds]) => {
      if (!next[testId]) next[testId] = {};
      subtestIds.forEach((id) => {
        if (!next[testId][id]) next[testId][id] = emptyScore();
      });
    });
    updateTests(next);
  }, [tests, updateTests]);

  const removeTest = useCallback((testId: string) => {
    const next = { ...tests };
    delete next[testId];
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
    let rev = 0;
    Object.values(tests).forEach((subtests) => {
      Object.values(subtests).forEach((res) => {
        if (!hasValue(res)) return;
        total += 1;
        if (reviewed(res)) rev += 1;
      });
    });
    return { total, rev, pending: Math.max(0, total - rev) };
  }, [tests]);
  const completion = stat.total > 0 ? Math.round((stat.rev / stat.total) * 100) : 0;

  const grouped = useMemo(() => {
    const groups: Record<string, TestDef[]> = {};
    Object.keys(tests).forEach((testId) => {
      const cat = catalog.find((c) => c.tests.some((t) => t.id === testId));
      if (!cat) {
        if (!groups.autre) groups.autre = [];
        const fallbackSubtests: SubtestDef[] = Object.keys(tests[testId] || {}).map((subId) => ({
          id: subId,
          name: subId,
          unit: 'pts',
          scoreType: 'none',
          inputModel: 'numeric_4mode',
        }));
        groups.autre.push({ id: testId, name: testId, subtests: fallbackSubtests });
        return;
      }
      if (!groups[cat.id]) groups[cat.id] = [];
      const def = cat.tests.find((t) => t.id === testId);
      if (def) groups[cat.id].push(def);
    });
    return groups;
  }, [tests, catalog]);

  const directionByDbSubtestId = useMemo(() => {
    const map: Record<string, EffectiveDirection> = {};
    Object.entries(tests).forEach(([testId, subtests]) => {
      Object.keys(subtests).forEach((subId) => {
        const dbSubtestId = subId.includes('_') ? subId : `${testId}_${subId}`;
        const subtestDef = getSubtestDefByDbSubtestId(dbSubtestId);
        const baseDirection = subtestDef ? resolveEffectiveDirection(subtestDef.rawDirection, subtestDef.name) : 'higher_better';
        map[dbSubtestId] = pendingDirectionOverrides[dbSubtestId] || baseDirection;
      });
    });
    return map;
  }, [getSubtestDefByDbSubtestId, pendingDirectionOverrides, tests]);

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-32">
      <div className="mb-8 bg-[var(--card-bg)] p-6 rounded-[32px] shadow-sm border border-[var(--border-color)]">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-serif font-bold text-[var(--text-heading)] flex items-center gap-3">
              <Activity size={24} className="text-[#E07A5F]" />
              Tests & mesures
            </h2>
            <p className="text-[var(--text-secondary)] text-sm font-medium mt-1">
              Saisie fluide : automatique si normes disponibles, assistée sinon.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${stat.pending === 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {stat.rev}/{stat.total} revus
            </div>
            {stat.pending > 0 && (
              <button
                type="button"
                onClick={() => {
                  const next = { ...tests };
                  Object.entries(next).forEach(([testId, subtests]) => {
                    Object.entries(subtests).forEach(([subId, res]) => {
                      if (hasValue(res) && !reviewed(res)) {
                        next[testId][subId] = { ...res, reviewState: 'reviewed', reviewedAt: new Date().toISOString(), status: 'validated' };
                      }
                    });
                  });
                  updateTests(next);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <CheckCheck size={14} />
                Tout revu
              </button>
            )}
            <button
              onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }}
              className="flex items-center gap-2 bg-[#3D405B] text-white px-5 py-2.5 rounded-xl font-bold hover:bg-[#2c2e42] transition-all text-sm"
            >
              <Plus size={16} />
              Ajouter
            </button>
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-[var(--progress-bg)] overflow-hidden">
          <div className="h-full bg-[#81B29A]" style={{ width: `${completion}%` }} />
        </div>
      </div>

      <div className="flex gap-8">
        <div className="flex-1 min-w-0 space-y-10">
          {Object.keys(tests).length === 0 && (
            <div className="rounded-[30px] border-2 border-dashed border-[var(--border-color)] bg-[var(--card-bg)] p-16 text-center shadow-sm">
              <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center">
                <Layers size={24} />
              </div>
              <p className="text-[var(--text-heading)] font-bold text-lg">Aucun test sélectionné</p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Ajoutez des tests depuis le catalogue pour démarrer la saisie guidée.</p>
              <button
                type="button"
                onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#3D405B] px-4 py-2 text-sm font-bold text-white hover:bg-[#2c2e42]"
              >
                <Plus size={16} />
                Ouvrir le catalogue
              </button>
            </div>
          )}

          {(Object.entries(grouped) as [string, TestDef[]][]).map(([catId, defs]) => {
            const cat = catalog.find((c) => c.id === catId);
            const CatIcon = ICON_MAP[cat?.iconKey || 'Box'];
            return (
              <section key={catId}>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2 shadow-sm">
                  <CatIcon size={16} className="text-[var(--text-heading)]" />
                  <h3 className="font-bold text-[var(--text-main)] uppercase text-xs tracking-[0.14em]">{cat?.name || 'Autres'}</h3>
                </div>
                {defs.map((test) => {
                  const collapsed = collapsedTests[test.id];
                  const editing = editMode[test.id];
                  const selectedIds = Object.keys(tests[test.id] || {});
                  const visibleSubtests = test.subtests.filter((st) => selectedIds.includes(st.id));
                  const subtestQuery = (subtestFilters[test.id] || '').trim().toLowerCase();
                  const filteredSubtests = subtestQuery
                    ? visibleSubtests.filter((st) => getSubtestDisplayName(st).toLowerCase().includes(subtestQuery))
                    : visibleSubtests;
                  const testFilledCount = visibleSubtests.filter((st) => hasValue(tests[test.id]?.[st.id])).length;
                  const testReviewedCount = visibleSubtests.filter((st) => reviewed(tests[test.id]?.[st.id])).length;
                  return (
                    <div key={test.id} className="mb-6 overflow-hidden rounded-[28px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                      <div className="px-5 py-4 border-b border-[var(--border-color)] bg-[var(--hover-bg)]">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <button onClick={() => setCollapsedTests((p) => ({ ...p, [test.id]: !p[test.id] }))} className="text-[var(--text-secondary)] rounded-xl p-1.5 hover:bg-[var(--card-bg)] hover:shadow-sm transition-all">
                              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                            </button>
                            <div className="min-w-0">
                              <h4 className="font-bold text-[var(--text-heading)] truncate">{test.name}</h4>
                              <p className="text-[11px] text-[var(--text-secondary)]">{visibleSubtests.length} épreuve(s) · {testFilledCount} saisie(s) · {testReviewedCount} revue(s)</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => setViewMode((p) => ({ ...p, [test.id]: p[test.id] === 'table' ? 'accordion' : 'table' }))}
                              className={`hidden md:flex p-2 rounded-lg border transition-all ${viewMode[test.id] === 'table' ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'text-[var(--text-secondary)] border-[var(--border-color)] hover:text-[#E07A5F] hover:border-[#E07A5F]/40'}`}
                              title={viewMode[test.id] === 'table' ? 'Vue détaillée' : 'Vue tableau'}
                            >
                              <Table2 size={14} />
                            </button>
                            <button onClick={() => setEditMode((p) => ({ ...p, [test.id]: !p[test.id] }))} className={`p-2 rounded-lg border ${editing ? 'bg-[#E07A5F] text-white border-[#E07A5F]' : 'text-[var(--text-secondary)] border-[var(--border-color)] hover:text-[#E07A5F] hover:border-[#E07A5F]/40'}`}>
                              <PenTool size={14} />
                            </button>
                            <button onClick={() => removeTest(test.id)} className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-rose-500 hover:border-rose-200">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {!collapsed && (
                        <div>
                          {visibleSubtests.length > 1 && viewMode[test.id] !== 'table' && (
                            <div className="px-5 pt-3">
                              <input
                                value={subtestFilters[test.id] || ''}
                                onChange={(e) => setSubtestFilters((prev) => ({ ...prev, [test.id]: e.target.value }))}
                                placeholder="Filtrer les sous-tests..."
                                className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--text-heading)] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none transition-colors"
                              />
                            </div>
                          )}
                          {visibleSubtests.length === 0 && <div className="p-6 text-center text-sm text-[var(--text-secondary)]">Aucune épreuve sélectionnée.</div>}

                          {viewMode[test.id] === 'table' ? (
                            /* ── Table mode ── */
                            <div className="p-3">
                              <TableView
                                testId={test.id}
                                patient={patient}
                                subtests={filteredSubtests}
                                tests={tests}
                                normsStatusMap={normsStatusMap}
                                directionByDbSubtestId={directionByDbSubtestId}
                                updateSubtest={updateSubtest}
                              />
                            </div>
                          ) : (
                            /* ── Accordion mode ── */
                            <>
                              {visibleSubtests.length > 0 && filteredSubtests.length === 0 && <div className="p-6 text-center text-sm text-[var(--text-secondary)]">Aucun sous-test ne correspond au filtre.</div>}
                              {filteredSubtests.map((st) => {
                                const res = tests[test.id]?.[st.id] || emptyScore();
                                const dbSubId = st.id.includes('_') ? st.id : `${test.id}_${st.id}`;
                                const normsStatus = normsStatusMap[dbSubId];
                                const hasApplicableNorms = normsStatus?.statusCode === 'ok';
                                const baseDirection = resolveBaseDirectionForDbSubtest(dbSubId, st);
                                const effectiveDirection = directionByDbSubtestId[dbSubId] || baseDirection;
                                const subKey = `${test.id}__${st.id}`;
                                const isSubExpanded = expandedSubKey === subKey;
                                const isSubReviewed = reviewed(res);
                                const hasData = hasValue(res);
                                return (
                                  <div
                                    key={st.id}
                                    className={`relative border-l-[3px] transition-all ${isSubReviewed
                                        ? 'border-l-emerald-400'
                                        : hasData
                                          ? 'border-l-amber-300'
                                          : 'border-l-transparent'
                                      } ${isSubExpanded ? 'bg-[var(--hover-bg)]' : ''}`}
                                  >
                                    {isSubExpanded ? (
                                      <FlexibleSubtestRow
                                        testId={test.id}
                                        patient={patient}
                                        subtest={st}
                                        result={res}
                                        onChange={(patch) => updateSubtest(test.id, st.id, patch)}
                                        hasNorms={hasApplicableNorms}
                                        normsStatusCode={normsStatus?.statusCode}
                                        effectiveDirection={effectiveDirection}
                                        baseDirection={baseDirection}
                                        onToggleDirection={() => toggleSubtestDirection(dbSubId, st)}
                                        hasPendingDirectionOverride={pendingDirectionOverrides[dbSubId] !== undefined}
                                        onFocus={() => setExpandedSubKey(subKey)}
                                      />
                                    ) : (
                                      <CompactSubtestRow subtest={st} result={res} onClick={() => setExpandedSubKey(subKey)} />
                                    )}
                                    {editing && isSubExpanded && <button onClick={() => removeSubtest(test.id, st.id)} className="absolute right-2 top-2 p-2 bg-rose-50 text-rose-500 rounded-lg"><Trash2 size={14} /></button>}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>

        {Object.keys(tests).length > 0 && <div className="hidden lg:block w-72 shrink-0"><SummaryPanel tests={tests} /></div>}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-5 bg-[var(--card-bg)]/90 backdrop-blur-md border-t border-[var(--border-color)] flex justify-center z-50">
        <div className="max-w-4xl w-full flex justify-between items-center">
          <button onClick={onBack} className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] font-bold text-sm uppercase tracking-widest px-2 transition-colors">Retour</button>
          <button
            onClick={() => (stat.pending > 0 ? setShowWarning(true) : void handleProceedToNext())}
            disabled={isPersistingDirectionOverrides}
            className="flex items-center gap-3 px-7 py-3 bg-gradient-to-r from-[#E07A5F] to-[#d0694e] text-white rounded-2xl font-bold shadow-xl shadow-orange-200 dark:shadow-black/30 hover:brightness-105 transition-all"
          >
            <span>{isPersistingDirectionOverrides ? 'Enregistrement...' : 'Passer au diagnostic'}</span>
            <ArrowRight size={20} />
          </button>
        </div>
      </div>

      <TestCatalogModal isOpen={showCatalog} onClose={() => setShowCatalog(false)} existingTests={tests} onAddTests={addTests} onContribute={onContribute} initialExpandedTestId={catalogTargetTestId} />

      {showWarning && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-[#3D405B]/75 backdrop-blur-sm">
          <div className="bg-[var(--card-bg)] w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-[var(--border-color)]">
            <div className="flex items-center gap-3 mb-3 text-amber-700"><AlertTriangle size={20} /><h4 className="font-bold text-lg text-[var(--text-heading)]">Eléments non revus</h4></div>
            <p className="text-sm text-[var(--text-main)]">{stat.pending} élément(s) saisi(s) ne sont pas encore marqués comme revus. Vous pouvez continuer ou revenir vérifier.</p>
            <div className="mt-6 flex justify-end gap-3"><button onClick={() => setShowWarning(false)} className="px-4 py-2 rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] font-bold text-xs uppercase tracking-wider">Revenir</button><button onClick={() => { setShowWarning(false); void handleProceedToNext(); }} className="px-4 py-2 rounded-xl bg-[#3D405B] text-white font-bold text-xs uppercase tracking-wider">Continuer quand même</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export const SubtestRowCheck = FlexibleSubtestRow;

