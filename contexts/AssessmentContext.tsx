/**
 * AssessmentContext — state of the assessment being edited (all three flows).
 *
 * - Creates the local patient record as soon as first name, last name and
 *   date of birth are known (Effect A).
 * - Autosaves a draft 3 s after the last change (Effect B), for every flow.
 * - Keeps the dashboard preview of the patient identity in sync (Effect C).
 *
 * `resetAssessment` bumps a session token: an autosave that was already
 * scheduled for the previous assessment is dropped instead of re-creating a
 * draft after finalization.
 */

import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ClinicalSynthesis, DraftPayload, Observations, Patient, PatientAssessment, ReportSection, TestData } from '../types';
import { StorageService } from '../services/storage';
import { useAuth } from './AuthContext';
import { Logger } from '../utils/logger';
import { buildPatientIdentitySignature, getPatientAgeForIdentity, isPatientCreationReady } from '../utils/patient';
import { normalizeTestData } from '../utils/scoring';

export type ReportType = 'initial' | 'reevaluation' | 'historique';

const AUTOSAVE_DEBOUNCE_MS = 3_000;
const IDENTITY_SYNC_DEBOUNCE_MS = 1_000;
const DRAFT_VERSION = 3;

export interface AssessmentContextType {
  patient: Patient;
  tests: TestData;
  observations: Observations;
  synthesis: ClinicalSynthesis;
  sections: ReportSection[];
  reportType: ReportType;
  /** Date of the original assessment (historical flow only), ISO string. */
  historicalDate: string;
  step: number;
  isAutoSaving: boolean;
  /** Reference assessment of a re-evaluation. */
  previousAssessment: PatientAssessment | null;

  setPreviousAssessment: (a: PatientAssessment | null) => void;
  setHistoricalDate: (d: string) => void;
  setPatient: (p: Patient) => void;
  updatePatient: (p: Partial<Patient>) => void;
  /** Replace all scores (the caller always passes the full object so deletions persist). */
  updateTests: (t: TestData) => void;
  updateObservations: (o: Partial<Observations>) => void;
  updateSynthesis: (s: Partial<ClinicalSynthesis>) => void;
  setSections: (s: ReportSection[]) => void;
  /** Patch a section (creates it when missing, e.g. the "Page École"). */
  updateSection: (id: string, update: Partial<ReportSection>) => void;
  setReportType: (t: ReportType) => void;
  setStep: (s: number) => void;
  resetAssessment: () => void;
  loadFromDraft: (draft: DraftPayload) => void;
  /** Snapshot for a manual "save & quit". */
  buildDraft: (patient: Patient) => DraftPayload;
  /**
   * Create the local patient record if needed and return its id (null when the
   * identity is incomplete or the creation failed). Every caller shares the same
   * in-flight promise, so a patient is never created twice.
   */
  ensurePatientId: (snapshot: Patient) => Promise<string | null>;
}

const AssessmentContext = createContext<AssessmentContextType | undefined>(undefined);

// The patient id stays undefined until the local record is created (Effect A).
const initialPatient: Patient = {
  firstName: '', lastName: '', dob: '', age: '', gender: '', address: '',
  parentNames: '', parentPhone: '', parentEmail: '', parent1Name: '', parent1Phone: '', parent1Email: '', parent2Name: '', parent2Phone: '', parent2Email: '',
  guardArrangement: '', siblings: [],
  school: '', classLevel: '', schoolType: '', schoolTrack: '', schoolRepeatYear: '', teacher: '', carePlan: '', avs: '', avsDetails: '',
  prescribingDoctor: '', medicalDiagnosis: '', medicalTreatments: '', medicalFollowup: '',
  reason: '', familyExpectations: '',
  pregnancyBirth: '', developmentMotor: '', developmentLanguage: '', sleep: '', sensory: '',
  crawlingFourPattes: '', crawlingRamper: '',
  meals: '', dressing: '', continence: '', timeSpace: '',
  dressingAutonomy: '', dressingObservations: '',
  hygieneTeeth: '', hygieneHands: '', hygieneBath: '', hygieneFace: '', hygieneHair: '', hygieneContinenceStatus: '', hygieneObservations: '',
  timeSpaceClockReading: '', timeSpaceObservations: '',
  schoolAttention: '', schoolFavoriteSubjects: '', schoolDislikedSubjects: '', classroomBehavior: '', schoolOrganization: '', schoolMemory: '',
  schoolParticipation: '', peerRelations: '', homeworkHabits: '', writingIssues: '', writingDifficultyTags: '', toolUsage: '', schoolAccommodations: '',
  emotionalGlobalTags: '', emotionalReactionTags: '', emotionalNotes: '',
  prescribingDoctorProfession: '',
  remarks: '', priorities: '',
};

const initialObs: Observations = { anamnese: '', motricite: '', coordination: '', spatial: '', graphique: '' };
const initialSynthesis: ClinicalSynthesis = { diagnosticInput: '', projectInput: '', recommendationsInput: '' };

export const AssessmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sessionKey, isDemoMode } = useAuth();

  const [patient, setPatient] = useState<Patient>(initialPatient);
  const [tests, setTests] = useState<TestData>({});
  const [observations, setObservations] = useState<Observations>(initialObs);
  const [synthesis, setSynthesis] = useState<ClinicalSynthesis>(initialSynthesis);
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reportType, setReportType] = useState<ReportType>('initial');
  const [historicalDate, setHistoricalDate] = useState('');
  const [step, setStep] = useState(1);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [previousAssessment, setPreviousAssessmentState] = useState<PatientAssessment | null>(null);

  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identitySyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createPromiseRef = useRef<Promise<string> | null>(null);
  const autoSaveCounterRef = useRef(0);
  const lastSyncedIdentityRef = useRef('');
  /** Incremented by resetAssessment; async saves started for an older session are dropped. */
  const sessionTokenRef = useRef(0);

  const canPersist = Boolean(sessionKey) && !isDemoMode;

  const setPreviousAssessment = useCallback((a: PatientAssessment | null) => {
    setPreviousAssessmentState(a ? { ...a, tests: normalizeTestData(a.tests ?? {}) } : null);
  }, []);

  const beginAutoSave = useCallback(() => {
    autoSaveCounterRef.current += 1;
    setIsAutoSaving(true);
  }, []);

  const endAutoSave = useCallback(() => {
    autoSaveCounterRef.current = Math.max(0, autoSaveCounterRef.current - 1);
    if (autoSaveCounterRef.current === 0) setIsAutoSaving(false);
  }, []);

  /** Create the local patient record once (concurrent callers share the same promise). */
  const ensurePatientId = useCallback(
    async (snapshot: Patient): Promise<string | null> => {
      if (snapshot.id) return snapshot.id;
      if (!isPatientCreationReady(snapshot)) return null; // demo: StorageService returns a fake id
      if (!createPromiseRef.current) {
        createPromiseRef.current = (async () => {
          const toCreate = { ...snapshot, age: getPatientAgeForIdentity(snapshot) };
          const newId = await StorageService.ensurePatientId(toCreate);
          setPatient((prev) => (prev.id ? prev : { ...prev, id: newId, age: toCreate.age }));
          return newId;
        })().finally(() => {
          createPromiseRef.current = null;
        });
      }
      try {
        return await createPromiseRef.current;
      } catch (e) {
        Logger.error('DB', 'Failed to create patient ID', e);
        return null;
      }
    },
    [],
  );

  const buildDraft = useCallback(
    (forPatient: Patient): DraftPayload => ({
      patient: forPatient,
      tests,
      observations,
      synthesis,
      sections,
      reportType,
      historicalDate: historicalDate || undefined,
      previousAssessmentId: previousAssessment?.id,
      step,
      version: DRAFT_VERSION,
      timestamp: new Date().toISOString(),
    }),
    [tests, observations, synthesis, sections, reportType, historicalDate, previousAssessment, step],
  );

  // EFFECT A: create the patient record as soon as the identity is complete
  useEffect(() => {
    if (!canPersist || patient.id || !isPatientCreationReady(patient)) return;
    void ensurePatientId(patient);
  }, [canPersist, patient, ensurePatientId]);

  // EFFECT B: debounced draft autosave
  useEffect(() => {
    if (!canPersist || !isPatientCreationReady(patient)) return;
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    const token = sessionTokenRef.current;
    const snapshotPatient = patient;
    const draftFor = buildDraft;

    draftSaveTimeoutRef.current = setTimeout(async () => {
      beginAutoSave();
      try {
        const patientId = snapshotPatient.id || (await ensurePatientId(snapshotPatient));
        if (!patientId || token !== sessionTokenRef.current) return;
        await StorageService.saveDraft(draftFor({ ...snapshotPatient, id: patientId, age: getPatientAgeForIdentity(snapshotPatient) }));
      } catch (e) {
        Logger.warn('DB', 'Autosave draft failed (silently)', e);
      } finally {
        endAutoSave();
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    };
  }, [canPersist, patient, buildDraft, ensurePatientId, beginAutoSave, endAutoSave]);

  // EFFECT C: keep the dashboard preview of the identity in sync
  const identitySignature = useMemo(() => buildPatientIdentitySignature(patient), [patient]);
  useEffect(() => {
    if (!patient.id || isDemoMode || identitySignature === lastSyncedIdentityRef.current) return;
    if (identitySyncTimeoutRef.current) clearTimeout(identitySyncTimeoutRef.current);
    const patientId = patient.id;
    const snapshot = { ...patient, age: getPatientAgeForIdentity(patient) };
    identitySyncTimeoutRef.current = setTimeout(async () => {
      beginAutoSave();
      try {
        await StorageService.syncPatientIdentityPreview(patientId, snapshot);
        lastSyncedIdentityRef.current = identitySignature;
      } catch (e) {
        Logger.warn('DB', 'Identity preview sync failed (silently)', e);
      } finally {
        endAutoSave();
      }
    }, IDENTITY_SYNC_DEBOUNCE_MS);
    return () => {
      if (identitySyncTimeoutRef.current) clearTimeout(identitySyncTimeoutRef.current);
    };
  }, [identitySignature, patient, isDemoMode, beginAutoSave, endAutoSave]);

  const updatePatient = useCallback((data: Partial<Patient>) => setPatient((prev) => ({ ...prev, ...data })), []);
  const updateTests = useCallback((data: TestData) => setTests(normalizeTestData(data)), []);
  const updateObservations = useCallback((data: Partial<Observations>) => setObservations((prev) => ({ ...prev, ...data })), []);
  const updateSynthesis = useCallback((data: Partial<ClinicalSynthesis>) => setSynthesis((prev) => ({ ...prev, ...data })), []);

  const updateSection = useCallback((id: string, update: Partial<ReportSection>) => {
    setSections((prev) =>
      prev.some((s) => s.id === id)
        ? prev.map((s) => (s.id === id ? { ...s, ...update } : s))
        : [...prev, { id, title: update.title || id, content: update.content || '', status: 'draft' as const, ...update }],
    );
  }, []);

  const resetAssessment = useCallback(() => {
    sessionTokenRef.current += 1;
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
    setPreviousAssessmentState(null);
  }, []);

  const loadFromDraft = useCallback((draft: DraftPayload) => {
    Logger.debug('DB', 'Context: loading draft');
    // Merge with defaults so drafts saved by older versions still load
    if (draft.patient) setPatient({ ...initialPatient, ...draft.patient });
    if (draft.tests) setTests(normalizeTestData(draft.tests));
    if (draft.observations) setObservations({ ...initialObs, ...draft.observations });
    if (draft.synthesis) setSynthesis({ ...initialSynthesis, ...draft.synthesis });
    if (draft.sections) setSections([...draft.sections]);
    if (draft.reportType) setReportType(draft.reportType);
    if (draft.historicalDate) setHistoricalDate(draft.historicalDate);
    if (draft.step) setStep(draft.step);
  }, []);

  const value = useMemo<AssessmentContextType>(
    () => ({
      patient,
      tests,
      observations,
      synthesis,
      sections,
      reportType,
      historicalDate,
      step,
      isAutoSaving,
      previousAssessment,
      setPreviousAssessment,
      setHistoricalDate,
      setPatient,
      updatePatient,
      updateTests,
      updateObservations,
      updateSynthesis,
      setSections,
      updateSection,
      setReportType,
      setStep,
      resetAssessment,
      loadFromDraft,
      buildDraft,
      ensurePatientId,
    }),
    [
      patient,
      tests,
      observations,
      synthesis,
      sections,
      reportType,
      historicalDate,
      step,
      isAutoSaving,
      previousAssessment,
      setPreviousAssessment,
      updatePatient,
      updateTests,
      updateObservations,
      updateSynthesis,
      updateSection,
      resetAssessment,
      loadFromDraft,
      buildDraft,
      ensurePatientId,
    ],
  );

  return <AssessmentContext.Provider value={value}>{children}</AssessmentContext.Provider>;
};

export const useAssessment = () => {
  const context = useContext(AssessmentContext);
  if (context === undefined) throw new Error('useAssessment must be used within an AssessmentProvider');
  return context;
};
