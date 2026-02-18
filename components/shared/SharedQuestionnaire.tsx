
import React, { useState, useEffect } from 'react';
import type { Patient, Sibling, ParamedicalTracking } from '../../types';
import { calculateAge } from '../../utils';
import { DebouncedInput, DebouncedTextarea } from './DebouncedControls';
import { User, Users, GraduationCap, Stethoscope, Baby, Coffee, MessageSquare, ChevronDown, ChevronUp, Check, Plus, Trash2, Home, Scale, HelpingHand, Scissors, Ruler, Utensils, Shirt, Activity, Smile, ArrowRight, Book, Clock, HeartHandshake, Eye, MapPin, Mail, Phone, Heart, Monitor, Droplets, PenTool, Brain } from 'lucide-react';

interface Props {
  data: Patient;
  onChange: (data: Partial<Patient>) => void;
  mode: 'family' | 'practitioner';
}

type SectionKey = 'identity' | 'parents' | 'school' | 'medical' | 'dev' | 'daily' | 'reason';

const SECTIONS_CONFIG: { id: SectionKey; title: string; icon: any }[] = [
    { id: 'identity', title: "IdentitÃ© de l'enfant", icon: User },
    { id: 'parents', title: "Situation Familiale", icon: Users },
    { id: 'school', title: "ScolaritÃ© & AVS", icon: GraduationCap },
    { id: 'medical', title: "Suivi MÃ©dical", icon: Stethoscope },
    { id: 'dev', title: "DÃ©veloppement", icon: Baby },
    { id: 'daily', title: "Vie Quotidienne", icon: Coffee },
    { id: 'reason', title: "PrioritÃ©s & Objectifs", icon: MessageSquare },
];

const SCHOOL_LEVELS = [
    "PS (Petite Section)", "MS (Moyenne Section)", "GS (Grande Section)",
    "CP", "CE1", "CE2", "CM1", "CM2",
    "6Ã¨me", "5Ã¨me", "4Ã¨me", "3Ã¨me",
    "2nde", "1Ã¨re", "Terminale",
    "ULIS", "IME / SESSAD", "Instruction en Famille", "Autre"
];

// --- UX COMPONENTS ---

const ChipGroup = ({ 
    options, 
    value, 
    onChange,
    multi = false
}: { 
    options: { value: string; label: string }[]; 
    value?: string; 
    onChange: (val: string) => void;
    multi?: boolean;
}) => {
    const selected = multi ? (value || '').split(',').filter(Boolean) : [];
    const handleClick = (optValue: string) => {
        if (!multi) { onChange(optValue); return; }
        const newSelected = selected.includes(optValue)
            ? selected.filter(v => v !== optValue)
            : [...selected, optValue];
        onChange(newSelected.join(','));
    };
    const isSelected = (optValue: string) => multi ? selected.includes(optValue) : value === optValue;
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(opt => (
                <button
                    key={opt.value}
                    onClick={() => handleClick(opt.value)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                        isSelected(opt.value) 
                        ? 'bg-[#3D405B] text-white border-[#3D405B] shadow-md' 
                        : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--text-heading)]'
                    }`}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
};

const SelectCard = ({ 
    selected, 
    value, 
    label, 
    icon: Icon, 
    onClick 
}: { 
    selected: boolean; 
    value: string; 
    label: string; 
    icon: any; 
    onClick: () => void;
}) => (
    <div 
        onClick={onClick}
        className={`flex-1 p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center gap-2 text-center ${
            selected 
            ? 'border-[#E07A5F] bg-[#fff5f2] dark:bg-[#E07A5F]/15 text-[#E07A5F]' 
            : 'border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
        }`}
    >
        <Icon size={24} strokeWidth={selected ? 2.5 : 2} />
        <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
    </div>
);

const ToggleSwitch = ({ 
    label, 
    checked, 
    onChange 
}: { 
    label: string; 
    checked: boolean; 
    onChange: (checked: boolean) => void;
}) => (
    <div className="flex items-center justify-between bg-[var(--hover-bg)] p-4 rounded-xl border border-[var(--border-color)]">
        <span className="font-bold text-[var(--text-heading)] text-sm">{label}</span>
        <button 
            onClick={() => onChange(!checked)}
            className={`w-12 h-6 rounded-full relative transition-colors ${checked ? 'bg-[#E07A5F]' : 'bg-[var(--progress-bg)]'}`}
        >
            <div className={`absolute top-1 w-4 h-4 bg-[var(--card-bg)] rounded-full transition-transform shadow-sm ${checked ? 'left-7' : 'left-1'}`}></div>
        </button>
    </div>
);

export const SharedQuestionnaire: React.FC<Props> = ({ data, onChange, mode }) => {
  
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
      identity: true,
      parents: false,
      school: false,
      medical: false,
      reason: false,
      dev: false,
      daily: false
  });

  const [progress, setProgress] = useState(0);

  // Calcul progression
  useEffect(() => {
      if (mode === 'family') {
          let filled = 0;
          const total = 12;
          if (data.lastName && data.firstName) filled++;
          if (data.parentNames) filled++;
          if (data.guardMode) filled++;
          if (data.school && data.classLevel) filled++;
          if (data.prescribingDoctor || (data.medicalTracking?.length ?? 0) > 0) filled++;
          if (data.walkingAge || data.developmentMotor) filled++;
          if (data.clothingButtons || data.eatingHabits) filled++;
          if (data.reason) filled++;
          if ((data.goals?.length ?? 0) > 0) filled++;
          if (data.sensory || data.sleepStatus) filled++;
          if (data.writingPain || data.writingIssues) filled++;
          if (data.continence || data.dressing) filled++;
          
          setProgress(Math.round((filled / total) * 100));
      }
  }, [data, mode]);

  const toggleSection = (id: SectionKey, forceState?: boolean) => {
      setOpenSections(prev => ({ 
          ...prev, 
          [id]: forceState !== undefined ? forceState : !prev[id] 
      }));
  };

  const openNextSection = (currentId: SectionKey) => {
      const currentIndex = SECTIONS_CONFIG.findIndex(s => s.id === currentId);
      if (currentIndex < SECTIONS_CONFIG.length - 1) {
          const nextId = SECTIONS_CONFIG[currentIndex + 1].id;
          toggleSection(currentId, false); // Ferme l'actuelle
          toggleSection(nextId, true); // Ouvre la suivante
          setTimeout(() => {
              const el = document.getElementById(`section-${nextId}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 300);
      }
  };

  const handleFieldChange = (field: keyof Patient, value: any) => {
      if (field === 'dob') {
          onChange({ [field]: value, age: calculateAge(value) });
      } else {
          onChange({ [field]: value });
      }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onChange({ [e.target.name]: e.target.value });
  };

  // --- LOGIQUE LISTES ---

  const addSibling = () => {
      onChange({ siblings: [...(data.siblings || []), { firstName: '', age: '', relation: 'FrÃ¨re', livesWithChild: true }] });
  };
  const updateSibling = (idx: number, field: keyof Sibling, val: any) => {
      const newSiblings = [...(data.siblings || [])];
      newSiblings[idx] = { ...newSiblings[idx], [field]: val };
      onChange({ siblings: newSiblings });
  };
  const removeSibling = (idx: number) => {
      const newSiblings = [...(data.siblings || [])];
      newSiblings.splice(idx, 1);
      onChange({ siblings: newSiblings });
  };

  const addMedicalTracking = () => {
      const newItem: ParamedicalTracking = { 
          id: crypto.randomUUID(), type: 'Orthophoniste', name: '', frequency: '1x/semaine', since: '', contact: '', reason: '' 
      };
      onChange({ medicalTracking: [...(data.medicalTracking || []), newItem] });
  };
  const updateMedicalTracking = (idx: number, field: keyof ParamedicalTracking, val: any) => {
      const newTracking = [...(data.medicalTracking || [])];
      newTracking[idx] = { ...newTracking[idx], [field]: val };
      onChange({ medicalTracking: newTracking });
  };
  const removeMedicalTracking = (idx: number) => {
      const newTracking = [...(data.medicalTracking || [])];
      newTracking.splice(idx, 1);
      onChange({ medicalTracking: newTracking });
  };

  // --- LOGIQUE OBJECTIFS (PrioritÃ©s) ---
  const goals = data.goals || [];
  const addGoal = (text: string) => {
      if (!text.trim()) return;
      const newGoals = [...goals, text];
      onChange({ goals: newGoals, priorities: newGoals.join('. ') }); // Sync legacy
  };
  const removeGoal = (idx: number) => {
      const newGoals = [...goals];
      newGoals.splice(idx, 1);
      onChange({ goals: newGoals, priorities: newGoals.join('. ') });
  };
  const [tempGoal, setTempGoal] = useState('');

  const inputClass = "w-full p-3 bg-[var(--input-bg)] rounded-xl border border-[var(--input-border)] outline-none focus:border-[#E07A5F] focus:bg-[var(--card-bg)] transition-all font-bold text-[var(--text-heading)] text-sm";
  const labelClass = "text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1 mb-1 block";

  const FamilyNextButton = ({ sectionId }: { sectionId: SectionKey }) => {
      if (mode !== 'family') return null;
      const isLast = sectionId === SECTIONS_CONFIG[SECTIONS_CONFIG.length - 1].id;
      return (
          <div className="flex justify-end mt-6 pt-4 border-t border-[var(--border-color)]">
              <button 
                  onClick={() => openNextSection(sectionId)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all ${isLast ? 'bg-emerald-500' : 'bg-[#3D405B] hover:bg-[#E07A5F]'}`}
              >
                  {isLast ? "Terminer la saisie" : "Valider et Suivant"}
                  {!isLast && <ArrowRight size={16} />}
              </button>
          </div>
      );
  };

  return (
    <div className="space-y-6 pb-20">
        {mode === 'family' && (
            <div className="sticky top-20 z-30 bg-[var(--app-bg)] pt-4 pb-4 border-b border-[var(--border-color)] mb-6">
                <div className="flex justify-between text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-2">
                    <span>Progression</span>
                    <span>{progress}%</span>
                </div>
                <div className="h-2 bg-[var(--progress-bg)] rounded-full overflow-hidden">
                    <div className="h-full bg-[#E07A5F] transition-all duration-500" style={{ width: `${progress}%` }}></div>
                </div>
            </div>
        )}

        {SECTIONS_CONFIG.map((section) => {
            const isOpen = openSections[section.id];
            
            return (
                <div id={`section-${section.id}`} key={section.id} className={`rounded-[24px] border transition-all duration-300 overflow-hidden ${isOpen ? 'shadow-md border-[#E07A5F]/30 bg-[var(--card-bg)]' : 'shadow-sm hover:shadow border-[var(--border-color)] bg-[var(--card-bg)]'}`}>
                    <button 
                        onClick={() => toggleSection(section.id)}
                        className={`w-full flex items-center justify-between p-5 transition-colors ${isOpen ? 'bg-[var(--card-bg)]' : 'bg-[var(--card-bg-raised)]'}`}
                    >
                        <div className="flex items-center gap-4">
                            <div className={`p-2.5 rounded-xl ${isOpen ? 'bg-[#fff5f2] dark:bg-[#E07A5F]/15 text-[#E07A5F]' : 'bg-[var(--hover-bg)] text-[var(--text-secondary)]'}`}>
                                <section.icon size={20} />
                            </div>
                            <h3 className={`font-serif font-bold text-lg ${isOpen ? 'text-[var(--text-heading)]' : 'text-[var(--text-secondary)]'}`}>
                                {section.title}
                            </h3>
                        </div>
                        <div className={`p-2 rounded-full ${isOpen ? 'text-[#E07A5F] bg-[#fff5f2] dark:bg-[#E07A5F]/15' : 'text-[var(--text-disabled)]'}`}>
                            {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                    </button>

                    {isOpen && (
                        <div className="p-6 border-t border-[var(--border-color)] animate-in slide-in-from-top-2 space-y-6">
                            
                            {/* --- 1. IDENTITÃ‰ (ENCART BLEU ARDOISE) --- */}
                            {section.id === 'identity' && (
                                <>
                                    <div className="bg-[var(--card-bg-raised)] border border-[var(--border-color)] p-5 rounded-2xl relative overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 text-[var(--text-secondary)]">
                                            <User size={16} />
                                            <h4 className="text-xs font-bold uppercase tracking-wider">Ã‰tat Civil</h4>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 relative z-10">
                                            <div><label className={labelClass}>Nom</label><DebouncedInput name="lastName" value={data.lastName || ''} onChange={(v) => handleFieldChange('lastName', v)} className={inputClass} placeholder="Nom de famille" /></div>
                                            <div><label className={labelClass}>PrÃ©nom</label><DebouncedInput name="firstName" value={data.firstName || ''} onChange={(v) => handleFieldChange('firstName', v)} className={inputClass} placeholder="PrÃ©nom" /></div>
                                            <div><label className={labelClass}>Date de naissance</label><input type="date" name="dob" value={data.dob || ''} onChange={handleChange} className={inputClass} /></div>
                                            <div>
                                                <label className={labelClass}>Genre</label>
                                                <div className="flex gap-4 pt-2">
                                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="gender" value="M" checked={data.gender === 'M'} onChange={handleChange} className="accent-[#E07A5F] w-4 h-4"/> GarÃ§on</label>
                                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="gender" value="F" checked={data.gender === 'F'} onChange={handleChange} className="accent-[#E07A5F] w-4 h-4"/> Fille</label>
                                                </div>
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className={labelClass}>Adresse</label>
                                                <div className="relative">
                                                    <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                                                    <DebouncedInput name="address" value={data.address || ''} onChange={(v) => handleFieldChange('address', v)} className={`${inputClass} pl-10`} placeholder="Adresse complÃ¨te" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <FamilyNextButton sectionId={section.id} />
                                </>
                            )}

                            {/* --- 2. SITUATION FAMILIALE (ENCART BLEU ARDOISE) --- */}
                            {section.id === 'parents' && (
                                <div className="space-y-6">
                                    <div className="bg-[var(--card-bg-raised)] border border-[var(--border-color)] p-5 rounded-2xl">
                                        <div className="flex items-center gap-2 mb-4 text-[var(--text-secondary)]">
                                            <Users size={16} />
                                            <h4 className="text-xs font-bold uppercase tracking-wider">Responsables LÃ©gaux</h4>
                                        </div>
                                        
                                        <div className="space-y-5">
                                            <div className="space-y-2">
                                                <label className={labelClass}>Mode de Garde</label>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                    <SelectCard 
                                                        selected={data.guardMode === 'commune'} 
                                                        onClick={() => handleFieldChange('guardMode', 'commune')}
                                                        label="Garde Commune" 
                                                        value="commune" 
                                                        icon={Heart} 
                                                    />
                                                    <SelectCard 
                                                        selected={data.guardMode === 'alternate'} 
                                                        onClick={() => handleFieldChange('guardMode', 'alternate')}
                                                        label="Garde AlternÃ©e" 
                                                        value="alternate" 
                                                        icon={Scale} 
                                                    />
                                                    <SelectCard 
                                                        selected={(data.guardMode || '').startsWith('exclusive')} 
                                                        onClick={() => handleFieldChange('guardMode', data.guardMode?.startsWith('exclusive') ? data.guardMode : 'exclusive_mere')}
                                                        label="Garde Exclusive" 
                                                        value="exclusive" 
                                                        icon={Home} 
                                                    />
                                                    <SelectCard 
                                                        selected={data.guardMode === 'third'} 
                                                        onClick={() => handleFieldChange('guardMode', 'third')}
                                                        label="Tiers / Foyer" 
                                                        value="third" 
                                                        icon={HelpingHand} 
                                                    />
                                                </div>
                                                {(data.guardMode || '').startsWith('exclusive') && (
                                                    <div className="flex gap-4 mt-3 ml-1 animate-in slide-in-from-top-2">
                                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="exclusiveParent" value="exclusive_mere" checked={data.guardMode === 'exclusive_mere'} onChange={() => handleFieldChange('guardMode', 'exclusive_mere')} className="accent-[#E07A5F] w-4 h-4"/> Chez la mÃ¨re</label>
                                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="exclusiveParent" value="exclusive_pere" checked={data.guardMode === 'exclusive_pere'} onChange={() => handleFieldChange('guardMode', 'exclusive_pere')} className="accent-[#E07A5F] w-4 h-4"/> Chez le pÃ¨re</label>
                                                    </div>
                                                )}
                                            </div>

                                            <div><label className={labelClass}>Noms des responsables</label><DebouncedInput name="parentNames" value={data.parentNames || ''} onChange={(v) => handleFieldChange('parentNames', v)} className={inputClass} placeholder="Mme X et M. Y" /></div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                <div>
                                                    <label className={labelClass}>TÃ©lÃ©phone</label>
                                                    <div className="relative">
                                                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                                                        <DebouncedInput name="parentPhone" type="tel" value={data.parentPhone || ''} onChange={(v) => handleFieldChange('parentPhone', v)} className={`${inputClass} pl-10`} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className={labelClass}>Email</label>
                                                    <div className="relative">
                                                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                                                        <DebouncedInput name="parentEmail" type="email" value={data.parentEmail || ''} onChange={(v) => handleFieldChange('parentEmail', v)} className={`${inputClass} pl-10`} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* FRATRIE (Reste en Stone pour diffÃ©rencier) */}
                                    <div className="bg-[var(--hover-bg)] p-4 rounded-2xl border border-[var(--border-color)]">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><HeartHandshake size={14}/> Fratrie</span>
                                            <button onClick={addSibling} className="text-[10px] bg-[var(--card-bg)] border border-[var(--border-color)] px-3 py-1.5 rounded-full uppercase font-bold tracking-wider hover:bg-[#3D405B] hover:text-white transition-all flex items-center gap-1 text-[var(--text-secondary)]"><Plus size={12}/> Ajouter</button>
                                        </div>
                                        <div className="space-y-2">
                                            {(data.siblings || []).map((sib, idx) => (
                                                <div key={idx} className="flex gap-2 items-center animate-in slide-in-from-left-2">
                                                    <input placeholder="PrÃ©nom" value={sib.firstName} onChange={e => updateSibling(idx, 'firstName', e.target.value)} className="flex-1 p-2 bg-[var(--input-bg)] rounded-lg text-sm border border-[var(--input-border)] outline-none focus:border-[#E07A5F] text-[var(--text-heading)]" />
                                                    <input placeholder="Ã‚ge" value={sib.age} onChange={e => updateSibling(idx, 'age', e.target.value)} className="w-16 p-2 bg-[var(--input-bg)] rounded-lg text-sm border border-[var(--input-border)] outline-none focus:border-[#E07A5F] text-[var(--text-heading)]" />
                                                    <select value={sib.relation} onChange={e => updateSibling(idx, 'relation', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs font-bold border border-[var(--input-border)] outline-none focus:border-[#E07A5F] text-[var(--text-heading)]">
                                                        <option value="FrÃ¨re">FrÃ¨re</option>
                                                        <option value="SÅ“ur">SÅ“ur</option>
                                                        <option value="Demi-frÃ¨re">Demi-frÃ¨re</option>
                                                        <option value="Demi-sÅ“ur">Demi-sÅ“ur</option>
                                                    </select>
                                                    
                                                    {/* BOUTON VIT AVEC ENFANT */}
                                                    <button 
                                                        onClick={() => updateSibling(idx, 'livesWithChild', !sib.livesWithChild)}
                                                        className={`p-2 rounded-lg border transition-all ${sib.livesWithChild ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700/30 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-disabled)]'}`}
                                                        title={sib.livesWithChild ? "Vit au domicile" : "Ne vit pas au domicile"}
                                                    >
                                                        <Home size={16} />
                                                    </button>

                                                    <button onClick={() => removeSibling(idx)} className="p-2 text-[var(--text-disabled)] hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-all"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                            {(!data.siblings || data.siblings.length === 0) && <p className="text-xs text-[var(--text-secondary)] italic text-center py-2">Aucun frÃ¨re ou sÅ“ur renseignÃ©.</p>}
                                        </div>
                                    </div>
                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 3. SCOLARITÃ‰ (AVEC AVS & OBSERVATIONS) --- */}
                            {section.id === 'school' && (
                                <div className="space-y-5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div><label className={labelClass}>Ã‰cole</label><DebouncedInput name="school" value={data.school || ''} onChange={(v) => handleFieldChange('school', v)} className={inputClass} /></div>
                                        <div>
                                            <label className={labelClass}>Classe</label>
                                            <select name="classLevel" value={data.classLevel || ''} onChange={handleChange} className={inputClass}>
                                                <option value="">SÃ©lectionner...</option>
                                                {SCHOOL_LEVELS.map(level => (
                                                    <option key={level} value={level}>{level}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    
                                    {/* BLOC AVS */}
                                    <div className="bg-[#fff9f9] dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800/20 p-4 rounded-2xl">
                                        <ToggleSwitch 
                                            label="Une AESH / AVS est-elle prÃ©sente ?" 
                                            checked={data.avs === 'OUI'} 
                                            onChange={(checked) => handleFieldChange('avs', checked ? 'OUI' : 'NON')} 
                                        />
                                        
                                        {data.avs === 'OUI' && (
                                            <div className="mt-4 pt-4 border-t border-rose-100 dark:border-rose-800/20 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top-2">
                                                <div>
                                                    <label className={labelClass}>Nombre d'heures / semaine</label>
                                                    <input 
                                                        type="text" 
                                                        value={data.avsHours || ''} 
                                                        onChange={(e) => handleFieldChange('avsHours', e.target.value)} 
                                                        className="w-full p-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm font-bold text-[var(--text-heading)] outline-none" 
                                                        placeholder="Ex: 12h"
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelClass}>Missions principales</label>
                                                    <input 
                                                        type="text" 
                                                        value={data.avsMissions || ''} 
                                                        onChange={(e) => handleFieldChange('avsMissions', e.target.value)} 
                                                        className="w-full p-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-heading)] outline-none" 
                                                        placeholder="Repas, Ã‰criture, Comportement..."
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className={labelClass}>Dispositifs scolaires</label>
                                        <ChipGroup 
                                            options={[{value: 'PAP', label: 'PAP'}, {value: 'PAI', label: 'PAI'}, {value: 'PPS', label: 'PPS'}, {value: 'PPRE', label: 'PPRE'}]}
                                            value={data.carePlan}
                                            onChange={(v) => handleFieldChange('carePlan', v)}
                                            multi
                                        />
                                    </div>

                                    {/* COMPORTEMENT SCOLAIRE (Page 4 PDF) */}
                                    <div className="bg-[var(--hover-bg)] p-4 rounded-2xl border border-[var(--border-color)] mt-6 space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><Book size={14}/> Vie Scolaire & Sociale</h4>
                                        
                                        <div>
                                            <label className={labelClass}>Attention & Participation (En classe)</label>
                                            <DebouncedInput name="schoolAttention" value={data.schoolAttention || ''} onChange={(v) => handleFieldChange('schoolAttention', v)} className={inputClass} placeholder="Attentif, rÃªveur, participe..." />
                                        </div>
                                        
                                        <div>
                                            <label className={labelClass}>Relations avec les camarades</label>
                                            <DebouncedInput name="socialBehavior" value={data.socialBehavior || ''} onChange={(v) => handleFieldChange('socialBehavior', v)} className={inputClass} placeholder="Copains, rÃ©crÃ©ation, conflits..." />
                                        </div>

                                        <div>
                                            <label className={labelClass}>AmÃ©nagements classe (hors AVS)</label>
                                            <DebouncedTextarea name="schoolAccommodations" value={data.schoolAccommodations || ''} onChange={(v) => handleFieldChange('schoolAccommodations', v)} className={inputClass} placeholder="Tiers-temps, photocopies, placement devant..." rows={2} />
                                        </div>
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 4. MÃ‰DICAL --- */}
                            {section.id === 'medical' && (
                                <div className="space-y-6">
                                    
                                    {/* HAUT DE PAGE 3 PDF */}
                                    <div className="bg-[var(--card-bg)] p-4 rounded-2xl border border-[var(--border-color)] mb-4 space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><Stethoscope size={14}/> Cadre MÃ©dical</h4>
                                        <div><label className={labelClass}>MÃ©decin prescripteur</label><DebouncedInput name="prescribingDoctor" value={data.prescribingDoctor || ''} onChange={(v) => handleFieldChange('prescribingDoctor', v)} className={inputClass} placeholder="Nom du mÃ©decin" /></div>
                                        <div><label className={labelClass}>Diagnostics mÃ©dicaux</label><DebouncedInput name="medicalDiagnosis" value={data.medicalDiagnosis || ''} onChange={(v) => handleFieldChange('medicalDiagnosis', v)} className={inputClass} placeholder="Si connu (ex: TDAH, Dys...)" /></div>
                                        <div><label className={labelClass}>Traitements en cours</label><DebouncedInput name="medicalTreatments" value={data.medicalTreatments || ''} onChange={(v) => handleFieldChange('medicalTreatments', v)} className={inputClass} placeholder="MÃ©dicaments, lunettes..." /></div>
                                    </div>

                                    {/* TABLEAU SUIVI PARAMÃ‰DICAL */}
                                    <div className="bg-[#f0fdf4] dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/20 p-4 rounded-2xl">
                                        <div className="flex justify-between items-center mb-4">
                                            <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-2"><Activity size={14}/> Suivi ExtÃ©rieur</h4>
                                            <button onClick={addMedicalTracking} className="text-[10px] bg-[var(--card-bg)] text-emerald-500 border border-emerald-500/30 px-3 py-1.5 rounded-full uppercase font-bold tracking-wider hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-1"><Plus size={12}/> Ajouter un pro</button>
                                        </div>
                                        <div className="space-y-3">
                                            {(data.medicalTracking || []).map((track, idx) => (
                                                <div key={track.id || idx} className="bg-[var(--card-bg)] p-3 rounded-xl border border-emerald-500/20 shadow-sm flex flex-col md:flex-row gap-3 items-start md:items-center">
                                                    <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-2 w-full">
                                                        <select value={track.type} onChange={(e) => updateMedicalTracking(idx, 'type', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs font-bold text-[var(--text-heading)] border border-[var(--input-border)] outline-none">
                                                            <option>Orthophoniste</option><option>Psychomotricien</option><option>Psychologue</option><option>Neuropsychologue</option><option>KinÃ©</option><option>Orthoptiste</option><option>ErgothÃ©rapeute</option><option>PÃ©dopsychiatre</option><option>NeuropÃ©diatre</option><option>Ophtalmologue</option><option>Podologue</option><option>ORL</option><option>Autre</option>
                                                        </select>
                                                        <input 
                                                            placeholder="Nom" 
                                                            value={track.name} 
                                                            onChange={(e) => updateMedicalTracking(idx, 'name', e.target.value)} 
                                                            className="p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none text-[var(--text-heading)]" 
                                                        />
                                                        <input placeholder="Motif..." value={track.reason || ''} onChange={(e) => updateMedicalTracking(idx, 'reason', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none md:col-span-1 text-[var(--text-heading)]" />
                                                        <input placeholder="FrÃ©quence" value={track.frequency} onChange={(e) => updateMedicalTracking(idx, 'frequency', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none text-[var(--text-heading)]" />
                                                        <input placeholder="Depuis..." value={track.since} onChange={(e) => updateMedicalTracking(idx, 'since', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none text-[var(--text-heading)]" />
                                                    </div>
                                                    <button onClick={() => removeMedicalTracking(idx)} className="p-2 text-rose-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                            {(!data.medicalTracking || data.medicalTracking.length === 0) && <p className="text-xs text-[var(--text-secondary)] italic text-center">Aucun suivi renseignÃ©.</p>}
                                        </div>
                                    </div>
                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 5. DÃ‰VELOPPEMENT --- */}
                            {section.id === 'dev' && (
                                <div className="space-y-6">
                                    {/* Grossesse / naissance */}
                                    <div>
                                        <label className={labelClass}>Grossesse & Naissance (particularitÃ©s)</label>
                                        <DebouncedTextarea name="pregnancyBirth" value={data.pregnancyBirth || ''} onChange={(v) => handleFieldChange('pregnancyBirth', v)} className={inputClass} placeholder="Naissance Ã  terme, prÃ©maturÃ©, complications, cÃ©sarienne, poids de naissance..." rows={2} />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className={labelClass}>Ã‚ge de la marche</label>
                                            <div className="flex items-center gap-2">
                                                <input type="number" value={parseInt(data.walkingAge || '0') || ''} onChange={(e) => handleFieldChange('walkingAge', e.target.value + ' mois')} className="w-20 p-2 bg-[var(--input-bg)] rounded-lg font-bold text-center border border-[var(--input-border)] outline-none focus:border-[#E07A5F] text-[var(--text-heading)]" placeholder="Mois" />
                                                <span className="text-sm font-bold text-[var(--text-secondary)]">mois</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className={labelClass}>4 pattes / Ramper ?</label>
                                            <ChipGroup 
                                                options={[{value: 'oui', label: 'Oui'}, {value: 'non', label: 'Non'}, {value: 'atypique', label: 'Atypique (Fesses)'}, {value: 'inconnu', label: 'Ne sais pas'}]}
                                                value={data.crawling} 
                                                onChange={(v) => handleFieldChange('crawling', v)} 
                                            />
                                        </div>
                                    </div>

                                    {/* DÃ©veloppement moteur */}
                                    <div>
                                        <label className={labelClass}>DÃ©veloppement moteur</label>
                                        <DebouncedTextarea name="developmentMotor" value={data.developmentMotor || ''} onChange={(v) => handleFieldChange('developmentMotor', v)} className={inputClass} placeholder="Marcher, courir, grimper, sauter, pÃ©daler, Ã©quilibre..." rows={2} />
                                    </div>

                                    {/* PropretÃ© */}
                                    <div>
                                        <label className={labelClass}>PropretÃ©</label>
                                        <ChipGroup 
                                            options={[{value: 'acquise', label: 'Acquise jour/nuit'}, {value: 'jour_seul', label: 'Jour uniquement'}, {value: 'en_cours', label: 'En cours'}, {value: 'accidents', label: 'Accidents frÃ©quents'}, {value: 'enuresie', label: 'Ã‰nurÃ©sie nocturne'}]}
                                            value={data.cleanliness} 
                                            onChange={(v) => handleFieldChange('cleanliness', v)} 
                                        />
                                    </div>

                                    {/* Langage */}
                                    <div>
                                        <label className={labelClass}>Langage (plusieurs choix possibles)</label>
                                        <ChipGroup 
                                            options={[{value: 'standard', label: 'Apparition standard'}, {value: 'retard', label: 'Retard simple'}, {value: 'suivi_ortho', label: 'Suivi Ortho'}, {value: 'inintelligible', label: 'Difficile Ã  comprendre'}, {value: 'begaiement', label: 'BÃ©gaiement'}]}
                                            value={data.languageStatus} 
                                            onChange={(v) => handleFieldChange('languageStatus', v)}
                                            multi
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>DÃ©veloppement du langage (dÃ©tails)</label>
                                        <DebouncedTextarea name="developmentLanguage" value={data.developmentLanguage || ''} onChange={(v) => handleFieldChange('developmentLanguage', v)} className={inputClass} placeholder="Premiers mots, phrases, comprÃ©hension, bilinguisme..." rows={2} />
                                    </div>

                                    {/* Sommeil */}
                                    <div>
                                        <label className={labelClass}>Sommeil (plusieurs choix possibles)</label>
                                        <ChipGroup 
                                            options={[{value: 'ok', label: 'Paisible'}, {value: 'endormissement', label: 'Endormissement long'}, {value: 'reveils', label: 'RÃ©veils multiples'}, {value: 'agite', label: 'AgitÃ© / Cauchemars'}, {value: 'fatigue_diurne', label: 'Fatigue en journÃ©e'}]}
                                            value={data.sleepStatus} 
                                            onChange={(v) => handleFieldChange('sleepStatus', v)}
                                            multi
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>DÃ©tails sommeil (heures, rituels...)</label>
                                        <DebouncedInput name="sleep" value={data.sleep || ''} onChange={(v) => handleFieldChange('sleep', v)} className={inputClass} placeholder="Heure coucher/lever, durÃ©e, rituel..." />
                                    </div>

                                    {/* Sensoriel */}
                                    <div>
                                        <label className={labelClass}>ParticularitÃ©s Sensorielles</label>
                                        <DebouncedTextarea name="sensory" value={data.sensory || ''} onChange={(v) => handleFieldChange('sensory', v)} className={inputClass} placeholder="HypersensibilitÃ© (Bruit, LumiÃ¨re, Ã‰tiquettes, Textures alimentaires...)" rows={2} />
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 6. VIE QUOTIDIENNE & OUTILS --- */}
                            {section.id === 'daily' && (
                                <div className="space-y-8">
                                    
                                    {/* REPAS (Page 4 PDF) */}
                                    <div className="bg-[#fffbf0] dark:bg-amber-950/20 border border-amber-100 dark:border-amber-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Utensils size={14}/> Repas</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Autonomie & Habitudes (plusieurs choix possibles)</label>
                                                <ChipGroup 
                                                    options={[{value: 'seul', label: 'Mange seul'}, {value: 'aide', label: 'A besoin d\'aide'}, {value: 'couverts_ok', label: 'Bonne utilisation couverts'}, {value: 'doigts', label: 'Mange avec les doigts'}, {value: 'selectif', label: 'TrÃ¨s sÃ©lectif'}, {value: 'salit', label: 'Salit beaucoup'}]}
                                                    value={data.eatingHabits} 
                                                    onChange={(v) => handleFieldChange('eatingHabits', v)}
                                                    multi
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Commentaires (Couverts, propretÃ©...)</label>
                                                <DebouncedTextarea name="meals" value={data.meals || ''} onChange={(v) => handleFieldChange('meals', v)} className={inputClass} placeholder="Utilisation des couverts, comportement Ã  table..." rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* HABILLAGE */}
                                    <div className="bg-[#fff9f9] dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Shirt size={14}/> Habillage</h4>
                                        <div className="space-y-4">
                                            {[{key: 'clothingButtons', label: 'Boutons'}, {key: 'clothingLaces', label: 'Lacets'}, {key: 'clothingZippers', label: 'Fermetures Ã‰clair'}].map((item) => (
                                                <div key={item.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-rose-100 dark:border-rose-800/20 last:border-0 pb-2">
                                                    <span className="text-sm font-bold text-[var(--text-main)]">{item.label}</span>
                                                    <div className="flex gap-2">
                                                        {['acquis', 'difficile', 'aide_totale'].map(opt => (
                                                            <label key={opt} className="cursor-pointer">
                                                                <input type="radio" name={item.key} value={opt} checked={(data as any)[item.key] === opt} onChange={handleChange} className="peer sr-only"/>
                                                                <div className="px-3 py-1 rounded-lg border border-[var(--border-color)] text-[10px] font-bold uppercase text-[var(--text-secondary)] peer-checked:bg-[#E07A5F] peer-checked:text-white peer-checked:border-[#E07A5F] transition-all">
                                                                    {opt === 'acquis' ? 'Facile' : opt === 'difficile' ? 'Difficile' : 'Impossible'}
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="mt-2">
                                                <label className={labelClass}>Commentaire habillage (choix des vÃªtements, autonomie...)</label>
                                                <DebouncedTextarea name="dressing" value={data.dressing || ''} onChange={(v) => handleFieldChange('dressing', v)} className={inputClass} placeholder="Choisit-il ses vÃªtements ? Met-il ses chaussures seul ? Enfile un manteau ?" rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* HYGIÃˆNE & CONTINENCE */}
                                    <div className="bg-[#f0fdf4] dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Droplets size={14}/> HygiÃ¨ne & Continence</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Toilettes, douche/bain, brossage des dents...</label>
                                                <DebouncedTextarea name="continence" value={data.continence || ''} onChange={(v) => handleFieldChange('continence', v)} className={inputClass} placeholder="Va-t-il aux toilettes seul ? Se lave les mains ? Se brosse les dents seul ? Douche autonome ?" rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* AJOUT TEMPS/ESPACE */}
                                    <div>
                                        <label className={labelClass}>RepÃ©rage Temps & Espace</label>
                                        <DebouncedTextarea name="timeSpace" value={data.timeSpace || ''} onChange={(v) => handleFieldChange('timeSpace', v)} className={inputClass} placeholder="Se repÃ¨re-t-il dans la journÃ©e ? La semaine ? Retrouve-t-il son chemin ? Lit-il lâ€™heure ?" rows={2} />
                                    </div>

                                    {/* OUTILS SCOLAIRES */}
                                    <div className="bg-[#f0f9ff] dark:bg-sky-950/20 border border-sky-100 dark:border-sky-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-sky-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Scissors size={14}/> Trousse & Ã‰criture</h4>
                                        
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Main dominante</label>
                                                <ChipGroup options={[{value: 'Droitier', label: 'Droitier'}, {value: 'Gaucher', label: 'Gaucher'}, {value: 'IndeterminÃ©', label: 'Change encore'}]} value={data.handDominance} onChange={(v) => handleFieldChange('handDominance', v)} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>DÃ©coupage (Ciseaux)</label>
                                                <ChipGroup options={[{value: 'ok', label: 'Suit la ligne'}, {value: 'hache', label: 'Hache le papier'}, {value: 'tenue_incorrecte', label: 'Tenue incorrecte'}, {value: 'ne_sait_pas', label: 'Ne sait pas utiliser'}, {value: 'refuse', label: 'Refuse'}]} value={data.toolScissors} onChange={(v) => handleFieldChange('toolScissors', v)} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Autres outils scolaires (compas, rÃ¨gle, gomme...)</label>
                                                <DebouncedTextarea name="toolUsage" value={data.toolUsage || ''} onChange={(v) => handleFieldChange('toolUsage', v)} className={inputClass} placeholder="Utilise-t-il le compas, la rÃ¨gle, la gomme correctement ?" rows={2} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>DifficultÃ©s dâ€™Ã©criture</label>
                                                <DebouncedTextarea name="writingIssues" value={data.writingIssues || ''} onChange={(v) => handleFieldChange('writingIssues', v)} className={inputClass} placeholder="Lettres en miroir, saut de lignes, lisibilitÃ©, tenue du crayon, lenteur..." rows={2} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Douleur en Ã©crivant ?</label>
                                                <ChipGroup options={[{value: 'non', label: 'Jamais'}, {value: 'oui_long', label: 'Sur longues tÃ¢ches'}, {value: 'oui_vite', label: 'Au bout de 5 min'}, {value: 'oui_constante', label: 'ImmÃ©diate'}]} value={data.writingPain} onChange={(v) => handleFieldChange('writingPain', v)} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* COMPORTEMENT & Ã‰CRANS */}
                                    <div className="bg-[#faf5ff] border border-purple-100 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-purple-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Brain size={14}/> Comportement & Ã‰motions</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Temps dâ€™Ã©cran quotidien estimÃ©</label>
                                                <DebouncedInput name="screenTime" value={data.screenTime || ''} onChange={(v) => handleFieldChange('screenTime', v)} className={inputClass} placeholder="Ex: 1h tablette, 30 min TV..." />
                                            </div>
                                            <div>
                                                <label className={labelClass}>RÃ©gulation Ã©motionnelle</label>
                                                <DebouncedTextarea name="emotionalRegulation" value={data.emotionalRegulation || ''} onChange={(v) => handleFieldChange('emotionalRegulation', v)} className={inputClass} placeholder="ColÃ¨res, frustrations, anxiÃ©tÃ©, difficultÃ© Ã  gÃ©rer les transitions..." rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 7. PRIORITÃ‰S (LISTE 1-5) --- */}
                            {section.id === 'reason' && (
                                <div className="space-y-6">
                                    {/* Motif de consultation */}
                                    <div className="bg-[var(--card-bg-raised)] border border-[var(--border-color)] p-5 rounded-2xl space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><MessageSquare size={14}/> Motif de consultation</h4>
                                        <div>
                                            <label className={labelClass}>Pourquoi consultez-vous en ergothÃ©rapie ?</label>
                                            <DebouncedTextarea name="reason" value={data.reason || ''} onChange={(v) => handleFieldChange('reason', v)} className={inputClass} placeholder="DÃ©crivez ce qui vous amÃ¨ne Ã  consulter (difficultÃ©s scolaires, motrices, comportementales...)" rows={3} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Attentes de la famille</label>
                                            <DebouncedTextarea name="familyExpectations" value={data.familyExpectations || ''} onChange={(v) => handleFieldChange('familyExpectations', v)} className={inputClass} placeholder="Quâ€™attendez-vous de ce bilan ? Quels changements espÃ©rez-vous ?" rows={2} />
                                        </div>
                                    </div>

                                    <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-2xl border border-amber-100 dark:border-amber-800/20">
                                        <h4 className="text-sm font-bold text-amber-900 dark:text-amber-400 mb-2 flex items-center gap-2">
                                            <Smile size={18} /> Vos Objectifs Prioritaires
                                        </h4>
                                        <p className="text-xs text-amber-800 dark:text-amber-300/80 mb-4">Quels sont les 3 Ã  5 problÃ¨mes que vous aimeriez rÃ©soudre en premier ?</p>
                                        
                                        <div className="space-y-2 mb-4">
                                            {goals.map((goal, idx) => (
                                                <div key={idx} className="flex items-center gap-2 bg-[var(--card-bg)] p-3 rounded-xl border border-amber-200/40 shadow-sm animate-in slide-in-from-left-2">
                                                    <span className="font-bold text-amber-500 w-6">{idx + 1}.</span>
                                                    <span className="flex-1 text-sm font-bold text-[var(--text-heading)]">{goal}</span>
                                                    <button onClick={() => removeGoal(idx)} className="text-[var(--text-disabled)] hover:text-rose-500"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                            {goals.length < 5 && (
                                                <div className="flex gap-2">
                                                    <input 
                                                        value={tempGoal}
                                                        onChange={(e) => setTempGoal(e.target.value)}
                                                        onKeyDown={(e) => { if(e.key === 'Enter') { addGoal(tempGoal); setTempGoal(''); } }}
                                                        placeholder="Ajouter un objectif..."
                                                        className="flex-1 p-3 rounded-xl border border-[var(--border-color)] text-sm outline-none focus:border-amber-400 bg-[var(--input-bg)] text-[var(--text-heading)]"
                                                    />
                                                    <button onClick={() => { addGoal(tempGoal); setTempGoal(''); }} className="bg-amber-400 text-white p-3 rounded-xl hover:bg-amber-500 transition-colors"><Plus size={18}/></button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Suggestions */}
                                        <div className="flex flex-wrap gap-2">
                                            {["\u00c9criture lisible", "Faire ses lacets", "Manger proprement", "Rester assis", "Moins de col\u00e8res", "Utiliser la r\u00e8gle", "S'habiller seul", "Autonomie toilettes", "Organiser son cartable", "Lire l'heure", "Se concentrer en classe", "G\u00e9rer ses \u00e9motions", "D\u00e9couper proprement", "Tenir son crayon", "Copier du tableau"].map(sug => (
                                                <button key={sug} onClick={() => addGoal(sug)} className="px-3 py-1 bg-[var(--card-bg)] border border-amber-200/40 rounded-full text-xs font-bold text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-all">+ {sug}</button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className={labelClass}>Remarques complÃ©mentaires</label>
                                        <DebouncedTextarea name="remarks" value={data.remarks || ''} onChange={(v) => handleFieldChange('remarks', v)} className={inputClass} rows={3} placeholder="Informations sensibles, contexte particulier, Ã©lÃ©ments difficiles Ã  Ã©voquer devant lâ€™enfant..." />
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                        </div>
                    )}
                </div>
            );
        })}
    </div>
  );
};
