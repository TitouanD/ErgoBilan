
import React, { useState, useCallback, useMemo } from 'react';
import { TestData, ScoreResult, UserProfile, Patient, Observations } from '../../types';
import { SubtestDef, TestDef, ICON_MAP } from '../../data/testCatalog';
import { calculateFromStandard, calculateFromZ, calculateFromPercentile } from '../../utils/scoring';
import { ScoringEngine } from '../../services/scoringEngine';
import { Plus, Trash2, ArrowRight, MessageSquare, X, Check, Layers, Search, FilePlus, Loader2, Activity, Brain, GripVertical, CheckCircle2 } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';

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

// --- JAUGE FINE ---
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

// --- LIGNE SOUS-TEST ---
const CompactSubtestRow = React.memo(({
    testId, patient, subtest, result, onChange, readOnly = false, onFocus
}: {
    testId: string; patient: Patient; subtest: SubtestDef; result: ScoreResult;
    onChange: (res: Partial<ScoreResult>) => void; readOnly?: boolean; onFocus?: () => void;
    isExpanded?: boolean; onToggleExpand?: () => void;
}) => {
    
    const [isComputing, setIsComputing] = useState(false);

    const handleRawInput = async (val: string) => {
        if (readOnly) return;
        const num = parseFloat(val.replace(',', '.'));
        onChange({ raw: val, status: 'estimated' }); 
        if (isNaN(num)) return;

        setIsComputing(true);
        try {
            // Estimation par défaut 8 ans si pas d'âge précis, juste pour la démo technique
            // En prod, ScoringEngine utilise la vraie date de naissance
            const ageInMonths = 96; 
            const dbSubtestId = `${testId}_${subtest.id}`; // Pattern ID DB
            // On essaie avec l'ID complet (si test officiel) ou l'ID court (si démo)
            // Note: ScoringEngine gère les cas démo
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
                    status: 'estimated'
                });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsComputing(false);
        }
    };

    const handleStandardChange = (val: string) => {
        const num = parseFloat(val.replace(',', '.'));
        if (isNaN(num)) { onChange({ standard: val, status: 'estimated' }); return; }
        const calculated = calculateFromStandard(num, subtest.scoreType);
        onChange({ ...calculated, standard: val, raw: result.raw, status: 'estimated' });
    };

    const handleValidate = () => {
        if (readOnly) return;
        onChange({ status: result.status === 'validated' ? 'estimated' : 'validated' });
    };

    const isValidated = result.status === 'validated';
    let zColor = "text-stone-400";
    if (result.raw) {
        if (result.zScore <= -2) zColor = "text-[#E07A5F]";
        else if (result.zScore <= -1) zColor = "text-[#F2CC8F]";
        else zColor = "text-[#81B29A]";
    }

    return (
        <div className={`border-b border-stone-100 last:border-0 transition-colors ${isValidated ? 'bg-emerald-50/10' : 'bg-white'}`}>
            <div className="flex flex-col md:flex-row">
                <div className="flex-1 p-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="text-stone-300"><GripVertical size={16}/></div>
                            <div>
                                <h4 className="font-bold text-[#3D405B] text-sm leading-tight">{subtest.name}</h4>
                                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{subtest.unit}</span>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 items-center bg-stone-50/50 p-2 rounded-xl border border-stone-100">
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-stone-400 uppercase text-center">Brut</label>
                            <div className="relative">
                                <input value={result.raw} onChange={(e) => handleRawInput(e.target.value)} onFocus={onFocus} className="w-full p-2 text-center bg-white border border-stone-200 rounded-lg font-bold text-[#3D405B] focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none text-sm" />
                                {isComputing && <Loader2 size={12} className="absolute right-1 top-2.5 animate-spin text-[#E07A5F]"/>}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-stone-400 uppercase text-center">NS</label>
                            <input value={result.standard} onChange={(e) => handleStandardChange(e.target.value)} onFocus={onFocus} className="w-full p-2 text-center bg-transparent border-b border-stone-200 rounded-none text-sm font-bold text-stone-600 focus:bg-white focus:border-[#E07A5F] outline-none" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-stone-400 uppercase text-center">ET</label>
                            <div className={`w-full p-2 text-center text-sm font-bold bg-transparent border-b border-stone-200 ${zColor}`}>
                                {result.zScore ? (result.zScore > 0 ? '+' : '') + result.zScore : '-'}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-stone-400 uppercase text-center">%</label>
                            <input value={result.percentile} readOnly className="w-full p-2 text-center bg-transparent border-b border-stone-200 text-sm font-bold text-stone-400 outline-none" />
                        </div>
                    </div>
                    <div className="mt-3 px-1">
                        {result.raw && <CompactGauge zScore={result.zScore || 0} />}
                        <div className="relative mt-3">
                            <textarea value={result.observation || ''} onChange={(e) => !readOnly && onChange({ observation: e.target.value })} onFocus={onFocus} placeholder="Observations cliniques..." className="w-full p-3 pl-9 bg-stone-50 border border-stone-100 rounded-xl text-xs text-[#3D405B] focus:border-[#E07A5F] focus:bg-white outline-none resize-none transition-all placeholder:text-stone-300" rows={2} />
                            <MessageSquare size={14} className="absolute top-3 left-3 text-stone-300" />
                        </div>
                    </div>
                </div>
                <div className="w-full md:w-20 flex md:border-l border-stone-100">
                    <button onClick={handleValidate} disabled={!result.raw} className={`w-full h-full flex flex-col items-center justify-center gap-1 transition-all duration-300 p-2 md:p-0 min-h-[60px] md:min-h-auto ${isValidated ? 'bg-emerald-500 text-white' : !result.raw ? 'bg-stone-50 text-stone-300 cursor-not-allowed' : 'bg-white hover:bg-stone-50 text-[#3D405B] group'}`}>
                        {isValidated ? (
                            <><div className="p-1 bg-white/20 rounded-full animate-in zoom-in duration-300"><CheckCircle2 size={24} strokeWidth={2.5} /></div><span className="text-[9px] font-bold uppercase tracking-wider hidden md:block">Validé</span></>
                        ) : (
                            <><div className={`p-2 rounded-full border-2 border-current transition-transform ${result.raw ? 'group-hover:scale-110 text-[#3D405B] border-[#3D405B] animate-pulse' : 'border-stone-200'}`}><Check size={18} strokeWidth={3} /></div><span className={`text-[9px] font-bold uppercase tracking-wider hidden md:block ${result.raw ? 'text-[#3D405B]' : 'text-stone-300'}`}>Valider</span></>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});

// --- CATALOG MODAL (REVISITED) ---
export const TestCatalogModal = ({ 
    isOpen, onClose, existingTests, onAddTests, onContribute
}: { 
    isOpen: boolean; onClose: () => void; existingTests: TestData; onAddTests: (ids: string[]) => void; onContribute?: () => void;
}) => {
    const { catalog, searchTests } = useCatalog();
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    
    if (!isOpen) return null;

    const handleToggle = (id: string) => {
        if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(i => i !== id));
        else setSelectedIds(prev => [...prev, id]);
    };

    const handleAdd = () => {
        onAddTests(selectedIds);
        setSelectedIds([]);
        onClose();
    };

    // LOGIQUE DE FILTRAGE
    // Si recherche active : Liste plate des résultats
    // Sinon : Affichage par catégories
    const searchResults = searchTerm ? searchTests(searchTerm) : [];
    
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-5xl h-[85vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col relative">
                
                {/* Header avec Search Bar intégrée */}
                <div className="p-6 border-b border-stone-100 bg-stone-50 flex flex-col gap-4 sticky top-0 z-20">
                    <div className="flex justify-between items-center">
                        <h2 className="font-serif font-bold text-2xl text-[#3D405B] flex items-center gap-3">
                            <Layers size={24} className="text-[#E07A5F]" /> Catalogue Unifié
                        </h2>
                        <button onClick={onClose} className="p-2 hover:bg-stone-200 rounded-full transition-colors text-stone-400"><X size={20}/></button>
                    </div>
                    
                    <div className="relative">
                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                        <input 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Rechercher un test (ex: MABC, NEPSY...)"
                            className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-[#E07A5F]/20 font-medium text-[#3D405B] shadow-sm transition-all"
                            autoFocus
                        />
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar bg-[#F9F9F9]">
                    
                    {searchTerm ? (
                        // VUE RECHERCHE
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {searchResults.map(test => {
                                const isAdded = !!existingTests[test.id];
                                const isSelected = selectedIds.includes(test.id);
                                return (
                                    <div 
                                        key={test.id}
                                        onClick={() => !isAdded && handleToggle(test.id)}
                                        className={`p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group flex flex-col justify-between min-h-[100px] ${isAdded ? 'border-stone-100 bg-stone-50 opacity-60 cursor-not-allowed' : isSelected ? 'border-[#E07A5F] bg-[#fff5f2] shadow-md' : 'border-stone-100 bg-white hover:border-[#E07A5F]/50 hover:shadow-sm'}`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className={`font-bold text-sm ${isSelected ? 'text-[#E07A5F]' : 'text-[#3D405B]'}`}>{test.name}</span>
                                            {isAdded && <Check size={16} className="text-stone-400"/>}
                                            {isSelected && !isAdded && <div className="w-6 h-6 bg-[#E07A5F] rounded-full flex items-center justify-center shadow-lg shadow-orange-200"><Check size={14} className="text-white"/></div>}
                                        </div>
                                    </div>
                                );
                            })}
                            {searchResults.length === 0 && (
                                <p className="col-span-full text-center text-stone-400 py-10">Aucun test trouvé.</p>
                            )}
                        </div>
                    ) : (
                        // VUE CATÉGORIES
                        catalog.map(cat => {
                            // Résolution dynamique de l'icône via ICON_MAP
                            const CatIcon = ICON_MAP[cat.iconKey] || ICON_MAP['Box'];
                            
                            return (
                                <div key={cat.id} className="animate-in slide-in-from-bottom-2">
                                    <h3 className="text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 text-stone-500">
                                        <div className="p-1 bg-stone-200 rounded text-stone-600"><CatIcon size={14} /></div>
                                        {cat.name}
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {cat.tests.map(test => {
                                            const isAdded = !!existingTests[test.id];
                                            const isSelected = selectedIds.includes(test.id);
                                            
                                            return (
                                                <div 
                                                    key={test.id}
                                                    onClick={() => !isAdded && handleToggle(test.id)}
                                                    className={`p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group flex flex-col justify-between min-h-[100px] ${
                                                        isAdded ? 'border-stone-100 bg-stone-50 opacity-60 cursor-not-allowed' :
                                                        isSelected ? 'border-[#E07A5F] bg-[#fff5f2] shadow-md' :
                                                        'border-stone-100 bg-white hover:border-[#E07A5F]/50 hover:shadow-sm'
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className={`font-bold text-sm ${isSelected ? 'text-[#E07A5F]' : 'text-[#3D405B]'}`}>{test.name}</span>
                                                        {isAdded && <Check size={16} className="text-stone-400"/>}
                                                        {isSelected && !isAdded && <div className="w-6 h-6 bg-[#E07A5F] rounded-full flex items-center justify-center shadow-lg shadow-orange-200"><Check size={14} className="text-white"/></div>}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <span className="text-[10px] font-bold text-stone-400 bg-stone-50 px-2 py-1 rounded">{test.subtests.length} épreuves</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
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

                <div className="p-6 border-t border-stone-100 bg-white flex justify-end gap-3 z-20">
                    <button onClick={onClose} className="px-6 py-3 font-bold text-stone-400 hover:text-stone-600 transition-colors">Annuler</button>
                    <button 
                        onClick={handleAdd}
                        disabled={selectedIds.length === 0}
                        className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-xl hover:bg-[#2c2e42] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        Ajouter {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- COMPOSANT PRINCIPAL ---
export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, updateObservations, observations, onNext, onBack, userProfile, onAcceptResponsibility, onContribute }) => {
  const { catalog } = useCatalog();
  const [showCatalog, setShowCatalog] = useState(false);

  // Group tests by Category for Display
  const groupedActiveTests = useMemo(() => {
      const groups: Record<string, TestDef[]> = {};
      Object.keys(tests).forEach(testId => {
          // On cherche le test dans toutes les catégories du catalogue
          const cat = catalog.find(c => c.tests.some(t => t.id === testId));
          if (cat) {
              if (!groups[cat.id]) groups[cat.id] = [];
              const testDef = cat.tests.find(t => t.id === testId);
              if (testDef) groups[cat.id].push(testDef);
          } else {
              // Fallback si test non trouvé (ex: test supprimé ou orphelin)
              if (!groups['autre']) groups['autre'] = [];
              // On crée une définition mock pour l'affichage
              groups['autre'].push({ id: testId, name: "Test inconnu", subtests: [] });
          }
      });
      return groups;
  }, [tests, catalog]);

  const addTests = useCallback((testIds: string[]) => {
    const newTests = { ...tests };
    testIds.forEach(testId => {
        if (!newTests[testId]) {
            const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
            if (def) {
                const newTestEntry: Record<string, ScoreResult> = {};
                def.subtests.forEach(st => {
                    newTestEntry[st.id] = { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
                });
                newTests[testId] = newTestEntry;
            }
        }
    });
    updateTests(newTests);
  }, [tests, catalog, updateTests]);

  const removeTest = useCallback((testId: string) => {
    const newTests = { ...tests };
    delete newTests[testId];
    updateTests(newTests);
  }, [tests, updateTests]);

  const handleSubtestChange = useCallback((testId: string, subtestId: string, result: Partial<ScoreResult>) => {
    const newTests = { ...tests };
    if(!newTests[testId]) newTests[testId] = {};
    const currentSub = newTests[testId][subtestId] || { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
    newTests[testId][subtestId] = { ...currentSub, ...result };
    updateTests(newTests);
  }, [tests, updateTests]);

  const activeTestsList = Object.keys(tests);

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500 pb-32">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-[32px] shadow-sm border border-stone-100">
        <div>
            <h2 className="text-2xl font-serif font-bold text-[#3D405B] flex items-center gap-3">
                <Activity size={24} className="text-[#E07A5F]" /> Tests & Mesures
            </h2>
            <p className="text-stone-500 text-sm font-medium mt-1">Saisie interactive avec visualisation temps réel.</p>
        </div>
        <button onClick={() => setShowCatalog(true)} className="flex items-center gap-2 bg-[#3D405B] text-white px-6 py-3 rounded-2xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all text-sm group">
            <Plus size={18} className="group-hover:rotate-90 transition-transform" /> Ajouter une épreuve
        </button>
      </div>

      <div className="space-y-12">
        {activeTestsList.length === 0 ? (
            <div onClick={() => setShowCatalog(true)} className="group cursor-pointer border-3 border-dashed border-stone-200 bg-stone-50/50 rounded-[40px] p-20 text-center hover:border-[#E07A5F] hover:bg-[#fff5f2] transition-all duration-300">
                <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto text-stone-300 group-hover:text-[#E07A5F] group-hover:scale-110 transition-all mb-6 shadow-sm border border-stone-100">
                    <Layers size={40} />
                </div>
                <h3 className="text-2xl font-bold text-stone-600 mb-2">Aucun test sélectionné</h3>
                <p className="text-stone-400 font-medium max-w-md mx-auto">Accédez au catalogue unifié pour sélectionner vos outils d'évaluation.</p>
            </div>
        ) : (
            Object.entries(groupedActiveTests).map(([catId, categoryTests]) => {
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
                            {categoryTests.map(testDef => (
                                <div key={testDef.id} className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden mb-8 transition-all hover:shadow-md">
                                    <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                                        <div className="flex items-center gap-3">
                                            <h3 className="font-bold text-lg text-[#3D405B]">{testDef.name}</h3>
                                            <span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded-full text-stone-400 uppercase tracking-wide border border-stone-100">
                                                {testDef.subtests.length} Épreuves
                                            </span>
                                        </div>
                                        <button onClick={() => removeTest(testDef.id)} className="text-stone-400 hover:text-rose-500 p-2 hover:bg-white/50 rounded-lg transition-all">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    <div className="bg-white">
                                        {testDef.subtests.map(st => {
                                            const res = tests[testDef.id]?.[st.id] || { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
                                            return (
                                                <CompactSubtestRow 
                                                    key={st.id}
                                                    testId={testDef.id}
                                                    patient={patient}
                                                    subtest={st}
                                                    result={res}
                                                    onChange={(val) => handleSubtestChange(testDef.id, st.id, val)}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })
        )}
      </div>

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
      />
    </div>
  );
};

export const SubtestRowCheck = CompactSubtestRow;
