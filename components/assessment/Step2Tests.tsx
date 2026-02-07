
import React, { useState, useCallback, useEffect } from 'react';
import { TestData, ScoreResult, UserProfile, Patient, Observations } from '../../types';
import { SubtestDef } from '../../data/testCatalog';
import { SCALES, calculateFromStandard, calculateFromZ, calculateFromPercentile } from '../../utils/scoring';
import { ScoringEngine } from '../../services/scoringEngine';
import { GaussianChart } from '../shared/GaussianChart';
import { Plus, Trash2, ArrowRight, MessageSquarePlus, X, Check, Layers, ChevronDown, Activity, Search, ShieldCheck, Lock, FlaskConical, FilePlus, Loader2, MousePointer2, Sparkles, PenTool, History, Palette, Move, Zap, Scan } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';
import { DEMO_PATIENTS } from '../../data/demoData';
import { useToast } from '../../contexts/ToastContext';
import { DebouncedTextarea } from '../shared/DebouncedControls';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  patient: Patient;
  tests: TestData;
  updateTests: (data: Partial<TestData>) => void;
  observations: Observations;
  updateObservations: (data: Partial<Observations>) => void;
  onNext: () => void;
  onBack: () => void;
  onAcceptResponsibility: () => void;
  onContribute: () => void;
  userProfile: UserProfile;
}

export const TestCatalogModal = ({ isOpen, onClose, existingTests, onAddTests }: any) => {
    const { catalog } = useCatalog();
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    
    if (!isOpen) return null;

    const handleToggle = (id: string) => {
        if (selectedIds.includes(id)) setSelectedIds(selectedIds.filter(i => i !== id));
        else setSelectedIds([...selectedIds, id]);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in">
            <div className="bg-white w-full max-w-4xl h-[80vh] rounded-[32px] overflow-hidden flex flex-col">
                <div className="p-6 border-b border-stone-100 flex justify-between items-center">
                    <h2 className="text-2xl font-serif font-bold text-[#3D405B]">Ajouter des tests</h2>
                    <button onClick={onClose}><X size={24} className="text-stone-400 hover:text-stone-600" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 md:grid-cols-3 gap-4">
                    {catalog.map(cat => (
                        <div key={cat.id} className="col-span-full">
                            <h3 className="font-bold text-[#E07A5F] uppercase tracking-widest text-xs mb-3 flex items-center gap-2">
                                <Layers size={14} /> {cat.name}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {cat.tests.map(test => {
                                    const isSelected = selectedIds.includes(test.id) || !!existingTests[test.id];
                                    return (
                                        <button 
                                            key={test.id}
                                            onClick={() => handleToggle(test.id)}
                                            disabled={!!existingTests[test.id]}
                                            className={`p-4 rounded-xl border text-left transition-all ${isSelected ? 'border-[#3D405B] bg-stone-50 opacity-60' : 'border-stone-200 hover:border-[#E07A5F]'}`}
                                        >
                                            <div className="font-bold text-[#3D405B]">{test.name}</div>
                                            <div className="text-xs text-stone-400">{test.subtests.length} épreuves</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-6 border-t border-stone-100 flex justify-end">
                    <button onClick={() => { onAddTests(selectedIds); onClose(); }} className="bg-[#3D405B] text-white px-6 py-3 rounded-xl font-bold">
                        Ajouter ({selectedIds.length})
                    </button>
                </div>
            </div>
        </div>
    );
};

export const SubtestRowCheck = ({ testId, patient, subtest, result, onChange, isExpanded, onToggleExpand, readOnly = false }: any) => {
    // Calcul automatique au blur du champ "raw"
    const handleCompute = async (rawVal: string) => {
        const numericRaw = parseFloat(rawVal.replace(',', '.'));
        if (!isNaN(numericRaw)) {
            // Conversion âge (ex: "9 ans 2 mois") en mois
            // Simplification : parsing basique
            let ageMonths = 0;
            if (patient.age) {
               const years = patient.age.match(/(\d+)\s*ans/);
               const months = patient.age.match(/(\d+)\s*mois/);
               if (years) ageMonths += parseInt(years[1]) * 12;
               if (months) ageMonths += parseInt(months[1]);
            }

            const computed = await ScoringEngine.compute(
                subtest.id, 
                numericRaw, 
                ageMonths || 96, // Défaut 8 ans si fail
                patient.gender as any,
                patient.classLevel
            );

            if (computed) {
                onChange({
                    raw: rawVal,
                    standard: computed.standard,
                    percentile: computed.percentile,
                    zScore: computed.zScore,
                    status: 'validated'
                });
            } else {
                // Si pas de calcul possible, on sauvegarde juste le brut
                onChange({ raw: rawVal });
            }
        } else {
            onChange({ raw: rawVal });
        }
    };

    return (
        <div className="border-b border-stone-100 py-3 last:border-0">
            <div className="flex justify-between items-center cursor-pointer" onClick={onToggleExpand}>
                <span className="font-bold text-sm text-[#3D405B] flex items-center gap-2">
                    {subtest.name}
                    {result?.status === 'validated' && <Check size={14} className="text-emerald-500" strokeWidth={3}/>}
                </span>
                <div className="flex items-center gap-4">
                    {result?.zScore !== undefined && result.zScore !== 0 && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${result.zScore <= -2 ? 'bg-rose-100 text-rose-600' : result.zScore <= -1 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            {result.zScore > 0 ? '+' : ''}{result.zScore} ET
                        </span>
                    )}
                    <span className="font-mono text-sm text-stone-500 min-w-[60px] text-right">{result?.raw ? `Brut: ${result.raw}` : '-'}</span>
                </div>
            </div>
            {isExpanded && !readOnly && (
                <div className="mt-3 p-4 bg-stone-50 rounded-xl animate-in slide-in-from-top-1">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                        <div>
                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">Score Brut</label>
                            <input 
                                placeholder="0" 
                                className="w-full p-2.5 rounded-lg border border-stone-200 outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 font-bold text-[#3D405B] bg-white"
                                value={result?.raw || ''}
                                onChange={(e) => onChange({ raw: e.target.value })}
                                onBlur={(e) => handleCompute(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">Standard</label>
                            <input 
                                placeholder="-" 
                                className="w-full p-2.5 rounded-lg border border-stone-200 outline-none focus:border-[#E07A5F] bg-white font-mono text-stone-600"
                                value={result?.standard || ''}
                                onChange={(e) => onChange({ standard: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">Percentile</label>
                            <input 
                                placeholder="-" 
                                className="w-full p-2.5 rounded-lg border border-stone-200 outline-none focus:border-[#E07A5F] bg-white font-mono text-stone-600"
                                value={result?.percentile || ''}
                                onChange={(e) => onChange({ percentile: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1 block">Obs. (Optionnel)</label>
                            <input 
                                placeholder="Note rapide..." 
                                className="w-full p-2.5 rounded-lg border border-stone-200 outline-none focus:border-[#E07A5F] bg-white text-xs"
                                value={result?.observation || ''}
                                onChange={(e) => onChange({ observation: e.target.value })}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, observations, updateObservations, onNext, onBack, onAcceptResponsibility, onContribute, userProfile }) => {
    const { catalog } = useCatalog();
    const { isDemoMode } = useAuth(); // Pour le switch CTA
    const [showCatalog, setShowCatalog] = useState(false);
    const [ctaOpen, setCtaOpen] = useState(false);

    const handleAddClick = () => {
        // En mode démo, le bouton "+" est un Paywall/CTA déguisé
        // Sauf si l'utilisateur veut juste voir comment ça marche, mais on a dit "Catalogue complet derrière inscription"
        // On autorise l'accès au catalogue restreint (snapshot) pour que la démo reste jouable,
        // OU on déclenche la modale "Créer un compte pour voir les 50 autres tests".
        // Le prompt demande : "CTA sur ajouter tests".
        
        if (isDemoMode) {
            setCtaOpen(true);
        } else {
            setShowCatalog(true);
        }
    };

    // --- MODALE CTA INTERNE ---
    const DemoCtaModal = () => (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/90 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white max-w-md w-full rounded-[32px] p-8 text-center relative overflow-hidden">
                <button onClick={() => setCtaOpen(false)} className="absolute top-4 right-4 p-2 bg-stone-50 rounded-full text-stone-400 hover:text-stone-600"><X size={18}/></button>
                <div className="w-20 h-20 bg-[#E07A5F] text-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-orange-200 rotate-3">
                    <Layers size={40} />
                </div>
                <h3 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Bibliothèque Complète</h3>
                <p className="text-stone-500 text-sm mb-6 leading-relaxed">
                    Accédez à plus de <strong>50 tests étalonnés</strong> (WISC-V, TEA-Ch, NEPSY-II...) et à la contribution communautaire.
                </p>
                <div className="space-y-3">
                    <button onClick={onContribute} className="w-full py-4 bg-[#3D405B] text-white rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-2">
                        Créer un compte gratuit <ArrowRight size={18}/>
                    </button>
                    <button onClick={() => { setCtaOpen(false); setShowCatalog(true); }} className="text-xs font-bold text-stone-400 uppercase tracking-wider hover:text-[#E07A5F]">
                        Voir les tests de démonstration
                    </button>
                </div>
            </div>
        </div>
    );

    const handleAddTests = (ids: string[]) => {
        const newTests: TestData = { ...tests };
        ids.forEach(id => {
            const def = catalog.flatMap(c => c.tests).find(t => t.id === id);
            if (def && !newTests[id]) {
                newTests[id] = {};
                def.subtests.forEach(st => {
                    newTests[id][st.id] = { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
                });
            }
        });
        updateTests(newTests);
    };

    const handleResultChange = (testId: string, subId: string, val: Partial<ScoreResult>) => {
        updateTests({
            [testId]: {
                ...tests[testId],
                [subId]: { ...tests[testId][subId], ...val }
            }
        });
    };

    const handleObsChange = (key: keyof Observations, val: string) => {
        updateObservations({ [key]: val });
    };

    return (
        <div className="max-w-5xl mx-auto pb-20 animate-in fade-in">
            <div className="mb-8 flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-serif font-bold text-[#3D405B]">Tests & Observations</h2>
                    <p className="text-stone-500 font-medium mt-2">Saisissez les résultats et vos observations cliniques.</p>
                </div>
                <button onClick={handleAddClick} className="bg-[#3D405B] text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg hover:bg-[#2c2e42] transition-all">
                    <Plus size={16} /> Ajouter un Test
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* TESTS LIST */}
                <div className="space-y-6">
                    {Object.keys(tests).length === 0 && (
                        <div className="text-center py-12 bg-stone-50 rounded-2xl border border-dashed border-stone-300">
                            <FlaskConical size={32} className="mx-auto text-stone-300 mb-2" />
                            <p className="text-stone-400 font-bold">Aucun test sélectionné</p>
                        </div>
                    )}
                    {Object.entries(tests).map(([testId, subtests]) => {
                        const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                        if (!def) return null;
                        return (
                            <div key={testId} className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                                <div className="bg-stone-50 px-4 py-3 border-b border-stone-200 flex justify-between items-center">
                                    <h3 className="font-bold text-[#3D405B] flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-[#E07A5F]"></div>
                                        {def.name}
                                    </h3>
                                    <button onClick={() => { const n = {...tests}; delete n[testId]; updateTests(n); }}><Trash2 size={16} className="text-stone-400 hover:text-rose-500 transition-colors"/></button>
                                </div>
                                <div className="p-4">
                                    {def.subtests.map(st => (
                                        <SubtestRowCheck 
                                            key={st.id}
                                            testId={testId}
                                            patient={patient}
                                            subtest={st}
                                            result={subtests[st.id]}
                                            onChange={(val: any) => handleResultChange(testId, st.id, val)}
                                            isExpanded={true} 
                                            onToggleExpand={() => {}}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* OBSERVATIONS */}
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 sticky top-6">
                        <h3 className="font-bold text-[#3D405B] mb-4 flex items-center gap-2"><Activity size={18}/> Observations Cliniques</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 block">Anamnèse & Comportement</label>
                                <DebouncedTextarea 
                                    value={observations.anamnese} 
                                    onChange={(v) => handleObsChange('anamnese', v)} 
                                    className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 text-sm focus:bg-white focus:border-[#E07A5F] outline-none transition-all h-32 resize-none" 
                                    placeholder="Histoire, attitude..."
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 block">Motricité Globale</label>
                                <DebouncedTextarea 
                                    value={observations.motricite} 
                                    onChange={(v) => handleObsChange('motricite', v)} 
                                    className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 text-sm focus:bg-white focus:border-[#E07A5F] outline-none transition-all h-24 resize-none" 
                                    placeholder="Equilibre, tonus..."
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 block">Graphisme</label>
                                <DebouncedTextarea 
                                    value={observations.graphique} 
                                    onChange={(v) => handleObsChange('graphique', v)} 
                                    className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 text-sm focus:bg-white focus:border-[#E07A5F] outline-none transition-all h-24 resize-none" 
                                    placeholder="Tenue crayon, posture..."
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-stone-100 flex justify-center z-50">
                <div className="max-w-4xl w-full flex justify-between items-center">
                    <button onClick={onBack} className="text-stone-400 hover:text-[#3D405B] font-bold text-sm uppercase tracking-widest px-4 transition-colors">
                        Retour
                    </button>
                    <button onClick={onNext} className="bg-[#E07A5F] text-white px-8 py-4 rounded-2xl font-bold shadow-xl hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center gap-2">
                        Suivant <ArrowRight size={20} />
                    </button>
                </div>
            </div>

            <TestCatalogModal 
                isOpen={showCatalog} 
                onClose={() => setShowCatalog(false)} 
                existingTests={tests} 
                onAddTests={handleAddTests} 
            />

            {ctaOpen && <DemoCtaModal />}
        </div>
    );
};
