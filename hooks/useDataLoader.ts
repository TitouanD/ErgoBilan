/**
 * useDataLoader — Manages patient files, pending questionnaires, drafts index,
 * and Supabase realtime subscriptions for the dashboard.
 *
 * Extracted from AppRouter to keep the main component focused on rendering.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../services/db';
import { StorageService } from '../services/storage';
import type { DashboardDraftMeta, PatientFile, PendingQuestionnaire, PractitionerProfile } from '../types';
import { Logger } from '../utils/logger';

interface UseDataLoaderParams {
  sessionKey: CryptoKey | null;
  authState: string;
  practitioner: PractitionerProfile | null;
  isDemoMode: boolean;
}

const PATIENT_PAGE_SIZE = 50;

export const useDataLoader = ({
  sessionKey,
  authState,
  practitioner,
  isDemoMode,
}: UseDataLoaderParams) => {
  const [patientFiles, setPatientFiles] = useState<PatientFile[]>([]);
  const [pendingQuestionnaires, setPendingQuestionnaires] = useState<PendingQuestionnaire[]>([]);
  const [draftsIndex, setDraftsIndex] = useState<Record<string, DashboardDraftMeta>>({});
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasMorePatients, setHasMorePatients] = useState(false);
  const [isLoadingMorePatients, setIsLoadingMorePatients] = useState(false);
  const patientOffsetRef = useRef(0);
  const loadingPatientsRef = useRef(false);

  // ------------------------------------------------------------------
  // Core data loaders (called on mount + after writes)
  // ------------------------------------------------------------------
  const sortPatients = (files: PatientFile[]) =>
    files.slice().sort((a, b) => new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime());

  const mergePatients = (prev: PatientFile[], next: PatientFile[]) => {
    const byId = new Map(prev.map((file) => [file.id, file]));
    next.forEach((file) => {
      byId.set(file.id, file);
    });
    return sortPatients(Array.from(byId.values()));
  };

  const loadPatients = useCallback(
    async (options?: { reset?: boolean }) => {
      if (!(sessionKey && authState === 'authenticated') && !isDemoMode) return;
      if (loadingPatientsRef.current) return;
      const reset = options?.reset ?? false;

      loadingPatientsRef.current = true;
      if (reset) {
        patientOffsetRef.current = 0;
      } else {
        setIsLoadingMorePatients(true);
      }

      try {
        const { files, hasMore, nextOffset } = await StorageService.loadPatientListPage({
          offset: patientOffsetRef.current,
          limit: PATIENT_PAGE_SIZE,
        });
        setHasMorePatients(hasMore);
        patientOffsetRef.current = nextOffset;
        setPatientFiles((prev) => (reset ? files : mergePatients(prev, files)));
      } finally {
        loadingPatientsRef.current = false;
        if (!reset) setIsLoadingMorePatients(false);
      }
    },
    [sessionKey, authState, isDemoMode],
  );

  const loadMorePatients = useCallback(async () => {
    if (!hasMorePatients) return;
    await loadPatients({ reset: false });
  }, [hasMorePatients, loadPatients]);

  const loadDrafts = useCallback(async () => {
    if (!(sessionKey && authState === 'authenticated') && !isDemoMode) return;
    const draftsMap = await StorageService.getDraftsMetadata();
    setDraftsIndex(draftsMap);
  }, [sessionKey, authState, isDemoMode]);

  const loadPending = useCallback(async () => {
    if (isDemoMode) {
      setPendingQuestionnaires([
        { id: 'demo-q1', label: 'Famille RAVEL (En attente)', status: 'pending', createdAt: new Date().toISOString(), practitionerEncryptedKey: '' },
        { id: 'demo-leo', label: 'Famille RAVEL (Dossier complet)', status: 'completed', createdAt: new Date(Date.now() - 86400000).toISOString(), practitionerEncryptedKey: '' },
      ]);
      return;
    }
    if (!(sessionKey && authState === 'authenticated') || !practitioner) return;

    const { data, error } = await supabase
      .from('pending_questionnaires')
      .select('id, label, status, created_at, practitioner_encrypted_key, access_token')
      .eq('practitioner_id', practitioner.id)
      .order('created_at', { ascending: false });
    if (error) {
      Logger.warn('DB', 'Failed to load pending questionnaires', error);
      return;
    }
    setPendingQuestionnaires(
      (data ?? []).map((p) => ({
        id: p.id,
        label: p.label ?? 'Questionnaire',
        status: p.status === 'completed' ? 'completed' : 'pending',
        createdAt: p.created_at ?? new Date().toISOString(),
        practitionerEncryptedKey: p.practitioner_encrypted_key,
        accessToken: p.access_token || undefined,
      })),
    );
  }, [sessionKey, authState, practitioner, isDemoMode]);

  const loadData = useCallback(async () => {
    if (!(sessionKey && authState === 'authenticated') && !isDemoMode) return;
    Logger.info('DB', 'Refreshing user data...');
    await loadPatients({ reset: true });
    await loadDrafts();
    await loadPending();
  }, [sessionKey, authState, isDemoMode, loadPatients, loadDrafts, loadPending]);

  // Auto-load on dependency change
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Drop patient data from memory when the session is locked or closed.
  useEffect(() => {
    if (authState !== 'locked' && authState !== 'unauthenticated') return;
    setPatientFiles([]);
    setPendingQuestionnaires([]);
    setDraftsIndex({});
    setHasMorePatients(false);
    patientOffsetRef.current = 0;
  }, [authState]);

  // ------------------------------------------------------------------
  // Realtime subscription for pending questionnaires only
  // (patients/followups are now local IndexedDB — no realtime needed)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!sessionKey || isDemoMode || authState !== 'authenticated') return;

    const schedule = (handler: () => void) => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(handler, 1000);
    };

    const channel = supabase
      .channel('dashboard-pending')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pending_questionnaires', filter: practitioner ? `practitioner_id=eq.${practitioner.id}` : undefined },
        () => schedule(loadPending),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, [sessionKey, authState, isDemoMode, practitioner, loadPending]);

  return {
    patientFiles,
    setPatientFiles,
    pendingQuestionnaires,
    setPendingQuestionnaires,
    draftsIndex,
    setDraftsIndex,
    hasMorePatients,
    isLoadingMorePatients,
    loadMorePatients,
    loadData,
  };
};
