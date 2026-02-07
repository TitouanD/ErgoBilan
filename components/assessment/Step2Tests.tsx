
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
    return (
        <div className="border-b border-stone-100 py-3">
            <div className="flex justify-between items-center cursor-pointer" onClick={onToggleExpand}>
                <span className="font-bold text-sm text-[#3D405B]">{subtest.name}</span>
                <span className="font-mono text-sm text-stone-500">{result?.raw ? `Brut: ${result.raw}` : '-'}</span>
            </div>
            {isExpanded && !readOnly && (
                <div className="mt-3 p-3 bg-stone-50 rounded-xl">
                    <div className="flex gap-2">
                        <input 
                            placeholder="Score brut" 
                            className="flex-1 p-2 rounded border border-stone-200"
                            value={result?.raw || ''}
                            onChange={(e) => onChange({ raw: e.target.value })}
                        />
                        <input 
                            placeholder="Standard" 
                            className="flex-1 p-2 rounded border border-stone-200"
                            value={result?.standard || ''}
                            onChange={(e) => onChange({ standard: e.target.value })}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, observations, updateObservations, onNext, onBack, onAcceptResponsibility, onContribute, userProfile }) => {
    const { catalog } = useCatalog();
    const [showCatalog, setShowCatalog] = useState(false);

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
                <button onClick={() => setShowCatalog(true)} className="bg-[#3D405B] text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg hover:bg-[#2c2e42] transition-all">
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
                                    <h3 className="font-bold text-[#3D405B]">{def.name}</h3>
                                    <button onClick={() => { const n = {...tests}; delete n[testId]; updateTests(n); }}><Trash2 size={16} className="text-stone-400 hover:text-rose-500"/></button>
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
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                        <h3 className="font-bold text-[#3D405B] mb-4 flex items-center gap-2"><Activity size={18}/> Observations Cliniques</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 block">Anamnèse & Comportement</label>
                                <DebouncedTextarea 
                                    value={observations.anamnese} 
                                    onChange={(v) => handleObsChange('anamnese', v)} 
                                    className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 text-sm focus:bg-white focus:border-[#E07A5F] outline-none transition-all h-32" 
                                    placeholder="Histoire, attitude..."
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 block">Motricité Globale</label>
                                <DebouncedTextarea 
                                    value={observations.motricite} 
                                    onChange={(v) => handleObsChange('motricite', v)} 
                                    className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 text-sm focus:bg-white focus:border-[#E07A5F] outline-none transition-all h-24" 
                                    placeholder="Equilibre, tonus..."
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 block">Graphisme</label>
                                <DebouncedTextarea 
                                    value={observations.graphique} 
                                    onChange={(v) => handleObsChange('graphique', v)} 
                                    className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 text-sm focus:bg-white focus:border-[#E07A5F] outline-none transition-all h-24" 
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
        </div>
    );
};
