
import React, { useState, useEffect } from 'react';
import { Patient, Sibling } from '../../types';
import { calculateAge } from '../../utils';
import { DebouncedInput, DebouncedTextarea } from './DebouncedControls';
import { User, Users, GraduationCap, Stethoscope, Baby, Coffee, MessageSquare, ChevronDown, ChevronUp, Check, AlertCircle, Plus, Trash2 } from 'lucide-react';

interface Props {
  data: Patient;
  onChange: (data: Partial<Patient>) => void;
  mode: 'family' | 'practitioner';
}

type SectionKey = 'identity' | 'parents' | 'school' | 'medical' | 'dev' | 'daily' | 'reason';

const SECTIONS_CONFIG: { id: SectionKey; title: string; icon: any; fields: (keyof Patient)[] }[] = [
    { id: 'identity', title: "Identité de l'enfant", icon: User, fields: ['lastName', 'firstName', 'dob', 'gender', 'address'] },
    { id: 'parents', title: "Responsables Légaux", icon: Users, fields: ['parentNames', 'parentPhone', 'parentEmail', 'guardArrangement'] },
    { id: 'school', title: "Scolarité", icon: GraduationCap, fields: ['school', 'classLevel', 'carePlan', 'avs', 'schoolAttention'] },
    { id: 'medical', title: "Suivi Médical", icon: Stethoscope, fields: ['prescribingDoctor', 'medicalDiagnosis', 'medicalTreatments', 'medicalFollowup'] },
    { id: 'reason', title: "Motif & Attentes", icon: MessageSquare, fields: ['reason', 'familyExpectations'] },
    { id: 'dev', title: "Développement", icon: Baby, fields: ['pregnancyBirth', 'developmentMotor', 'developmentLanguage', 'sleep', 'sensory'] },
    { id: 'daily', title: "Vie Quotidienne", icon: Coffee, fields: ['meals', 'dressing', 'continence', 'timeSpace'] },
];

export const SharedQuestionnaire: React.FC<Props> = ({ data, onChange, mode }) => {
  
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
      identity: true,
      parents: mode === 'family' ? false : true,
      school: mode === 'family' ? false : true,
      medical: mode === 'family' ? false : true,
      reason: mode === 'family' ? false : true,
      dev: mode === 'family' ? false : true,
      daily: mode === 'family' ? false : true,
  });

  const [progress, setProgress] = useState(0);

  useEffect(() => {
      if (mode === 'practitioner') {
          const newOpenState = { ...openSections };
          let allClosed = true;

          SECTIONS_CONFIG.forEach(sec => {
              const hasData = sec.fields.some(f => data[f] && data[f].length > 0);
              if (hasData) {
                  newOpenState[sec.id] = false;
              } else {
                  newOpenState[sec.id] = true;
                  allClosed = false;
              }
          });

          if (allClosed) {
              newOpenState['identity'] = true;
          }

          setOpenSections(newOpenState);
      }
  }, []);

  useEffect(() => {
      if (mode === 'family') {
          const totalFields = SECTIONS_CONFIG.reduce((acc, sec) => acc + sec.fields.length, 0);
          const filledFields = SECTIONS_CONFIG.reduce((acc, sec) => acc + sec.fields.filter(f => data[f] && data[f].length > 2).length, 0);
          setProgress(Math.round((filledFields / totalFields) * 100));
      }
  }, [data, mode]);

  const toggleSection = (id: SectionKey) => {
      setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleFieldChange = (field: keyof Patient, value: string) => {
      if (field === 'dob') {
          onChange({ [field]: value, age: calculateAge(value) });
      } else {
          onChange({ [field]: value });
      }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Pour les inputs natifs comme Radio
      onChange({ [e.target.name]: e.target.value });
  };

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

  const isSectionComplete = (sectionId: SectionKey) => {
      const section = SECTIONS_CONFIG.find(s => s.id === sectionId);
      if (!section) return false;
      const filled = section.fields.filter(f => data[f] && data[f].length > 0).length;
      return filled >= 1; 
  };

  const inputClass = "w-full p-3 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-[#E07A5F] focus:bg-white transition-all font-bold text-[#3D405B]";

  return (
    <div className="space-y-6">
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
            const isComplete = isSectionComplete(section.id);
            const headerColor = mode === 'practitioner' && isComplete ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-stone-200';
            const iconColor = mode === 'practitioner' && isComplete ? 'text-emerald-600 bg-emerald-100' : 'text-[#E07A5F] bg-[#fff5f2]';

            return (
                <div key={section.id} className={`rounded-[24px] border transition-all duration-300 overflow-hidden ${isOpen ? 'shadow-md border-[#E07A5F]/30' : 'shadow-sm hover:shadow'}`}>
                    <button 
                        onClick={() => toggleSection(section.id)}
                        className={`w-full flex items-center justify-between p-5 transition-colors ${isOpen ? 'bg-white' : headerColor}`}
                    >
                        <div className="flex items-center gap-4">
                            <div className={`p-2.5 rounded-xl ${iconColor}`}>
                                {mode === 'practitioner' && isComplete && !isOpen ? <Check size={20} /> : <section.icon size={20} />}
                            </div>
                            <div className="text-left">
                                <h3 className={`font-serif font-bold text-lg ${mode === 'practitioner' && isComplete ? 'text-emerald-800' : 'text-[#3D405B]'}`}>
                                    {section.title}
                                </h3>
                                {mode === 'practitioner' && isComplete && !isOpen && (
                                    <p className="text-xs text-emerald-600 font-medium mt-0.5">Données saisies</p>
                                )}
                            </div>
                        </div>
                        <div className={`p-2 rounded-full ${isOpen ? 'text-[#E07A5F] bg-[#fff5f2]' : 'text-stone-300'}`}>
                            {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                    </button>

                    {isOpen && (
                        <div className="p-6 bg-white border-t border-stone-50 animate-in slide-in-from-top-2">
                            
                            {section.id === 'identity' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Nom</label>
                                        <DebouncedInput name="lastName" value={data.lastName || ''} onChange={(v) => handleFieldChange('lastName', v)} className={inputClass} placeholder="Nom de famille" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Prénom</label>
                                        <DebouncedInput name="firstName" value={data.firstName || ''} onChange={(v) => handleFieldChange('firstName', v)} className={inputClass} placeholder="Prénom" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Date de naissance</label>
                                        <input type="date" name="dob" value={data.dob || ''} onChange={handleChange} className={inputClass} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Genre</label>
                                        <div className="flex gap-4 pt-2">
                                            <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="gender" value="M" checked={data.gender === 'M'} onChange={handleChange} className="accent-[#E07A5F]"/> Garçon</label>
                                            <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="gender" value="F" checked={data.gender === 'F'} onChange={handleChange} className="accent-[#E07A5F]"/> Fille</label>
                                        </div>
                                    </div>
                                    <div className="md:col-span-2 space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Adresse</label>
                                        <DebouncedInput name="address" value={data.address || ''} onChange={(v) => handleFieldChange('address', v)} className={inputClass} placeholder="Adresse complète" />
                                    </div>
                                </div>
                            )}

                            {section.id === 'parents' && (
                                <div className="space-y-5">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Noms des responsables</label>
                                        <DebouncedInput name="parentNames" value={data.parentNames || ''} onChange={(v) => handleFieldChange('parentNames', v)} className={inputClass} placeholder="Mme X et M. Y" />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Téléphone</label>
                                            <DebouncedInput name="parentPhone" type="tel" value={data.parentPhone || ''} onChange={(v) => handleFieldChange('parentPhone', v)} className={inputClass} />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Email</label>
                                            <DebouncedInput name="parentEmail" type="email" value={data.parentEmail || ''} onChange={(v) => handleFieldChange('parentEmail', v)} className={inputClass} />
                                        </div>
                                    </div>
                                    
                                    <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                                        <div className="flex justify-between items-center mb-3">
                                            <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Fratrie</span>
                                            <button onClick={addSibling} className="text-[10px] bg-white border border-stone-200 px-3 py-1.5 rounded-full uppercase font-bold tracking-wider hover:bg-[#3D405B] hover:text-white transition-all flex items-center gap-1">
                                                <Plus size={12}/> Ajouter
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {data.siblings?.map((sib, idx) => (
                                                <div key={idx} className="flex gap-2 items-center">
                                                    <input placeholder="Prénom" value={sib.firstName} onChange={e => updateSibling(idx, 'firstName', e.target.value)} className="flex-1 p-2 bg-white rounded-lg text-sm border border-stone-200 outline-none focus:border-[#E07A5F]" />
                                                    <input placeholder="Âge" value={sib.age} onChange={e => updateSibling(idx, 'age', e.target.value)} className="w-16 p-2 bg-white rounded-lg text-sm border border-stone-200 outline-none focus:border-[#E07A5F]" />
                                                    <button onClick={() => removeSibling(idx)} className="p-2 text-stone-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                            {(!data.siblings || data.siblings.length === 0) && (
                                                <p className="text-xs text-stone-400 italic text-center py-2">Aucun frère ou sœur renseigné.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {section.id === 'school' && (
                                <div className="space-y-5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">École</label>
                                            <DebouncedInput name="school" value={data.school || ''} onChange={(v) => handleFieldChange('school', v)} className={inputClass} />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Classe</label>
                                            <DebouncedInput name="classLevel" value={data.classLevel || ''} onChange={(v) => handleFieldChange('classLevel', v)} className={inputClass} />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Dispositifs (PAI, PAP, PPS)</label>
                                        <select name="carePlan" value={data.carePlan || ''} onChange={handleChange as any} className={inputClass}>
                                            <option value="">Aucun</option>
                                            <option value="PAP">PAP (Plan d'Accompagnement Personnalisé)</option>
                                            <option value="PAI">PAI (Projet d'Accueil Individualisé)</option>
                                            <option value="PPS">PPS (Projet Personnalisé de Scolarisation)</option>
                                            <option value="PPRE">PPRE</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Vie Scolaire & Comportement</label>
                                        <DebouncedTextarea name="schoolAttention" value={data.schoolAttention || ''} onChange={(v) => handleFieldChange('schoolAttention', v)} className={inputClass} rows={3} placeholder="Attention, relations, comportement..." />
                                    </div>
                                </div>
                            )}

                            {section.id === 'reason' && (
                                <div className="space-y-5">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Pourquoi consultez-vous ?</label>
                                        <DebouncedTextarea name="reason" value={data.reason || ''} onChange={(v) => handleFieldChange('reason', v)} className="w-full p-4 bg-rose-50/50 rounded-xl border border-rose-100 outline-none focus:border-[#E07A5F] focus:bg-white transition-all text-[#3D405B] resize-none font-medium" rows={4} placeholder="Décrivez les difficultés principales..." />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Vos attentes</label>
                                        <DebouncedTextarea name="familyExpectations" value={data.familyExpectations || ''} onChange={(v) => handleFieldChange('familyExpectations', v)} className={inputClass} rows={2} />
                                    </div>
                                </div>
                            )}

                            {['medical', 'dev', 'daily'].includes(section.id) && (
                                <div className="space-y-5">
                                    {section.fields.map(field => (
                                        <div key={field} className="space-y-1">
                                            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">
                                                {field === 'medicalDiagnosis' ? 'Diagnostics' : 
                                                 field === 'medicalTreatments' ? 'Traitements' :
                                                 field === 'pregnancyBirth' ? 'Grossesse & Naissance' :
                                                 field === 'developmentMotor' ? 'Développement Moteur' :
                                                 field === 'meals' ? 'Repas' :
                                                 field === 'dressing' ? 'Habillage' :
                                                 field}
                                            </label>
                                            <DebouncedTextarea 
                                                name={field} 
                                                value={data[field] as string || ''} 
                                                onChange={(v) => handleFieldChange(field, v)} 
                                                className={inputClass} 
                                                rows={2} 
                                            />
                                        </div>
                                    ))}
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
