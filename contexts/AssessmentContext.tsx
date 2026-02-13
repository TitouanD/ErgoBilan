import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import type { Patient, TestData, Observations, ReportSection, ClinicalSynthesis } from '../types';
import { StorageService } from '../services/storage';
import { useAuth } from './AuthContext';
import { Logger } from '../utils/logger';
import { buildPatientIdentitySignature, getPatientAgeForIdentity, isPatientCreationReady } from '../utils';

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

// NOTE: L'ID doit etre undefined au depart. Pas de generation client.
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

  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identitySyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createPromiseRef = useRef<Promise<string> | null>(null);
  const autoSaveCounterRef = useRef(0);
  const lastSyncedIdentityRef = useRef('');

  const beginAutoSave = useCallback(() => {
    autoSaveCounterRef.current += 1;
    setIsAutoSaving(true);
  }, []);

  const endAutoSave = useCallback(() => {
    autoSaveCounterRef.current = Math.max(0, autoSaveCounterRef.current - 1);
    if (autoSaveCounterRef.current === 0) {
      setIsAutoSaving(false);
    }
  }, []);

  const ensurePatientId = useCallback(async (patientSnapshot: Patient): Promise<string | null> => {
    if (patientSnapshot.id) return patientSnapshot.id;
    if (!orgKey || isDemoMode) return null;
    if (!isPatientCreationReady(patientSnapshot)) return null;

    if (!createPromiseRef.current) {
      createPromiseRef.current = (async () => {
        const toCreate = {
          ...patientSnapshot,
          age: getPatientAgeForIdentity(patientSnapshot),
        };
        const newId = await StorageService.ensurePatientId(toCreate, orgKey);
        setPatient((prev) => (prev.id ? prev : { ...prev, id: newId, age: toCreate.age }));
        return newId;
      })().finally(() => {
        createPromiseRef.current = null;
      });
    }

    try {
      return await createPromiseRef.current;
    } catch (createError) {
      Logger.error('DB', 'Failed to create patient ID', createError);
      return null;
    }
  }, [orgKey, isDemoMode]);

  // Effect A: creation immediate de l'ID patient des que les champs requis sont saisis
  useEffect(() => {
    if (!sessionKey && !isDemoMode) return;
    if (patient.id || !isPatientCreationReady(patient)) return;
    void ensurePatientId(patient);
  }, [patient, patient.id, patient.firstName, patient.lastName, patient.dob, patient.age, sessionKey, isDemoMode, ensurePatientId]);

  // Effect B: autosave draft uniquement (sans saveFile)
  useEffect(() => {
    if (!sessionKey && !isDemoMode) return;
    if (!isPatientCreationReady(patient)) return;

    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);

    draftSaveTimeoutRef.current = setTimeout(async () => {
      beginAutoSave();
      try {
        const currentPatientId = patient.id || await ensurePatientId(patient);
        if (!currentPatientId) {
          Logger.warn('DB', 'Autosave skipped: patient ID unavailable');
          return;
        }

        const draftData = {
          patient: { ...patient, id: currentPatientId, age: getPatientAgeForIdentity(patient) },
          tests,
          observations,
          synthesis,
          sections,
          step,
          timestamp: new Date().toISOString(),
        };

        if (sessionKey) {
          await StorageService.saveDraft(draftData, sessionKey);
        }
      } catch (e) {
        Logger.warn('DB', 'Autosave draft failed (silently)', e);
      } finally {
        endAutoSave();
      }
    }, 8000);

    return () => {
      if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    };
  }, [patient, tests, observations, synthesis, sections, step, sessionKey, isDemoMode, ensurePatientId, beginAutoSave, endAutoSave]);

  // Effect C: sync identite patient + preview sans toucher aux compteurs
  useEffect(() => {
    if (!patient.id || !orgKey || isDemoMode) return;

    const identitySignature = buildPatientIdentitySignature(patient);
    if (identitySignature === lastSyncedIdentityRef.current) return;

    if (identitySyncTimeoutRef.current) clearTimeout(identitySyncTimeoutRef.current);
    identitySyncTimeoutRef.current = setTimeout(async () => {
      beginAutoSave();
      try {
        const patientToSync = { ...patient, age: getPatientAgeForIdentity(patient) };
        await StorageService.syncPatientIdentityPreview(patient.id!, patientToSync, orgKey);
        lastSyncedIdentityRef.current = buildPatientIdentitySignature(patientToSync);
      } catch (e) {
        Logger.warn('DB', 'Identity preview sync failed (silently)', e);
      } finally {
        endAutoSave();
      }
    }, 2500);

    return () => {
      if (identitySyncTimeoutRef.current) clearTimeout(identitySyncTimeoutRef.current);
    };
  }, [patient, patient.id, patient.firstName, patient.lastName, patient.dob, patient.age, patient.classLevel, patient.gender, orgKey, isDemoMode, beginAutoSave, endAutoSave]);

  useEffect(() => {
    if (!patient.id) {
      lastSyncedIdentityRef.current = '';
    }
  }, [patient.id]);

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
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    if (identitySyncTimeoutRef.current) clearTimeout(identitySyncTimeoutRef.current);
    createPromiseRef.current = null;
    autoSaveCounterRef.current = 0;
    lastSyncedIdentityRef.current = '';
    setIsAutoSaving(false);
    setPatient(initialPatient);
    setTests({});
    setObservations(initialObs);
    setSynthesis(initialSynthesis);
    setSections([]);
    setStep(1);
  };

  const loadFromDraft = (draft: any) => {
    Logger.debug('DB', 'Context: Loading Draft...', draft);
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
