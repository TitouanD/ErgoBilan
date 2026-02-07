
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

  // Auto-Save Logic Renforcée
  useEffect(() => {
      if (!sessionKey && !isDemoMode) return;
      
      const hasMinimalData = patient.lastName.trim().length > 0 || patient.firstName.trim().length > 0;
      if (!hasMinimalData) return;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setIsAutoSaving(true);
      
      saveTimeoutRef.current = setTimeout(async () => {
          try {
              // Ajout de 'synthesis' au draft
              const draftData = { patient, tests, observations, synthesis, sections, step, timestamp: new Date().toISOString() };
              if (sessionKey) {
                  await StorageService.saveDraft(draftData, sessionKey);
              }

              if (orgKey && patient.id && hasMinimalData) {
                  const fileWrapper: PatientFile = {
                      id: patient.id,
                      patient: patient,
                      reports: [], 
                      sessions: [],
                      lastInteraction: new Date().toISOString(),
                      archived: false
                  };
                  // En autosave, on ne sauvegarde que si l'ID existe déjà pour ne pas créer de doublons accidentels
                  // La création explicite se fait via Step1Admin
                  await StorageService.saveFile(fileWrapper, orgKey);
              }

          } catch(e) { 
              Logger.warn('DB', "Autosave failed (silently)", e); 
          } finally { 
              setIsAutoSaving(false); 
          }
      }, 2000); 

      return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [patient, tests, observations, synthesis, sections, step, sessionKey, orgKey, isDemoMode]);

  const updatePatient = (data: Partial<Patient>) => {
      setPatient(prev => {
          const newData = { ...prev, ...data };
          // SUPPRESSION DE LA GÉNÉRATION D'ID CLIENT
          return newData;
      });
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
