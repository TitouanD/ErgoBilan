/**
 * AssessmentContext — the assessment in progress, for React.
 *
 * State and lifecycle live in `utils/assessmentSession.ts` (intentions, draft
 * autosave, patient creation, ordering rules). This provider only binds it to
 * React and keeps the dashboard preview of the patient identity in sync.
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StorageService } from '../services/storage';
import { useAuth } from './AuthContext';
import { useCatalog } from './CatalogContext';
import { Logger } from '../utils/logger';
import { buildPatientIdentitySignature, getPatientAgeForIdentity } from '../utils/patient';
import { createAssessmentSession, type AssessmentSession, type AssessmentState } from '../utils/assessmentSession';

export type { ReportType } from '../utils/assessmentSession';

const IDENTITY_SYNC_DEBOUNCE_MS = 1_000;

export type AssessmentContextType = AssessmentState & Omit<AssessmentSession, 'getState' | 'subscribe'>;

const AssessmentContext = createContext<AssessmentContextType | undefined>(undefined);

export const AssessmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sessionKey, isDemoMode } = useAuth();
  const { ensureCatalogLoaded } = useCatalog();

  // The session is created once; it reads the latest auth state through this ref.
  const depsRef = useRef({ canPersist: false, isDemoMode, ensureCatalogLoaded });
  depsRef.current = { canPersist: Boolean(sessionKey) && !isDemoMode, isDemoMode, ensureCatalogLoaded };

  const [session] = useState(() =>
    createAssessmentSession({
      store: StorageService,
      canPersist: () => depsRef.current.canPersist,
      isDemoMode: () => depsRef.current.isDemoMode,
      loadCatalog: () => depsRef.current.ensureCatalogLoaded(),
    }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { patient } = state;

  // Keep the dashboard preview of the identity in sync
  const identityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedIdentityRef = useRef('');
  const identitySignature = useMemo(() => buildPatientIdentitySignature(patient), [patient]);
  useEffect(() => {
    if (!patient.id || isDemoMode || identitySignature === lastSyncedIdentityRef.current) return;
    if (identityTimeoutRef.current) clearTimeout(identityTimeoutRef.current);
    const patientId = patient.id;
    const snapshot = { ...patient, age: getPatientAgeForIdentity(patient) };
    identityTimeoutRef.current = setTimeout(async () => {
      try {
        await StorageService.syncPatientIdentityPreview(patientId, snapshot);
        lastSyncedIdentityRef.current = identitySignature;
      } catch (e) {
        Logger.warn('DB', 'Identity preview sync failed (silently)', e);
      }
    }, IDENTITY_SYNC_DEBOUNCE_MS);
    return () => {
      if (identityTimeoutRef.current) clearTimeout(identityTimeoutRef.current);
    };
  }, [identitySignature, patient, isDemoMode]);

  const value = useMemo<AssessmentContextType>(() => {
    const { getState: _getState, subscribe: _subscribe, ...intentions } = session;
    return { ...state, ...intentions };
  }, [session, state]);

  return <AssessmentContext.Provider value={value}>{children}</AssessmentContext.Provider>;
};

export const useAssessment = () => {
  const context = useContext(AssessmentContext);
  if (context === undefined) throw new Error('useAssessment must be used within an AssessmentProvider');
  return context;
};
