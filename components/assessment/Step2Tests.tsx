
import React, { useState, useCallback, useEffect } from 'react';
import { TestData, ScoreResult, UserProfile, Patient } from '../../types';
import { SubtestDef } from '../../data/testCatalog';
import { SCALES, calculateFromStandard, calculateFromZ, calculateFromPercentile } from '../../utils/scoring';
import { ScoringEngine } from '../../services/scoringEngine';
import { GaussianChart } from '../shared/GaussianChart';
import { Plus, Trash2, ArrowRight, MessageSquarePlus, X, Check, Layers, ChevronDown, Activity, Search, ShieldCheck, Lock, FlaskConical, FilePlus, Loader2, MousePointer2, Sparkles } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';
import { DEMO_PATIENTS } from '../../data/demoData';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  patient: Patient; 
  tests: TestData;
  updateTests: (data: Partial<TestData>) => void;
  onNext: () => void;
  onBack: () => void;
  userProfile?: UserProfile;
  onAcceptResponsibility?: () => void;
  onContribute?: () => void;
}

// ... (TestCatalogModal inchangé) ...
// --- CATALOGUE MODAL (EXPORTÉ) ---
export const TestCatalogModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    existingTests: TestData;
    onAddTests: (testIds: string[]) => void;
    onContribute?: () => void;
}> = ({ isOpen, onClose, existingTests, onAddTests, onContribute }) => {
    const { catalog } = useCatalog();
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [activeCategory, setActiveCategory] = useState(catalog[0]?.id || '');
    const [searchQuery, setSearchQuery] = useState('');

    if (!isOpen) return null;

    const toggleSelection = (id: string) => {
        if (selectedIds.includes(id)) {
            setSelectedIds(selectedIds.filter(tid => tid !== id));
        } else {
            setSelectedIds([...selectedIds, id]);
        }
    };

    const handleValidate = () => {
        onAddTests(selectedIds);
        setSelectedIds([]);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-4xl h-[700px] rounded-[32px] shadow-2xl flex overflow-hidden flex-col md:flex-row">
                <div className="w-full md:w-1/3 bg-stone-50 p-6 md:p-8 border-b md:border-r border-stone-100 flex flex-col gap-2">
                    <h3 className="font-serif font-bold text-2xl text-[#3D405B] mb-4 hidden md:block">Catalogue</h3>
                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-x-1/2 text-stone-400" size={16} />
                        <input type="text" placeholder="Rechercher..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-3 py-2 bg-white border border-stone-200 rounded-xl text-sm outline-none focus:border-[#E07A5F]" />
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar">
                        {catalog.map(cat => (
                            <button key={cat.id} onClick={() => setActiveCategory(cat.id)} className={`w-full text-left px-5 py-3 rounded-2xl font-bold text-sm transition-all flex items-center gap-3 ${activeCategory === cat.id ? 'bg-white shadow-md text-[#E07A5F] ring-1 ring-stone-100' : 'text-stone-500 hover:bg-stone-100'}`}>
                                {cat.name}
                            </button>
                        ))}
                    </div>
                    {onContribute && (
                        <div className="mt-4 pt-4 border-t border-stone-200">
                            <button onClick={() => { onClose(); onContribute(); }} className="w-full p-3 bg-[#E07A5F]/10 text-[#E07A5F] rounded-xl text-xs font-bold hover:bg-[#E07A5F]/20 transition-all text-left flex items-center gap-2 group">
                                <div className="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform"><FilePlus size={14} /></div>
                                <div><span className="block">Test manquant ?</span><span className="text-[10px] font-medium opacity-80">Gagnez des crédits !</span></div>
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex-1 p-6 md:p-10 bg-white flex flex-col relative">
                     <div className="flex justify-between items-center mb-6">
                         <div><h4 className="font-bold text-xl text-[#3D405B]">Choisir les épreuves</h4><p className="text-stone-400 text-sm">Sélectionnez plusieurs tests si nécessaire.</p></div>
                         <button onClick={onClose} className="p-3 bg-stone-50 rounded-full hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"><X size={20}/></button>
                     </div>
                     <div className="flex-1 overflow-y-auto grid grid-cols-1 gap-4 pb-20">
                        {catalog.find(c => c.id === activeCategory)?.tests.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase())).map((test, index) => {
                             const isAlreadyAdded = !!existingTests[test.id];
                             const isSelected = selectedIds.includes(test.id);
                             return (
                                 <button key={test.id} onClick={() => !isAlreadyAdded && toggleSelection(test.id)} disabled={isAlreadyAdded} className={`text-left p-5 rounded-2xl border-2 transition-all flex justify-between items-center group ${isAlreadyAdded ? 'bg-stone-50 border-stone-100 opacity-60 cursor-default' : isSelected ? 'bg-[#E07A5F]/5 border-[#E07A5F] shadow-sm' : 'bg-white border-stone-100 hover:border-stone-300'}`}>
                                    <div><span className={`font-bold text-lg block mb-1 ${isAlreadyAdded ? 'text-stone-400' : 'text-[#3D405B]'}`}>{test.name}</span><span className="text-xs text-stone-400 font-medium">{test.subtests.length} sous-tests inclus</span></div>
                                    {isAlreadyAdded ? <span className="flex items-center gap-1 text-xs font-bold text-[#81B29A] uppercase bg-[#81B29A]/10 px-3 py-1.5 rounded-full"><Check size={12} strokeWidth={3}/> Ajouté</span> : <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${isSelected ? 'bg-[#E07A5F] text-white' : 'bg-stone-100 text-stone-300 group-hover:bg-[#E07A5F]/20'}`}>{isSelected ? <Check size={16} strokeWidth={3} /> : <Plus size={16} />}</div>}
                                 </button>
                             )
                        })}
                        {catalog.find(c => c.id === activeCategory)?.tests.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && <div className="text-center py-10"><p className="text-stone-400 text-sm">Aucun résultat.</p></div>}
                     </div>
                     <div className="absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-stone-100 flex justify-between items-center">
                        <span className="text-sm font-bold text-stone-500">{selectedIds.length} test{selectedIds.length > 1 ? 's' : ''} sélectionné{selectedIds.length > 1 ? 's' : ''}</span>
                        <button onClick={handleValidate} disabled={selectedIds.length === 0} className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2c2e42] transition-colors shadow-lg">Valider la sélection</button>
                     </div>
                </div>
            </div>
        </div>
    );
}

// Helper pour l'interprétation textuelle
const getInterpretation = (z: number) => {
    if (z <= -2) return { text: "Difficulté significative (Zone Pathologique)", color: "text-[#D62828]" };
    if (z <= -1) return { text: "Fragilité à surveiller (Zone Limite)", color: "text-[#E07A5F]" };
    if (z >= 1) return { text: "Performance supérieure à la moyenne", color: "text-[#81B29A]" };
    return { text: "Performance dans la moyenne attendue", color: "text-[#81B29A]" };
};

// --- SOUS-COMPOSANT EXPORTÉ ET MÉMOISÉ : Smart Test Row (Accordéon) ---
export const SubtestRowCheck = React.memo(({
    testId, 
    patient,
    subtest,
    result,
    onChange,
    readOnly = false,
    isExpanded: controlledExpanded,
    onToggleExpand,
    onFocus,
    onErrorPulse,
    hasAcceptedResponsibility = false,
    onAcceptResponsibility,
    highlightMode = false // NOUVEAU : Prop pour le mode démo
}: {
    testId: string; 
    patient: Patient;
    subtest: SubtestDef;
    result: ScoreResult;
    onChange: (res: Partial<ScoreResult>) => void;
    readOnly?: boolean;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    onFocus?: () => void;
    onErrorPulse?: boolean;
    hasAcceptedResponsibility?: boolean;
    onAcceptResponsibility?: () => void;
    highlightMode?: boolean;
}) => {
    
    const [localExpanded, setLocalExpanded] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [isComputing, setIsComputing] = useState(false); // État de chargement DB

    const isExpanded = controlledExpanded !== undefined ? controlledExpanded : localExpanded;
    
    const handleToggle = () => {
        if (onToggleExpand) onToggleExpand();
        else setLocalExpanded(!localExpanded);
    };

    // 1. Logique Saisie RAW (via Moteur DB)
    const handleRawInput = async (val: string) => {
        if (readOnly || result.status === 'validated') return;
        if (onFocus) onFocus();

        const num = parseFloat(val);
        
        // Mise à jour immédiate de l'input brut (UX sans lag)
        onChange({ raw: val, status: 'empty' }); 

        if (isNaN(num)) return;

        // SCENARIO DEMO : Si c'est le champ "5" de Léo, on simule le calcul
        if (highlightMode) {
            setIsComputing(true);
            setTimeout(() => {
                onChange({
                    raw: val,
                    standard: '5', // Score faible pour l'exemple
                    percentile: '5',
                    zScore: -1.6,
                    status: 'estimated'
                });
                setIsComputing(false);
                // Le toast est déclenché par le parent via l'écoute du changement de state
            }, 600);
            return;
        }

        // Calcul Async Normal
        setIsComputing(true);
        try {
            // Conversion Age String -> Mois (Approximation ou précis)
            const ageInMonths = 96; // TODO: Vrai calcul d'âge

            const dbSubtestId = `${testId}_${subtest.id}`;
            const computed = await ScoringEngine.compute(dbSubtestId, num, ageInMonths, patient.gender === 'F' ? 'F' : 'M');
            
            if (computed) {
                onChange({
                    raw: val, // Garde le string saisi
                    standard: computed.standard,
                    percentile: computed.percentile,
                    zScore: computed.zScore,
                    status: 'estimated'
                });
            } else {
                // Pas de norme trouvée
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsComputing(false);
        }
    };

    // 2. Logique Édition Manuelle (Calcul Bidirectionnel Purement Mathématique - Pas de DB)
    const handleCalculatedEdit = (field: 'standard' | 'zScore' | 'percentile', val: string) => {
        if (readOnly || result.status === 'validated') return;
        if (onFocus) onFocus();

        const num = parseFloat(val);
        if (isNaN(num)) {
            onChange({ [field === 'zScore' ? 'zScore' : field]: field === 'zScore' ? 0 : val });
            return;
        }

        let calculated: any = {};
        if (field === 'standard') {
            calculated = calculateFromStandard(num, subtest.scoreType);
        } else if (field === 'zScore') {
            calculated = calculateFromZ(num, subtest.scoreType);
        } else if (field === 'percentile') {
            calculated = calculateFromPercentile(num, subtest.scoreType);
        }

        onChange({
            ...calculated,
            status: 'estimated'
        });
    };

    // 3. Validation
    const handleActionClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (readOnly) return;

        if (result.status === 'estimated') {
            if (!hasAcceptedResponsibility) setShowConfirmModal(true);
            else confirmValidation();
        } else if (result.status === 'validated') {
            onChange({ status: 'estimated', validatedAt: undefined });
        }
    };

    const confirmValidation = () => {
        onChange({ status: 'validated', validatedAt: new Date().toISOString() });
        setShowConfirmModal(false);
        if (!isExpanded && onToggleExpand) onToggleExpand();
        else if (!isExpanded) setLocalExpanded(true);
    };

    const handleConfirmFirstTime = () => {
        if (onAcceptResponsibility) onAcceptResponsibility();
        confirmValidation();
    };

    const handleObservation = (txt: string) => {
        if (readOnly) return;
        onChange({ observation: txt });
    };

    // États visuels
    const isEstimated = result.status === 'estimated';
    const isValidated = result.status === 'validated';
    const isEmpty = result.status === 'empty' || result.raw === '';
    const z = result.zScore || 0;

    let semanticColor = "#81B29A"; 
    if (z <= -2) semanticColor = "#D62828";
    else if (z <= -1) semanticColor = "#E07A5F";
    
    const PROPOSAL_COLOR = "#6366F1"; // Indigo
    
    const getCalculatedInputStyle = () => {
        if (isValidated) {
            return {
                borderColor: semanticColor,
                color: semanticColor,
                backgroundColor: '#FFFFFF',
                borderStyle: 'solid',
                borderWidth: '2px',
                fontWeight: '800'
            };
        } else if (isEstimated) {
            return {
                borderColor: '#A5B4FC',
                color: PROPOSAL_COLOR,
                backgroundColor: '#EEF2FF',
                borderStyle: 'dashed',
                borderWidth: '2px',
                fontStyle: 'italic'
            };
        }
        return { 
            borderColor: 'transparent',
            backgroundColor: '#F9FAFB',
            color: '#3D405B'
        };
    };

    const calcStyle = getCalculatedInputStyle();
    const inputBaseClass = "text-center rounded-xl text-lg outline-none transition-all duration-300 font-bold shadow-sm";
    const interpretation = getInterpretation(z);

    return (
        <>
            <div className={`relative bg-white rounded-2xl shadow-sm border transition-all duration-300 mb-4 group 
                ${isExpanded ? 'shadow-md ring-1 ring-stone-100' : 'hover:shadow'}
                ${onErrorPulse && isEstimated ? 'animate-pulse ring-2 ring-indigo-300 shadow-indigo-100' : 'border-stone-100'}
                ${highlightMode ? 'ring-4 ring-[#E07A5F]/30 shadow-xl' : ''}
            `}>
                
                {/* Suppression de la flèche externe ici pour corriger le responsive */}

                <div 
                    className="absolute left-0 top-0 bottom-0 w-[6px] rounded-l-2xl transition-colors duration-500 z-10"
                    style={{ backgroundColor: isValidated ? semanticColor : (isEstimated ? PROPOSAL_COLOR : '#F5F5F4') }}
                />

                <div 
                    onClick={() => (isValidated || readOnly) && handleToggle()}
                    className={`flex items-center gap-4 p-4 pl-8 transition-colors ${(isValidated || readOnly) ? 'cursor-pointer' : ''}`}
                >
                    <div className="w-1/4 min-w-[120px]">
                        <h4 className="font-bold text-sm text-[#3D405B] group-hover:text-[#E07A5F] transition-colors">{subtest.name}</h4>
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">{subtest.unit}</span>
                    </div>

                    <div className="flex-1 flex items-center justify-start gap-2 md:gap-4 overflow-x-auto no-scrollbar">
                        <div className="flex flex-col items-center min-w-[60px]">
                            <span className="text-[9px] font-bold text-stone-300 uppercase mb-1">Brut</span>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    value={result.raw}
                                    onChange={(e) => handleRawInput(e.target.value)}
                                    onFocus={onFocus}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder={highlightMode && isEmpty ? "Tapez 5" : "-"}
                                    disabled={readOnly || isValidated}
                                    autoFocus={highlightMode}
                                    className={`w-16 h-12 ${inputBaseClass}`}
                                    style={{ 
                                        backgroundColor: isValidated ? '#F9FAFB' : highlightMode && isEmpty ? '#fff5f2' : '#FFFFFF',
                                        border: isValidated ? '1px solid transparent' : highlightMode && isEmpty ? '2px solid #E07A5F' : '1px solid #E5E7EB',
                                        color: '#3D405B',
                                        paddingRight: isComputing ? '20px' : '0' 
                                    }}
                                />
                                {isValidated && <Lock size={10} className="absolute top-1 right-1 text-stone-300" />}
                                {isComputing && <div className="absolute top-1/2 right-1 -translate-y-1/2 text-[#E07A5F]"><Loader2 size={12} className="animate-spin" /></div>}
                            </div>
                        </div>

                        <div className="h-8 w-px bg-stone-100 hidden sm:block"></div>

                        <div className="flex flex-col items-center min-w-[60px] relative">
                            <span className={`text-[9px] font-bold uppercase mb-1 ${isEstimated && !isValidated ? 'text-indigo-400' : 'text-stone-300'}`}>NS</span>
                            <input type="text" value={result.standard} onChange={(e) => handleCalculatedEdit('standard', e.target.value)} onFocus={onFocus} onClick={(e) => e.stopPropagation()} disabled={readOnly || isValidated} placeholder="-" className={`w-14 h-10 text-sm ${inputBaseClass}`} style={calcStyle} />
                            {isEstimated && !isValidated && <div className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 rounded-full text-white text-[8px] flex items-center justify-center font-bold pointer-events-none">?</div>}
                        </div>

                        <div className="flex flex-col items-center min-w-[60px]">
                            <span className={`text-[9px] font-bold uppercase mb-1 ${isEstimated && !isValidated ? 'text-indigo-400' : 'text-stone-300'}`}>ET</span>
                            <input type="text" value={result.zScore || 0} onChange={(e) => handleCalculatedEdit('zScore', e.target.value)} onFocus={onFocus} onClick={(e) => e.stopPropagation()} disabled={readOnly || isValidated} placeholder="-" className={`w-14 h-10 text-sm ${inputBaseClass}`} style={calcStyle} />
                        </div>

                        <div className="flex flex-col items-center min-w-[60px]">
                            <span className={`text-[9px] font-bold uppercase mb-1 ${isEstimated && !isValidated ? 'text-indigo-400' : 'text-stone-300'}`}>%</span>
                            <input type="text" value={result.percentile} onChange={(e) => handleCalculatedEdit('percentile', e.target.value)} onFocus={onFocus} onClick={(e) => e.stopPropagation()} disabled={readOnly || isValidated} placeholder="-" className={`w-14 h-10 text-sm ${inputBaseClass}`} style={calcStyle} />
                        </div>
                    </div>

                    <div className="flex justify-end items-center gap-4 pl-4 border-l border-transparent sm:border-stone-50 ml-4">
                        {!readOnly && (
                            <div className="relative group/btn">
                                <button onClick={handleActionClick} disabled={isEmpty} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 relative ${isValidated ? `bg-white shadow-none border-2 scale-90 hover:bg-stone-50` : isEstimated ? "bg-[#4F46E5] text-white shadow-lg shadow-indigo-200 hover:scale-110 hover:shadow-indigo-300 animate-pulse" : "bg-stone-100 text-stone-300 cursor-not-allowed" }`} style={{ borderColor: isValidated ? semanticColor : 'transparent', color: isValidated ? semanticColor : 'white' }}>
                                    {isValidated ? <ShieldCheck size={18} /> : <Check size={20} strokeWidth={3} />}
                                </button>
                                {isEstimated && !isValidated && (
                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-[#3D405B] text-white text-[10px] px-3 py-2 rounded-lg opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none text-center leading-tight z-50">
                                        Validation & Contribution anonyme <br/> aux statistiques <FlaskConical size={10} className="inline ml-1"/>
                                    </div>
                                )}
                            </div>
                        )}
                        {readOnly && isValidated && <div className={`text-stone-300 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}><ChevronDown size={20} /></div>}
                    </div>
                </div>

                <div className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                        <div className="p-6 pt-0 border-t border-stone-50 bg-stone-50/30 rounded-b-2xl">
                            {isValidated && result.validatedAt && (
                                <div className="flex justify-end mt-2 mb-2"><span className="text-[9px] text-stone-400 font-medium flex items-center gap-1 bg-white px-2 py-0.5 rounded-full border border-stone-100 shadow-sm"><ShieldCheck size={10} className="text-emerald-500" />Vérifié le {new Date(result.validatedAt).toLocaleDateString()}</span></div>
                            )}
                            <div className="flex flex-col md:flex-row gap-8 items-center mt-2">
                                 <div className="w-full md:flex-1 h-40 bg-white rounded-xl border border-stone-100 p-4 shadow-sm relative">
                                     <div className="absolute top-2 left-3 z-10 bg-stone-100 px-2 py-1 rounded text-[10px] font-bold text-stone-500 uppercase">Distribution Normale</div>
                                     <GaussianChart mean={SCALES[subtest.scoreType].mean} sd={SCALES[subtest.scoreType].sd} userScore={parseFloat(result.standard)} label="" isActive={isExpanded} />
                                 </div>
                                 <div className="w-full md:w-1/3 space-y-4">
                                     <div><h5 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Interprétation</h5><p className={`text-sm font-bold flex items-center gap-2 ${interpretation.color}`}><Activity size={16} /> {interpretation.text}</p></div>
                                     <div>
                                         <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1 flex items-center gap-2"><MessageSquarePlus size={12}/> Notes Cliniques</label>
                                         <textarea value={result.observation || ''} onChange={(e) => handleObservation(e.target.value)} placeholder="Notez ici les éléments qualitatifs..." disabled={readOnly} rows={2} className="w-full text-sm p-3 rounded-xl bg-white border border-stone-200 focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/10 outline-none resize-none transition-all placeholder:text-stone-300 text-stone-700" />
                                     </div>
                                 </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {showConfirmModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden p-6 animate-in zoom-in-95 duration-200 border-t-4 border-[#4F46E5]">
                        <div className="flex items-center gap-3 mb-4 text-[#4F46E5]"><div className="p-2 bg-indigo-50 rounded-full"><ShieldCheck size={28} /></div><h3 className="font-serif font-bold text-xl text-[#3D405B]">Certification Requise</h3></div>
                        <p className="text-stone-600 text-sm leading-relaxed mb-6">Les valeurs <strong>NS ({result.standard})</strong>, <strong>ET ({result.zScore})</strong> et <strong>% ({result.percentile})</strong> sont liées mathématiquement.<br/><br/>En tant que professionnel, confirmez-vous que ces résultats sont cohérents ?</p>
                        <div className="flex gap-3 justify-end">
                            <button onClick={() => setShowConfirmModal(false)} className="px-4 py-2 text-stone-400 font-bold text-sm hover:text-stone-600">Annuler</button>
                            <button onClick={handleConfirmFirstTime} className="px-6 py-3 bg-[#4F46E5] text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-2"><Check size={16} strokeWidth={3} /> Je certifie</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}, (prev, next) => {
    return (
        prev.result === next.result &&
        prev.isExpanded === next.isExpanded &&
        prev.onErrorPulse === next.onErrorPulse &&
        prev.readOnly === next.readOnly &&
        prev.subtest.id === next.subtest.id &&
        prev.testId === next.testId &&
        prev.highlightMode === next.highlightMode // Included new prop
    );
});

export const Step2Tests: React.FC<Props> = ({ patient, tests, updateTests, onNext, onBack, userProfile, onAcceptResponsibility, onContribute }) => {
  const { catalog } = useCatalog();
  const [showCatalog, setShowCatalog] = useState(false);
  const [expandedSubtestId, setExpandedSubtestId] = useState<string | null>(null);
  const [triggerErrorPulse, setTriggerErrorPulse] = useState(false);
  
  // DEMO STATE
  const [showDemoToast, setShowDemoToast] = useState(false);
  const toast = useToast();

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
    
    // Détection du trigger DEMO
    // Si on modifie manuellement le test "manual-dexterity" et qu'on entre "5"
    if (patient.id === 'demo-leo' && testId === 'mabc-2' && subtestId === 'manual-dexterity' && result.raw === '5') {
        setShowDemoToast(true);
    }

    newTests[testId][subtestId] = { ...currentSub, ...result };
    updateTests(newTests);
  }, [tests, updateTests, patient.id]);

  const handleFillAllDemo = () => {
      // Injection de tous les scores pré-définis de Léo
      // Pour simuler, on met à jour manual-dexterity à validé et on injecte le reste si manquant
      const newTests = { ...tests }; // Utilise l'état courant qui est vide au départ
      
      // On s'assure que la structure existe
      if (!newTests['mabc-2']) newTests['mabc-2'] = {};

      // Injection explicite des valeurs "résolues" (Hardcoded pour le Wow effect)
      // Car demoData.ts est maintenant vide.
      newTests['mabc-2']['manual-dexterity'] = { 
          raw: '5', standard: '5', percentile: '5', zScore: -1.6, status: 'validated' 
      };
      newTests['mabc-2']['ball-skills'] = { 
          raw: '8', standard: '8', percentile: '25', zScore: -0.6, status: 'validated' 
      };
      newTests['mabc-2']['balance'] = { 
          raw: '6', standard: '6', percentile: '9', zScore: -1.3, status: 'validated' 
      };
      
      updateTests(newTests);
      setShowDemoToast(false);
      toast.success("Tous les scores importés.");
  };

  const handleNext = () => {
    let hasPendingEstimations = false;
    Object.values(tests).forEach(subtests => {
        Object.values(subtests).forEach(res => {
            if (res.status === 'estimated') hasPendingEstimations = true;
        });
    });

    if (hasPendingEstimations) {
        setTriggerErrorPulse(true);
        setTimeout(() => setTriggerErrorPulse(false), 1000);
        const firstError = document.querySelector('.animate-pulse');
        firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
        onNext();
    }
  };

  const activeTestsList = Object.keys(tests);

  return (
    <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in duration-500 pb-32 relative">
      <div className="flex justify-between items-end mb-6 border-b border-stone-200 pb-6">
        <div>
            <h2 className="text-3xl font-serif font-bold text-[#3D405B]">Tests & Mesures</h2>
            <p className="text-stone-500 font-medium mt-2">Saisissez les résultats. Les scores NS, ET et % sont calculés automatiquement.</p>
        </div>
        <button onClick={() => setShowCatalog(true)} className="flex items-center gap-2 bg-[#3D405B] text-white px-6 py-3 rounded-2xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all"><Plus size={18} /> Ajouter un test</button>
      </div>

      <div className="space-y-16">
        {activeTestsList.length === 0 ? (
            <div onClick={() => setShowCatalog(true)} className="group cursor-pointer border-2 border-dashed border-stone-200 bg-white rounded-[32px] p-20 text-center hover:border-[#E07A5F] hover:bg-[#fff5f2] transition-all duration-300">
                <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto text-stone-300 group-hover:text-[#E07A5F] group-hover:scale-110 transition-all mb-6"><Layers size={40} /></div>
                <h3 className="text-2xl font-bold text-stone-600 mb-2">Aucun test sélectionné</h3>
                <p className="text-stone-400 font-medium">Commencez par ajouter une épreuve depuis le catalogue.</p>
            </div>
        ) : (
            activeTestsList.map(testId => {
                const def = catalog.flatMap(c => c.tests).find(t => t.id === testId);
                if (!def) return null;

                return (
                    <div key={testId} className="animate-in slide-in-from-bottom-4 duration-500 bg-white/50 rounded-[32px] p-2 md:p-6 border border-transparent hover:border-stone-100 transition-colors">
                        <div className="flex items-center justify-between mb-8 px-2 border-b border-stone-100 pb-4">
                            <h3 className="font-serif font-bold text-2xl text-[#3D405B] flex items-center gap-3"><span className="w-2 h-8 bg-[#F2CC8F] rounded-full"></span>{def.name}</h3>
                            <button onClick={() => removeTest(testId)} className="text-stone-300 hover:text-[#E07A5F] hover:bg-rose-50 p-3 rounded-xl transition-all" title="Supprimer ce test"><Trash2 size={20} /></button>
                        </div>
                        <div>
                            {def.subtests.map(st => {
                                const res = tests[testId]?.[st.id] || { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' };
                                const uniqueId = `${testId}-${st.id}`;
                                
                                // LOGIQUE DEMO : Si c'est Léo (ID demo-leo) et MABC-2 et Manual Dexterity, on active le highlight
                                const isDemoHighlight = patient.id === 'demo-leo' && testId === 'mabc-2' && st.id === 'manual-dexterity';

                                return (
                                    <SubtestRowCheck 
                                        key={st.id}
                                        testId={testId}
                                        patient={patient}
                                        subtest={st}
                                        result={res}
                                        onChange={(val) => handleSubtestChange(testId, st.id, val)}
                                        isExpanded={expandedSubtestId === uniqueId}
                                        onToggleExpand={() => setExpandedSubtestId(expandedSubtestId === uniqueId ? null : uniqueId)}
                                        onFocus={() => setExpandedSubtestId(null)}
                                        onErrorPulse={triggerErrorPulse}
                                        hasAcceptedResponsibility={userProfile?.hasAcceptedResponsibility}
                                        onAcceptResponsibility={onAcceptResponsibility}
                                        highlightMode={isDemoHighlight} // Passage de la prop beacon
                                    />
                                );
                            })}
                        </div>
                    </div>
                );
            })
        )}
      </div>

      {/* TOAST DEMO INTERACTIF */}
      {showDemoToast && (
          <div className="fixed bottom-32 left-1/2 -translate-x-1/2 bg-[#3D405B] text-white p-6 rounded-[24px] shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col items-center gap-4 z-[100] max-w-md text-center border border-white/10">
              <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30">
                  <Check size={24} strokeWidth={3} />
              </div>
              <div>
                  <h3 className="font-serif font-bold text-lg">Calcul Automatique !</h3>
                  <p className="text-sm text-stone-300 mt-1">
                      Fini les tables de conversion manuelles. Nous avons calculé les normes instantanément.
                  </p>
              </div>
              <button 
                  onClick={handleFillAllDemo}
                  className="w-full py-3 bg-white text-[#3D405B] font-bold rounded-xl hover:bg-stone-100 transition-all flex items-center justify-center gap-2"
              >
                  <Sparkles size={16} /> Remplir le reste pour la démo
              </button>
          </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-stone-100 flex justify-center z-50">
        <div className="max-w-4xl w-full flex justify-between items-center">
             <button onClick={onBack} className="text-stone-400 hover:text-[#3D405B] font-bold text-sm uppercase tracking-widest px-4 transition-colors">Retour</button>
            <div className="flex flex-col items-end">
                {triggerErrorPulse && <span className="text-xs font-bold text-rose-500 animate-bounce mb-2">Veuillez certifier les scores en bleu avant de continuer.</span>}
                <button onClick={handleNext} className={`flex items-center gap-3 px-8 py-4 text-white rounded-2xl font-bold shadow-xl transition-all hover:-translate-y-1 ${triggerErrorPulse ? 'bg-rose-500 shadow-rose-200 animate-shake' : 'bg-[#E07A5F] shadow-orange-200 hover:bg-[#d0694e]'}`}><span>Passer aux Observations</span><ArrowRight size={20} /></button>
            </div>
        </div>
      </div>

      <TestCatalogModal isOpen={showCatalog} onClose={() => setShowCatalog(false)} existingTests={tests} onAddTests={addTests} onContribute={onContribute} />
    </div>
  );
};
