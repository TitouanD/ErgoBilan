
import React, { useState, useCallback } from 'react';
import type { Patient } from '../../types';
import { calculateAge, getPatientAgeForIdentity, isPatientCreationReady } from '../../utils';
import { User, Lock, AlertTriangle, Database, CheckCircle2, Mic, MicOff, Edit3, Check, FileText } from 'lucide-react';
import { SharedQuestionnaire } from '../shared/SharedQuestionnaire';
import { useAuth } from '../../contexts/AuthContext';
import { useAssessment } from '../../contexts/AssessmentContext';
import { StorageService } from '../../services/storage';
import { Logger } from '../../utils/logger';
import { useToast } from '../../contexts/ToastContext';
import { DEMO_PATIENTS } from '../../data/demoData';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';

interface Props {
  data: Patient;
  updateData: (data: Partial<Patient>) => void;
  onNext: () => void;
  onPatientCreated: () => void;
}

// --- VOICE TEXTAREA COMPONENT (reusable across steps) ---
export const VoiceTextarea: React.FC<{
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    rows?: number;
    className?: string;
    label?: string;
}> = ({ value, onChange, placeholder, rows = 5, className = '', label }) => {
    const handleTranscript = useCallback((text: string) => {
        onChange(value ? `${value} ${text}` : text);
    }, [value, onChange]);

    const { isListening, isSupported, interimText, toggleListening } = useVoiceDictation({
        onTranscript: handleTranscript,
    });

    return (
        <div className="relative">
            {label && <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">{label}</label>}
            <div className="relative">
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    rows={rows}
                    className={`w-full bg-white border rounded-xl p-4 text-stone-700 placeholder:text-stone-300 outline-none focus:ring-2 focus:ring-[#E07A5F]/30 focus:border-[#E07A5F]/50 resize-none leading-relaxed pr-12 ${className}`}
                />
                {isSupported && (
                    <button
                        type="button"
                        onClick={toggleListening}
                        className={`absolute top-3 right-3 p-2 rounded-xl transition-all ${
                            isListening 
                                ? 'bg-red-100 text-red-600 animate-pulse shadow-lg shadow-red-200' 
                                : 'bg-stone-100 text-stone-400 hover:bg-[#E07A5F]/10 hover:text-[#E07A5F]'
                        }`}
                        title={isListening ? 'Arrêter la dictée' : 'Dictée vocale'}
                    >
                        {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                )}
            </div>
            {isListening && interimText && (
                <div className="mt-1 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 italic animate-pulse">
                    🎙️ {interimText}...
                </div>
            )}
        </div>
    );
};

// --- SECTION SUMMARY (read-only condensed view) ---
const SectionSummary: React.FC<{
    title: string;
    fields: { label: string; value?: string }[];
    isFilled: boolean;
    onToggleEdit: () => void;
}> = ({ title, fields, isFilled, onToggleEdit }) => {
    const filledFields = fields.filter(f => f.value?.trim());
    
    return (
        <div className={`border rounded-2xl transition-all ${isFilled ? 'border-stone-100 bg-white' : 'border-amber-200 bg-amber-50/30'}`}>
            <div className="flex items-center justify-between p-4 cursor-pointer" onClick={onToggleEdit}>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${isFilled ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        <FileText size={16} />
                    </div>
                    <div>
                        <h4 className="font-bold text-sm text-[#3D405B]">{title}</h4>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isFilled ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {isFilled ? '✓ Rempli par la famille' : '⚠ À compléter'}
                        </span>
                    </div>
                </div>
                <button className="p-2 hover:bg-stone-100 rounded-xl transition-colors text-stone-400 hover:text-[#3D405B]">
                    <Edit3 size={16} />
                </button>
            </div>
            {filledFields.length > 0 && (
                <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-3 gap-2">
                    {filledFields.slice(0, 6).map((f, i) => (
                        <div key={i} className="text-xs">
                            <span className="text-stone-400">{f.label}: </span>
                            <span className="text-stone-600 font-medium">{(f.value?.length || 0) > 40 ? f.value?.slice(0, 40) + '…' : f.value}</span>
                        </div>
                    ))}
                    {filledFields.length > 6 && (
                        <div className="text-xs text-stone-400 italic">+{filledFields.length - 6} autres champs</div>
                    )}
                </div>
            )}
        </div>
    );
};

export const Step1Admin: React.FC<Props> = ({ data, updateData, onNext, onPatientCreated }) => {
  const { userProfile, orgKey } = useAuth(); 
  const { loadFromDraft } = useAssessment();
  const [dataLoaded, setDataLoaded] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [viewMode, setViewMode] = useState<'review' | 'edit'>('review');
  const toast = useToast();
  
  const handleDataChange = (partialData: Partial<Patient>) => {
      if (partialData.dob) {
          partialData.age = calculateAge(partialData.dob);
      }
      updateData(partialData);
  };

  const handleNotesChange = useCallback((val: string) => {
      updateData({ interviewNotes: val });
  }, [updateData]);

  // Determine if parent questionnaire has meaningful content (not only reason/expectations).
  const hasQuestionnaireData = !!(
      data.reason ||
      data.familyExpectations ||
      data.goals?.length ||
      data.remarks ||
      data.interviewNotes ||
      data.parentNames ||
      data.school ||
      data.medicalDiagnosis ||
      data.developmentMotor ||
      data.meals ||
      data.writingIssues
  );
  const hasParentData = !!(data.firstName && data.lastName && data.dob && hasQuestionnaireData);
  
  // Section fill status checks
  const sectionDefs = [
      { title: 'État Civil', filled: !!(data.firstName && data.lastName && data.dob), fields: [
          { label: 'Prénom', value: data.firstName }, { label: 'Nom', value: data.lastName },
          { label: 'Date de naissance', value: data.dob }, { label: 'Genre', value: data.gender },
          { label: 'Adresse', value: data.address },
      ]},
      { title: 'Situation Familiale', filled: !!data.parentNames, fields: [
          { label: 'Parents', value: data.parentNames }, { label: 'Téléphone', value: data.parentPhone },
          { label: 'Email', value: data.parentEmail }, { label: 'Garde', value: data.guardArrangement },
      ]},
      { title: 'Scolarité', filled: !!(data.school && data.classLevel), fields: [
          { label: 'École', value: data.school }, { label: 'Classe', value: data.classLevel },
          { label: 'Plan', value: data.carePlan }, { label: 'AVS', value: data.avs },
          { label: 'Attention', value: data.schoolAttention },
      ]},
      { title: 'Suivi Médical', filled: !!(data.prescribingDoctor || (data.medicalTracking?.length ?? 0) > 0), fields: [
          { label: 'Médecin', value: data.prescribingDoctor }, { label: 'Diagnostic', value: data.medicalDiagnosis },
          { label: 'Traitements', value: data.medicalTreatments },
          { label: 'Suivis', value: data.medicalTracking?.map(t => t.type).join(', ') },
      ]},
      { title: 'Développement', filled: !!(data.walkingAge || data.developmentMotor), fields: [
          { label: 'Marche', value: data.walkingAge }, { label: 'Moteur', value: data.developmentMotor },
          { label: 'Langage', value: data.developmentLanguage }, { label: 'Sommeil', value: data.sleepStatus || data.sleep },
      ]},
      { title: 'Vie Quotidienne', filled: !!(data.meals || data.dressing), fields: [
          { label: 'Repas', value: data.meals }, { label: 'Habillage', value: data.dressing },
          { label: 'Écriture', value: data.writingIssues }, { label: 'Douleur', value: data.writingPain },
          { label: 'Latéralité', value: data.handDominance },
      ]},
      { title: 'Motif & Priorités', filled: !!(data.reason || data.familyExpectations || (data.goals?.length ?? 0) > 0 || data.remarks), fields: [
          { label: 'Motif', value: data.reason || data.remarks }, { label: 'Attentes', value: data.familyExpectations },
          { label: 'Objectifs', value: data.goals?.join(', ') },
      ]},
  ];

  const filledSections = sectionDefs.filter(s => s.filled).length;
  const totalSections = sectionDefs.length;

  const ensurePatientPersisted = async (): Promise<void> => {
      if (!orgKey) throw new Error('Missing org key');
      if (!isPatientCreationReady(data)) throw new Error('PATIENT_REQUIRED_FIELDS_MISSING');

      const patientId = await StorageService.ensurePatientId(data, orgKey);
      const patientSnapshot: Patient = {
          ...data,
          id: patientId,
          age: getPatientAgeForIdentity(data),
      };

      if (data.id !== patientId || data.age !== patientSnapshot.age) {
          updateData({ id: patientId, age: patientSnapshot.age });
      }

      await StorageService.syncPatientIdentityPreview(patientId, patientSnapshot, orgKey);
      onPatientCreated();
  };

  const handleFakeData = async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
          const freshData = JSON.parse(JSON.stringify(DEMO_PATIENTS.LEO));
          if (!freshData.patient.id) freshData.patient.id = crypto.randomUUID();
          loadFromDraft(freshData);
          if (orgKey) {
              const patientId = await StorageService.ensurePatientId(freshData.patient, orgKey);
              await StorageService.syncPatientIdentityPreview(patientId, { ...freshData.patient, id: patientId }, orgKey);
              onPatientCreated();
          }
          setDataLoaded(true);
          setFormKey(prev => prev + 1); 
          setTimeout(() => setDataLoaded(false), 2000);
      } catch (err) {
          Logger.error('SYSTEM', "ERREUR INJECTION:", err);
          toast.error("Erreur lors de l'injection des données test.");
      }
  };

  const handleNextStep = async () => {
      try {
          if (!isPatientCreationReady(data)) {
              toast.error("Le nom, le prénom et la date de naissance sont obligatoires.");
              return;
          }
          await ensurePatientPersisted();
          onNext();
      } catch (e) {
          Logger.error('DB', "Erreur sauvegarde patient:", e);
          toast.error("Impossible de sauvegarder le patient. Réessayez.");
      }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 animate-in fade-in duration-500">
      
      <div className="mb-8 border-b border-stone-200 pb-6 flex justify-between items-end relative z-10">
        <div>
            <h2 className="text-3xl font-serif font-bold text-stone-900">Dossier Patient</h2>
            <p className="text-stone-500 font-medium mt-2">
                {hasParentData ? 'Revue des données transmises par la famille.' : 'Saisie des informations patient.'}
            </p>
        </div>
        <div className="flex gap-3 items-center">
            {userProfile.isAdmin && (
                <button 
                    type="button" onClick={handleFakeData}
                    className={`relative z-50 cursor-pointer px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 border transition-all active:scale-95 shadow-md ${dataLoaded ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200'}`}
                >
                    {dataLoaded ? <CheckCircle2 size={14}/> : <Database size={14} />} 
                    {dataLoaded ? 'Données Injectées' : 'FAKE DATA'}
                </button>
            )}
            <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 border border-emerald-100">
                <User size={14} /> Mode Praticien
            </div>
        </div>
      </div>

      {/* PROGRESS INDICATOR */}
      {hasParentData && viewMode === 'review' && (
          <div className="mb-6 bg-white rounded-2xl border border-stone-100 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Complétion du dossier</span>
                  <span className="text-sm font-bold text-[#3D405B]">{filledSections}/{totalSections} sections</span>
              </div>
              <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div 
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{ 
                          width: `${(filledSections / totalSections) * 100}%`,
                          background: filledSections === totalSections ? '#81B29A' : 'linear-gradient(90deg, #E07A5F, #F2CC8F)'
                      }}
                  />
              </div>
          </div>
      )}

      {/* CLINICAL NOTES — Always visible, prominently placed, fed to AI */}
      <div className="bg-gradient-to-br from-[#fffdf5] to-[#fff8ec] border border-[#F2CC8F]/40 rounded-[24px] p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[#d97706]">
                  <FileText size={18} />
                  <h3 className="font-bold text-sm uppercase tracking-wider">Notes Cliniques d'Entretien</h3>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-stone-400">
                  <Lock size={10} /> Chiffré · Utilisé par l'IA pour la rédaction
              </div>
          </div>
          <VoiceTextarea
              value={data.interviewNotes || ''}
              onChange={handleNotesChange}
              placeholder="Dictez ou tapez vos notes d'entretien : comportement observé, coopération, impression clinique, contexte familial, éléments non couverts par le questionnaire..."
              rows={5}
              className="border-[#F2CC8F]/30 focus:ring-[#F2CC8F]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-stone-400">
              <span className="flex items-center gap-1"><AlertTriangle size={10} /> Notes chiffrées, invisibles dans l'espace famille.</span>
              <span className="flex items-center gap-1"><Mic size={10} /> Utilisez le micro pour dicter.</span>
          </div>
      </div>

      {/* QUESTIONNAIRE — Review mode (condensed) or Edit mode (full form) */}
      {hasParentData && viewMode === 'review' ? (
          <div className="space-y-3 mb-8">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wider">Données du questionnaire famille</h3>
                  <button 
                      onClick={() => setViewMode('edit')}
                      className="text-xs font-bold text-[#E07A5F] hover:underline flex items-center gap-1"
                  >
                      <Edit3 size={12} /> Tout modifier
                  </button>
              </div>
              {sectionDefs.map((sec, i) => (
                  <SectionSummary
                      key={i}
                      title={sec.title}
                      fields={sec.fields}
                      isFilled={sec.filled}
                      onToggleEdit={() => setViewMode('edit')}
                  />
              ))}
          </div>
      ) : (
          <>
              {viewMode === 'edit' && hasParentData && (
                  <div className="mb-4 flex justify-end">
                      <button 
                          onClick={() => setViewMode('review')}
                          className="text-xs font-bold text-stone-400 hover:text-[#3D405B] flex items-center gap-1 px-3 py-2 rounded-xl hover:bg-stone-50 transition-colors"
                      >
                          <Check size={12} /> Retour à la vue résumée
                      </button>
                  </div>
              )}
              <SharedQuestionnaire 
                  key={formKey} 
                  data={data} 
                  onChange={handleDataChange} 
                  mode="practitioner" 
              />
          </>
      )}

      <div className="flex justify-center pt-12">
        <button 
            onClick={handleNextStep}
            disabled={!isPatientCreationReady(data)}
            className="px-10 py-4 bg-[#3D405B] text-white rounded-xl font-bold text-sm shadow-xl hover:bg-[#E07A5F] hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
            Suivant : Tests & Mesures
        </button>
      </div>
    </div>
  );
};
