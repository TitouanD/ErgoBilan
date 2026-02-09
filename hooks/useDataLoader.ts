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
  authState: string;
  practitioner: PractitionerProfile | null;
  isDemoMode: boolean;
}

export const useDataLoader = ({
  sessionKey,
  orgKey,
  authState,
  practitioner,
  isDemoMode,
}: UseDataLoaderParams) => {
  const [patientFiles, setPatientFiles] = useState<PatientFile[]>([]);
  const [pendingQuestionnaires, setPendingQuestionnaires] = useState<PendingQuestionnaire[]>([]);
  const [draftsIndex, setDraftsIndex] = useState<Record<string, string>>({});
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------
  // Core data loader (called on mount + after writes)
  // ------------------------------------------------------------------
  const loadData = useCallback(async () => {
    if (!(sessionKey && orgKey && authState === 'authenticated') && !isDemoMode) return;

    Logger.info('DB', 'Refreshing user data...');
    const files = await StorageService.loadPatientList(orgKey!);
    setPatientFiles(files);

    const draftsMap = await StorageService.getDraftsMetadata();
    setDraftsIndex(draftsMap);

    if (practitioner && !isDemoMode) {
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
    } else if (isDemoMode) {
      setPendingQuestionnaires([
        { id: 'demo-q1', label: 'Famille MARTIN (En attente)', status: 'pending', createdAt: new Date().toISOString(), practitionerEncryptedKey: '' },
        { id: 'demo-leo', label: 'Famille MARTIN (Dossier complet)', status: 'completed', createdAt: new Date(Date.now() - 86400000).toISOString(), practitionerEncryptedKey: '' },
      ]);
    }
  }, [sessionKey, orgKey, authState, practitioner, isDemoMode]);

  // Auto-load on dependency change
  useEffect(() => {
    loadData();
  }, [loadData]);

  // ------------------------------------------------------------------
  // Realtime subscription (debounced)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!sessionKey || !orgKey || isDemoMode || authState !== 'authenticated') return;

    const handleRealtimeUpdate = () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        loadData();
      }, 1000);
    };

    const channel = supabase
      .channel('dashboard-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_questionnaires' }, handleRealtimeUpdate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, handleRealtimeUpdate)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, [sessionKey, orgKey, authState, isDemoMode, loadData]);

  return {
    patientFiles,
    setPatientFiles,
    pendingQuestionnaires,
    setPendingQuestionnaires,
    draftsIndex,
    loadData,
  };
};
