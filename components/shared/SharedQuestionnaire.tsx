
import React, { useState, useEffect } from 'react';
import { Patient, Sibling, ParamedicalTracking } from '../../types';
import { calculateAge } from '../../utils';
import { DebouncedInput, DebouncedTextarea } from './DebouncedControls';
import { User, Users, GraduationCap, Stethoscope, Baby, Coffee, MessageSquare, ChevronDown, ChevronUp, Check, Plus, Trash2, Home, Scale, HelpingHand, Scissors, Ruler, Utensils, Shirt, Activity, Smile, ArrowRight, Book, Clock, HeartHandshake, Eye, MapPin, Mail, Phone } from 'lucide-react';

interface Props {
  data: Patient;
  onChange: (data: Partial<Patient>) => void;
  mode: 'family' | 'practitioner';
}

type SectionKey = 'identity' | 'parents' | 'school' | 'medical' | 'dev' | 'daily' | 'behavior' | 'reason';

const SECTIONS_CONFIG: { id: SectionKey; title: string; icon: any }[] = [
    { id: 'identity', title: "Identité de l'enfant", icon: User },
    { id: 'parents', title: "Situation Familiale", icon: Users },
    { id: 'school', title: "Scolarité & AVS", icon: GraduationCap },
    { id: 'medical', title: "Suivi Médical", icon: Stethoscope },
    { id: 'dev', title: "Développement", icon: Baby },
    { id: 'daily', title: "Vie Quotidienne", icon: Coffee },
    { id: 'reason', title: "Priorités & Objectifs", icon: MessageSquare },
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
    onChange 
}: { 
    options: { value: string; label: string }[]; 
    value?: string; 
    onChange: (val: string) => void; 
}) => (
    <div className="flex flex-wrap gap-2">
        {options.map(opt => (
            <button
                key={opt.value}
                onClick={() => onChange(opt.value)}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                    value === opt.value 
                    ? 'bg-[#3D405B] text-white border-[#3D405B] shadow-md' 
                    : 'bg-white text-stone-500 border-stone-200 hover:border-[#3D405B]'
                }`}
            >
                {opt.label}
            </button>
        ))}
    </div>
);

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
            ? 'border-[#E07A5F] bg-[#fff5f2] text-[#E07A5F]' 
            : 'border-stone-100 bg-white text-stone-400 hover:border-stone-300'
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
    <div className="flex items-center justify-between bg-stone-50 p-4 rounded-xl border border-stone-100">
        <span className="font-bold text-[#3D405B] text-sm">{label}</span>
        <button 
            onClick={() => onChange(!checked)}
            className={`w-12 h-6 rounded-full relative transition-colors ${checked ? 'bg-[#E07A5F]' : 'bg-stone-300'}`}
        >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${checked ? 'left-7' : 'left-1'}`}></div>
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
      daily: false,
      behavior: false
  });

  const [progress, setProgress] = useState(0);

  // Calcul progression
  useEffect(() => {
      if (mode === 'family') {
          let filled = 0;
          if (data.lastName) filled++;
          if (data.school) filled++;
          if (data.reason) filled++;
          if (data.medicalTracking?.length) filled++;
          if (data.walkingAge) filled++;
          if (data.clothingButtons) filled++;
          
          setProgress(Math.round((filled / 8) * 100));
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
      onChange({ siblings: [...(data.siblings || []), { firstName: '', age: '', relation: 'Frère', livesWithChild: true }] });
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

  const inputClass = "w-full p-3 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-[#E07A5F] focus:bg-white transition-all font-bold text-[#3D405B] text-sm";
  const labelClass = "text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1 mb-1 block";

  const FamilyNextButton = ({ sectionId }: { sectionId: SectionKey }) => {
      if (mode !== 'family') return null;
      const isLast = sectionId === SECTIONS_CONFIG[SECTIONS_CONFIG.length - 1].id;
      return (
          <div className="flex justify-end mt-6 pt-4 border-t border-stone-100">
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
            <div className="sticky top-20 z-30 bg-[#fffbfb] pt-4 pb-4 border-b border-stone-100 mb-6">
                <div className="flex justify-between text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">
                    <span>Progression</span>
                    <span>{progress}%</span>
                </div>
                <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#E07A5F] transition-all duration-500" style={{ width: `${progress}%` }}></div>
                </div>
            </div>
        )}

        {SECTIONS_CONFIG.map((section) => {
            const isOpen = openSections[section.id];
            
            return (
                <div id={`section-${section.id}`} key={section.id} className={`rounded-[24px] border transition-all duration-300 overflow-hidden ${isOpen ? 'shadow-md border-[#E07A5F]/30 bg-white' : 'shadow-sm hover:shadow border-stone-200 bg-white'}`}>
                    <button 
                        onClick={() => toggleSection(section.id)}
                        className={`w-full flex items-center justify-between p-5 transition-colors ${isOpen ? 'bg-white' : 'bg-stone-50/50'}`}
                    >
                        <div className="flex items-center gap-4">
                            <div className={`p-2.5 rounded-xl ${isOpen ? 'bg-[#fff5f2] text-[#E07A5F]' : 'bg-stone-100 text-stone-400'}`}>
                                <section.icon size={20} />
                            </div>
                            <h3 className={`font-serif font-bold text-lg ${isOpen ? 'text-[#3D405B]' : 'text-stone-500'}`}>
                                {section.title}
                            </h3>
                        </div>
                        <div className={`p-2 rounded-full ${isOpen ? 'text-[#E07A5F] bg-[#fff5f2]' : 'text-stone-300'}`}>
                            {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                    </button>

                    {isOpen && (
                        <div className="p-6 border-t border-stone-50 animate-in slide-in-from-top-2 space-y-6">
                            
                            {/* --- 1. IDENTITÉ (ENCART BLEU ARDOISE) --- */}
                            {section.id === 'identity' && (
                                <>
                                    <div className="bg-[#f8fafc] border border-slate-200 p-5 rounded-2xl relative overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 text-slate-500">
                                            <User size={16} />
                                            <h4 className="text-xs font-bold uppercase tracking-wider">État Civil</h4>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 relative z-10">
                                            <div><label className={labelClass}>Nom</label><DebouncedInput name="lastName" value={data.lastName || ''} onChange={(v) => handleFieldChange('lastName', v)} className={inputClass} placeholder="Nom de famille" /></div>
                                            <div><label className={labelClass}>Prénom</label><DebouncedInput name="firstName" value={data.firstName || ''} onChange={(v) => handleFieldChange('firstName', v)} className={inputClass} placeholder="Prénom" /></div>
                                            <div><label className={labelClass}>Date de naissance</label><input type="date" name="dob" value={data.dob || ''} onChange={handleChange} className={inputClass} /></div>
                                            <div>
                                                <label className={labelClass}>Genre</label>
                                                <div className="flex gap-4 pt-2">
                                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-stone-600"><input type="radio" name="gender" value="M" checked={data.gender === 'M'} onChange={handleChange} className="accent-[#E07A5F] w-4 h-4"/> Garçon</label>
                                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-stone-600"><input type="radio" name="gender" value="F" checked={data.gender === 'F'} onChange={handleChange} className="accent-[#E07A5F] w-4 h-4"/> Fille</label>
                                                </div>
                                            </div>
                                            <div className="md:col-span-2">
                                                <label className={labelClass}>Adresse</label>
                                                <div className="relative">
                                                    <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"/>
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
                                    <div className="bg-[#f8fafc] border border-slate-200 p-5 rounded-2xl">
                                        <div className="flex items-center gap-2 mb-4 text-slate-500">
                                            <Users size={16} />
                                            <h4 className="text-xs font-bold uppercase tracking-wider">Responsables Légaux</h4>
                                        </div>
                                        
                                        <div className="space-y-5">
                                            <div className="space-y-2">
                                                <label className={labelClass}>Mode de Garde</label>
                                                <div className="flex flex-col md:flex-row gap-3">
                                                    <SelectCard 
                                                        selected={data.guardMode === 'exclusive'} 
                                                        onClick={() => handleFieldChange('guardMode', 'exclusive')}
                                                        label="Garde Exclusive" 
                                                        value="exclusive" 
                                                        icon={Home} 
                                                    />
                                                    <SelectCard 
                                                        selected={data.guardMode === 'alternate'} 
                                                        onClick={() => handleFieldChange('guardMode', 'alternate')}
                                                        label="Garde Alternée" 
                                                        value="alternate" 
                                                        icon={Scale} 
                                                    />
                                                    <SelectCard 
                                                        selected={data.guardMode === 'third'} 
                                                        onClick={() => handleFieldChange('guardMode', 'third')}
                                                        label="Tiers / Foyer" 
                                                        value="third" 
                                                        icon={HelpingHand} 
                                                    />
                                                </div>
                                            </div>

                                            <div><label className={labelClass}>Noms des responsables</label><DebouncedInput name="parentNames" value={data.parentNames || ''} onChange={(v) => handleFieldChange('parentNames', v)} className={inputClass} placeholder="Mme X et M. Y" /></div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                <div>
                                                    <label className={labelClass}>Téléphone</label>
                                                    <div className="relative">
                                                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"/>
                                                        <DebouncedInput name="parentPhone" type="tel" value={data.parentPhone || ''} onChange={(v) => handleFieldChange('parentPhone', v)} className={`${inputClass} pl-10`} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className={labelClass}>Email</label>
                                                    <div className="relative">
                                                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"/>
                                                        <DebouncedInput name="parentEmail" type="email" value={data.parentEmail || ''} onChange={(v) => handleFieldChange('parentEmail', v)} className={`${inputClass} pl-10`} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* FRATRIE (Reste en Stone pour différencier) */}
                                    <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-2"><HeartHandshake size={14}/> Fratrie</span>
                                            <button onClick={addSibling} className="text-[10px] bg-white border border-stone-200 px-3 py-1.5 rounded-full uppercase font-bold tracking-wider hover:bg-[#3D405B] hover:text-white transition-all flex items-center gap-1"><Plus size={12}/> Ajouter</button>
                                        </div>
                                        <div className="space-y-2">
                                            {(data.siblings || []).map((sib, idx) => (
                                                <div key={idx} className="flex gap-2 items-center animate-in slide-in-from-left-2">
                                                    <input placeholder="Prénom" value={sib.firstName} onChange={e => updateSibling(idx, 'firstName', e.target.value)} className="flex-1 p-2 bg-white rounded-lg text-sm border border-stone-200 outline-none focus:border-[#E07A5F]" />
                                                    <input placeholder="Âge" value={sib.age} onChange={e => updateSibling(idx, 'age', e.target.value)} className="w-16 p-2 bg-white rounded-lg text-sm border border-stone-200 outline-none focus:border-[#E07A5F]" />
                                                    
                                                    {/* BOUTON VIT AVEC ENFANT */}
                                                    <button 
                                                        onClick={() => updateSibling(idx, 'livesWithChild', !sib.livesWithChild)}
                                                        className={`p-2 rounded-lg border transition-all ${sib.livesWithChild ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white border-stone-200 text-stone-300'}`}
                                                        title={sib.livesWithChild ? "Vit au domicile" : "Ne vit pas au domicile"}
                                                    >
                                                        <Home size={16} />
                                                    </button>

                                                    <button onClick={() => removeSibling(idx)} className="p-2 text-stone-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                            {(!data.siblings || data.siblings.length === 0) && <p className="text-xs text-stone-400 italic text-center py-2">Aucun frère ou sœur renseigné.</p>}
                                        </div>
                                    </div>
                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 3. SCOLARITÉ (AVEC AVS & OBSERVATIONS) --- */}
                            {section.id === 'school' && (
                                <div className="space-y-5">
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
                                    </div>
                                    
                                    {/* BLOC AVS */}
                                    <div className="bg-[#fff9f9] border border-rose-100 p-4 rounded-2xl">
                                        <ToggleSwitch 
                                            label="Une AESH / AVS est-elle présente ?" 
                                            checked={data.avs === 'OUI'} 
                                            onChange={(checked) => handleFieldChange('avs', checked ? 'OUI' : 'NON')} 
                                        />
                                        
                                        {data.avs === 'OUI' && (
                                            <div className="mt-4 pt-4 border-t border-rose-100 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in slide-in-from-top-2">
                                                <div>
                                                    <label className={labelClass}>Nombre d'heures / semaine</label>
                                                    <input 
                                                        type="text" 
                                                        value={data.avsHours || ''} 
                                                        onChange={(e) => handleFieldChange('avsHours', e.target.value)} 
                                                        className="w-full p-2 bg-white border border-rose-200 rounded-lg text-sm font-bold text-[#3D405B] outline-none" 
                                                        placeholder="Ex: 12h"
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelClass}>Missions principales</label>
                                                    <input 
                                                        type="text" 
                                                        value={data.avsMissions || ''} 
                                                        onChange={(e) => handleFieldChange('avsMissions', e.target.value)} 
                                                        className="w-full p-2 bg-white border border-rose-200 rounded-lg text-sm text-[#3D405B] outline-none" 
                                                        placeholder="Repas, Écriture, Comportement..."
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className={labelClass}>Dispositifs (PAP, PAI, PPS)</label>
                                        <select name="carePlan" value={data.carePlan || ''} onChange={handleChange} className={inputClass}>
                                            <option value="">Aucun</option>
                                            <option value="PAP">PAP</option>
                                            <option value="PAI">PAI</option>
                                            <option value="PPS">PPS</option>
                                            <option value="PPRE">PPRE</option>
                                        </select>
                                    </div>

                                    {/* COMPORTEMENT SCOLAIRE (Page 4 PDF) */}
                                    <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100 mt-6 space-y-4">
                                        <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2"><Book size={14}/> Vie Scolaire & Sociale</h4>
                                        
                                        <div>
                                            <label className={labelClass}>Attention & Participation (En classe)</label>
                                            <DebouncedInput name="schoolAttention" value={data.schoolAttention || ''} onChange={(v) => handleFieldChange('schoolAttention', v)} className={inputClass} placeholder="Attentif, rêveur, participe..." />
                                        </div>
                                        
                                        <div>
                                            <label className={labelClass}>Relations avec les camarades</label>
                                            <DebouncedInput name="socialBehavior" value={data.socialBehavior || ''} onChange={(v) => handleFieldChange('socialBehavior', v)} className={inputClass} placeholder="Copains, récréation, conflits..." />
                                        </div>

                                        <div>
                                            <label className={labelClass}>Aménagements classe (hors AVS)</label>
                                            <DebouncedTextarea name="schoolAccommodations" value={data.schoolAccommodations || ''} onChange={(v) => handleFieldChange('schoolAccommodations', v)} className={inputClass} placeholder="Tiers-temps, photocopies, placement devant..." rows={2} />
                                        </div>
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 4. MÉDICAL --- */}
                            {section.id === 'medical' && (
                                <div className="space-y-6">
                                    
                                    {/* HAUT DE PAGE 3 PDF */}
                                    <div className="bg-white p-4 rounded-2xl border border-stone-100 mb-4 space-y-4">
                                        <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2"><Stethoscope size={14}/> Cadre Médical</h4>
                                        <div><label className={labelClass}>Médecin prescripteur</label><DebouncedInput name="prescribingDoctor" value={data.prescribingDoctor || ''} onChange={(v) => handleFieldChange('prescribingDoctor', v)} className={inputClass} placeholder="Nom du médecin" /></div>
                                        <div><label className={labelClass}>Diagnostics médicaux</label><DebouncedInput name="medicalDiagnosis" value={data.medicalDiagnosis || ''} onChange={(v) => handleFieldChange('medicalDiagnosis', v)} className={inputClass} placeholder="Si connu (ex: TDAH, Dys...)" /></div>
                                        <div><label className={labelClass}>Traitements en cours</label><DebouncedInput name="medicalTreatments" value={data.medicalTreatments || ''} onChange={(v) => handleFieldChange('medicalTreatments', v)} className={inputClass} placeholder="Médicaments, lunettes..." /></div>
                                    </div>

                                    {/* TABLEAU SUIVI PARAMÉDICAL */}
                                    <div className="bg-[#f0fdf4] border border-emerald-100 p-4 rounded-2xl">
                                        <div className="flex justify-between items-center mb-4">
                                            <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-2"><Activity size={14}/> Suivi Extérieur</h4>
                                            <button onClick={addMedicalTracking} className="text-[10px] bg-white text-emerald-600 border border-emerald-200 px-3 py-1.5 rounded-full uppercase font-bold tracking-wider hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-1"><Plus size={12}/> Ajouter un pro</button>
                                        </div>
                                        <div className="space-y-3">
                                            {(data.medicalTracking || []).map((track, idx) => (
                                                <div key={track.id || idx} className="bg-white p-3 rounded-xl border border-emerald-100 shadow-sm flex flex-col md:flex-row gap-3 items-start md:items-center">
                                                    <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-2 w-full">
                                                        <select value={track.type} onChange={(e) => updateMedicalTracking(idx, 'type', e.target.value)} className="p-2 bg-stone-50 rounded-lg text-xs font-bold text-[#3D405B] border border-stone-200 outline-none">
                                                            <option>Orthophoniste</option><option>Psychomotricien</option><option>Psychologue</option><option>Kiné</option><option>Orthoptiste</option><option>Autre</option>
                                                        </select>
                                                        <input 
                                                            placeholder="Nom" 
                                                            value={track.name} 
                                                            onChange={(e) => updateMedicalTracking(idx, 'name', e.target.value)} 
                                                            className="p-2 bg-stone-50 rounded-lg text-xs border border-stone-200 outline-none" 
                                                        />
                                                        <input placeholder="Motif..." value={track.reason || ''} onChange={(e) => updateMedicalTracking(idx, 'reason', e.target.value)} className="p-2 bg-stone-50 rounded-lg text-xs border border-stone-200 outline-none md:col-span-1" />
                                                        <input placeholder="Fréquence" value={track.frequency} onChange={(e) => updateMedicalTracking(idx, 'frequency', e.target.value)} className="p-2 bg-stone-50 rounded-lg text-xs border border-stone-200 outline-none" />
                                                        <input placeholder="Depuis..." value={track.since} onChange={(e) => updateMedicalTracking(idx, 'since', e.target.value)} className="p-2 bg-stone-50 rounded-lg text-xs border border-stone-200 outline-none" />
                                                    </div>
                                                    <button onClick={() => removeMedicalTracking(idx)} className="p-2 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                            {(!data.medicalTracking || data.medicalTracking.length === 0) && <p className="text-xs text-stone-400 italic text-center">Aucun suivi renseigné.</p>}
                                        </div>
                                    </div>
                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 5. DÉVELOPPEMENT (SIMPLIFIÉ) --- */}
                            {section.id === 'dev' && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className={labelClass}>Âge de la marche</label>
                                            <div className="flex items-center gap-2">
                                                <input type="number" value={parseInt(data.walkingAge || '0') || ''} onChange={(e) => handleFieldChange('walkingAge', e.target.value + ' mois')} className="w-20 p-2 bg-stone-50 rounded-lg font-bold text-center border border-stone-200 outline-none focus:border-[#E07A5F]" placeholder="Mois" />
                                                <span className="text-sm font-bold text-stone-500">mois</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className={labelClass}>4 pattes / Ramper ?</label>
                                            <ChipGroup 
                                                options={[{value: 'oui', label: 'Oui'}, {value: 'non', label: 'Non'}, {value: 'atypique', label: 'Atypique (Fesses)'}]}
                                                value={data.crawling} 
                                                onChange={(v) => handleFieldChange('crawling', v)} 
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className={labelClass}>Propreté</label>
                                        <ChipGroup 
                                            options={[{value: 'acquise', label: 'Acquise jour/nuit'}, {value: 'jour_seul', label: 'Jour uniquement'}, {value: 'en_cours', label: 'En cours'}, {value: 'accidents', label: 'Accidents fréquents'}]}
                                            value={data.cleanliness} 
                                            onChange={(v) => handleFieldChange('cleanliness', v)} 
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>Langage</label>
                                        <ChipGroup 
                                            options={[{value: 'standard', label: 'Apparition standard'}, {value: 'retard', label: 'Retard simple'}, {value: 'suivi_ortho', label: 'Suivi Ortho'}, {value: 'inintelligible', label: 'Difficile à comprendre'}]}
                                            value={data.languageStatus} 
                                            onChange={(v) => handleFieldChange('languageStatus', v)} 
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>Sommeil</label>
                                        <ChipGroup 
                                            options={[{value: 'ok', label: 'Paisible'}, {value: 'endormissement', label: 'Endormissement long'}, {value: 'reveils', label: 'Réveils multiples'}, {value: 'agite', label: 'Agité / Cauchemars'}]}
                                            value={data.sleepStatus} 
                                            onChange={(v) => handleFieldChange('sleepStatus', v)} 
                                        />
                                    </div>

                                    {/* AJOUT SENSORIEL */}
                                    <div>
                                        <label className={labelClass}>Particularités Sensorielles</label>
                                        <DebouncedTextarea name="sensory" value={data.sensory || ''} onChange={(v) => handleFieldChange('sensory', v)} className={inputClass} placeholder="Hypersensibilité (Bruit, Lumière, Étiquettes, Textures alimentaires...)" rows={2} />
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 6. VIE QUOTIDIENNE & OUTILS --- */}
                            {section.id === 'daily' && (
                                <div className="space-y-8">
                                    
                                    {/* REPAS (Page 4 PDF) */}
                                    <div className="bg-[#fffbf0] border border-amber-100 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Utensils size={14}/> Repas</h4>
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Autonomie & Habitudes</label>
                                                <ChipGroup 
                                                    options={[{value: 'seul', label: 'Mange seul'}, {value: 'aide', label: 'A besoin d\'aide'}, {value: 'doigts', label: 'Mange avec les doigts'}, {value: 'selectif', label: 'Très sélectif'}, {value: 'salit', label: 'Salit beaucoup'}]}
                                                    value={data.eatingHabits} 
                                                    onChange={(v) => handleFieldChange('eatingHabits', v)} 
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Commentaires (Couverts, propreté...)</label>
                                                <DebouncedTextarea name="meals" value={data.meals || ''} onChange={(v) => handleFieldChange('meals', v)} className={inputClass} placeholder="Utilisation des couverts, comportement à table..." rows={2} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* HABILLAGE */}
                                    <div className="bg-[#fff9f9] border border-rose-100 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Shirt size={14}/> Habillage</h4>
                                        <div className="space-y-4">
                                            {[{key: 'clothingButtons', label: 'Boutons'}, {key: 'clothingLaces', label: 'Lacets'}, {key: 'clothingZippers', label: 'Fermetures Éclair'}].map((item) => (
                                                <div key={item.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-rose-100 last:border-0 pb-2">
                                                    <span className="text-sm font-bold text-stone-600">{item.label}</span>
                                                    <div className="flex gap-2">
                                                        {['acquis', 'difficile', 'aide_totale'].map(opt => (
                                                            <label key={opt} className="cursor-pointer">
                                                                <input type="radio" name={item.key} value={opt} checked={(data as any)[item.key] === opt} onChange={handleChange} className="peer sr-only"/>
                                                                <div className="px-3 py-1 rounded-lg border border-stone-200 text-[10px] font-bold uppercase text-stone-400 peer-checked:bg-[#E07A5F] peer-checked:text-white peer-checked:border-[#E07A5F] transition-all">
                                                                    {opt === 'acquis' ? 'Facile' : opt === 'difficile' ? 'Difficile' : 'Impossible'}
                                                                </div>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* AJOUT TEMPS/ESPACE */}
                                    <div>
                                        <label className={labelClass}>Repérage Temps & Espace</label>
                                        <DebouncedTextarea name="timeSpace" value={data.timeSpace || ''} onChange={(v) => handleFieldChange('timeSpace', v)} className={inputClass} placeholder="Se repère-t-il dans la journée ? La semaine ? Retrouve-t-il son chemin ?" rows={2} />
                                    </div>

                                    {/* OUTILS SCOLAIRES */}
                                    <div className="bg-[#f0f9ff] border border-sky-100 p-4 rounded-2xl">
                                        <h4 className="text-xs font-bold text-sky-800 uppercase tracking-wider flex items-center gap-2 mb-4"><Scissors size={14}/> Trousse & Écriture</h4>
                                        
                                        <div className="space-y-4">
                                            <div>
                                                <label className={labelClass}>Main dominante</label>
                                                <ChipGroup options={[{value: 'Droitier', label: 'Droitier'}, {value: 'Gaucher', label: 'Gaucher'}, {value: 'Indeterminé', label: 'Change encore'}]} value={data.handDominance} onChange={(v) => handleFieldChange('handDominance', v)} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Découpage (Ciseaux)</label>
                                                <ChipGroup options={[{value: 'ok', label: 'Suit la ligne'}, {value: 'hache', label: 'Hache le papier'}, {value: 'tenue_incorrecte', label: 'Tenue incorrecte'}]} value={data.toolScissors} onChange={(v) => handleFieldChange('toolScissors', v)} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Douleur en écrivant ?</label>
                                                <ChipGroup options={[{value: 'non', label: 'Jamais'}, {value: 'oui_vite', label: 'Au bout de 5 min'}, {value: 'oui_constante', label: 'Immédiate'}]} value={data.writingPain} onChange={(v) => handleFieldChange('writingPain', v)} />
                                            </div>
                                        </div>
                                    </div>

                                    <FamilyNextButton sectionId={section.id} />
                                </div>
                            )}

                            {/* --- 7. PRIORITÉS (LISTE 1-5) --- */}
                            {section.id === 'reason' && (
                                <div className="space-y-6">
                                    <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                                        <h4 className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-2">
                                            <Smile size={18} /> Vos Objectifs Prioritaires
                                        </h4>
                                        <p className="text-xs text-amber-800 mb-4">Quels sont les 3 à 5 problèmes que vous aimeriez résoudre en premier ?</p>
                                        
                                        <div className="space-y-2 mb-4">
                                            {goals.map((goal, idx) => (
                                                <div key={idx} className="flex items-center gap-2 bg-white p-3 rounded-xl border border-amber-100 shadow-sm animate-in slide-in-from-left-2">
                                                    <span className="font-bold text-amber-500 w-6">{idx + 1}.</span>
                                                    <span className="flex-1 text-sm font-bold text-[#3D405B]">{goal}</span>
                                                    <button onClick={() => removeGoal(idx)} className="text-stone-300 hover:text-rose-500"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                            {goals.length < 5 && (
                                                <div className="flex gap-2">
                                                    <input 
                                                        value={tempGoal}
                                                        onChange={(e) => setTempGoal(e.target.value)}
                                                        onKeyDown={(e) => { if(e.key === 'Enter') { addGoal(tempGoal); setTempGoal(''); } }}
                                                        placeholder="Ajouter un objectif..."
                                                        className="flex-1 p-3 rounded-xl border border-stone-200 text-sm outline-none focus:border-amber-400"
                                                    />
                                                    <button onClick={() => { addGoal(tempGoal); setTempGoal(''); }} className="bg-amber-400 text-white p-3 rounded-xl hover:bg-amber-500 transition-colors"><Plus size={18}/></button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Suggestions */}
                                        <div className="flex flex-wrap gap-2">
                                            {["Écriture lisible", "Faire ses lacets", "Manger proprement", "Rester assis", "Moins de colères", "Utiliser la règle", "S'habiller seul"].map(sug => (
                                                <button key={sug} onClick={() => addGoal(sug)} className="px-3 py-1 bg-white border border-amber-100 rounded-full text-xs font-bold text-amber-600 hover:bg-amber-100 transition-all">+ {sug}</button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className={labelClass}>Autres remarques</label>
                                        <DebouncedTextarea name="remarks" value={data.remarks || ''} onChange={(v) => handleFieldChange('remarks', v)} className={inputClass} rows={2} placeholder="Quelque chose d'autre à signaler ?" />
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
