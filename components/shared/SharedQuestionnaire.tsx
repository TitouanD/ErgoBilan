
import React, { useState, useEffect } from 'react';
import type { Patient, Sibling, ParamedicalTracking } from '../../types';
import { calculateAge } from '../../utils';
import { DebouncedInput, DebouncedTextarea } from './DebouncedControls';
import { User, Users, GraduationCap, Stethoscope, Baby, Coffee, MessageSquare, ChevronDown, ChevronUp, Check, Plus, Trash2, Home, HelpingHand, Scissors, Ruler, Utensils, Shirt, Activity, Smile, ArrowRight, Book, Clock, HeartHandshake, Eye, MapPin, Mail, Phone, Monitor, Droplets, PenTool, Brain, Repeat } from 'lucide-react';

interface Props {
  data: Patient;
  onChange: (data: Partial<Patient>) => void;
  mode: 'family' | 'practitioner';
}

type SectionKey = 'identity' | 'parents' | 'medical' | 'reason' | 'dev' | 'daily' | 'school' | 'emotions' | 'goals';

const SECTIONS_CONFIG: { id: SectionKey; title: string; icon: any }[] = [
    { id: 'identity', title: "Identité de l'enfant", icon: User },
    { id: 'parents', title: "Situation familiale", icon: Users },
    { id: 'medical', title: "Suivi médical", icon: Stethoscope },
    { id: 'reason', title: "Motif de consultation", icon: MessageSquare },
    { id: 'dev', title: "Développement", icon: Baby },
    { id: 'daily', title: "Vie quotidienne", icon: Coffee },
    { id: 'school', title: "Vie scolaire", icon: GraduationCap },
    { id: 'emotions', title: "Gestion des émotions", icon: Brain },
    { id: 'goals', title: "Vos objectifs prioritaires", icon: Smile },
];

const SCHOOL_LEVELS = [
    "PS (Petite Section)", "MS (Moyenne Section)", "GS (Grande Section)",
    "CP", "CE1", "CE2", "CM1", "CM2",
    "6ème", "5ème", "4ème", "3ème",
    "2nde", "1ère", "Terminale",
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
      medical: false,
      reason: false,
      dev: false,
      daily: false,
      school: false,
      emotions: false,
      goals: false
  });

  const [progress, setProgress] = useState(0);

  // Calcul progression
  useEffect(() => {
      if (mode === 'family') {
          let filled = 0;
          const total = 13;
          if (data.lastName && data.firstName) filled++;
          if (data.parent1Name || data.parent2Name || data.parentNames) filled++;
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
          if (data.emotionalRegulation || data.screenTime) filled++;
          
          setProgress(Math.round((filled / total) * 100));
      }
  }, [data, mode]);

  const toggleSection = (id: SectionKey, forceState?: boolean) => {
      setOpenSections(prev => {
          const shouldOpen = forceState !== undefined ? forceState : !prev[id];
          if (!shouldOpen) {
              return {
                  identity: false,
                  parents: false,
                  medical: false,
                  reason: false,
                  dev: false,
                  daily: false,
                  school: false,
                  emotions: false,
                  goals: false
              };
          }
          return {
              identity: false,
              parents: false,
              medical: false,
              reason: false,
              dev: false,
              daily: false,
              school: false,
              emotions: false,
              goals: false,
              [id]: true
          };
      });
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
      onChange({ siblings: [...(data.siblings || []), { firstName: '', age: '', relation: 'Frère', livesWithChild: true, livesPartially: false, residenceStatus: 'with' }] });
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

  // --- LOGIQUE OBJECTIFS (Priorités) ---
  const goals = data.goals || [];

  const syncLegacyParentFields = (nextData: Partial<Patient>) => {
      const parent1Name = nextData.parent1Name ?? data.parent1Name ?? '';
      const parent2Name = nextData.parent2Name ?? data.parent2Name ?? '';
      const parent1Phone = nextData.parent1Phone ?? data.parent1Phone ?? '';
      const parent2Phone = nextData.parent2Phone ?? data.parent2Phone ?? '';
      const parent1Email = nextData.parent1Email ?? data.parent1Email ?? '';
      const parent2Email = nextData.parent2Email ?? data.parent2Email ?? '';

      const mergedNames = [parent1Name, parent2Name].filter(Boolean).join(' / ');
      const mergedPhones = [parent1Phone, parent2Phone].filter(Boolean).join(' / ');
      const mergedEmails = [parent1Email, parent2Email].filter(Boolean).join(' / ');

      onChange({
          ...nextData,
          parentNames: mergedNames,
          parentPhone: mergedPhones,
          parentEmail: mergedEmails,
      });
  };

  const getSiblingResidence = (sib: Sibling): 'with' | 'partial' | 'away' => {
      if (sib.residenceStatus) return sib.residenceStatus;
      if (sib.livesPartially) return 'partial';
      return sib.livesWithChild ? 'with' : 'away';
  };

  const setSiblingResidence = (idx: number, status: 'with' | 'partial' | 'away') => {
      const newSiblings = [...(data.siblings || [])];
      const livesWithChild = status === 'with';
      const livesPartially = status === 'partial';
      newSiblings[idx] = {
          ...newSiblings[idx],
          residenceStatus: status,
          livesWithChild,
          livesPartially,
      };
      onChange({ siblings: newSiblings });
  };

  const addGoal = (text: string) => {
      if (!text.trim()) return;
      const newGoals = [...goals, text];
      onChange({ goals: newGoals, priorities: newGoals.join('. ') }); // Sync legacy
  };
  const updateGoal = (idx: number, text: string) => {
      const newGoals = [...goals];
      newGoals[idx] = text;
      onChange({ goals: newGoals, priorities: newGoals.join('. ') });
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
                <React.Fragment key={section.id}>
                <div id={`section-${section.id}`} className={`rounded-[24px] border transition-all duration-300 overflow-hidden ${isOpen ? 'shadow-md border-[#E07A5F]/30 bg-[var(--card-bg)]' : 'shadow-sm hover:shadow border-[var(--border-color)] bg-[var(--card-bg)]'}`}>
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
                            
                            {/* --- 1. IDENTITÉ (ENCART BLEU ARDOISE) --- */}
                            {section.id === 'identity' && (
                                <>
                                    <div className="bg-[var(--card-bg-raised)] border border-[var(--border-color)] p-5 rounded-2xl relative overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 text-[var(--text-secondary)]">
                                            <User size={16} />
                                            <h4 className="text-xs font-bold uppercase tracking-wider">État Civil</h4>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 relative z-10">
                                            <div><label className={labelClass}>Prénom</label><DebouncedInput name="firstName" value={data.firstName || ''} onChange={(v) => handleFieldChange('firstName', v)} className={inputClass} placeholder="Prénom" /></div>
                                            <div><label className={labelClass}>Nom</label><DebouncedInput name="lastName" value={data.lastName || ''} onChange={(v) => handleFieldChange('lastName', v)} className={inputClass} placeholder="Nom de famille" /></div>
                                            <div><label className={labelClass}>Date de naissance</label><input type="date" name="dob" value={data.dob || ''} onChange={handleChange} className={inputClass} /></div>
                                            <div>
                                                <label className={labelClass}>Genre</label>
                                                <div className="flex gap-4 pt-2">
                                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="gender" value="M" checked={data.gender === 'M'} onChange={handleChange} className="accent-[#E07A5F] w-4 h-4"/> Garçon</label>
                                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="gender" value="F" checked={data.gender === 'F'} onChange={handleChange} className="accent-[#E07A5F] w-4 h-4"/> Fille</label>
                                                </div>
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className={labelClass}>Adresse</label>
                                                <div className="relative">
                                                    <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                                                    <DebouncedInput name="address" value={data.address || ''} onChange={(v) => handleFieldChange('address', v)} className={`${inputClass} pl-10`} placeholder="Adresse complète" />
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
                                            <h4 className="text-xs font-bold uppercase tracking-wider">Responsables Légaux</h4>
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
                                                        icon={Users} 
                                                    />
                                                    <SelectCard 
                                                        selected={data.guardMode === 'alternate'} 
                                                        onClick={() => handleFieldChange('guardMode', 'alternate')}
                                                        label="Garde Alternée" 
                                                        value="alternate" 
                                                        icon={Repeat} 
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
                                                    <div className="flex flex-wrap gap-4 mt-3 ml-1 animate-in slide-in-from-top-2">
                                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="exclusiveParent" value="exclusive_mere" checked={data.guardMode === 'exclusive_mere'} onChange={() => handleFieldChange('guardMode', 'exclusive_mere')} className="accent-[#E07A5F] w-4 h-4"/> Chez la mère</label>
                                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="exclusiveParent" value="exclusive_pere" checked={data.guardMode === 'exclusive_pere'} onChange={() => handleFieldChange('guardMode', 'exclusive_pere')} className="accent-[#E07A5F] w-4 h-4"/> Chez le père</label>
                                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[var(--text-main)]"><input type="radio" name="exclusiveParent" value="exclusive_autre" checked={data.guardMode === 'exclusive_autre'} onChange={() => handleFieldChange('guardMode', 'exclusive_autre')} className="accent-[#E07A5F] w-4 h-4"/> Autre</label>
                                                    </div>
                                                )}
                                                {data.guardMode === 'exclusive_autre' && (
                                                    <div className="mt-2 animate-in slide-in-from-top-2">
                                                        <label className={labelClass}>Préciser (famille d&apos;accueil, tuteur...)</label>
                                                        <DebouncedInput name="guardExclusiveOther" value={data.guardExclusiveOther || ''} onChange={(v) => handleFieldChange('guardExclusiveOther', v)} className={inputClass} placeholder="Ex : famille d'accueil, grands-parents..." />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                <div className="space-y-3 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
                                                    <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Responsable 1</h5>
                                                    <div>
                                                        <label className={labelClass}>Nom</label>
                                                        <DebouncedInput name="parent1Name" value={data.parent1Name || ''} onChange={(v) => syncLegacyParentFields({ parent1Name: v })} className={inputClass} placeholder="Nom du responsable 1" />
                                                    </div>
                                                    <div>
                                                        <label className={labelClass}>Téléphone</label>
                                                        <div className="relative">
                                                            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                                                            <DebouncedInput name="parent1Phone" type="tel" value={data.parent1Phone || ''} onChange={(v) => syncLegacyParentFields({ parent1Phone: v })} className={`${inputClass} pl-10`} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className={labelClass}>Email</label>
                                                        <div className="relative">
                                                            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                                                            <DebouncedInput name="parent1Email" type="email" value={data.parent1Email || ''} onChange={(v) => syncLegacyParentFields({ parent1Email: v })} className={`${inputClass} pl-10`} />
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-3 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
                                                    <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Responsable 2</h5>
                                                    <div>
                                                        <label className={labelClass}>Nom</label>
                                                        <DebouncedInput name="parent2Name" value={data.parent2Name || ''} onChange={(v) => syncLegacyParentFields({ parent2Name: v })} className={inputClass} placeholder="Nom du responsable 2" />
                                                    </div>
                                                    <div>
                                                        <label className={labelClass}>Téléphone</label>
                                                        <div className="relative">
                                                            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                                                            <DebouncedInput name="parent2Phone" type="tel" value={data.parent2Phone || ''} onChange={(v) => syncLegacyParentFields({ parent2Phone: v })} className={`${inputClass} pl-10`} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className={labelClass}>Email</label>
                                                        <div className="relative">
                                                            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/>
                                                            <DebouncedInput name="parent2Email" type="email" value={data.parent2Email || ''} onChange={(v) => syncLegacyParentFields({ parent2Email: v })} className={`${inputClass} pl-10`} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* FRATRIE (Reste en Stone pour différencier) */}
                                    <div className="bg-[var(--hover-bg)] p-4 rounded-2xl border border-[var(--border-color)]">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><HeartHandshake size={14}/> Fratrie</span>
                                            <button onClick={addSibling} className="text-[10px] bg-[var(--card-bg)] border border-[var(--border-color)] px-3 py-1.5 rounded-full uppercase font-bold tracking-wider hover:bg-[#3D405B] hover:text-white transition-all flex items-center gap-1 text-[var(--text-secondary)]"><Plus size={12}/> Ajouter</button>
                                        </div>
                                        <div className="space-y-2">
                                            {(data.siblings || []).map((sib, idx) => (
                                                <div key={idx} className="flex gap-2 items-center animate-in slide-in-from-left-2">
                                                    <input placeholder="Prénom" value={sib.firstName} onChange={e => updateSibling(idx, 'firstName', e.target.value)} className="flex-1 p-2 bg-[var(--input-bg)] rounded-lg text-sm border border-[var(--input-border)] outline-none focus:border-[#E07A5F] text-[var(--text-heading)]" />
                                                    <input placeholder="Âge" value={sib.age} onChange={e => updateSibling(idx, 'age', e.target.value)} className="w-16 p-2 bg-[var(--input-bg)] rounded-lg text-sm border border-[var(--input-border)] outline-none focus:border-[#E07A5F] text-[var(--text-heading)]" />
                                                    <select value={sib.relation} onChange={e => updateSibling(idx, 'relation', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs font-bold border border-[var(--input-border)] outline-none focus:border-[#E07A5F] text-[var(--text-heading)]">
                                                        <option value="Frère">Frère</option>
                                                        <option value="Sœur">Sœur</option>
                                                        <option value="Demi-frère">Demi-frère</option>
                                                        <option value="Demi-sœur">Demi-sœur</option>
                                                    </select>
                                                    
                                                    <div className="flex rounded-lg border border-[var(--border-color)] overflow-hidden bg-[var(--card-bg)]">
                                                        {[
                                                            { key: 'with' as const, label: 'Avec', title: 'Vit au domicile' },
                                                            { key: 'partial' as const, label: 'Partiel', title: 'Vit partiellement au domicile' },
                                                            { key: 'away' as const, label: 'Non', title: 'Ne vit pas au domicile' },
                                                        ].map((option) => {
                                                            const active = getSiblingResidence(sib) === option.key;
                                                            return (
                                                                <button
                                                                    key={option.key}
                                                                    onClick={() => setSiblingResidence(idx, option.key)}
                                                                    title={option.title}
                                                                    className={`px-2 py-1.5 text-[10px] font-bold uppercase transition-all border-r last:border-r-0 ${active ? 'bg-[#3D405B] text-white border-[#3D405B]' : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:bg-[var(--hover-bg)]'}`}
                                                                >
                                                                    {option.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>

                                                    <button onClick={() => removeSibling(idx)} className="p-2 text-[var(--text-disabled)] hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-all"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                            {(!data.siblings || data.siblings.length === 0) && <p className="text-xs text-[var(--text-secondary)] italic text-center py-2">Aucun frère ou sœur renseigné.</p>}
                                        </div>
                                    </div>
                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 3. SCOLARITÉ (AVEC AVS & OBSERVATIONS) --- */}
                            {section.id === 'school' && (
                                <div className="space-y-6">
                                    <div className="bg-[var(--card-bg-raised)] border border-[var(--border-color)] p-5 rounded-2xl space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><Book size={14}/> Scolarité</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                            <div><label className={labelClass}>École</label><DebouncedInput name="school" value={data.school || ''} onChange={(v) => handleFieldChange('school', v)} className={inputClass} /></div>
                                            <div>
                                                <label className={labelClass}>Classe</label>
                                                <select name="classLevel" value={data.classLevel || ''} onChange={handleChange} className={inputClass}>
                                                    <option value="">Sélectionner...</option>
                                                    {SCHOOL_LEVELS.map(level => (
                                                        <option key={level} value={level}>{level}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelClass}>Type de filière</label>
                                                <select name="schoolType" value={data.schoolType || ''} onChange={handleChange} className={inputClass}>
                                                    <option value="">—</option>
                                                    <option value="general">Général</option>
                                                    <option value="technologique">Technologique</option>
                                                    <option value="pro">Professionnel (Bac Pro)</option>
                                                    <option value="cap">CAP</option>
                                                    <option value="bts">BTS / BUT</option>
                                                    <option value="autre">Autre</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelClass}>Redoublement</label>
                                                <ChipGroup
                                                    options={[{value: 'non', label: 'Non'}, {value: 'oui', label: 'Oui'}]}
                                                    value={data.schoolRepeatYear}
                                                    onChange={(v) => handleFieldChange('schoolRepeatYear', v)}
                                                />
                                            </div>
                                        </div>

                                        <div className="bg-[#fff9f9] dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800/20 p-4 rounded-2xl">
                                            <ToggleSwitch
                                                label="Une AESH / AVS est-elle présente ?"
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
                                                            placeholder="Repas, écriture, attention..."
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <label className={labelClass}>Dispositif scolaire</label>
                                            <ChipGroup
                                                options={[{value: 'PAP', label: 'PAP'}, {value: 'PAI', label: 'PAI'}, {value: 'PPS', label: 'PPS'}, {value: 'PPRE', label: 'PPRE'}]}
                                                value={data.carePlan}
                                                onChange={(v) => handleFieldChange('carePlan', v)}
                                                multi
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Aménagements rattachés</label>
                                            <DebouncedTextarea name="schoolAccommodations" value={data.schoolAccommodations || ''} onChange={(v) => handleFieldChange('schoolAccommodations', v)} className={inputClass} placeholder="Placement, supports adaptés, tiers-temps, outils de compensation..." rows={2} />
                                        </div>
                                    </div>

                                    <div className="bg-[var(--hover-bg)] p-4 rounded-2xl border border-[var(--border-color)] space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><Users size={14}/> Vie scolaire et sociale</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelClass}>Matières préférées</label>
                                                <DebouncedInput name="schoolFavoriteSubjects" value={data.schoolFavoriteSubjects || ''} onChange={(v) => handleFieldChange('schoolFavoriteSubjects', v)} className={inputClass} placeholder="Ex : sport, maths, arts..." />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Matières moins appréciées</label>
                                                <DebouncedInput name="schoolDislikedSubjects" value={data.schoolDislikedSubjects || ''} onChange={(v) => handleFieldChange('schoolDislikedSubjects', v)} className={inputClass} placeholder="Ex : dictée, géométrie..." />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={labelClass}>Comportement en classe</label>
                                            <DebouncedInput name="classroomBehavior" value={data.classroomBehavior || ''} onChange={(v) => handleFieldChange('classroomBehavior', v)} className={inputClass} placeholder="Calme, impulsif, opposition, agitation..." />
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div>
                                                <label className={labelClass}>Organisation</label>
                                                <DebouncedInput name="schoolOrganization" value={data.schoolOrganization || ''} onChange={(v) => handleFieldChange('schoolOrganization', v)} className={inputClass} placeholder="Cartable, matériel, consignes..." />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Mémorisation</label>
                                                <DebouncedInput name="schoolMemory" value={data.schoolMemory || ''} onChange={(v) => handleFieldChange('schoolMemory', v)} className={inputClass} placeholder="Leçons, consignes, automatismes..." />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Attention & participation</label>
                                                <DebouncedInput name="schoolAttention" value={data.schoolAttention || ''} onChange={(v) => handleFieldChange('schoolAttention', v)} className={inputClass} placeholder="Concentration, participation, distractibilité..." />
                                            </div>
                                        </div>
                                        <div>
                                            <label className={labelClass}>Relation avec ses pairs</label>
                                            <DebouncedInput name="peerRelations" value={data.peerRelations || data.socialBehavior || ''} onChange={(v) => handleFieldChange('peerRelations', v)} className={inputClass} placeholder="Jeux, interactions, conflits, isolement..." />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Devoirs</label>
                                            <DebouncedTextarea name="homeworkHabits" value={data.homeworkHabits || ''} onChange={(v) => handleFieldChange('homeworkHabits', v)} className={inputClass} placeholder="Autonomie, aide nécessaire, durée, fatigue..." rows={2} />
                                        </div>
                                    </div>

                                    <div className="bg-[#f0f9ff] dark:bg-sky-950/20 border border-sky-100 dark:border-sky-800/20 p-4 rounded-2xl space-y-4">
                                        <h4 className="text-xs font-bold text-sky-800 uppercase tracking-wider flex items-center gap-2 mb-2"><PenTool size={14}/> Écriture</h4>
                                        <div>
                                            <label className={labelClass}>Latéralité</label>
                                            <ChipGroup options={[{value: 'Droitier', label: 'Droitier'}, {value: 'Gaucher', label: 'Gaucher'}, {value: 'Indeterminé', label: 'Non latéralisé'}]} value={data.handDominance} onChange={(v) => handleFieldChange('handDominance', v)} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Difficultés d'écriture typiques (plusieurs choix possibles)</label>
                                            <ChipGroup
                                                options={[
                                                    {value: 'orthographe', label: "Fautes d'orthographe"},
                                                    {value: 'lisibilite', label: 'Lisibilité des écrits'},
                                                    {value: 'miroir', label: 'Lettres miroir'},
                                                    {value: 'douleur', label: 'Douleur'},
                                                    {value: 'posture', label: 'Mauvaise posture'},
                                                    {value: 'lenteur', label: 'Lenteur'},
                                                ]}
                                                value={data.writingDifficultyTags}
                                                onChange={(v) => handleFieldChange('writingDifficultyTags', v)}
                                                multi
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Difficultés d'écriture (remarques)</label>
                                            <DebouncedTextarea name="writingIssues" value={data.writingIssues || ''} onChange={(v) => handleFieldChange('writingIssues', v)} className={inputClass} placeholder="Préciser les difficultés observées en écriture..." rows={2} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Douleur en écrivant ?</label>
                                            <ChipGroup options={[{value: 'non', label: 'Jamais'}, {value: 'oui_long', label: 'Sur longues tâches'}, {value: 'oui_vite', label: 'Au bout de 5 min'}, {value: 'oui_constante', label: 'Immédiate'}]} value={data.writingPain} onChange={(v) => handleFieldChange('writingPain', v)} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Utilisation des outils scolaires</label>
                                            <DebouncedTextarea name="toolUsage" value={data.toolUsage || ''} onChange={(v) => handleFieldChange('toolUsage', v)} className={inputClass} placeholder="Règle, gomme, compas, ciseaux, trousse..." rows={2} />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Autres remarques</label>
                                            <DebouncedTextarea name="writingOther" value={data.writingOther || ''} onChange={(v) => handleFieldChange('writingOther', v)} className={inputClass} rows={2} placeholder="Tout autre élément relatif à l'écriture ou aux outils scolaires..." />
                                        </div>
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 4. MÉDICAL --- */}
                            {section.id === 'medical' && (
                                <div className="space-y-6">
                                    
                                    {/* HAUT DE PAGE 3 PDF */}
                                    <div className="bg-[var(--card-bg)] p-4 rounded-2xl border border-[var(--border-color)] mb-4 space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><Stethoscope size={14}/> Cadre Médical</h4>
                                        <div><label className={labelClass}>Médecin prescripteur</label><DebouncedInput name="prescribingDoctor" value={data.prescribingDoctor || ''} onChange={(v) => handleFieldChange('prescribingDoctor', v)} className={inputClass} placeholder="Nom du médecin prescripteur" /></div>
                                        <div><label className={labelClass}>Médecin traitant</label><DebouncedInput name="treatingDoctor" value={data.treatingDoctor || ''} onChange={(v) => handleFieldChange('treatingDoctor', v)} className={inputClass} placeholder="Nom du médecin traitant" /></div>
                                        <div><label className={labelClass}>Diagnostics médicaux</label><DebouncedInput name="medicalDiagnosis" value={data.medicalDiagnosis || ''} onChange={(v) => handleFieldChange('medicalDiagnosis', v)} className={inputClass} placeholder="Si connu (ex: TDAH, Dys...)" /></div>
                                        <div><label className={labelClass}>Traitements en cours</label><DebouncedInput name="medicalTreatments" value={data.medicalTreatments || ''} onChange={(v) => handleFieldChange('medicalTreatments', v)} className={inputClass} placeholder="Médicaments, lunettes..." /></div>
                                    </div>

                                    {/* TABLEAU SUIVI PARAMÉDICAL */}
                                    <div className="bg-[#f0fdf4] dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/20 p-4 rounded-2xl">
                                        <div className="flex justify-between items-center mb-4">
                                            <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-2"><Activity size={14}/> Suivi Extérieur</h4>
                                            <button onClick={addMedicalTracking} className="text-[10px] bg-[var(--card-bg)] text-emerald-500 border border-emerald-500/30 px-3 py-1.5 rounded-full uppercase font-bold tracking-wider hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-1"><Plus size={12}/> Ajouter un pro</button>
                                        </div>
                                        <div className="space-y-3">
                                            {(data.medicalTracking || []).map((track, idx) => (
                                                <div key={track.id || idx} className="bg-[var(--card-bg)] p-3 rounded-xl border border-emerald-500/20 shadow-sm flex flex-col gap-2">
                                                    <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-2 w-full">
                                                            <select value={track.type} onChange={(e) => updateMedicalTracking(idx, 'type', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs font-bold text-[var(--text-heading)] border border-[var(--input-border)] outline-none">
                                                                <option>Orthophoniste</option><option>Psychomotricien</option><option>Psychologue</option><option>Neuropsychologue</option><option>Kiné</option><option>Orthoptiste</option><option>Ergothérapeute</option><option>Pédopsychiatre</option><option>Neuropediatre</option><option>Ophtalmologue</option><option>Podologue</option><option>ORL</option><option>Autre</option>
                                                            </select>
                                                            {track.type === 'Autre' ? (
                                                                <input
                                                                    placeholder="Préciser la profession..."
                                                                    value={track.name}
                                                                    onChange={(e) => updateMedicalTracking(idx, 'name', e.target.value)}
                                                                    className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs border border-amber-200 dark:border-amber-700/40 outline-none text-[var(--text-heading)] col-span-2 md:col-span-2 font-semibold"
                                                                    autoFocus
                                                                />
                                                            ) : (
                                                            <input 
                                                                placeholder="Nom" 
                                                                value={track.name} 
                                                                onChange={(e) => updateMedicalTracking(idx, 'name', e.target.value)} 
                                                                className="p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none text-[var(--text-heading)]" 
                                                            />
                                                            )}
                                                            <input placeholder="Motif..." value={track.reason || ''} onChange={(e) => updateMedicalTracking(idx, 'reason', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none md:col-span-1 text-[var(--text-heading)]" />
                                                            <input placeholder="Fréquence" value={track.frequency} onChange={(e) => updateMedicalTracking(idx, 'frequency', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none text-[var(--text-heading)]" />
                                                            <input placeholder="Depuis..." value={track.since} onChange={(e) => updateMedicalTracking(idx, 'since', e.target.value)} className="p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none text-[var(--text-heading)]" />
                                                        </div>
                                                        <button onClick={() => removeMedicalTracking(idx)} className="p-2 text-rose-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg"><Trash2 size={16}/></button>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <label className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1 mb-0.5 block">Terminé le</label>
                                                            <input type="date" value={track.endDate || ''} onChange={(e) => updateMedicalTracking(idx, 'endDate', e.target.value)} className="w-full p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none text-[var(--text-heading)]" />
                                                        </div>
                                                        <div>
                                                            <label className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1 mb-0.5 block">Nb de séances effectuées</label>
                                                            <input type="number" min="0" placeholder="Ex: 24" value={track.sessionCount || ''} onChange={(e) => updateMedicalTracking(idx, 'sessionCount', e.target.value)} className="w-full p-2 bg-[var(--input-bg)] rounded-lg text-xs border border-[var(--input-border)] outline-none text-[var(--text-heading)]" />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            {(!data.medicalTracking || data.medicalTracking.length === 0) && <p className="text-xs text-[var(--text-secondary)] italic text-center">Aucun suivi renseigné.</p>}
                                        </div>
                                    </div>
                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 5. DÉVELOPPEMENT --- */}
                            {section.id === 'dev' && (
                                <div className="space-y-4">

                                    {/* 🟣 PÉRINATALITÉ */}
                                    <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-purple-800 dark:text-purple-300 uppercase tracking-wider flex items-center gap-2 mb-4">🟣 Périnatalité</h4>
                                        <div>
                                            <label className={labelClass}>Grossesse & Naissance (particularités)</label>
                                            <DebouncedTextarea name="pregnancyBirth" value={data.pregnancyBirth || ''} onChange={(v) => handleFieldChange('pregnancyBirth', v)} className={inputClass} placeholder="Naissance à terme, prématuré, complications, césarienne, poids de naissance..." rows={2} />
                                        </div>
                                    </div>

                                    {/* 🔵 MOTRICITÉ */}
                                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider flex items-center gap-2 mb-4">🔵 Motricité</h4>
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className={labelClass}>Âge de la marche</label>
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
                                            <div>
                                                <label className={labelClass}>Développement moteur</label>
                                                <DebouncedTextarea name="developmentMotor" value={data.developmentMotor || ''} onChange={(v) => handleFieldChange('developmentMotor', v)} className={inputClass} placeholder="Marcher, courir, grimper, sauter, pédaler, équilibre..." rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* 🟢 LANGAGE */}
                                    <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-2 mb-4">🟢 Langage</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Langage (plusieurs choix possibles)</label>
                                                <ChipGroup 
                                                    options={[{value: 'standard', label: 'Apparition standard'}, {value: 'retard', label: 'Retard simple'}, {value: 'suivi_ortho', label: 'Suivi Ortho'}, {value: 'inintelligible', label: 'Difficile à comprendre'}, {value: 'begaiement', label: 'Bégaiement'}]}
                                                    value={data.languageStatus} 
                                                    onChange={(v) => handleFieldChange('languageStatus', v)}
                                                    multi
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Développement du langage (détails)</label>
                                                <DebouncedTextarea name="developmentLanguage" value={data.developmentLanguage || ''} onChange={(v) => handleFieldChange('developmentLanguage', v)} className={inputClass} placeholder="Premiers mots, phrases, compréhension, bilinguisme..." rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* 🌙 SOMMEIL */}
                                    <div className="bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-indigo-800 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-2 mb-4">🌙 Sommeil</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Sommeil (plusieurs choix possibles)</label>
                                                <ChipGroup 
                                                    options={[{value: 'ok', label: 'Paisible'}, {value: 'endormissement', label: 'Endormissement long'}, {value: 'reveils', label: 'Réveils multiples'}, {value: 'agite', label: 'Agité / Cauchemars'}, {value: 'fatigue_diurne', label: 'Fatigue en journée'}]}
                                                    value={data.sleepStatus} 
                                                    onChange={(v) => handleFieldChange('sleepStatus', v)}
                                                    multi
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Détails sommeil (heures, rituels...)</label>
                                                <DebouncedInput name="sleep" value={data.sleep || ''} onChange={(v) => handleFieldChange('sleep', v)} className={inputClass} placeholder="Heure coucher/lever, durée, rituel..." />
                                            </div>
                                        </div>
                                    </div>

                                    {/* 🟡 SENSORIEL */}
                                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-2 mb-4">🟡 Sensoriel</h4>
                                        <div>
                                            <label className={labelClass}>Particularités Sensorielles</label>
                                            <DebouncedTextarea name="sensory" value={data.sensory || ''} onChange={(v) => handleFieldChange('sensory', v)} className={inputClass} placeholder="Hypersensibilité (Bruit, Lumière, Étiquettes, Textures alimentaires...)" rows={2} />
                                        </div>
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
                                                    options={[{value: 'autonomie', label: 'Mange en autonomie'}, {value: 'aide_repas', label: 'A besoin d\'aide pour manger'}, {value: 'agite_repas', label: 'Agité(e) lors des repas'}, {value: 'couverts', label: 'Utilisation des couverts'}, {value: 'mains', label: 'Mange avec les mains'}, {value: 'salit', label: 'Se salit beaucoup'}]}
                                                    value={data.eatingHabits} 
                                                    onChange={(v) => handleFieldChange('eatingHabits', v)}
                                                    multi
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Commentaires (Couverts, propreté...)</label>
                                                <DebouncedTextarea name="meals" value={data.meals || ''} onChange={(v) => handleFieldChange('meals', v)} className={inputClass} placeholder="Utilisation des couverts, comportement à table..." rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* HABILLAGE */}
                                    <div className="bg-[#fff9f9] dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Shirt size={14}/> Habillage</h4>
                                        <div className="space-y-4">
                                            {[{key: 'clothingButtons', label: 'Boutons'}, {key: 'clothingLaces', label: 'Lacets'}, {key: 'clothingZippers', label: 'Fermetures Éclair'}].map((item) => (
                                                <div key={item.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-rose-100 dark:border-rose-800/20 last:border-0 pb-2">
                                                    <span className="text-sm font-bold text-[var(--text-main)]">{item.label}</span>
                                                    <div className="flex gap-2">
                                                        {['acquis', 'difficile', 'aide_totale'].map(opt => (
                                                            <label key={opt} className="cursor-pointer">
                                                                <input type="radio" name={item.key} value={opt} checked={(data as any)[item.key] === opt} onChange={handleChange} className="peer sr-only"/>
                                                                <div className="px-3 py-1 rounded-lg border border-[var(--border-color)] text-[10px] font-bold uppercase text-[var(--text-secondary)] peer-checked:bg-[#E07A5F] peer-checked:text-white peer-checked:border-[#E07A5F] transition-all">
                                                                    {opt === 'acquis' ? 'Acquis' : opt === 'difficile' ? 'Difficile' : 'Impossible'}
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="mt-2">
                                                <label className={labelClass}>Commentaire habillage (choix des vêtements, autonomie...)</label>
                                                <DebouncedTextarea name="dressing" value={data.dressing || ''} onChange={(v) => handleFieldChange('dressing', v)} className={inputClass} placeholder="Choisit-il ses vêtements ? Met-il ses chaussures seul ? Enfile un manteau ?" rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* HYGIÈNE & CONTINENCE */}
                                    <div className="bg-[#f0fdf4] dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Droplets size={14}/> Hygiène & Continence</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Toilettes, douche/bain, brossage des dents...</label>
                                                <DebouncedTextarea name="continence" value={data.continence || ''} onChange={(v) => handleFieldChange('continence', v)} className={inputClass} placeholder="Va-t-il aux toilettes seul ? Se lave les mains ? Se brosse les dents seul ? Douche autonome ?" rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* AJOUT TEMPS/ESPACE */}
                                    <div>
                                        <label className={labelClass}>Repérage Temps & Espace</label>
                                        <DebouncedTextarea name="timeSpace" value={data.timeSpace || ''} onChange={(v) => handleFieldChange('timeSpace', v)} className={inputClass} placeholder="Se repère-t-il dans la journée ? La semaine ? Retrouve-t-il son chemin ? Lit-il l’heure ?" rows={2} />
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 7. MOTIF DE CONSULTATION --- */}
                            {section.id === 'reason' && (
                                <div className="space-y-6">
                                    <div className="bg-[var(--card-bg-raised)] border border-[var(--border-color)] p-5 rounded-2xl space-y-4">
                                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2"><MessageSquare size={14}/> Motif de consultation</h4>
                                        <div>
                                            <label className={labelClass}>Pourquoi consultez-vous en ergothérapie ?</label>
                                            <DebouncedTextarea name="reason" value={data.reason || ''} onChange={(v) => handleFieldChange('reason', v)} className={inputClass} placeholder="Décrivez ce qui vous amène à consulter (difficultés scolaires, motrices, comportementales...)" rows={3} />
                                        </div>
                                    </div>

                                    <div>
                                        <label className={labelClass}>Remarques complémentaires</label>
                                        <DebouncedTextarea name="remarks" value={data.remarks || ''} onChange={(v) => handleFieldChange('remarks', v)} className={inputClass} rows={3} placeholder="Informations sensibles, contexte particulier, éléments difficiles à évoquer devant l’enfant..." />
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 8. GESTION DES ÉMOTIONS --- */}
                            {section.id === 'emotions' && (
                                <div className="space-y-4">
                                    <div className="bg-[#faf5ff] dark:bg-purple-950/20 border border-purple-100 dark:border-purple-800/20 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-purple-800 dark:text-purple-300 uppercase tracking-wider flex items-center gap-2 mb-4"><Brain size={14}/> Gestion des émotions</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Temps d’écran quotidien estimé</label>
                                                <DebouncedInput name="screenTime" value={data.screenTime || ''} onChange={(v) => handleFieldChange('screenTime', v)} className={inputClass} placeholder="Ex: 1h tablette, 30 min TV..." />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Régulation émotionnelle</label>
                                                <DebouncedTextarea name="emotionalRegulation" value={data.emotionalRegulation || ''} onChange={(v) => handleFieldChange('emotionalRegulation', v)} className={inputClass} placeholder="Colères, frustrations, anxiété, difficulté à gérer les transitions..." rows={2} />
                                            </div>
                                        </div>
                                    </div>
                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 9. OBJECTIFS PRIORITAIRES --- */}
                            {section.id === 'goals' && (
                                <div className="space-y-6">
                                    <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-2xl border border-amber-100 dark:border-amber-800/20">
                                        <h4 className="text-sm font-bold text-amber-900 dark:text-amber-400 mb-2 flex items-center gap-2">
                                            <Smile size={18} /> Vos objectifs prioritaires
                                        </h4>
                                        <p className="text-xs text-amber-800 dark:text-amber-300/80 mb-4">Quels sont les 3 à 5 problèmes que vous aimeriez résoudre en premier ?</p>

                                        <div className="space-y-2 mb-4">
                                            {goals.map((goal, idx) => (
                                                <div key={idx} className="flex items-center gap-2 bg-[var(--card-bg)] p-3 rounded-xl border border-amber-200/40 shadow-sm animate-in slide-in-from-left-2">
                                                    <span className="font-bold text-amber-500 w-6">{idx + 1}.</span>
                                                    <input
                                                        value={goal}
                                                        onChange={(e) => updateGoal(idx, e.target.value)}
                                                        className="flex-1 text-sm font-bold bg-transparent text-[var(--text-heading)] border-b border-transparent focus:border-amber-300 outline-none"
                                                    />
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

                                        <div className="flex flex-wrap gap-2">
                                            {["Écriture lisible", "Faire ses lacets", "Manger proprement", "Rester assis", "Moins de colères", "Utiliser la règle", "S'habiller seul", "Autonomie toilettes", "Organiser son cartable", "Lire l'heure", "Se concentrer en classe", "Gérer ses émotions", "Découper proprement", "Tenir son crayon", "Copier du tableau"].map(sug => (
                                                <button key={sug} onClick={() => addGoal(sug)} className="px-3 py-1 bg-[var(--card-bg)] border border-amber-200/40 rounded-full text-xs font-bold text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-all">+ {sug}</button>
                                            ))}
                                        </div>
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                        </div>
                    )}
                </div>
                {section.id === 'reason' && (
                    <div className="my-2 flex items-center justify-center">
                        <div className="h-px w-full max-w-xl bg-[var(--border-color)]" />
                    </div>
                )}
                </React.Fragment>
            );
        })}
    </div>
  );
};
