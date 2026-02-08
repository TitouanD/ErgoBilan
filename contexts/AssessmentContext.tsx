
import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Patient, TestData, Observations, ReportSection, PatientFile, ClinicalSynthesis } from '../types';
import { StorageService } from '../services/storage';
import { useAuth } from './AuthContext';
import { Logger } from '../utils/logger';

interface AssessmentContextType {
  patient: Patient;
  tests: TestData;
  observations: Observations;
  synthesis: ClinicalSynthesis; 
  sections: ReportSection[];
  step: number;
  isAutoSaving: boolean;
  
  setPatient: (p: Patient) => void;
  updatePatient: (p: Partial<Patient>) => void;
  
  setTests: (t: TestData) => void;
  updateTests: (t: Partial<TestData>) => void;
  
  setObservations: (o: Observations) => void;
  updateObservations: (o: Partial<Observations>) => void;
  
  setSynthesis: (s: ClinicalSynthesis) => void;
  updateSynthesis: (s: Partial<ClinicalSynthesis>) => void;

  setSections: (s: ReportSection[]) => void;
  updateSection: (id: string, update: Partial<ReportSection>) => void;
  
  setStep: (s: number) => void;
  resetAssessment: () => void;
  loadFromDraft: (draft: any) => void;
}

const AssessmentContext = createContext<AssessmentContextType | undefined>(undefined);

// NOTE: L'ID doit être undefined au départ. Pas de génération client.
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

const initialSynthesis: ClinicalSynthesis = {
    diagnosticInput: '',
    recommendationsInput: ''
};

export const AssessmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sessionKey, orgKey, isDemoMode } = useAuth(); 
  
  const [patient, setPatient] = useState<Patient>(initialPatient);
  const [tests, setTests] = useState<TestData>({});
  const [observations, setObservations] = useState<Observations>(initialObs);
  const [synthesis, setSynthesis] = useState<ClinicalSynthesis>(initialSynthesis);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [step, setStep] = useState(1);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-Save Logic Intelligente (Création puis Sauvegarde)
  useEffect(() => {
      if (!sessionKey && !isDemoMode) return;
      
      const hasMinimalData = patient.lastName.trim().length > 0 && patient.firstName.trim().length > 0;
      
      // Si pas de données minimales, on ne fait rien
      if (!hasMinimalData) return;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setIsAutoSaving(true);
      
      saveTimeoutRef.current = setTimeout(async () => {
          try {
              let currentPatientId = patient.id;

              // PHASE 1 : CRÉATION AUTOMATIQUE EN BASE (Si pas d'ID)
              if (!currentPatientId && orgKey && !isDemoMode) {
                  Logger.info('DB', "Autosave: creating patient entry first...");
                  try {
                      // On crée le patient en DB pour obtenir son ID officiel
                      const newId = await StorageService.createPatient(patient, orgKey);
                      currentPatientId = newId;
                      // Mise à jour immédiate du state local avec l'ID serveur
                      setPatient(prev => ({ ...prev, id: newId }));
                  } catch (createError) {
                      Logger.error('DB', "Failed to create patient during autosave", createError);
                      return; // Stop si échec création
                  }
              }

              // PHASE 2 : SAUVEGARDE DU BROUILLON
              // On attache l'ID (qui vient d'être créé ou existait déjà) au payload
              const draftData = { 
                  patient: { ...patient, id: currentPatientId }, 
                  tests, observations, synthesis, sections, step, 
                  timestamp: new Date().toISOString() 
              };

              if (sessionKey) {
                  await StorageService.saveDraft(draftData, sessionKey);
              }

              // PHASE 3 : UPDATE DU FICHIER PATIENT (Si ID existe déjà ou vient d'être créé)
              // Met à jour les métadonnées chiffrées (last interaction, etc.)
              if (currentPatientId && orgKey && !isDemoMode) {
                  const fileWrapper: PatientFile = {
                      id: currentPatientId,
                      patient: { ...patient, id: currentPatientId },
                      reports: [], 
                      sessions: [],
                      lastInteraction: new Date().toISOString(),
                      archived: false
                  };
                  await StorageService.saveFile(fileWrapper, orgKey);
              }

          } catch(e) { 
              Logger.warn('DB', "Autosave failed (silently)", e); 
          } finally { 
              setIsAutoSaving(false); 
          }
      }, 2000); // Délai de 2s

      return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [patient, tests, observations, synthesis, sections, step, sessionKey, orgKey, isDemoMode]);

  const updatePatient = (data: Partial<Patient>) => {
      setPatient(prev => ({ ...prev, ...data }));
  };

  const updateTests = (data: Partial<TestData>) => setTests(prev => ({ ...prev, ...data }));
  const updateObservations = (data: Partial<Observations>) => setObservations(prev => ({ ...prev, ...data }));
  const updateSynthesis = (data: Partial<ClinicalSynthesis>) => setSynthesis(prev => ({ ...prev, ...data }));
  
  const updateSection = (id: string, update: Partial<ReportSection>) => {
      setSections(prev => prev.map(s => s.id === id ? { ...s, ...update } : s));
  };

  const resetAssessment = () => {
      setPatient(initialPatient);
      setTests({});
      setObservations(initialObs);
      setSynthesis(initialSynthesis);
      setSections([]);
      setStep(1);
  };

  const loadFromDraft = (draft: any) => {
      Logger.debug('DB', "Context: Loading Draft...", draft);
      if (draft.patient) setPatient({ ...draft.patient });
      if (draft.tests) setTests({ ...draft.tests });
      if (draft.observations) setObservations({ ...draft.observations });
      if (draft.synthesis) setSynthesis({ ...draft.synthesis });
      if (draft.sections) setSections([...draft.sections]);
      if (draft.step) setStep(draft.step);
  };

  return (
    <AssessmentContext.Provider value={{
        patient, setPatient, updatePatient,
        tests, setTests, updateTests,
        observations, setObservations, updateObservations,
        synthesis, setSynthesis, updateSynthesis,
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
