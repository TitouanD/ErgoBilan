
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { TestData, ScoreResult, UserProfile, Patient, Observations } from '../../types';
import { ICON_MAP, type SubtestDef, type TestDef } from '../../data/testCatalog';
import { calculateFromStandard, calculateFromZ, calculateFromPercentile, zScoreToPercentile } from '../../utils/scoring';
import { ScoringEngine } from '../../services/scoringEngine';
import { Plus, Trash2, ArrowRight, MessageSquare, X, Check, Layers, Search, FilePlus, Loader2, Activity, Brain, GripVertical, CheckCircle2, Shield, ShieldCheck, AlertTriangle, ChevronDown, ChevronUp, Mic, MicOff, Edit2, Zap, BarChart3, PenTool } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';

interface Props {
    patient: Patient;
    tests: TestData;
    updateTests: (data: Partial<TestData>) => void;
    observations: Observations;
    updateObservations: (data: Partial<Observations>) => void;
    onNext: () => void;
    onBack: () => void;
    userProfile?: UserProfile;
    onAcceptResponsibility?: () => void;
    onContribute?: () => void;
}

// --- ARC GAUGE (visual % display) ---
const ArcGauge: React.FC<{ zScore: number; percentile: string }> = ({ zScore, percentile }) => {
    const clamped = Math.max(-3.5, Math.min(3.5, zScore));
    // Map z-score from [-3.5, 3.5] to angle [0, 180]
    const angle = ((clamped + 3.5) / 7) * 180;
    const pNum = parseFloat(percentile) || 0;

    let color = '#81B29A'; // green (sauge)
    let bgLight = '#f0fdf4';
    if (zScore <= -2) { color = '#E07A5F'; bgLight = '#fff1f2'; } // red (terracotta)
    else if (zScore <= -1) { color = '#F2CC8F'; bgLight = '#fffbeb'; } // amber (ocre)

    const r = 28;
    const cx = 36;
    const cy = 36;
    // Start at 180deg (left), end at 0deg (right)
    const startAngle = Math.PI;
    const endAngle = Math.PI - (angle * Math.PI / 180);
    const x = cx + r * Math.cos(endAngle);
    const y = cy - r * Math.sin(endAngle);
    const largeArc = angle > 180 ? 1 : 0;

    return (
        <div className="flex flex-col items-center gap-0.5">
            <svg width="72" height="42" viewBox="0 0 72 42">
                {/* Background arc */}
                <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#e7e5e4" strokeWidth="5" strokeLinecap="round" />
                {/* Zone markers */}
                <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(Math.PI - (0.214 * Math.PI))} ${cy - r * Math.sin(Math.PI - (0.214 * Math.PI))}`} fill="none" stroke="#E07A5F" strokeWidth="5" strokeLinecap="round" opacity="0.3" />
                <path d={`M ${cx + r * Math.cos(Math.PI - (0.214 * Math.PI))} ${cy - r * Math.sin(Math.PI - (0.214 * Math.PI))} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(Math.PI - (0.357 * Math.PI))} ${cy - r * Math.sin(Math.PI - (0.357 * Math.PI))}`} fill="none" stroke="#F2CC8F" strokeWidth="5" opacity="0.3" />
                {/* Indicator dot */}
                <circle cx={x} cy={y} r="5" fill={color} stroke="white" strokeWidth="2">
                    <animate attributeName="r" from="3" to="5" dur="0.4s" fill="freeze" />
                </circle>
            </svg>
            <span className="text-[10px] font-bold" style={{ color }}>{pNum > 0 ? `P${Math.round(pNum)}` : '-'}</span>
        </div>
    );
};

// --- COMPACT GAUGE (kept for inline use) ---
const CompactGauge: React.FC<{ zScore: number }> = ({ zScore }) => {
    const clamped = Math.max(-3.5, Math.min(3.5, zScore));
    const percent = ((clamped + 3.5) / 7) * 100;

    return (
        <div className="h-1.5 w-full bg-stone-200 rounded-full relative overflow-hidden mt-3 mb-1">
            <div className="absolute inset-y-0 left-0 w-[21.4%] bg-rose-300 opacity-50"></div>
            <div className="absolute inset-y-0 left-[21.4%] w-[14.3%] bg-amber-300 opacity-50"></div>
            <div className="absolute inset-y-0 left-[35.7%] right-0 bg-emerald-300 opacity-50"></div>
            <div className="absolute top-0 bottom-0 w-px bg-white/80 left-[21.4%]"></div>
            <div className="absolute top-0 bottom-0 w-px bg-white/80 left-[35.7%]"></div>
            <div className="absolute top-0 bottom-0 w-px bg-white/80 left-[50%]"></div>
            <div className="absolute top-0 bottom-0 w-2 h-2 -mt-[1px] bg-[#3D405B] rounded-full shadow-sm transition-all duration-700 ease-out transform -translate-x-1/2 ring-2 ring-white" style={{ left: `${percent}%` }}></div>
        </div>
    );
};

// --- VOICE OBSERVATION INPUT ---
const VoiceObservation: React.FC<{
    value: string;
    onChange: (val: string) => void;
    readOnly?: boolean;
    onFocus?: () => void;
}> = ({ value, onChange, readOnly, onFocus }) => {
    const handleTranscript = useCallback((text: string) => {
        onChange(value ? `${value} ${text}` : text);
    }, [value, onChange]);

    const { isListening, isSupported, interimText, toggleListening } = useVoiceDictation({
        onTranscript: handleTranscript,
    });

    return (
        <div className="relative mt-3">
            <textarea
                value={value}
                onChange={(e) => !readOnly && onChange(e.target.value)}
                onFocus={onFocus}
                placeholder="Observation clinique rapide…"
                className="w-full p-3 pl-9 pr-10 bg-stone-50 border border-stone-100 rounded-xl text-xs text-[#3D405B] focus:border-[#E07A5F] focus:bg-white outline-none resize-none transition-all placeholder:text-stone-300"
                rows={2}
            />
            <MessageSquare size={14} className="absolute top-3 left-3 text-stone-300" />
            {isSupported && !readOnly && (
                <button
                    type="button"
                    onClick={toggleListening}
                    className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg transition-all ${isListening
                        ? 'bg-red-100 text-red-500 animate-pulse'
                        : 'text-stone-300 hover:text-[#E07A5F] hover:bg-stone-100'
                        }`}
                    title="Dictée vocale"
                >
                    {isListening ? <MicOff size={12} /> : <Mic size={12} />}
                </button>
            )}
            {isListening && interimText && (
                <div className="mt-1 px-2 py-1 bg-red-50 border border-red-100 rounded text-[10px] text-red-500 italic">
                    🎙️ {interimText}...
                </div>
            )}
        </div>
    );
};

// --- LIGNE SOUS-TEST (REFACTORED) ---
const CompactSubtestRow = React.memo(({
    testId, patient, subtest, result, onChange, readOnly = false, onFocus
}: {
    testId: string; patient: Patient; subtest: SubtestDef; result: ScoreResult;
    onChange: (res: Partial<ScoreResult>) => void; readOnly?: boolean; onFocus?: () => void;
    isExpanded?: boolean; onToggleExpand?: () => void;
}) => {

    const [isComputing, setIsComputing] = useState(false);
    const [showCertify, setShowCertify] = useState(false);

    const isScoreable = subtest.scoreType !== 'none';
    const standardLabelMap: Record<string, string> = {
        'standard': 'NS',
        'scaled': 'NS',
        't-score': 'T',
        'percentile': 'Pctl',
        'sten': 'Sten',
        'none': 'Brut'
    };
    const standardLabel = standardLabelMap[subtest.scoreType] || 'NS';

    const handleRawInput = async (val: string) => {
        if (readOnly) return;
        const num = parseFloat(val.replace(',', '.'));
        if (!isScoreable) {
            onChange({ raw: val, status: val ? 'estimated' : 'empty' });
            return;
        }
        onChange({ raw: val, status: 'estimated', scoreSource: 'auto' });
        if (isNaN(num)) return;

        setIsComputing(true);
        try {
            let ageInMonths = 96;
            if (patient.dob) {
                const dob = new Date(patient.dob);
                const now = new Date();
                ageInMonths = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
                if (ageInMonths < 1) ageInMonths = 96;
            }
            const dbSubtestId = `${testId}_${subtest.id}`;
            const computed = await ScoringEngine.compute(
                subtest.id.includes('_') ? subtest.id : dbSubtestId,
                num, ageInMonths, patient.gender === 'F' ? 'F' : 'M', patient.classLevel
            );

            if (computed) {
                onChange({
                    raw: val,
                    standard: computed.standard,
                    percentile: computed.percentile,
                    zScore: computed.zScore,
                    status: 'estimated',
                    scoreSource: 'auto'
                });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsComputing(false);
        }
    };

    const handleStandardChange = (val: string) => {
        if (!isScoreable) return;
        const num = parseFloat(val.replace(',', '.'));
        if (isNaN(num)) { onChange({ standard: val, status: 'estimated', scoreSource: 'manual_ns' }); return; }
        const calculated = calculateFromStandard(num, subtest.scoreType);
        onChange({ ...calculated, standard: val, raw: result.raw, status: 'estimated', scoreSource: 'manual_ns' });
    };

    const handleZScoreChange = (val: string) => {
        if (!isScoreable) return;
        const num = parseFloat(val.replace(',', '.'));
        if (isNaN(num)) { onChange({ status: 'estimated', scoreSource: 'manual_et' }); return; }
        const calculated = calculateFromZ(num, subtest.scoreType);
        onChange({ ...calculated, zScore: num, raw: result.raw, status: 'estimated', scoreSource: 'manual_et' });
    };

    const handleCertify = () => {
        onChange({
            status: 'certified',
            certifiedAt: new Date().toISOString(),
            validatedAt: new Date().toISOString(),
        });
        setShowCertify(false);
    };

    const handleDecertify = () => {
        onChange({ status: 'estimated', certifiedAt: undefined, validatedAt: undefined });
    };

    const isCertified = result.status === 'certified';
    const isValidated = result.status === 'validated' || isCertified;
    const isManual = result.scoreSource === 'manual_ns' || result.scoreSource === 'manual_et';

    let zColor = "text-stone-400";
    if (result.raw && isScoreable) {
        if (result.zScore <= -2) zColor = "text-[#E07A5F]";
        else if (result.zScore <= -1) zColor = "text-[#F2CC8F]";
        else zColor = "text-[#81B29A]";
    }

    return (
        <div className={`border-b border-stone-100 last:border-0 transition-colors ${isCertified ? 'bg-emerald-50/20' : 'bg-white'}`}>
            <div className="flex flex-col md:flex-row">
                <div className="flex-1 p-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="text-stone-300"><GripVertical size={16} /></div>
                            <div>
                                <h4 className="font-bold text-[#3D405B] text-sm leading-tight">{subtest.name}</h4>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{subtest.unit}</span>
                                    {isManual && (
                                        <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                            <Edit2 size={8} /> Corrigé
                                        </span>
                                    )}
                                    {result.scoreSource === 'auto' && result.raw && (
                                        <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                            <Zap size={8} /> Auto
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        {/* Arc gauge for visual percentile */}
                        {result.raw && isScoreable && <ArcGauge zScore={result.zScore || 0} percentile={result.percentile} />}
                    </div>

                    {/* SCORE GRID: Brut | NS | ET | % */}
                    {isScoreable ? (
                        <div className="grid grid-cols-4 gap-3 items-center bg-stone-50/50 p-2.5 rounded-xl border border-stone-100">
                            <div className="flex flex-col gap-1">
                                <label className="text-[9px] font-bold text-stone-400 uppercase text-center">Brut</label>
                                <div className="relative">
                                    <input value={result.raw} onChange={(e) => handleRawInput(e.target.value)} onFocus={onFocus} className="w-full p-2 text-center bg-white border border-stone-200 rounded-lg font-bold text-[#3D405B] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none text-sm" />
                                    {isComputing && <Loader2 size={12} className="absolute right-1 top-2.5 animate-spin text-[#E07A5F]" />}
                                </div>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[9px] font-bold text-stone-400 uppercase text-center">{standardLabel}</label>
                                <input value={result.standard} onChange={(e) => handleStandardChange(e.target.value)} onFocus={onFocus} className={`w-full p-2 text-center border-b border-stone-200 rounded-none text-sm font-bold focus:bg-white focus:border-[#E07A5F] outline-none ${result.scoreSource === 'manual_ns' ? 'bg-blue-50/50 text-blue-700' : 'bg-transparent text-stone-600'}`} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[9px] font-bold text-stone-400 uppercase text-center">ET</label>
                                <input
                                    value={result.zScore ? (result.zScore > 0 ? '+' : '') + result.zScore : ''}
                                    onChange={(e) => handleZScoreChange(e.target.value)}
                                    onFocus={onFocus}
                                    className={`w-full p-2 text-center border-b border-stone-200 rounded-none text-sm font-bold outline-none focus:bg-white focus:border-[#E07A5F] ${result.scoreSource === 'manual_et' ? 'bg-blue-50/50 text-blue-700' : `bg-transparent ${zColor}`}`}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[9px] font-bold text-stone-400 uppercase text-center">%</label>
                                <div className={`w-full p-2 text-center text-sm font-bold bg-transparent border-b border-stone-200 ${zColor}`}>
                                    {result.percentile ? `P${result.percentile}` : '-'}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-stone-50/50 p-2.5 rounded-xl border border-stone-100">
                            <label className="text-[9px] font-bold text-stone-400 uppercase">Brut</label>
                            <div className="relative mt-1">
                                <input value={result.raw} onChange={(e) => handleRawInput(e.target.value)} onFocus={onFocus} className="w-full p-2 text-center bg-white border border-stone-200 rounded-lg font-bold text-[#3D405B] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none text-sm" />
                            </div>
                        </div>
                    )}

                    {/* Compact gauge line */}
                    <div className="mt-2 px-1">
                        {result.raw && isScoreable && <CompactGauge zScore={result.zScore || 0} />}
                    </div>

                    {/* Observation with voice */}
                    <VoiceObservation
                        value={result.observation || ''}
                        onChange={(val) => !readOnly && onChange({ observation: val })}
                        readOnly={readOnly}
                        onFocus={onFocus}
                    />

                    {/* Inline certification confirmation */}
                    {showCertify && !isCertified && result.raw && (
                        <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3 animate-in slide-in-from-top-2 duration-200">
                            <div className="flex items-center gap-2 mb-2">
                                <ShieldCheck size={14} className="text-emerald-600" />
                                <span className="text-xs font-bold text-emerald-700">Confirmer les valeurs</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-emerald-600 mb-3">
                                <span>Brut: <strong>{result.raw}</strong></span>
                                <span>→ NS: <strong>{result.standard || '-'}</strong></span>
                                <span>→ ET: <strong>{result.zScore || '-'}</strong></span>
                                <span>→ P{result.percentile || '-'}</span>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleCertify} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors flex items-center gap-1">
                                    <ShieldCheck size={12} /> Je certifie
                                </button>
                                <button onClick={() => setShowCertify(false)} className="px-3 py-1.5 text-stone-400 text-xs font-bold hover:text-stone-600 transition-colors">
                                    Annuler
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* RIGHT ACTION COLUMN */}
                <div className="w-full md:w-20 flex md:border-l border-stone-100">
                    <button
                        onClick={() => {
                            if (isCertified) handleDecertify();
                            else if (result.raw && !showCertify) setShowCertify(true);
                            else if (showCertify) handleCertify();
                        }}
                        disabled={!result.raw}
                        className={`w-full h-full flex flex-col items-center justify-center gap-1 transition-all duration-300 p-2 md:p-0 min-h-[60px] md:min-h-auto ${isCertified ? 'bg-emerald-500 text-white' :
                            !result.raw ? 'bg-stone-50 text-stone-300 cursor-not-allowed' :
                                'bg-white hover:bg-stone-50 text-[#3D405B] group'
                            }`}
                    >
                        {isCertified ? (
                            <>
                                <div className="p-1 bg-white/20 rounded-full animate-in zoom-in duration-300"><ShieldCheck size={24} strokeWidth={2.5} /></div>
                                <span className="text-[9px] font-bold uppercase tracking-wider hidden md:block">Certifié</span>
                            </>
                        ) : (
                            <>
                                <div className={`p-2 rounded-full border-2 border-current transition-transform ${result.raw ? 'group-hover:scale-110 text-[#3D405B] border-[#3D405B]' : 'border-stone-200'}`}>
                                    <Shield size={18} strokeWidth={2.5} />
                                </div>
                                <span className={`text-[9px] font-bold uppercase tracking-wider hidden md:block ${result.raw ? 'text-[#3D405B]' : 'text-stone-300'}`}>Certifier</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});

// --- SUMMARY PANEL ---
const SummaryPanel: React.FC<{ tests: TestData }> = ({ tests }) => {
    const { catalog } = useCatalog();

    const stats = useMemo(() => {
        let total = 0;
        let certified = 0;
        const alerts: { name: string; z: number }[] = [];
        const categoryScores: Record<string, { scores: number[]; name: string }> = {};

        // Build a flat lookup: subtestId → subtestName, testId → testName
        const testNameMap: Record<string, string> = {};
        const subtestNameMap: Record<string, string> = {};
        catalog.forEach(cat => {
            cat.tests.forEach(t => {
                testNameMap[t.id] = t.name;
                t.subtests.forEach(st => {
                    subtestNameMap[st.id] = st.name;
                });
            });
        });

        Object.entries(tests).forEach(([testId, subtests]) => {
            const testName = testNameMap[testId] || testId;
            Object.entries(subtests).forEach(([subId, res]) => {
                if (res.raw) {
                    total++;
                    if (res.status === 'certified' || res.status === 'validated') certified++;
                    if (res.zScore <= -2) alerts.push({ name: subtestNameMap[subId] || subId, z: res.zScore });

                    // Group by test for radar
                    if (!categoryScores[testId]) categoryScores[testId] = { scores: [], name: testName };
                    if (res.zScore !== undefined && res.zScore !== null) categoryScores[testId].scores.push(res.zScore);
                }
            });
        });

        return { total, certified, alerts, categoryScores };
    }, [tests, catalog]);

    if (stats.total === 0) return null;

    const progressPercent = stats.total > 0 ? (stats.certified / stats.total) * 100 : 0;

    return (
        <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4 sticky top-24">
            {/* Progress */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1">
                        <ShieldCheck size={12} /> Certification
                    </span>
                    <span className="text-sm font-bold text-[#3D405B]">{stats.certified}/{stats.total}</span>
                </div>
                <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                            width: `${progressPercent}%`,
                            background: progressPercent === 100 ? '#81B29A' : 'linear-gradient(90deg, #E07A5F, #F2CC8F)'
                        }}
                    />
                </div>
                {progressPercent === 100 && (
                    <div className="mt-2 text-[10px] text-emerald-600 font-bold flex items-center gap-1 animate-in fade-in">
                        <CheckCircle2 size={12} /> Tous les scores sont certifiés ✓
                    </div>
                )}
            </div>

            {/* Z-Score overview per test */}
            {Object.keys(stats.categoryScores).length > 0 && (
                <div>
                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1 mb-3">
                        <BarChart3 size={12} /> Résumé par test
                    </span>
                    <div className="space-y-2">
                        {Object.entries(stats.categoryScores).map(([testId, { scores, name }]: [string, { scores: number[]; name: string }]) => {
                            const avg = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
                            let color = '#81B29A';
                            if (avg <= -2) color = '#E07A5F';
                            else if (avg <= -1) color = '#F2CC8F';
                            const barWidth = Math.min(100, Math.max(5, ((avg + 3.5) / 7) * 100));

                            return (
                                <div key={testId}>
                                    <div className="flex justify-between text-[10px] mb-1">
                                        <span className="text-stone-500 font-medium truncate max-w-[120px]">{name}</span>
                                        <span className="font-bold" style={{ color }}>{avg > 0 ? '+' : ''}{avg.toFixed(1)} ET</span>
                                    </div>
                                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barWidth}%`, backgroundColor: color }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- CATALOG MODAL (REVISITED) ---
export const TestCatalogModal: React.FC<{
    isOpen: boolean; onClose: () => void; existingTests: TestData; onAddTests: (selection: Record<string, string[]>) => void; onContribute?: () => void;
    initialExpandedTestId?: string | null;
}> = ({ isOpen, onClose, existingTests, onAddTests, onContribute, initialExpandedTestId }) => {
    const { catalog, searchTests, loading, ensureCatalogLoaded } = useCatalog();
    // Map: testId -> array of selected subtestIds
    const [selectedSubtests, setSelectedSubtests] = useState<Record<string, string[]>>({});
    const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [localFilter, setLocalFilter] = useState('');

    useEffect(() => {
        if (isOpen) {
            ensureCatalogLoaded();
            if (initialExpandedTestId) {
                setExpandedTestId(initialExpandedTestId);
            }
        } else {
            setExpandedTestId(null);
            setSearchTerm('');
            setLocalFilter('');
        }
    }, [isOpen, ensureCatalogLoaded, initialExpandedTestId]);

    if (!isOpen) return null;

    const handleTestClick = (test: TestDef) => {
        if (expandedTestId === test.id) {
            setExpandedTestId(null);
        } else {
            setExpandedTestId(test.id);
            // Auto-select logic removed as per new flow
        }
    };

    const handleToggleSubtest = (testId: string, subtestId: string) => {
        setSelectedSubtests(prev => {
            const current = prev[testId] || [];
            if (current.includes(subtestId)) {
                const next = current.filter(id => id !== subtestId);
                if (next.length === 0) {
                    const { [testId]: _, ...rest } = prev;
                    return rest;
                }
                return { ...prev, [testId]: next };
            } else {
                return { ...prev, [testId]: [...current, subtestId] };
            }
        });
    };

    const handleToggleAll = (test: TestDef) => {
        setSelectedSubtests(prev => {
            const current = prev[test.id] || [];
            if (current.length === test.subtests.length) {
                const { [test.id]: _, ...rest } = prev;
                return rest;
            } else {
                return { ...prev, [test.id]: test.subtests.map(st => st.id) };
            }
        });
    };

    const totalSelected: number = (Object.values(selectedSubtests) as string[][]).reduce((sum, arr) => sum + arr.length, 0);
    const totalTests: number = Object.keys(selectedSubtests).filter(k => (selectedSubtests[k] || []).length > 0).length;

    const handleAdd = () => {
        onAddTests(selectedSubtests);
        setSelectedSubtests({});
        setExpandedTestId(null);
        onClose();
    };

    const searchResults = searchTerm ? searchTests(searchTerm) : [];

    const renderTestCard = (test: TestDef) => {
        const isAdded = !!existingTests[test.id];
        const isExpanded = expandedTestId === test.id;
        const selectedSubs = selectedSubtests[test.id] || [];
        const hasSelection = selectedSubs.length > 0;

        return (
            <div key={test.id} className={`rounded-2xl border transition-all overflow-hidden ${isAdded ? 'border-stone-100 bg-stone-50' : isExpanded ? 'border-[#E07A5F] bg-[#fff5f2] shadow-md col-span-1 md:col-span-2 lg:col-span-3' : hasSelection ? 'border-[#E07A5F]/50 bg-[#fff5f2]/50 shadow-sm' : 'border-stone-100 bg-white hover:border-[#E07A5F]/50 hover:shadow-sm'}`}>
                <div
                    onClick={() => handleTestClick(test)}
                    className="p-5 cursor-pointer flex justify-between items-center"
                >
                    <div className="flex items-center gap-3 min-w-0">
                        <span className={`font-bold text-sm ${hasSelection || isExpanded ? 'text-[#E07A5F]' : 'text-[#3D405B]'}`}>{test.name}</span>
                        <span className="text-[10px] font-bold text-stone-400 bg-stone-50 px-2 py-1 rounded flex-shrink-0">{test.subtests.length} épreuves</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {isAdded && <Check size={16} className="text-stone-400" />}
                        {hasSelection && !isAdded && <div className="w-6 h-6 bg-[#E07A5F] rounded-full flex items-center justify-center shadow-lg shadow-orange-200"><span className="text-white text-[10px] font-bold">{selectedSubs.length}</span></div>}
                        {!isAdded && <ChevronDown size={16} className={`text-stone-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                    </div>
                </div>

                {isExpanded && (
                    <div className="px-5 pb-5 border-t border-[#E07A5F]/20">
                        <div className="flex items-center justify-between mt-3 mb-3">
                            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Sélectionner les épreuves</span>
                            {!isAdded && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleToggleAll(test); }}
                                    className="text-[10px] font-bold text-[#E07A5F] hover:text-[#c5654a] transition-colors uppercase tracking-wider"
                                >
                                    {selectedSubs.length === test.subtests.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                                </button>
                            )}
                        </div>

                        {/* LOCAL SEARCH for large tests */}
                        {test.subtests.length > 10 && (
                            <div className="mb-3 relative">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                                <input
                                    type="text"
                                    placeholder="Filtrer les épreuves..."
                                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:border-[#E07A5F] outline-none"
                                    onClick={(e) => e.stopPropagation()}
                                    value={localFilter}
                                    onChange={(e) => setLocalFilter(e.target.value)}
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {test.subtests.filter(st => !localFilter || st.name.toLowerCase().includes(localFilter.toLowerCase())).map(st => {
                                const isChecked = selectedSubs.includes(st.id);
                                const isAlreadyIn = existingTests[test.id]?.[st.id] !== undefined;

                                return (
                                    <label
                                        key={st.id}
                                        className={`flex items-center gap-2.5 p-2.5 rounded-xl transition-all text-sm ${isAlreadyIn
                                            ? 'bg-stone-50 border border-stone-100 opacity-60 cursor-not-allowed'
                                            : isChecked
                                                ? 'bg-[#E07A5F]/10 border border-[#E07A5F]/30 cursor-pointer'
                                                : 'bg-white border border-stone-100 hover:border-stone-200 cursor-pointer'
                                            }`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (isAlreadyIn) return;
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isChecked || isAlreadyIn}
                                            disabled={isAlreadyIn}
                                            onChange={() => handleToggleSubtest(test.id, st.id)}
                                            className="w-4 h-4 rounded border-stone-300 text-[#E07A5F] focus:ring-[#E07A5F]/30 accent-[#E07A5F]"
                                        />
                                        <span className={`font-medium truncate ${isChecked || isAlreadyIn ? 'text-[#E07A5F]' : 'text-stone-600'}`}>{st.name}</span>
                                        {isAlreadyIn && <span className="text-[9px] text-stone-400 ml-auto font-bold uppercase">Ajouté</span>}
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-5xl h-[85vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col relative">

                {/* Header avec Search Bar intégrée */}
                <div className="p-6 border-b border-stone-100 bg-stone-50 flex flex-col gap-4 sticky top-0 z-20">
                    <div className="flex justify-between items-center">
                        <h2 className="font-serif font-bold text-2xl text-[#3D405B] flex items-center gap-3">
                            <Layers size={24} className="text-[#E07A5F]" /> Catalogue
                        </h2>
                        <button onClick={onClose} className="p-2 hover:bg-stone-200 rounded-full transition-colors text-stone-400"><X size={20} /></button>
                    </div>

                    <div className="relative">
                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                        <input
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setExpandedTestId(null); }}
                            placeholder="Rechercher un test (ex: MABC, NEPSY...)"
                            className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E07A5F]/20 font-medium text-[#3D405B] shadow-sm transition-all"
                            autoFocus
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar bg-[var(--app-bg)]">
                    {loading && catalog.length === 0 && (
                        <div className="flex items-center justify-center h-32 text-stone-400 text-sm font-bold uppercase tracking-wider">
                            Chargement du catalogue...
                        </div>
                    )}
                    {!loading && catalog.length === 0 && (
                        <div className="flex items-center justify-center h-32 text-stone-400 text-sm font-bold uppercase tracking-wider">
                            Catalogue indisponible.
                        </div>
                    )}

                    {searchTerm ? (
                        // VUE RECHERCHE
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {searchResults.map(test => renderTestCard(test))}
                            {searchResults.length === 0 && (
                                <p className="col-span-full text-center text-stone-400 py-10">Aucun test trouvé.</p>
                            )}
                        </div>
                    ) : (
                        // VUE CATÉGORIES
                        catalog.map(cat => {
                            const CatIcon = ICON_MAP[cat.iconKey] || ICON_MAP['Box'];
                            return (
                                <div key={cat.id} className="animate-in slide-in-from-bottom-2">
                                    <h3 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 text-stone-500">
                                        <div className="p-1 bg-stone-200 rounded text-stone-600"><CatIcon size={14} /></div>
                                        {cat.name}
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {cat.tests.map(test => renderTestCard(test))}
                                    </div>
                                </div>
                            );
                        })
                    )}

                    {/* Contribution Banner */}
                    <div className="bg-white border border-stone-200 p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 mt-8 shadow-sm">
                        <div>
                            <h3 className="font-bold text-[#3D405B] flex items-center gap-2"><FilePlus size={18} /> Test manquant ?</h3>
                            <p className="text-xs text-stone-500 mt-1">Numérisez vos propres tests pour les ajouter à votre catalogue personnel.</p>
                        </div>
                        {onContribute && (
                            <button onClick={() => { onClose(); onContribute(); }} className="bg-stone-50 text-[#3D405B] border border-stone-200 hover:border-[#3D405B] px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all whitespace-nowrap">
                                Numériser un test
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-6 border-t border-stone-100 bg-white flex justify-between items-center z-20">
                    <span className="text-xs text-stone-400 font-medium">
                        {totalSelected > 0 ? `${totalSelected} épreuve${totalSelected > 1 ? 's' : ''} dans ${totalTests} test${totalTests > 1 ? 's' : ''}` : 'Cliquez sur un test pour choisir les épreuves'}
                    </span>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-6 py-3 font-bold text-stone-400 hover:text-stone-600 transition-colors">Annuler</button>
                        <button
                            onClick={handleAdd}
                            disabled={totalSelected === 0}
                            className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-xl hover:bg-[#2c2e42] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            Ajouter {totalSelected > 0 ? `(${totalSelected})` : ''}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- COMPOSANT PRINCIPAL ---
export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, updateObservations, observations, onNext, onBack, userProfile, onAcceptResponsibility, onContribute }) => {
    const { catalog, ensureCatalogLoaded } = useCatalog();
    const [showCatalog, setShowCatalog] = useState(false);
    const [catalogTargetTestId, setCatalogTargetTestId] = useState<string | null>(null);
    const [collapsedTests, setCollapsedTests] = useState<Record<string, boolean>>({});
    // Removed old filters (subtestFilters, showFilledOnly)
    const [editMode, setEditMode] = useState<Record<string, boolean>>({});

    useEffect(() => {
        ensureCatalogLoaded();
    }, [ensureCatalogLoaded]);

    // Group tests by Category for Display
    const groupedActiveTests = useMemo(() => {
        const groups: Record<string, TestDef[]> = {};
        Object.keys(tests).forEach(testId => {
            const cat = catalog.find(c => c.tests.some(t => t.id === testId));
            if (cat) {
                if (!groups[cat.id]) groups[cat.id] = [];
                const testDef = cat.tests.find(t => t.id === testId);
                if (testDef) groups[cat.id].push(testDef);
            } else {
                if (!groups['autre']) groups['autre'] = [];
                groups['autre'].push({ id: testId, name: "Test inconnu", subtests: [] });
            }
        });
        return groups;
    }, [tests, catalog]);

    const addTests = useCallback((selection: Record<string, string[]>) => {
        const newTests = { ...tests };
        Object.entries(selection).forEach(([testId, subtestIds]) => {
            if (!newTests[testId]) {
                newTests[testId] = {};
            }
            subtestIds.forEach(stId => {
                if (!newTests[testId][stId]) {
                    newTests[testId][stId] = { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
                }
            });
        });
        updateTests(newTests);
    }, [tests, updateTests]);

    const removeTest = useCallback((testId: string) => {
        const newTests = { ...tests };
        delete newTests[testId];
        updateTests(newTests);
    }, [tests, updateTests]);

    const removeSubtest = useCallback((testId: string, subtestId: string) => {
        const newTests = { ...tests };
        if (newTests[testId]) {
            delete newTests[testId][subtestId];
            // If no subtests left, remove the test entirely? Maybe let user do it explicitly via Trash on card.
            // But usually empty test should be removed? Let's keep it for now so they can add.
            updateTests(newTests);
        }
    }, [tests, updateTests]);

    const handleSubtestChange = useCallback((testId: string, subtestId: string, result: Partial<ScoreResult>) => {
        const newTests = { ...tests };
        if (!newTests[testId]) newTests[testId] = {};
        const currentSub = newTests[testId][subtestId] || { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
        newTests[testId][subtestId] = { ...currentSub, ...result };
        updateTests(newTests);
    }, [tests, updateTests]);

    // Batch certify all filled scores
    const handleCertifyAll = useCallback(() => {
        const newTests = { ...tests };
        const now = new Date().toISOString();
        Object.keys(newTests).forEach(testId => {
            Object.keys(newTests[testId]).forEach(subId => {
                const res = newTests[testId][subId];
                if (res.raw && res.status !== 'certified') {
                    newTests[testId][subId] = { ...res, status: 'certified', certifiedAt: now, validatedAt: now };
                }
            });
        });
        updateTests(newTests);
    }, [tests, updateTests]);

    // Stats for the header badge
    const certStats = useMemo(() => {
        let total = 0, certified = 0;
        Object.values(tests).forEach(subtests => {
            Object.values(subtests).forEach(res => {
                if (res.raw) { total++; if (res.status === 'certified' || res.status === 'validated') certified++; }
            });
        });
        return { total, certified };
    }, [tests]);

    const activeTestsList = Object.keys(tests);

    return (
        <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-32">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-[32px] shadow-sm border border-stone-100 mb-8">
                <div>
                    <h2 className="text-2xl font-serif font-bold text-[#3D405B] flex items-center gap-3">
                        <Activity size={24} className="text-[#E07A5F]" /> Tests & Mesures
                    </h2>
                    <p className="text-stone-500 text-sm font-medium mt-1">
                        Saisie rapide · NS et ET éditables · % automatique · Certification par épreuve
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {certStats.total > 0 && (
                        <button
                            onClick={handleCertifyAll}
                            disabled={certStats.certified === certStats.total}
                            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all ${certStats.certified === certStats.total
                                ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                                : 'bg-emerald-600 text-white shadow-lg hover:bg-emerald-700'
                                }`}
                        >
                            <ShieldCheck size={18} />
                            {certStats.certified === certStats.total
                                ? `${certStats.certified}/${certStats.total} certifiés ✓`
                                : `Tout certifier (${certStats.total - certStats.certified})`
                            }
                        </button>
                    )}
                    <button onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }} className="flex items-center gap-2 bg-[#3D405B] text-white px-6 py-3 rounded-2xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all text-sm group">
                        <Plus size={18} className="group-hover:rotate-90 transition-transform" /> Ajouter
                    </button>
                </div>
            </div>

            {/* Two-column layout: Tests + Summary */}
            <div className="flex gap-8">
                {/* Main column */}
                <div className="flex-1 min-w-0 space-y-12">
                    {activeTestsList.length === 0 ? (
                        <div onClick={() => { setCatalogTargetTestId(null); setShowCatalog(true); }} className="group cursor-pointer border-3 border-dashed border-stone-200 bg-stone-50/50 rounded-[40px] p-20 text-center hover:border-[#E07A5F] hover:bg-[#fff5f2] transition-all duration-300">
                            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto text-stone-300 group-hover:text-[#E07A5F] group-hover:scale-110 transition-all mb-6 shadow-sm border border-stone-100">
                                <Layers size={40} />
                            </div>
                            <h3 className="text-2xl font-bold text-stone-600 mb-2">Aucun test sélectionné</h3>
                            <p className="text-stone-400 font-medium max-w-md mx-auto">Accédez au catalogue pour sélectionner vos outils d'évaluation.</p>
                        </div>
                    ) : (
                        (Object.entries(groupedActiveTests) as [string, TestDef[]][]).map(([catId, categoryTests]) => {
                            const catDef = catalog.find(c => c.id === catId);
                            const CatIcon = ICON_MAP[catDef?.iconKey || 'Box'];

                            return (
                                <div key={catId} className="animate-in slide-in-from-bottom-4 duration-700">
                                    <div className="flex items-center gap-3 mb-6 px-2">
                                        <div className="p-2 rounded-xl bg-white border border-stone-200 text-stone-600 shadow-sm">
                                            <CatIcon size={20} />
                                        </div>
                                        <h3 className="font-serif font-bold text-xl uppercase tracking-wide text-stone-600">
                                            {catDef?.name || "Tests Divers"}
                                        </h3>
                                        <div className="h-px bg-stone-200 flex-1 ml-4 opacity-50"></div>
                                    </div>

                                    <div>
                                        {categoryTests.map(testDef => {
                                            const isCollapsed = collapsedTests[testDef.id];
                                            const isEdit = editMode[testDef.id];

                                            // Get ONLY currently added subtests
                                            const addedSubtestIds = Object.keys(tests[testDef.id] || {});
                                            // Sort them by their order in definition to keep consistent layout
                                            const visibleSubtests = testDef.subtests.filter(st => addedSubtestIds.includes(st.id));

                                            const filled = Object.values(tests[testDef.id] || {}).filter((r: ScoreResult) => r.raw).length;
                                            const certifiedCount = Object.values(tests[testDef.id] || {}).filter((r: ScoreResult) => r.status === 'certified' || r.status === 'validated').length;

                                            return (
                                                <div key={testDef.id} className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden mb-8 transition-all hover:shadow-md">
                                                    <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                                                        <div className="flex items-center gap-3">
                                                            <button
                                                                onClick={() => setCollapsedTests(prev => ({ ...prev, [testDef.id]: !prev[testDef.id] }))}
                                                                className="text-stone-400 hover:text-[#3D405B] transition-colors"
                                                            >
                                                                {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                                                            </button>
                                                            <h3 className="font-bold text-lg text-[#3D405B]">{testDef.name}</h3>
                                                            <span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded-full text-stone-400 uppercase tracking-wide border border-stone-100">
                                                                {visibleSubtests.length} Épreuves
                                                            </span>
                                                            {filled > 0 && (
                                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${certifiedCount === visibleSubtests.length
                                                                    ? 'bg-emerald-100 text-emerald-700'
                                                                    : 'bg-amber-50 text-amber-600'
                                                                    }`}>
                                                                    {certifiedCount === visibleSubtests.length
                                                                        ? `✓ ${certifiedCount}/${visibleSubtests.length}`
                                                                        : `${filled}/${visibleSubtests.length} saisi`
                                                                    }
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {/* EDIT MODE TOGGLE */}
                                                            <button
                                                                onClick={() => setEditMode(prev => ({ ...prev, [testDef.id]: !prev[testDef.id] }))}
                                                                className={`p-2 rounded-lg transition-all ${isEdit
                                                                    ? 'bg-[#E07A5F] text-white shadow-lg shadow-orange-100'
                                                                    : 'text-stone-400 hover:text-[#E07A5F] hover:bg-white'}
                                                                `}
                                                                title={isEdit ? "Terminer l'édition" : "Modifier la liste des épreuves"}
                                                            >
                                                                <PenTool size={16} />
                                                            </button>

                                                            <button onClick={() => removeTest(testDef.id)} className="text-stone-400 hover:text-rose-500 p-2 hover:bg-white/50 rounded-lg transition-all">
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {!isCollapsed && (
                                                        <div className="bg-white">
                                                            {visibleSubtests.length === 0 ? (
                                                                <div className="p-8 flex flex-col items-center justify-center gap-3">
                                                                    <p className="text-sm text-stone-400 font-medium">Aucune épreuve sélectionnée.</p>
                                                                    <button
                                                                        onClick={() => { setCatalogTargetTestId(testDef.id); setShowCatalog(true); }}
                                                                        className="text-xs font-bold text-[#E07A5F] hover:underline"
                                                                    >
                                                                        Ouvrir le catalogue pour ajouter
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                visibleSubtests.map(st => {
                                                                    const res = tests[testDef.id]?.[st.id] || { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
                                                                    return (
                                                                        <div key={st.id} className="group relative">
                                                                            <CompactSubtestRow
                                                                                testId={testDef.id}
                                                                                patient={patient}
                                                                                subtest={st}
                                                                                result={res}
                                                                                onChange={(val) => handleSubtestChange(testDef.id, st.id, val)}
                                                                            />
                                                                            {/* DELETE BUTTON IN EDIT MODE */}
                                                                            {isEdit && (
                                                                                <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white via-white to-transparent flex items-center justify-center opacity-100 transition-opacity">
                                                                                    <button
                                                                                        onClick={() => removeSubtest(testDef.id, st.id)}
                                                                                        className="p-2 bg-rose-50 text-rose-500 rounded-lg hover:bg-rose-100 hover:scale-110 transition-all shadow-sm"
                                                                                        title="Retirer cette épreuve"
                                                                                    >
                                                                                        <Trash2 size={16} />
                                                                                    </button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })
                                                            )}

                                                            {/* ADD BUTTON IN EDIT MODE */}
                                                            {isEdit && (
                                                                <div className="p-4 border-t border-stone-100 bg-stone-50/30 flex justify-center">
                                                                    <button
                                                                        onClick={() => { setCatalogTargetTestId(testDef.id); setShowCatalog(true); }}
                                                                        className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold text-[#3D405B] shadow-sm hover:border-[#E07A5F] hover:text-[#E07A5F] transition-all"
                                                                    >
                                                                        <Plus size={14} /> Ajouter une épreuve au test
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Sidebar Summary Panel */}
                {
                    activeTestsList.length > 0 && (
                        <div className="hidden lg:block w-72 shrink-0">
                            <SummaryPanel tests={tests} />
                        </div>
                    )
                }
            </div >

            <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-stone-100 flex justify-center z-50">
                <div className="max-w-4xl w-full flex justify-between items-center">
                    <button onClick={onBack} className="text-stone-400 hover:text-[#3D405B] font-bold text-sm uppercase tracking-widest px-4 transition-colors">Retour</button>
                    <button onClick={onNext} className="flex items-center gap-3 px-8 py-4 bg-[#E07A5F] text-white rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all">
                        <span>Passer au Diagnostic</span>
                        <ArrowRight size={20} />
                    </button>
                </div>
            </div>

            <TestCatalogModal
                isOpen={showCatalog}
                onClose={() => setShowCatalog(false)}
                existingTests={tests}
                onAddTests={addTests}

                onContribute={onContribute}
                initialExpandedTestId={catalogTargetTestId}
            />
        </div >
    );
};

export const SubtestRowCheck = CompactSubtestRow;

