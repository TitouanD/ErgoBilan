/**
 * useLinkManager — Handles secure questionnaire link generation, copying,
 * and clipboard actions for dashboard workflows.
 */

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '../services/db';
import { generateQuestionnaireKey, encryptToEnvelope, decryptEnvelope } from '../utils/crypto';
import type { PendingQuestionnaire, PractitionerProfile } from '../types';
import { Logger } from '../utils/logger';

interface UseLinkManagerParams {
  sessionKey: CryptoKey | null;
  practitioner: PractitionerProfile | null;
  isDemoMode: boolean;
  pendingQuestionnaires: PendingQuestionnaire[];
  setPendingQuestionnaires: Dispatch<SetStateAction<PendingQuestionnaire[]>>;
  toast: { success: (m: string) => void; error: (m: string) => void };
}

export const useLinkManager = ({
  sessionKey,
  practitioner,
  isDemoMode,
  pendingQuestionnaires,
  setPendingQuestionnaires,
  toast,
}: UseLinkManagerParams) => {
  const tryCopyLink = useCallback(
    async (link: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(link);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // Generate a new questionnaire link
  // ------------------------------------------------------------------
  const handleGenerateLink = useCallback(async () => {
    if (isDemoMode) {
      const demoLink = `${window.location.origin}/?q_id=demo-q1#key=demo-key`;
      setPendingQuestionnaires((prev) => [
        { id: 'demo-new', label: 'Nouveau Dossier (Simulé)', status: 'pending', createdAt: new Date().toISOString(), practitionerEncryptedKey: '' },
        ...prev,
      ]);
      const copied = await tryCopyLink(demoLink);
      toast.success(copied ? 'Lien sécurisé généré et copié' : 'Lien sécurisé généré');
      return;
    }

    if (!practitioner || !sessionKey) return;

    // bootstrap_org_for_user is idempotent (creates the organization if missing) and returns its uuid.
    const { data: organizationId, error: orgError } = await supabase.rpc('bootstrap_org_for_user', {
      p_user_id: practitioner.id,
      p_org_name: 'Mon Cabinet',
    });
    if (orgError || typeof organizationId !== 'string' || !organizationId) {
      toast.error('Erreur critique : Organisation introuvable.');
      return;
    }

    const { keyString } = await generateQuestionnaireKey();
    const practitionerEncryptedKey = await encryptToEnvelope(keyString, sessionKey);

    // Générer un token d'accès pour sécuriser l'accès anonyme
    const accessTokenBytes = new Uint8Array(32);
    crypto.getRandomValues(accessTokenBytes);
    const accessToken = Array.from(accessTokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const label = `Dossier #${pendingQuestionnaires.length + 1} (${new Date().toLocaleDateString()})`;

    const { data, error } = await supabase
      .from('pending_questionnaires')
      .insert({
        practitioner_id: practitioner.id,
        organization_id: organizationId,
        label,
        status: 'pending',
        practitioner_encrypted_key: practitionerEncryptedKey,
        access_token: accessToken,
      })
      .select()
      .single();

    if (error) {
      Logger.error('DB', 'Questionnaire link creation failed', error);
      toast.error('Impossible de créer le lien.');
      return;
    }

    if (data) {
      const generatedLink = `${window.location.origin}/?q_id=${data.id}&t=${accessToken}#key=${keyString}`;
      setPendingQuestionnaires((prev) => [
        {
          id: data.id,
          label: data.label ?? label,
          status: 'pending',
          createdAt: data.created_at ?? new Date().toISOString(),
          practitionerEncryptedKey: data.practitioner_encrypted_key,
          accessToken: data.access_token || accessToken,
        },
        ...prev,
      ]);
      const copied = await tryCopyLink(generatedLink);
      toast.success(copied ? 'Lien sécurisé généré et copié' : 'Lien sécurisé généré');
    }
  }, [isDemoMode, sessionKey, practitioner, pendingQuestionnaires, setPendingQuestionnaires, toast, tryCopyLink]);

  // ------------------------------------------------------------------
  // Delete a pending questionnaire (suppression en DB)
  // ------------------------------------------------------------------
  const handleDeletePending = useCallback(
    async (q: PendingQuestionnaire): Promise<void> => {
      // Optimistic removal first
      setPendingQuestionnaires((prev) => prev.filter((item) => item.id !== q.id));

      if (isDemoMode) return;

      const { error } = await supabase
        .from('pending_questionnaires')
        .delete()
        .eq('id', q.id);

      if (error) {
        // Rollback on failure
        setPendingQuestionnaires((prev) => [q, ...prev]);
        toast.error('Erreur lors de la suppression.');
      }
    },
    [isDemoMode, setPendingQuestionnaires, toast],
  );

  // ------------------------------------------------------------------
  // Copy an existing link
  // ------------------------------------------------------------------
  const handleCopyLink = useCallback(
    async (q: PendingQuestionnaire) => {
      if (isDemoMode) {
        navigator.clipboard.writeText(`${window.location.origin}/?q_id=${q.id}#key=demo-key`);
        toast.success('Lien copié !');
        return;
      }

      if (!sessionKey || !q.practitionerEncryptedKey) return;
      if (!q.accessToken) {
        toast.error('Lien expiré — veuillez régénérer.');
        return;
      }

      try {
        const keyString = await decryptEnvelope(q.practitionerEncryptedKey, sessionKey);
        await navigator.clipboard.writeText(`${window.location.origin}/?q_id=${q.id}&t=${q.accessToken}#key=${keyString}`);
        toast.success('Lien copié');
      } catch (e) {
        Logger.error('CRYPTO', 'Questionnaire link copy failed', e, { questionnaireId: q.id });
        toast.error('Erreur déchiffrement lien');
      }
    },
    [isDemoMode, sessionKey, toast],
  );

  return {
    handleGenerateLink,
    handleCopyLink,
    handleDeletePending,
  };
};
