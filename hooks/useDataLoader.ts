/**
 * useDataLoader — Manages patient files, pending questionnaires, drafts index,
 * and Supabase realtime subscriptions for the dashboard.
 *
 * Extracted from AppRouter to keep the main component focused on rendering.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../services/db';
import { StorageService } from '../services/storage';
import type { PatientFile, PendingQuestionnaire, PractitionerProfile } from '../types';
import { Logger } from '../utils/logger';

interface UseDataLoaderParams {
  sessionKey: CryptoKey | null;
  orgKey: CryptoKey | null;
  orgId: string | null;
  authState: string;
  practitioner: PractitionerProfile | null;
  isDemoMode: boolean;
}

const PATIENT_PAGE_SIZE = 50;

export const useDataLoader = ({
  sessionKey,
  orgKey,
  orgId,
  authState,
  practitioner,
  isDemoMode,
}: UseDataLoaderParams) => {
  const [patientFiles, setPatientFiles] = useState<PatientFile[]>([]);
  const [pendingQuestionnaires, setPendingQuestionnaires] = useState<PendingQuestionnaire[]>([]);
  const [draftsIndex, setDraftsIndex] = useState<Record<string, string>>({});
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasMorePatients, setHasMorePatients] = useState(false);
  const [isLoadingMorePatients, setIsLoadingMorePatients] = useState(false);
  const patientOffsetRef = useRef(0);
  const loadingPatientsRef = useRef(false);
  const pendingPatientIdsRef = useRef<Set<string>>(new Set());

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
      if (!(sessionKey && orgKey && authState === 'authenticated') && !isDemoMode) return;
      if (loadingPatientsRef.current) return;
      const reset = options?.reset ?? false;

      loadingPatientsRef.current = true;
      if (reset) {
        patientOffsetRef.current = 0;
      } else {
        setIsLoadingMorePatients(true);
      }

      try {
        const { files, hasMore, nextOffset } = await StorageService.loadPatientListPage(orgKey!, {
          orgId: orgId || undefined,
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
    [sessionKey, orgKey, orgId, authState, isDemoMode],
  );

  const loadMorePatients = useCallback(async () => {
    if (!hasMorePatients) return;
    await loadPatients({ reset: false });
  }, [hasMorePatients, loadPatients]);

  const loadDrafts = useCallback(async () => {
    if (!(sessionKey && orgKey && authState === 'authenticated') && !isDemoMode) return;
    const draftsMap = await StorageService.getDraftsMetadata();
    setDraftsIndex(draftsMap);
  }, [sessionKey, orgKey, authState, isDemoMode]);

  const loadPending = useCallback(async () => {
    if (isDemoMode) {
      setPendingQuestionnaires([
        { id: 'demo-q1', label: 'Famille RAVEL (En attente)', status: 'pending', createdAt: new Date().toISOString(), practitionerEncryptedKey: '' },
        { id: 'demo-leo', label: 'Famille RAVEL (Dossier complet)', status: 'completed', createdAt: new Date(Date.now() - 86400000).toISOString(), practitionerEncryptedKey: '' },
      ]);
      return;
    }
    if (!(sessionKey && orgKey && authState === 'authenticated')) return;
    if (!practitioner) return;

    const { data } = await supabase
      .from('pending_questionnaires')
      .select('id, label, status, created_at, practitioner_encrypted_key, access_token')
      .eq('practitioner_id', practitioner.id)
      .order('created_at', { ascending: false });

    if (data) {
      setPendingQuestionnaires(
        data.map((p: Record<string, unknown>) => ({
          ...p,
          id: p.id as string,
          label: p.label as string,
          status: p.status as 'pending' | 'completed',
          createdAt: p.created_at as string,
          practitionerEncryptedKey: p.practitioner_encrypted_key as string,
          accessToken: (p.access_token as string | null) || undefined,
        })),
      );
    }
  }, [sessionKey, orgKey, authState, practitioner, isDemoMode]);

  const refreshPatientsByIds = useCallback(
    async (ids: string[]) => {
      if (!orgKey || ids.length === 0) return;
      const uniqueIds = Array.from(new Set(ids));
      const results = await Promise.all(
        uniqueIds.map((id) => StorageService.loadPatientPreviewById(id, orgKey!, { orgId: orgId || undefined })),
      );

      setPatientFiles((prev) => {
        const byId = new Map<string, PatientFile>(prev.map((file) => [file.id, file]));
        uniqueIds.forEach((id, idx) => {
          const file = results[idx];
          if (file) {
            byId.set(file.id, file);
          } else {
            byId.delete(id);
          }
        });
        return sortPatients(Array.from(byId.values()));
      });
    },
    [orgKey, orgId],
  );

  const loadData = useCallback(async () => {
    if (!(sessionKey && orgKey && authState === 'authenticated') && !isDemoMode) return;
    Logger.info('DB', 'Refreshing user data...');
    await loadPatients({ reset: true });
    await loadDrafts();
    await loadPending();
  }, [sessionKey, orgKey, authState, isDemoMode, loadPatients, loadDrafts, loadPending]);

  // Auto-load on dependency change
  useEffect(() => {
    loadData();
  }, [loadData]);

  // ------------------------------------------------------------------
  // Realtime subscription (debounced)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!sessionKey || !orgKey || isDemoMode || authState !== 'authenticated') return;

    const schedule = (handler: () => void) => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        handler();
      }, 1000);
    };

    const handlePatientChange = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const id = (payload.new?.id as string) || (payload.old?.id as string);
      if (!id) return;
      pendingPatientIdsRef.current.add(id);
      schedule(() => {
        const ids = Array.from(pendingPatientIdsRef.current);
        pendingPatientIdsRef.current.clear();
        refreshPatientsByIds(ids);
      });
    };

    const channel = supabase
      .channel('dashboard-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pending_questionnaires', filter: practitioner ? `practitioner_id=eq.${practitioner.id}` : undefined },
        () => schedule(loadPending),
      );

    if (orgId) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'patients', filter: `organization_id=eq.${orgId}` }, handlePatientChange);
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, [sessionKey, orgKey, authState, isDemoMode, practitioner, orgId, loadPending, refreshPatientsByIds]);

  return {
    patientFiles,
    setPatientFiles,
    pendingQuestionnaires,
    setPendingQuestionnaires,
    draftsIndex,
    hasMorePatients,
    isLoadingMorePatients,
    loadMorePatients,
    loadData,
  };
};
