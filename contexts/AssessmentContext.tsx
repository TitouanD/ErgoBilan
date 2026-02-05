
import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Patient, TestData, Observations, ReportSection, PatientFile } from '../types';
import { StorageService } from '../services/storage';
import { useAuth } from './AuthContext';
import { Logger } from '../utils/logger';

interface AssessmentContextType {
  patient: Patient;
  tests: TestData;
  observations: Observations;
  sections: ReportSection[];
  step: number;
  isAutoSaving: boolean;
  
  setPatient: (p: Patient) => void;
  updatePatient: (p: Partial<Patient>) => void;
  
  setTests: (t: TestData) => void;
  updateTests: (t: Partial<TestData>) => void;
  
  setObservations: (o: Observations) => void;
  updateObservations: (o: Partial<Observations>) => void;
  
  setSections: (s: ReportSection[]) => void;
  updateSection: (id: string, update: Partial<ReportSection>) => void;
  
  setStep: (s: number) => void;
  resetAssessment: () => void;
  loadFromDraft: (draft: any) => void;
}

const AssessmentContext = createContext<AssessmentContextType | undefined>(undefined);

const initialPatient: Patient = {
  firstName: '', lastName: '', dob: '', age: '', gender: '', address: '',
  parentNames: '', parentPhone: '', parentEmail: '', guardArrangement: '', siblings: [],
  school: '', classLevel: '', teacher: '', carePlan: '', avs: '', avsDetails: '',
  prescribingDoctor: '', medicalDiagnosis: '', medicalTreatments: '', medicalFollowup: '',
  reason: '', familyExpectations: '',
  pregnancyBirth: '', developmentMotor: '', developmentLanguage: '', sleep: '', sensory: '',
  meals: '', dressing: '', continence: '', timeSpace: '',
  schoolAttention: '', writingIssues: '', toolUsage: '', schoolAccommodations: '',
  remarks: '', priorities: ''
};

const initialObs: Observations = {
  anamnese: '', motricite: '', coordination: '', spatial: '', graphique: ''
};

export const AssessmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sessionKey, orgKey, isDemoMode } = useAuth(); // Récupération de orgKey pour la sauvegarde Patient
  
  const [patient, setPatient] = useState<Patient>(initialPatient);
  const [tests, setTests] = useState<TestData>({});
  const [observations, setObservations] = useState<Observations>(initialObs);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [step, setStep] = useState(1);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-Save Logic Renforcée
  useEffect(() => {
      // Conditions d'arrêt : Pas de session (sauf démo) ou données vides
      if (!sessionKey && !isDemoMode) return;
      
      // On ne sauvegarde pas si le patient n'a même pas un début de nom (évite les fichiers vides)
      const hasMinimalData = patient.lastName.trim().length > 0 || patient.firstName.trim().length > 0;
      if (!hasMinimalData) return;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setIsAutoSaving(true);
      
      saveTimeoutRef.current = setTimeout(async () => {
          try {
              // 1. Sauvegarde du Brouillon (Données Volatiles & Privées)
              const draftData = { patient, tests, observations, sections, step, timestamp: new Date().toISOString() };
              if (sessionKey) {
                  await StorageService.saveDraft(draftData, sessionKey);
              }

              // 2. Sauvegarde Structurelle (Fichier Patient) - UNIQUEMENT SI ID EXISTE
              // Cela permet au Dashboard de "voir" le patient même si on n'a pas cliqué sur Suivant.
              // On le fait si on a la clé d'organisation (Authentifié)
              if (orgKey && patient.id && hasMinimalData) {
                  // On crée un objet PatientFile minimal pour mettre à jour l'identité chiffrée
                  // Attention : On ne sauvegarde pas les reports/sessions ici, juste l'identité.
                  const fileWrapper: PatientFile = {
                      id: patient.id,
                      patient: patient,
                      reports: [], // On n'écrase pas, StorageService gère l'upsert intelligent normalement mais ici c'est safe car vide
                      sessions: [],
                      lastInteraction: new Date().toISOString(),
                      archived: false
                  };
                  
                  // Logger.debug('DB', "Auto-creating patient entry for dashboard visibility", patient.id);
                  await StorageService.saveFile(fileWrapper, orgKey);
              }

          } catch(e) { 
              Logger.warn('DB', "Autosave failed (silently)", e); 
          } finally { 
              setIsAutoSaving(false); 
          }
      }, 2000); // Debounce 2s

      return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [patient, tests, observations, sections, step, sessionKey, orgKey, isDemoMode]);

  const updatePatient = (data: Partial<Patient>) => {
      setPatient(prev => {
          const newData = { ...prev, ...data };
          // Génération d'ID immédiate dès la première saisie si inexistant
          if (!newData.id) {
              newData.id = crypto.randomUUID();
              Logger.info('UI', "Generated new Patient ID locally:", newData.id);
          }
          return newData;
      });
  };

  const updateTests = (data: Partial<TestData>) => setTests(prev => ({ ...prev, ...data }));
  const updateObservations = (data: Partial<Observations>) => setObservations(prev => ({ ...prev, ...data }));
  
  const updateSection = (id: string, update: Partial<ReportSection>) => {
      setSections(prev => prev.map(s => s.id === id ? { ...s, ...update } : s));
  };

  const resetAssessment = () => {
      setPatient(initialPatient);
      setTests({});
      setObservations(initialObs);
      setSections([]);
      setStep(1);
  };

  const loadFromDraft = (draft: any) => {
      Logger.debug('DB', "Context: Loading Draft...", draft);
      if (draft.patient) {
          setPatient({ ...draft.patient });
      }
      if (draft.tests) {
          setTests({ ...draft.tests });
      }
      if (draft.observations) {
          setObservations({ ...draft.observations });
      }
      if (draft.sections) setSections([...draft.sections]);
      if (draft.step) setStep(draft.step);
  };

  return (
    <AssessmentContext.Provider value={{
        patient, setPatient, updatePatient,
        tests, setTests, updateTests,
        observations, setObservations, updateObservations,
        sections, setSections, updateSection,
        step, setStep,
        isAutoSaving,
        resetAssessment, loadFromDraft
    }}>
      {children}
    </AssessmentContext.Provider>
  );
};

export const useAssessment = () => {
  const context = useContext(AssessmentContext);
  if (context === undefined) throw new Error('useAssessment must be used within an AssessmentProvider');
  return context;
};
