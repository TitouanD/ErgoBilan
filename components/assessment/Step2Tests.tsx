import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Observations, Patient, ScoreResult, TestData, UserProfile } from '../../types';
import { ICON_MAP, type SubtestDef, type TestDef } from '../../data/testCatalog';
import { ScoringEngine } from '../../services/scoringEngine';
import { calculateFromPercentile, calculateFromStandard, calculateFromZ } from '../../utils/scoring';
import { useCatalog } from '../../contexts/CatalogContext';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  FilePlus,
  GripVertical,
  Layers,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  PenTool,
  Plus,
  Search,
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

const METRIC_OPTIONS: Array<{ key: Metric; label: string }> = [
  { key: 'raw', label: 'Brut' },
  { key: 'standard', label: 'NS' },
  { key: 'z', label: 'ET' },
  { key: 'percentile', label: '%' },
];

const parseNum = (value: string): number | null => {
  const n = parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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
        className="w-full p-3 pl-9 pr-10 bg-stone-50 border border-stone-100 rounded-xl text-xs text-[#3D405B] focus:border-[#E07A5F] focus:bg-white outline-none resize-none transition-all placeholder:text-stone-300"
        rows={2}
      />
      <MessageSquare size={14} className="absolute top-3 left-3 text-stone-300" />
      {isSupported && !readOnly && (
        <button
          type="button"
          onClick={toggleListening}
          className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg transition-all ${
            isListening ? 'bg-red-100 text-red-500 animate-pulse' : 'text-stone-300 hover:text-[#E07A5F] hover:bg-stone-100'
          }`}
        >
          {isListening ? <MicOff size={12} /> : <Mic size={12} />}
        </button>
      )}
      {isListening && interimText && <div className="mt-1 px-2 py-1 bg-red-50 border border-red-100 rounded text-[10px] text-red-500 italic">Dictee: {interimText}...</div>}
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
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
        isReviewed
          ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-100/60 text-emerald-700 shadow-sm'
          : 'border-stone-200 bg-white text-stone-500 hover:border-[#E07A5F] hover:text-[#E07A5F] hover:shadow-sm'
      } ${!canReview ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${
          isReviewed ? 'bg-emerald-600 text-white' : 'border border-stone-300 text-stone-400'
        }`}
      >
        {isReviewed ? <CircleCheck size={10} /> : <Circle size={10} />}
      </span>
      <span>{isReviewed ? 'Revu' : 'Marquer revu'}</span>
      {isReviewed && reviewedAtText && <span className="text-[9px] font-semibold normal-case tracking-normal text-emerald-700/80">{reviewedAtText}</span>}
    </button>
  );
};

const GaussBand: React.FC<{ z: number | null }> = ({ z }) => {
  if (z === null || !Number.isFinite(z)) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white px-3 py-3">
        <div className="h-2 rounded-full bg-stone-200" />
      </div>
    );
  }

  const clamped = clamp(z, -3.5, 3.5);
  const left = ((clamped + 3.5) / 7) * 100;

  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-2">
      <div
        className="relative h-2 rounded-full"
        style={{
          background:
            'linear-gradient(to right, #f87171 0%, #f87171 21.4%, #fbbf24 21.4%, #fbbf24 35.7%, #34d399 35.7%, #34d399 100%)',
        }}
      >
        <span
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-[#3D405B] shadow"
          style={{ left: `${left}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="text-[11px] font-semibold text-stone-500">
          ET {z > 0 ? '+' : ''}
          {z.toFixed(2)}
        </span>
      </div>
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
}> = ({ testId, patient, subtest, result, onChange, readOnly, onFocus }) => {
  const [isComputing, setIsComputing] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const active = result.entryMetric || subtest.inputConfig?.defaultMetric || 'raw';

  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));

  const computeRaw = async (raw: string, value: number) => {
    if ((subtest.computationMode || 'LOOKUP') === 'NONE') {
      setWarn('Pas de calcul automatique pour cette epreuve.');
      setPatch({ raw, derived: { source: 'manual' } });
      return;
    }

    setIsComputing(true);
    try {
      const dbSubtestId = subtest.id.includes('_') ? subtest.id : `${testId}_${subtest.id}`;
      const out = await ScoringEngine.compute(dbSubtestId, value, ageMonths(patient.dob), patient.gender === 'F' ? 'F' : 'M', patient.classLevel);
      if (!out || !out.normFound) {
        setWarn('Normes introuvables. Continuez en saisie manuelle.');
        setPatch({ raw, derived: { source: 'manual' } });
        return;
      }
      setWarn(out.warnings.length > 0 ? out.warnings.join(' | ') : null);
      setPatch({
        raw,
        standard: out.standard ?? '',
        percentile: out.percentile ?? '',
        zScore: typeof out.zScore === 'number' ? out.zScore : undefined,
        derived: {
          standard: out.standard ?? undefined,
          percentile: out.percentile ?? undefined,
          zScore: typeof out.zScore === 'number' ? out.zScore : undefined,
          source: 'auto',
        },
        scoreSource: 'auto',
      });
    } catch (e) {
      setWarn('Erreur calcul automatique.');
      setPatch({ raw, derived: { source: 'manual' } });
      console.error(e);
    } finally {
      setIsComputing(false);
    }
  };

  const onMetricInput = async (metric: Metric, text: string) => {
    if (readOnly) return;
    const n = parseNum(text);
    if (metric === 'raw') {
      setPatch({ entryMetric: 'raw', raw: text });
      if (n !== null) await computeRaw(text, n);
      return;
    }
    if (metric === 'standard') {
      if (n === null) {
        setPatch({ entryMetric: 'standard', standard: text, derived: { source: 'manual' }, scoreSource: 'manual_ns' });
        return;
      }
      const c = calculateFromStandard(n, subtest.scoreType || 'standard');
      setWarn(null);
      setPatch({ entryMetric: 'standard', standard: text, percentile: c.percentile, zScore: c.zScore, derived: { standard: text, percentile: c.percentile, zScore: c.zScore, source: 'assisted' }, scoreSource: 'manual_ns' });
      return;
    }
    if (metric === 'z') {
      if (n === null) {
        setPatch({ entryMetric: 'z', zScore: undefined, derived: { source: 'manual' }, scoreSource: 'manual_et' });
        return;
      }
      const c = calculateFromZ(n, subtest.scoreType || 'standard');
      setWarn(null);
      setPatch({ entryMetric: 'z', zScore: n, standard: c.standard, percentile: c.percentile, derived: { standard: c.standard, percentile: c.percentile, zScore: n, source: 'assisted' }, scoreSource: 'manual_et' });
      return;
    }
    if (n === null) {
      setPatch({ entryMetric: 'percentile', percentile: text, derived: { source: 'manual' }, scoreSource: 'manual_ns' });
      return;
    }
    const c = calculateFromPercentile(n, subtest.scoreType || 'standard');
    setWarn(null);
    setPatch({ entryMetric: 'percentile', percentile: text, standard: c.standard, zScore: c.zScore, derived: { standard: c.standard, percentile: text, zScore: c.zScore, source: 'assisted' }, scoreSource: 'manual_ns' });
  };

  const hasZ = typeof result.zScore === 'number' && Number.isFinite(result.zScore);

  const metricValue = (metric: Metric): string => {
    if (metric === 'raw') return result.raw || '';
    if (metric === 'standard') return result.standard || '';
    if (metric === 'z') return hasZ ? String(result.zScore) : '';
    return result.percentile || '';
  };

  let visualZ: number | null = hasZ ? result.zScore! : null;
  if (visualZ === null && result.standard) {
    const s = parseNum(result.standard);
    if (s !== null) visualZ = calculateFromStandard(s, subtest.scoreType || 'standard').zScore;
  }
  if (visualZ === null && result.percentile) {
    const p = parseNum(result.percentile);
    if (p !== null) visualZ = calculateFromPercentile(p, subtest.scoreType || 'standard').zScore;
  }

  return (
    <div className="border-b border-stone-100 last:border-0 bg-white">
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="hidden md:block text-stone-300"><GripVertical size={16} /></div>
            <div className="min-w-0">
              <h4 className="font-bold text-[#3D405B] text-sm md:text-base truncate">{subtest.name}</h4>
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{subtest.unit}</span>
            </div>
          </div>
          <ReviewButton result={result} onChange={onChange} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {METRIC_OPTIONS.map((m) => {
            const val = metricValue(m.key);
            const isActive = active === m.key;
            return (
              <div
                key={m.key}
                className={`rounded-lg border px-2 py-2 transition-all ${
                  isActive
                    ? 'border-[#3D405B] bg-[#3D405B] text-white'
                    : 'border-stone-200 bg-white text-stone-500'
                }`}
              >
                <p className={`text-[10px] font-bold uppercase tracking-wider text-center ${isActive ? 'text-white' : 'text-stone-500'}`}>{m.label}</p>
                <input
                  value={val}
                  disabled={readOnly}
                  inputMode="decimal"
                  onFocus={() => {
                    setPatch({ entryMetric: m.key });
                    onFocus?.();
                  }}
                  onChange={(e) => {
                    void onMetricInput(m.key, e.target.value);
                  }}
                  className={`mt-1 w-full text-center text-lg font-bold bg-transparent outline-none ${
                    isActive ? 'text-white placeholder:text-white/70' : 'text-[#3D405B] placeholder:text-stone-300'
                  } ${readOnly ? 'cursor-not-allowed opacity-70' : ''}`}
                  placeholder="-"
                />
              </div>
            );
          })}
        </div>

        <div className="mb-2 flex items-center justify-end">
          {isComputing && <Loader2 size={13} className="animate-spin text-[#E07A5F]" />}
        </div>

        <GaussBand z={visualZ} />

        {warn && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
            <div className="inline-flex items-center gap-1.5">
              <AlertTriangle size={12} />
              {warn}
            </div>
          </div>
        )}

        <VoiceObservation value={result.observation || ''} onChange={(value) => setPatch({ observation: value })} readOnly={readOnly} onFocus={onFocus} />
      </div>
    </div>
  );
};

const QualitativeRow: React.FC<{ subtest: SubtestDef; result: ScoreResult; onChange: (patch: Partial<ScoreResult>) => void; readOnly?: boolean; onFocus?: () => void }> = ({ subtest, result, onChange, readOnly, onFocus }) => {
  const options = [...(subtest.inputConfig?.options || [])].sort((a, b) => a.order - b.order);
  const selected = result.qualitativeCode || result.raw;

  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));

  return (
    <div className="border-b border-stone-100 last:border-0 bg-white">
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden md:block text-stone-300"><GripVertical size={16} /></div>
            <div className="min-w-0">
              <h4 className="font-bold text-[#3D405B] text-sm md:text-base leading-tight truncate">{subtest.name}</h4>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Categorie normative</p>
            </div>
          </div>
          <ReviewButton result={result} onChange={onChange} />
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
                className={`text-left rounded-lg border px-3 py-2.5 text-xs font-semibold transition-all ${
                  active
                    ? 'border-[#3D405B] bg-[#3D405B] text-white'
                    : 'border-stone-200 bg-white text-stone-600 hover:border-[#E07A5F]'
                } ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'}`}>
                    {index + 1}
                  </span>
                  <span>{o.label}</span>
                </div>
              </button>
            );
          })}
        </div>

        <VoiceObservation value={result.observation || ''} onChange={(value) => setPatch({ observation: value })} readOnly={readOnly} onFocus={onFocus} />
      </div>
    </div>
  );
};

const RawOnlyRow: React.FC<{ subtest: SubtestDef; result: ScoreResult; onChange: (patch: Partial<ScoreResult>) => void; readOnly?: boolean; onFocus?: () => void }> = ({ subtest, result, onChange, readOnly, onFocus }) => {
  const setPatch = (patch: Partial<ScoreResult>) => onChange(mergePatch(result, patch));
  return (
    <div className="border-b border-stone-100 last:border-0 bg-white">
      <div className="p-4 md:p-5">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden md:block text-stone-300"><GripVertical size={16} /></div>
            <div className="min-w-0">
              <h4 className="font-bold text-[#3D405B] text-sm md:text-base leading-tight truncate">{subtest.name}</h4>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Saisie brute manuelle</p>
            </div>
          </div>
          <ReviewButton result={result} onChange={onChange} />
        </div>

        <input
          value={result.raw}
          onChange={(e) => setPatch({ raw: e.target.value })}
          onFocus={onFocus}
          disabled={readOnly}
          placeholder="Entrer la valeur brute"
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-3 text-center text-2xl font-bold text-[#3D405B] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none"
        />
        <VoiceObservation value={result.observation || ''} onChange={(value) => setPatch({ observation: value })} readOnly={readOnly} onFocus={onFocus} />
      </div>
    </div>
  );
};

const FlexibleSubtestRow = React.memo((props: { testId: string; patient: Patient; subtest: SubtestDef; result: ScoreResult; onChange: (patch: Partial<ScoreResult>) => void; readOnly?: boolean; onFocus?: () => void; isExpanded?: boolean; onToggleExpand?: () => void }) => {
  const model = props.subtest.inputModel || 'numeric_4mode';
  if (model === 'qualitative_category') return <QualitativeRow subtest={props.subtest} result={props.result} onChange={props.onChange} readOnly={props.readOnly} onFocus={props.onFocus} />;
  if (model === 'raw_only' || props.subtest.scoreType === 'none') return <RawOnlyRow subtest={props.subtest} result={props.result} onChange={props.onChange} readOnly={props.readOnly} onFocus={props.onFocus} />;
  return <NumericRow testId={props.testId} patient={props.patient} subtest={props.subtest} result={props.result} onChange={props.onChange} readOnly={props.readOnly} onFocus={props.onFocus} />;
});

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
    <div className="sticky top-24 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm space-y-3">
      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2">
        <Activity size={14} />
        Resume par test
      </h4>

      {testRows.length === 0 ? (
        <div className="h-2 rounded-full bg-stone-200" />
      ) : (
        <div className="space-y-2">
          {testRows.map(({ testId, name, avg, subtestCount }) => {
            const hasAvg = typeof avg === 'number' && Number.isFinite(avg);
            const markerLeft = hasAvg ? ((clamp(avg!, -3.5, 3.5) + 3.5) / 7) * 100 : null;
            const tone = scoreToneFromZ(hasAvg ? avg! : null);
            return (
              <div key={testId}>
                <div className="mb-1 flex items-center justify-between text-[10px]">
                  <span className="truncate font-medium text-stone-500 max-w-[160px]">{name}</span>
                  {hasAvg ? (
                    <span className={`font-bold ${tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {avg! > 0 ? '+' : ''}
                      {avg!.toFixed(2)} ET
                    </span>
                  ) : (
                    <span className="font-bold text-stone-300">--</span>
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
                  <div className="h-2 rounded-full bg-stone-200" />
                )}
                <div className="mt-1 flex items-center justify-between text-[10px] text-stone-400">
                  <span>{subtestCount} epreuve(s)</span>
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

  const totalSelected = Object.values(selected).reduce((acc, ids) => acc + ids.length, 0);
  const categoryTabs = useMemo(() => [{ id: 'all', label: 'Tous' }, ...catalog.map((c) => ({ id: c.id, label: c.name }))], [catalog]);
  const testsToRender = useMemo(() => {
    if (searchTerm.trim()) return searchTests(searchTerm.trim());
    if (activeCategoryId === 'all') return catalog.flatMap((c) => c.tests);
    return catalog.find((c) => c.id === activeCategoryId)?.tests || [];
  }, [searchTerm, searchTests, activeCategoryId, catalog]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-6xl h-[88vh] rounded-[34px] overflow-hidden bg-white shadow-[0_35px_80px_rgba(0,0,0,0.28)] border border-white/70 flex flex-col">
        <div className="px-6 py-5 border-b border-stone-100 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif font-bold text-2xl flex items-center gap-3">
                <Layers size={24} className="text-[#E07A5F]" />
                Catalogue tests
              </h2>
              <p className="text-sm text-stone-500 mt-1">Selection rapide des tests et sous-tests.</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-full bg-stone-100 hover:bg-stone-200 transition-colors text-stone-500">
              <X size={20} />
            </button>
          </div>
          <div className="mt-4 relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher un test..."
              className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-xl outline-none text-[#3D405B] font-semibold focus:ring-2 focus:ring-[#E07A5F]/20"
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
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${
                    activeCategoryId === tab.id
                      ? 'bg-[#3D405B] text-white shadow-sm'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-[var(--app-bg)] custom-scrollbar">
          {loading && testsToRender.length === 0 && <p className="text-sm text-stone-400">Chargement...</p>}
          {testsToRender.length === 0 && !loading && <p className="text-sm text-stone-500">Aucun test trouve pour ce filtre.</p>}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            {testsToRender.map((test) => {
              const isExpanded = expandedTestId === test.id;
              const selectedCount = (selected[test.id] || []).length;
              const alreadyCount = Object.keys(existingTests[test.id] || {}).length;
              const subtestSearch = (subtestSearchByTest[test.id] || '').trim().toLowerCase();
              const filteredSubtests = subtestSearch
                ? test.subtests.filter((st) => st.name.toLowerCase().includes(subtestSearch))
                : test.subtests;
              return (
                <div
                  key={test.id}
                  className={`rounded-2xl border overflow-hidden transition-all ${
                    selectedCount > 0
                      ? 'border-[#E07A5F]/40 bg-[#E07A5F]/5 shadow-sm'
                      : 'border-stone-200 bg-white hover:border-stone-300'
                  } ${isExpanded ? 'xl:col-span-2' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedTestId((prev) => (prev === test.id ? null : test.id))}
                    className="w-full px-4 py-3 text-left flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-[#3D405B] truncate">{test.name}</p>
                      <p className="text-[11px] text-stone-500">{test.subtests.length} sous-tests</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {alreadyCount > 0 && <span className="rounded-full bg-stone-100 text-stone-500 px-2 py-0.5 text-[10px] font-bold">{alreadyCount} deja</span>}
                      {selectedCount > 0 && <span className="rounded-full bg-[#E07A5F] text-white px-2 py-0.5 text-[10px] font-bold">{selectedCount}</span>}
                      {isExpanded ? <ChevronUp size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-stone-100 px-3 pb-3 pt-2 grid grid-cols-1 gap-2">
                      {test.subtests.length > 8 && (
                        <div className="pb-1">
                          <input
                            value={subtestSearchByTest[test.id] || ''}
                            onChange={(e) => setSubtestSearchByTest((prev) => ({ ...prev, [test.id]: e.target.value }))}
                            placeholder="Rechercher un sous-test..."
                            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-[#3D405B] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none"
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
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                              already
                                ? 'bg-stone-50 border-stone-100 text-stone-400'
                                : 'bg-white border-stone-200 text-stone-600 hover:border-[#E07A5F]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={already}
                              onChange={() => toggleSubtest(test.id, st.id)}
                              className="accent-[#E07A5F]"
                            />
                            <span className="truncate">{st.name}</span>
                            {already && <span className="ml-auto text-[10px] uppercase font-bold">ajoute</span>}
                          </label>
                        );
                        })}
                      </div>
                      {filteredSubtests.length === 0 && (
                        <p className="text-xs text-stone-400 px-1 py-2">Aucun sous-test ne correspond a la recherche.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 bg-white border border-stone-200 p-4 rounded-2xl flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-[#3D405B] flex items-center gap-2"><FilePlus size={16} /> Test manquant ?</h3>
              <p className="text-xs text-stone-500">Ajoutez-le via le studio contribution.</p>
            </div>
            {onContribute && <button onClick={() => { onClose(); onContribute(); }} className="px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-[#3D405B] hover:border-[#3D405B]">Contribuer</button>}
          </div>
        </div>

        <div className="p-4 border-t border-stone-100 bg-white flex flex-wrap justify-between items-center gap-3">
          <span className="text-xs text-stone-500 font-semibold">{totalSelected} epreuve(s) selectionnee(s)</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 font-bold text-stone-400">Annuler</button>
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
  const { catalog, ensureCatalogLoaded } = useCatalog();
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogTargetTestId, setCatalogTargetTestId] = useState<string | null>(null);
  const [collapsedTests, setCollapsedTests] = useState<Record<string, boolean>>({});
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const [subtestFilters, setSubtestFilters] = useState<Record<string, string>>({});
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    ensureCatalogLoaded();
  }, [ensureCatalogLoaded]);

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
          inputModel: 'raw_only',
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

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-32">
      <div className="mb-8 bg-white p-6 rounded-[32px] shadow-sm border border-stone-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-serif font-bold text-[#3D405B] flex items-center gap-3">
              <Activity size={24} className="text-[#E07A5F]" />
              Tests & mesures
            </h2>
            <p className="text-stone-500 text-sm font-medium mt-1">
              Saisie simple: automatique si normes disponibles, sinon assistee.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${stat.pending === 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {stat.rev}/{stat.total} revus
            </div>
            <button
              onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }}
              className="flex items-center gap-2 bg-[#3D405B] text-white px-5 py-2.5 rounded-xl font-bold hover:bg-[#2c2e42] transition-all text-sm"
            >
              <Plus size={16} />
              Ajouter
            </button>
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-stone-100 overflow-hidden">
          <div className="h-full bg-[#81B29A]" style={{ width: `${completion}%` }} />
        </div>
      </div>

      <div className="flex gap-8">
        <div className="flex-1 min-w-0 space-y-10">
          {Object.keys(tests).length === 0 && (
            <div className="rounded-[30px] border-2 border-dashed border-stone-300 bg-white p-16 text-center shadow-sm">
              <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center">
                <Layers size={24} />
              </div>
              <p className="text-[#3D405B] font-bold text-lg">Aucun test selectionne</p>
              <p className="mt-1 text-sm text-stone-500">Ajoute des tests pour demarrer la saisie guidee.</p>
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
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 shadow-sm">
                  <CatIcon size={16} className="text-[#3D405B]" />
                  <h3 className="font-bold text-stone-600 uppercase text-xs tracking-[0.14em]">{cat?.name || 'Divers'}</h3>
                </div>
                {defs.map((test) => {
                  const collapsed = collapsedTests[test.id];
                  const editing = editMode[test.id];
                  const selectedIds = Object.keys(tests[test.id] || {});
                  const visibleSubtests = test.subtests.filter((st) => selectedIds.includes(st.id));
                  const subtestQuery = (subtestFilters[test.id] || '').trim().toLowerCase();
                  const filteredSubtests = subtestQuery
                    ? visibleSubtests.filter((st) => st.name.toLowerCase().includes(subtestQuery))
                    : visibleSubtests;
                  const testFilledCount = visibleSubtests.filter((st) => hasValue(tests[test.id]?.[st.id])).length;
                  const testReviewedCount = visibleSubtests.filter((st) => reviewed(tests[test.id]?.[st.id])).length;
                  return (
                    <div key={test.id} className="mb-6 overflow-hidden rounded-[26px] border border-stone-200 bg-white shadow-[0_10px_24px_rgba(61,64,91,0.06)]">
                      <div className="px-4 py-4 border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <button onClick={() => setCollapsedTests((p) => ({ ...p, [test.id]: !p[test.id] }))} className="text-stone-400 rounded-lg p-1.5 hover:bg-white">
                              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                            </button>
                            <div className="min-w-0">
                              <h4 className="font-bold text-[#3D405B] truncate">{test.name}</h4>
                              <p className="text-[11px] text-stone-500">{visibleSubtests.length} epreuve(s) | {testFilledCount} saisie(s) | {testReviewedCount} revue(s)</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => setEditMode((p) => ({ ...p, [test.id]: !p[test.id] }))} className={`p-2 rounded-lg border ${editing ? 'bg-[#E07A5F] text-white border-[#E07A5F]' : 'text-stone-400 border-stone-200 hover:text-[#E07A5F] hover:border-[#E07A5F]/40'}`}>
                              <PenTool size={14} />
                            </button>
                            <button onClick={() => removeTest(test.id)} className="p-2 rounded-lg border border-stone-200 text-stone-400 hover:text-rose-500 hover:border-rose-200">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {!collapsed && (
                        <div>
                          {visibleSubtests.length > 1 && (
                            <div className="px-4 pt-3">
                              <input
                                value={subtestFilters[test.id] || ''}
                                onChange={(e) => setSubtestFilters((prev) => ({ ...prev, [test.id]: e.target.value }))}
                                placeholder="Filtrer les sous-tests..."
                                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs text-[#3D405B] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none"
                              />
                            </div>
                          )}
                          {visibleSubtests.length === 0 && <div className="p-6 text-center text-sm text-stone-400">Aucune epreuve selectionnee.</div>}
                          {visibleSubtests.length > 0 && filteredSubtests.length === 0 && <div className="p-6 text-center text-sm text-stone-400">Aucun sous-test ne correspond au filtre.</div>}
                          {filteredSubtests.map((st) => {
                            const res = tests[test.id]?.[st.id] || emptyScore();
                            return (
                              <div key={st.id} className="relative">
                                <FlexibleSubtestRow testId={test.id} patient={patient} subtest={st} result={res} onChange={(patch) => updateSubtest(test.id, st.id, patch)} />
                                {editing && <button onClick={() => removeSubtest(test.id, st.id)} className="absolute right-2 top-2 p-2 bg-rose-50 text-rose-500 rounded-lg"><Trash2 size={14} /></button>}
                              </div>
                            );
                          })}
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

      <div className="fixed bottom-0 left-0 right-0 p-5 bg-white/90 backdrop-blur-md border-t border-stone-100 flex justify-center z-50">
        <div className="max-w-4xl w-full flex justify-between items-center">
          <button onClick={onBack} className="text-stone-400 hover:text-[#3D405B] font-bold text-sm uppercase tracking-widest px-2 transition-colors">Retour</button>
          <button
            onClick={() => (stat.pending > 0 ? setShowWarning(true) : onNext())}
            className="flex items-center gap-3 px-7 py-3 bg-gradient-to-r from-[#E07A5F] to-[#d0694e] text-white rounded-2xl font-bold shadow-xl shadow-orange-200 hover:brightness-105 transition-all"
          >
            <span>Passer au diagnostic</span>
            <ArrowRight size={20} />
          </button>
        </div>
      </div>

      <TestCatalogModal isOpen={showCatalog} onClose={() => setShowCatalog(false)} existingTests={tests} onAddTests={addTests} onContribute={onContribute} initialExpandedTestId={catalogTargetTestId} />

      {showWarning && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-[#3D405B]/75 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-stone-100">
            <div className="flex items-center gap-3 mb-3 text-amber-700"><AlertTriangle size={20} /><h4 className="font-bold text-lg text-[#3D405B]">Elements non revus</h4></div>
            <p className="text-sm text-stone-600">{stat.pending} element(s) saisi(s) ne sont pas encore marques comme revus. Vous pouvez continuer ou revenir verifier.</p>
            <div className="mt-6 flex justify-end gap-3"><button onClick={() => setShowWarning(false)} className="px-4 py-2 rounded-xl border border-stone-200 text-stone-500 font-bold text-xs uppercase">Revenir</button><button onClick={() => { setShowWarning(false); onNext(); }} className="px-4 py-2 rounded-xl bg-[#3D405B] text-white font-bold text-xs uppercase">Continuer</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export const SubtestRowCheck = FlexibleSubtestRow;
