
import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Patient, TestData, Observations, ReportSection } from '../types';
import { StorageService } from '../services/storage';
import { useAuth } from './AuthContext';

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
  const { sessionKey } = useAuth();
  
  const [patient, setPatient] = useState<Patient>(initialPatient);
  const [tests, setTests] = useState<TestData>({});
  const [observations, setObservations] = useState<Observations>(initialObs);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [step, setStep] = useState(1);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-Save Logic
  useEffect(() => {
      if (!sessionKey || step === 1) return; // On ne sauvegarde pas trop tôt ou si pas déverrouillé

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setIsAutoSaving(true);
      
      saveTimeoutRef.current = setTimeout(async () => {
          const draftData = { patient, tests, observations, sections, step, timestamp: new Date().toISOString() };
          try { 
              await StorageService.saveDraft(draftData, sessionKey); 
          } catch(e) { 
              console.error("Autosave failed", e); 
          } finally { 
              setIsAutoSaving(false); 
          }
      }, 2000);

      return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [patient, tests, observations, sections, step, sessionKey]);

  const updatePatient = (data: Partial<Patient>) => setPatient(prev => ({ ...prev, ...data }));
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
      console.log("📥 Context: Loading Draft...", draft);
      // Utilisation du spread {...obj} pour créer une nouvelle référence objet
      // Cela garantit que React détecte le changement même si les propriétés internes sont identiques
      if (draft.patient) {
          console.log("   -> Patient loaded:", draft.patient.lastName);
          setPatient({ ...draft.patient });
      }
      if (draft.tests) {
          console.log("   -> Tests loaded:", Object.keys(draft.tests).length);
          setTests({ ...draft.tests });
      }
      if (draft.observations) {
          console.log("   -> Observations loaded");
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
