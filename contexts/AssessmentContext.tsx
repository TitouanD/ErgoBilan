import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { Patient, TestData, Observations, ReportSection, ClinicalSynthesis, PatientAssessment } from '../types';
import { StorageService } from '../services/storage';
import { useAuth } from './AuthContext';
import { Logger } from '../utils/logger';
import { buildPatientIdentitySignature, getPatientAgeForIdentity, isPatientCreationReady } from '../utils';
import { normalizeTestData } from '../utils/scoring';

interface AssessmentContextType {
  patient: Patient;
  tests: TestData;
  observations: Observations;
  synthesis: ClinicalSynthesis;
  sections: ReportSection[];
  reportType: 'initial' | 'reevaluation' | 'historique';
  historicalDate: string;
  step: number;
  isAutoSaving: boolean;

  previousAssessment: PatientAssessment | null;
  setPreviousAssessment: (a: PatientAssessment | null) => void;

  setHistoricalDate: (d: string) => void;

  setPatient: (p: Patient) => void;
  updatePatient: (p: Partial<Patient>) => void;

  setTests: (t: TestData) => void;
  updateTests: (t: TestData) => void;

  setObservations: (o: Observations) => void;
  updateObservations: (o: Partial<Observations>) => void;

  setSynthesis: (s: ClinicalSynthesis) => void;
  updateSynthesis: (s: Partial<ClinicalSynthesis>) => void;

  setSections: (s: ReportSection[]) => void;
  updateSection: (id: string, update: Partial<ReportSection>) => void;
  setReportType: (t: 'initial' | 'reevaluation' | 'historique') => void;

  setStep: (s: number) => void;
  resetAssessment: () => void;
  loadFromDraft: (draft: any) => void;
}

const AssessmentContext = createContext<AssessmentContextType | undefined>(undefined);

// NOTE: L'ID doit etre undefined au depart. Pas de generation client.
const initialPatient: Patient = {
  firstName: '', lastName: '', dob: '', age: '', gender: '', address: '',
  parentNames: '', parentPhone: '', parentEmail: '', parent1Name: '', parent1Phone: '', parent1Email: '', parent2Name: '', parent2Phone: '', parent2Email: '', guardArrangement: '', siblings: [],
  school: '', classLevel: '', schoolType: '', schoolTrack: '', schoolRepeatYear: '', teacher: '', carePlan: '', avs: '', avsDetails: '',
  prescribingDoctor: '', medicalDiagnosis: '', medicalTreatments: '', medicalFollowup: '',
  reason: '', familyExpectations: '',
  pregnancyBirth: '', developmentMotor: '', developmentLanguage: '', sleep: '', sensory: '',
  crawlingFourPattes: '', crawlingRamper: '',
  meals: '', dressing: '', continence: '', timeSpace: '',
  dressingAutonomy: '', dressingObservations: '',
  hygieneTeeth: '', hygieneHands: '', hygieneBath: '', hygieneFace: '', hygieneHair: '', hygieneContinenceStatus: '', hygieneObservations: '',
  timeSpaceClockReading: '', timeSpaceObservations: '',
  schoolAttention: '', schoolFavoriteSubjects: '', schoolDislikedSubjects: '', classroomBehavior: '', schoolOrganization: '', schoolMemory: '', schoolParticipation: '', peerRelations: '', homeworkHabits: '', writingIssues: '', writingDifficultyTags: '', toolUsage: '', schoolAccommodations: '',
  emotionalGlobalTags: '', emotionalReactionTags: '', emotionalNotes: '',
  prescribingDoctorProfession: '',
  remarks: '', priorities: ''
};

const initialObs: Observations = {
  anamnese: '', motricite: '', coordination: '', spatial: '', graphique: ''
};

const initialSynthesis: ClinicalSynthesis = {
  diagnosticInput: '',
  projectInput: '',
  recommendationsInput: ''
};

const DRAFT_VERSION = 2;

export const AssessmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sessionKey, isDemoMode } = useAuth();

  const [patient, setPatient] = useState<Patient>(initialPatient);
  const [tests, setTests] = useState<TestData>({});
  const [observations, setObservations] = useState<Observations>(initialObs);
  const [synthesis, setSynthesis] = useState<ClinicalSynthesis>(initialSynthesis);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reportType, setReportType] = useState<'initial' | 'reevaluation' | 'historique'>('initial');
  const [historicalDate, setHistoricalDate] = useState<string>('');
  const [step, setStep] = useState(1);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [previousAssessment, setPreviousAssessmentState] = useState<PatientAssessment | null>(null);
  // Normalize legacy ScoreResult shapes in previousAssessment.tests on the way in
  // (e.g. reevaluation comparisons against an older bilan saved before this simplification).
  const setPreviousAssessment = useCallback((a: PatientAssessment | null) => {
    setPreviousAssessmentState(a ? { ...a, tests: normalizeTestData(a.tests ?? {}) } : null);
  }, []);

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

  // Create patient ID when identity is ready
  // Uses ref to prevent multiple simultaneous creation attempts
  const ensurePatientId = useCallback(async (patientSnapshot: Patient): Promise<string | null> => {
    if (patientSnapshot.id) return patientSnapshot.id;
    if (isDemoMode) return null;
    if (!isPatientCreationReady(patientSnapshot)) return null;

    if (!createPromiseRef.current) {
      createPromiseRef.current = (async () => {
        const toCreate = {
          ...patientSnapshot,
          age: getPatientAgeForIdentity(patientSnapshot),
        };
        const newId = await StorageService.ensurePatientId(toCreate);
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
  }, [isDemoMode]);

  // Memoize patient identity fields to optimize Effect A & C dependencies
  // Only changes when actual identity fields change, not entire patient object
  const patientIdentity = useMemo(() => ({
    id: patient.id,
    firstName: patient.firstName,
    lastName: patient.lastName,
    dob: patient.dob,
    age: patient.age,
    classLevel: patient.classLevel,
    gender: patient.gender,
  }), [patient.id, patient.firstName, patient.lastName, patient.dob, patient.age, patient.classLevel, patient.gender]);

  // Memoize all assessment data for Effect B (draft autosave)
  // Consolidates all state changes into single dependency
  const assessmentData = useMemo(() => ({
    patient,
    tests,
    observations,
    synthesis,
    sections,
    step,
  }), [patient, tests, observations, synthesis, sections, step]);

  // EFFECT A: Create patient ID when sufficient identity fields are present
  // Runs once per unique identity + auth state change
  // Does NOT run on every keystroke — only when identity actually changes
  useEffect(() => {
    if (!sessionKey && !isDemoMode) return;
    if (patientIdentity.id || !isPatientCreationReady(patient)) return;
    void ensurePatientId(patient);
  }, [patientIdentity, sessionKey, isDemoMode, patient, ensurePatientId]);

  // EFFECT B: Autosave draft with debounce (3s)
  // Skip for 'historique' imports — they are one-shot and handled by handleFinalizeHistorical.
  useEffect(() => {
    if (!sessionKey && !isDemoMode) return;
    if (!isPatientCreationReady(patient)) return;
    if (reportType === 'historique') return; // ⚠️ Never auto-save historical imports

    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);

    draftSaveTimeoutRef.current = setTimeout(async () => {
      beginAutoSave();
      try {
        const currentPatientId = assessmentData.patient.id || await ensurePatientId(assessmentData.patient);
        if (!currentPatientId) {
          Logger.warn('DB', 'Autosave skipped: patient ID unavailable');
          return;
        }

        const draftData = {
          patient: { ...assessmentData.patient, id: currentPatientId, age: getPatientAgeForIdentity(assessmentData.patient) },
          tests: assessmentData.tests,
          observations: assessmentData.observations,
          synthesis: assessmentData.synthesis,
          sections: assessmentData.sections,
          step: assessmentData.step,
          reportType,
          version: DRAFT_VERSION,
          timestamp: new Date().toISOString(),
        };

        await StorageService.saveDraft(draftData);
      } catch (e) {
        Logger.warn('DB', 'Autosave draft failed (silently)', e);
      } finally {
        endAutoSave();
      }
    }, 3000);

    return () => {
      if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    };
  }, [assessmentData, reportType, sessionKey, isDemoMode, ensurePatientId, beginAutoSave, endAutoSave]);

  // EFFECT C: Sync patient identity (encrypted preview) when identity changes
  // Separate from draft autosave to isolate identity mutations
  // Uses patientIdentity memo to avoid excessive syncs
  useEffect(() => {
    if (!patientIdentity.id || isDemoMode) return;

    const identitySignature = buildPatientIdentitySignature(patient);
    if (identitySignature === lastSyncedIdentityRef.current) return;

    if (identitySyncTimeoutRef.current) clearTimeout(identitySyncTimeoutRef.current);
    identitySyncTimeoutRef.current = setTimeout(async () => {
      beginAutoSave();
      try {
        const patientToSync = { ...patient, age: getPatientAgeForIdentity(patient) };
        await StorageService.syncPatientIdentityPreview(patientIdentity.id, patientToSync);
        lastSyncedIdentityRef.current = buildPatientIdentitySignature(patientToSync);
      } catch (e) {
        Logger.warn('DB', 'Identity preview sync failed (silently)', e);
      } finally {
        endAutoSave();
      }
    }, 1000);

    return () => {
      if (identitySyncTimeoutRef.current) clearTimeout(identitySyncTimeoutRef.current);
    };
  }, [patientIdentity, patient, isDemoMode, beginAutoSave, endAutoSave]);

  const updatePatient = (data: Partial<Patient>) => {
    setPatient(prev => ({ ...prev, ...data }));
  };

  // Step 2 always sends the full tests object. Replace instead of merge so deletions persist.
  // Two-level deep copy: prevents mutations from propagating back to previousAssessment.tests
  // when the reevaluation pre-fills from it (shallow copy would share inner subtest references).
  // Also normalizes legacy ScoreResult shapes (raw/standard/percentile/zScore/status/...)
  // to the new minimal { value, unit } shape so older bilans keep working transparently.
  const updateTests = (data: TestData) => {
    setTests(normalizeTestData(data));
  };
  const updateObservations = (data: Partial<Observations>) => setObservations(prev => ({ ...prev, ...data }));
  const updateSynthesis = (data: Partial<ClinicalSynthesis>) => setSynthesis(prev => ({ ...prev, ...data }));

  const updateSection = (id: string, update: Partial<ReportSection>) => {
    setSections(prev => {
      const exists = prev.some(s => s.id === id);
      if (exists) return prev.map(s => s.id === id ? { ...s, ...update } : s);
      // Create the section if it doesn't exist yet (e.g. Page École)
      return [...prev, { id, title: update.title || id, content: update.content || '', status: 'draft' as const, ...update }];
    });
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
    setReportType('initial');
    setHistoricalDate('');
    setStep(1);
    setPreviousAssessment(null);
  };

  const loadFromDraft = (draft: any) => {
    Logger.debug('DB', 'Context: Loading Draft...', draft);
    // Merge with initial defaults to handle schema evolution (B3)
    if (draft.patient) setPatient({ ...initialPatient, ...draft.patient });
    if (draft.tests) setTests(normalizeTestData(draft.tests));
    if (draft.observations) setObservations({ ...initialObs, ...draft.observations });
    if (draft.synthesis) setSynthesis({ ...initialSynthesis, ...draft.synthesis });
    if (draft.sections) setSections([...draft.sections]);
    if (draft.reportType === 'initial' || draft.reportType === 'reevaluation' || draft.reportType === 'historique') setReportType(draft.reportType);
    if (draft.historicalDate) setHistoricalDate(draft.historicalDate);
    if (draft.step) setStep(draft.step);
  };

  return (
    <AssessmentContext.Provider value={{
      patient, setPatient, updatePatient,
      tests, setTests, updateTests,
      observations, setObservations, updateObservations,
      synthesis, setSynthesis, updateSynthesis,
      sections, setSections, updateSection,
      reportType, setReportType,
      historicalDate, setHistoricalDate,
      step, setStep,
      isAutoSaving,
      previousAssessment, setPreviousAssessment,
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
