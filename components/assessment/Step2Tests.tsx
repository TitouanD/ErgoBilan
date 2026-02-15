import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Observations, Patient, ScoreResult, TestData, UserProfile } from '../../types';
import { ICON_MAP, type SubtestDef, type TestDef } from '../../data/testCatalog';
import { ScoringEngine } from '../../services/scoringEngine';
import { calculateFromPercentile, calculateFromStandard, calculateFromZ, zScoreToPercentile } from '../../utils/scoring';
import { useCatalog } from '../../contexts/CatalogContext';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
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
  updateTests: (data: Partial<TestData>) => void;
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
  return (
    <button
      type="button"
      disabled={!hasValue(result)}
      onClick={() => {
        if (isReviewed) {
          onChange({ reviewState: 'not_reviewed', reviewedAt: undefined, status: hasValue(result) ? 'estimated' : 'empty' });
          return;
        }
        onChange({ reviewState: 'reviewed', reviewedAt: new Date().toISOString(), status: hasValue(result) ? 'validated' : 'empty', certifiedAt: undefined });
      }}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${
        isReviewed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-50 text-stone-500 border-stone-200 hover:border-[#E07A5F] hover:text-[#E07A5F]'
      } ${!hasValue(result) ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {isReviewed ? <CircleCheck size={12} /> : <Circle size={12} />}
      {isReviewed ? 'Revu' : 'Marquer revu'}
    </button>
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

  const onActiveInput = async (text: string) => {
    if (readOnly) return;
    const n = parseNum(text);
    if (active === 'raw') {
      setPatch({ raw: text });
      if (n !== null) await computeRaw(text, n);
      return;
    }
    if (active === 'standard') {
      if (n === null) {
        setPatch({ standard: text, derived: { source: 'manual' }, scoreSource: 'manual_ns' });
        return;
      }
      const c = calculateFromStandard(n, subtest.scoreType || 'standard');
      setWarn(null);
      setPatch({ standard: text, percentile: c.percentile, zScore: c.zScore, derived: { standard: text, percentile: c.percentile, zScore: c.zScore, source: 'assisted' }, scoreSource: 'manual_ns' });
      return;
    }
    if (active === 'z') {
      if (n === null) {
        setPatch({ zScore: undefined, derived: { source: 'manual' }, scoreSource: 'manual_et' });
        return;
      }
      const c = calculateFromZ(n, subtest.scoreType || 'standard');
      setWarn(null);
      setPatch({ zScore: n, standard: c.standard, percentile: c.percentile, derived: { standard: c.standard, percentile: c.percentile, zScore: n, source: 'assisted' }, scoreSource: 'manual_et' });
      return;
    }
    if (n === null) {
      setPatch({ percentile: text, derived: { source: 'manual' }, scoreSource: 'manual_ns' });
      return;
    }
    const c = calculateFromPercentile(n, subtest.scoreType || 'standard');
    setWarn(null);
    setPatch({ percentile: text, standard: c.standard, zScore: c.zScore, derived: { standard: c.standard, percentile: text, zScore: c.zScore, source: 'assisted' }, scoreSource: 'manual_ns' });
  };

  const activeValue = active === 'raw' ? result.raw : active === 'standard' ? result.standard : active === 'z' ? (typeof result.zScore === 'number' ? String(result.zScore) : '') : result.percentile;
  const hasZ = typeof result.zScore === 'number' && Number.isFinite(result.zScore);
  const zText = hasZ ? `${result.zScore! > 0 ? '+' : ''}${result.zScore}` : '-';
  const pText = result.percentile ? `P${result.percentile}` : hasZ ? `P${Math.round(zScoreToPercentile(result.zScore!))}` : '-';

  return (
    <div className="border-b border-stone-100 last:border-0 bg-white">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-stone-300"><GripVertical size={16} /></div>
            <div className="min-w-0">
              <h4 className="font-bold text-[#3D405B] text-sm leading-tight truncate">{subtest.name}</h4>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{subtest.unit}</p>
            </div>
          </div>
          <ReviewButton result={result} onChange={onChange} />
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {METRIC_OPTIONS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setPatch({ entryMetric: m.key })}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${
                active === m.key ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'bg-white text-stone-500 border-stone-200 hover:border-[#E07A5F] hover:text-[#E07A5F]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="bg-stone-50/70 border border-stone-100 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Saisie active: {METRIC_OPTIONS.find((m) => m.key === active)?.label || 'Brut'}</span>
            {isComputing && <Loader2 size={12} className="animate-spin text-[#E07A5F]" />}
          </div>
          <input
            value={activeValue}
            onChange={(e) => {
              void onActiveInput(e.target.value);
            }}
            onFocus={onFocus}
            className="w-full p-2.5 text-center bg-white border border-stone-200 rounded-lg font-bold text-[#3D405B] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none text-sm"
          />
          <div className="grid grid-cols-4 gap-2 mt-3 text-[11px]">
            <div className="bg-white rounded-lg border border-stone-100 px-2 py-1.5 text-center"><p className="text-[9px] uppercase text-stone-400 font-bold">Brut</p><p className="font-bold text-[#3D405B]">{result.raw || '-'}</p></div>
            <div className="bg-white rounded-lg border border-stone-100 px-2 py-1.5 text-center"><p className="text-[9px] uppercase text-stone-400 font-bold">NS</p><p className="font-bold text-[#3D405B]">{result.standard || '-'}</p></div>
            <div className="bg-white rounded-lg border border-stone-100 px-2 py-1.5 text-center"><p className="text-[9px] uppercase text-stone-400 font-bold">ET</p><p className="font-bold text-[#3D405B]">{zText}</p></div>
            <div className="bg-white rounded-lg border border-stone-100 px-2 py-1.5 text-center"><p className="text-[9px] uppercase text-stone-400 font-bold">%</p><p className="font-bold text-[#3D405B]">{pText}</p></div>
          </div>
        </div>

        {warn && <div className="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">{warn}</div>}

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
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-stone-300"><GripVertical size={16} /></div>
            <div className="min-w-0">
              <h4 className="font-bold text-[#3D405B] text-sm leading-tight truncate">{subtest.name}</h4>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Categorie normative</p>
            </div>
          </div>
          <ReviewButton result={result} onChange={onChange} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {options.map((o) => {
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
                className={`text-left px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${active ? 'border-[#3D405B] bg-[#3D405B] text-white' : 'border-stone-200 bg-white text-stone-600 hover:border-[#E07A5F] hover:text-[#E07A5F]'} ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {o.label}
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
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-stone-300"><GripVertical size={16} /></div>
            <div className="min-w-0">
              <h4 className="font-bold text-[#3D405B] text-sm leading-tight truncate">{subtest.name}</h4>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Saisie brute</p>
            </div>
          </div>
          <ReviewButton result={result} onChange={onChange} />
        </div>

        <input value={result.raw} onChange={(e) => setPatch({ raw: e.target.value })} onFocus={onFocus} disabled={readOnly} className="w-full p-2.5 text-center bg-white border border-stone-200 rounded-lg font-bold text-[#3D405B] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none text-sm" />
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
  const summary = useMemo(() => {
    let total = 0;
    let reviewedCount = 0;
    Object.values(tests).forEach((subtests) => {
      Object.values(subtests).forEach((res) => {
        if (!hasValue(res)) return;
        total += 1;
        if (reviewed(res)) reviewedCount += 1;
      });
    });
    return { total, reviewedCount, pending: Math.max(0, total - reviewedCount) };
  }, [tests]);

  return (
    <div className="sticky top-24 bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-4">
      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider">Progression revue</h4>
      <div className="flex justify-between text-sm font-bold text-[#3D405B]"><span>Revus</span><span>{summary.reviewedCount}/{summary.total}</span></div>
      <div className="h-2 bg-stone-100 rounded-full overflow-hidden"><div className="h-full bg-[#81B29A]" style={{ width: `${summary.total > 0 ? (summary.reviewedCount / summary.total) * 100 : 0}%` }} /></div>
      {summary.pending > 0 ? <p className="text-xs text-amber-600">{summary.pending} element(s) non revus.</p> : <p className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> Tout est revu.</p>}
    </div>
  );
};

export const TestCatalogModal: React.FC<{ isOpen: boolean; onClose: () => void; existingTests: TestData; onAddTests: (selection: Record<string, string[]>) => void; onContribute?: () => void; initialExpandedTestId?: string | null }> = ({ isOpen, onClose, existingTests, onAddTests, onContribute, initialExpandedTestId }) => {
  const { catalog, searchTests, ensureCatalogLoaded, loading } = useCatalog();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    ensureCatalogLoaded();
    setExpandedTestId(initialExpandedTestId || null);
  }, [isOpen, ensureCatalogLoaded, initialExpandedTestId]);

  if (!isOpen) return null;

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
  const testsToRender = searchTerm ? searchTests(searchTerm) : catalog.flatMap((c) => c.tests);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-5xl h-[85vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col relative">
        <div className="p-6 border-b border-stone-100 bg-stone-50 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="font-serif font-bold text-2xl text-[#3D405B] flex items-center gap-3"><Layers size={24} className="text-[#E07A5F]" /> Catalogue</h2>
            <button onClick={onClose} className="p-2 hover:bg-stone-200 rounded-full transition-colors text-stone-400"><X size={20} /></button>
          </div>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Rechercher un test..." className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E07A5F]/20 font-medium text-[#3D405B]" autoFocus />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[var(--app-bg)]">
          {loading && testsToRender.length === 0 && <p className="text-sm text-stone-400">Chargement...</p>}
          {testsToRender.map((test) => {
            const isExpanded = expandedTestId === test.id;
            const selectedCount = (selected[test.id] || []).length;
            return (
              <div key={test.id} className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
                <button type="button" onClick={() => setExpandedTestId((prev) => (prev === test.id ? null : test.id))} className="w-full px-4 py-3 flex justify-between items-center hover:bg-stone-50 text-left">
                  <span className="font-semibold text-[#3D405B]">{test.name}</span>
                  <span className="text-xs text-stone-500 flex items-center gap-2">{selectedCount > 0 && <span className="px-2 py-0.5 rounded-full bg-[#E07A5F] text-white font-bold">{selectedCount}</span>}{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-stone-100 pt-3">
                    {test.subtests.map((st) => {
                      const already = existingTests[test.id]?.[st.id] !== undefined;
                      const checked = already || (selected[test.id] || []).includes(st.id);
                      return (
                        <label key={st.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${already ? 'bg-stone-50 border-stone-100 text-stone-400' : 'bg-white border-stone-200 text-stone-600 hover:border-[#E07A5F]'}`}>
                          <input type="checkbox" checked={checked} disabled={already} onChange={() => toggleSubtest(test.id, st.id)} className="accent-[#E07A5F]" />
                          <span className="text-sm truncate">{st.name}</span>
                          {already && <span className="ml-auto text-[10px] uppercase font-bold">ajoute</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="bg-white border border-stone-200 p-4 rounded-2xl flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-[#3D405B] flex items-center gap-2"><FilePlus size={16} /> Test manquant ?</h3>
              <p className="text-xs text-stone-500">Ajoutez-le via le studio contribution.</p>
            </div>
            {onContribute && <button onClick={() => { onClose(); onContribute(); }} className="px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-[#3D405B] hover:border-[#3D405B]">Contribuer</button>}
          </div>
        </div>

        <div className="p-4 border-t border-stone-100 bg-white flex justify-between items-center">
          <span className="text-xs text-stone-400">{totalSelected} epreuve(s) selectionnee(s)</span>
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-[32px] shadow-sm border border-stone-100 mb-8">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#3D405B] flex items-center gap-3"><Activity size={24} className="text-[#E07A5F]" /> Tests & mesures</h2>
          <p className="text-stone-500 text-sm font-medium mt-1">Saisie hybride assistee, calcul auto si normes disponibles, revue praticien non bloquante.</p>
        </div>
        <div className="flex items-center gap-3">
          {stat.total > 0 && <div className={`px-4 py-2 rounded-xl text-xs font-bold border ${stat.pending === 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>{stat.rev}/{stat.total} revus</div>}
          <button onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }} className="flex items-center gap-2 bg-[#3D405B] text-white px-6 py-3 rounded-2xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all text-sm"><Plus size={18} /> Ajouter</button>
        </div>
      </div>

      <div className="flex gap-8">
        <div className="flex-1 min-w-0 space-y-10">
          {Object.keys(tests).length === 0 && <div className="p-16 rounded-3xl border-2 border-dashed border-stone-200 text-center text-stone-400">Aucun test selectionne.</div>}

          {(Object.entries(grouped) as [string, TestDef[]][]).map(([catId, defs]) => {
            const cat = catalog.find((c) => c.id === catId);
            const CatIcon = ICON_MAP[cat?.iconKey || 'Box'];
            return (
              <section key={catId}>
                <div className="flex items-center gap-3 mb-4"><CatIcon size={18} className="text-stone-500" /><h3 className="font-bold text-stone-600 uppercase text-sm tracking-wide">{cat?.name || 'Divers'}</h3></div>
                {defs.map((test) => {
                  const collapsed = collapsedTests[test.id];
                  const editing = editMode[test.id];
                  const selectedIds = Object.keys(tests[test.id] || {});
                  const visibleSubtests = test.subtests.filter((st) => selectedIds.includes(st.id));
                  return (
                    <div key={test.id} className="bg-white rounded-2xl border border-stone-200 mb-6 overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between bg-stone-50 border-b border-stone-100">
                        <div className="flex items-center gap-3 min-w-0"><button onClick={() => setCollapsedTests((p) => ({ ...p, [test.id]: !p[test.id] }))} className="text-stone-400">{collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button><h4 className="font-bold text-[#3D405B] truncate">{test.name}</h4></div>
                        <div className="flex items-center gap-2"><button onClick={() => setEditMode((p) => ({ ...p, [test.id]: !p[test.id] }))} className={`p-2 rounded-lg ${editing ? 'bg-[#E07A5F] text-white' : 'text-stone-400 hover:text-[#E07A5F]'}`}><PenTool size={14} /></button><button onClick={() => removeTest(test.id)} className="p-2 text-stone-400 hover:text-rose-500"><Trash2 size={14} /></button></div>
                      </div>
                      {!collapsed && (
                        <div>
                          {visibleSubtests.length === 0 && <div className="p-6 text-center text-sm text-stone-400">Aucune epreuve selectionnee.</div>}
                          {visibleSubtests.map((st) => {
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

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-stone-100 flex justify-center z-50">
        <div className="max-w-4xl w-full flex justify-between items-center">
          <button onClick={onBack} className="text-stone-400 hover:text-[#3D405B] font-bold text-sm uppercase tracking-widest px-4 transition-colors">Retour</button>
          <button onClick={() => (stat.pending > 0 ? setShowWarning(true) : onNext())} className="flex items-center gap-3 px-8 py-4 bg-[#E07A5F] text-white rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] transition-all"><span>Passer au diagnostic</span><ArrowRight size={20} /></button>
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
