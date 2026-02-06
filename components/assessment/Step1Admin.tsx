
import React, { useState } from 'react';
import { Patient, PatientFile } from '../../types';
import { calculateAge } from '../../utils';
import { User, Lock, AlertTriangle, Database, CheckCircle2 } from 'lucide-react';
import { SharedQuestionnaire } from '../shared/SharedQuestionnaire';
import { useAuth } from '../../contexts/AuthContext';
import { useAssessment } from '../../contexts/AssessmentContext';
import { DEMO_PATIENTS } from '../../data/demoData';
import { StorageService } from '../../services/storage';
import { Logger } from '../../utils/logger';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  data: Patient;
  updateData: (data: Partial<Patient>) => void;
  onNext: () => void;
  onPatientCreated: () => void;
}

export const Step1Admin: React.FC<Props> = ({ data, updateData, onNext, onPatientCreated }) => {
  const { userProfile, sessionKey, orgKey } = useAuth(); 
  const { loadFromDraft, patient } = useAssessment();
  const [dataLoaded, setDataLoaded] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const toast = useToast();
  
  const handleDataChange = (partialData: Partial<Patient>) => {
      if (partialData.dob) {
          partialData.age = calculateAge(partialData.dob);
      }
      updateData(partialData);
  };

  const handlePrivateNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateData({ interviewNotes: e.target.value });
  };

  /**
   * Sécurité : On force une sauvegarde explicite au moment de passer à l'étape suivante.
   * Note : L'ID est normalement déjà généré par le Context dès la saisie.
   */
  const ensurePatientPersisted = async (): Promise<void> => {
      if (!orgKey || !data.id) return;

      // On s'assure que le fichier patient est bien créé/mis à jour
      const fileWrapper: PatientFile = {
          id: data.id,
          patient: data,
          reports: [],
          sessions: [],
          lastInteraction: new Date().toISOString(),
          archived: false
      };

      await StorageService.saveFile(fileWrapper, orgKey);
      
      // Le Realtime du Dashboard devrait détecter le changement, mais on appelle le callback au cas où
      if (onPatientCreated) onPatientCreated();
  };

  const handleFakeData = async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      try {
          const freshData = JSON.parse(JSON.stringify({ 
              patient: DEMO_PATIENTS.LEO.patient, 
              tests: DEMO_PATIENTS.LEO.tests, 
              observations: DEMO_PATIENTS.LEO.observations 
          }));
          
          // On génère un ID frais si besoin
          if (!freshData.patient.id || freshData.patient.id === 'demo-leo') freshData.patient.id = crypto.randomUUID();
          
          // Mise à jour du context via loadFromDraft pour écraser proprement
          loadFromDraft(freshData);
          
          // Trigger la sauvegarde immédiate si on a la clé
          if (orgKey) {
              const fileWrapper: PatientFile = {
                  id: freshData.patient.id,
                  patient: freshData.patient,
                  reports: [],
                  sessions: [],
                  lastInteraction: new Date().toISOString(),
                  archived: false
              };
              await StorageService.saveFile(fileWrapper, orgKey);
              if (onPatientCreated) onPatientCreated();
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
          // Validation basique
          if (!data.lastName || !data.firstName) {
              toast.error("Le nom et le prénom sont obligatoires.");
              return;
          }
          
          await ensurePatientPersisted();
          onNext();
      } catch (e) {
          Logger.error('DB', "Erreur sauvegarde patient:", e);
          // On ne bloque pas la navigation si erreur réseau, le draft local/session existe
          onNext();
      }
  };

  // Check de validation sécurisé (évite le passage si le debounce n'a pas fini de commit)
  const isFormValid = data.lastName?.trim().length > 0 && data.firstName?.trim().length > 0;

  return (
    <div className="max-w-4xl mx-auto pb-20 animate-in fade-in duration-500">
      
      <div className="mb-10 border-b border-stone-200 pb-6 flex justify-between items-end relative z-10">
        <div>
            <h2 className="text-3xl font-serif font-bold text-stone-900">Dossier Patient</h2>
            <p className="text-stone-500 font-medium mt-2">Revue des données transmises et complétion.</p>
        </div>
        <div className="flex gap-3 items-center">
            {userProfile.isAdmin && (
                <button 
                    type="button"
                    onClick={handleFakeData}
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

      <div className="bg-[#fffdf5] border border-[#F2CC8F]/50 rounded-[24px] p-6 mb-8 shadow-sm">
          <div className="flex items-center gap-2 mb-4 text-[#d97706]">
              <Lock size={18} />
              <h3 className="font-bold text-sm uppercase tracking-wider">Notes d'Entretien (Privé)</h3>
          </div>
          <textarea 
              value={data.interviewNotes || ''}
              onChange={handlePrivateNotesChange}
              placeholder="Notes confidentielles, impressions cliniques, éléments non partagés avec la famille..."
              className="w-full h-32 bg-white border border-[#F2CC8F]/30 rounded-xl p-4 text-stone-700 placeholder:text-stone-400 outline-none focus:ring-2 focus:ring-[#F2CC8F] resize-none leading-relaxed"
          />
          <div className="mt-2 flex items-center gap-2 text-[10px] text-stone-400">
              <AlertTriangle size={10} /> Ces notes sont chiffrées avec votre clé praticien et ne sont jamais visibles dans l'espace famille.
          </div>
      </div>

      <SharedQuestionnaire 
          key={formKey} 
          data={data} 
          onChange={handleDataChange} 
          mode="practitioner" 
      />

      <div className="flex justify-center pt-12">
        <button 
            onClick={handleNextStep}
            disabled={!isFormValid}
            className="px-10 py-4 bg-[#3D405B] text-white rounded-xl font-bold text-sm shadow-xl hover:bg-[#E07A5F] hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
            Suivant : Tests & Mesures
        </button>
      </div>
    </div>
  );
};
