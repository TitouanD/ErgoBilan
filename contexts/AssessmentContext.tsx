/**
 * AssessmentContext — the assessment in progress, for React.
 *
 * State and lifecycle live in `utils/assessmentInProgress.ts` (intentions, draft
 * autosave, patient creation, ordering rules). This provider only binds it to
 * React.
 */

import React, { createContext, useContext, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StorageService } from '../services/storage';
import { useAuth } from './AuthContext';
import { useCatalog } from './CatalogContext';
import { createAssessmentInProgress, type AssessmentInProgress, type AssessmentState } from '../utils/assessmentInProgress';

export type { ReportType } from '../utils/assessmentInProgress';

export type AssessmentContextType = AssessmentState & Omit<AssessmentInProgress, 'getState' | 'subscribe'>;

const AssessmentContext = createContext<AssessmentContextType | undefined>(undefined);

export const AssessmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { sessionKey, isDemoMode } = useAuth();
  const { ensureCatalogLoaded } = useCatalog();

  // The assessment in progress is created once; it reads the latest auth state through this ref.
  const depsRef = useRef({ canPersist: false, isDemoMode, ensureCatalogLoaded });
  depsRef.current = { canPersist: Boolean(sessionKey) && !isDemoMode, isDemoMode, ensureCatalogLoaded };

  const [bilan] = useState(() =>
    createAssessmentInProgress({
      store: StorageService,
      canPersist: () => depsRef.current.canPersist,
      isDemoMode: () => depsRef.current.isDemoMode,
      loadCatalog: () => depsRef.current.ensureCatalogLoaded(),
    }),
  );
  const state = useSyncExternalStore(bilan.subscribe, bilan.getState);

  const value = useMemo<AssessmentContextType>(() => {
    const { getState: _getState, subscribe: _subscribe, ...intentions } = bilan;
    return { ...state, ...intentions };
  }, [bilan, state]);

  return <AssessmentContext.Provider value={value}>{children}</AssessmentContext.Provider>;
};

export const useAssessment = () => {
  const context = useContext(AssessmentContext);
  if (context === undefined) throw new Error('useAssessment must be used within an AssessmentProvider');
  return context;
};
