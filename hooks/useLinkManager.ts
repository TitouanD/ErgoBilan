/**
 * useLinkManager — Handles secure questionnaire link generation, copying,
 * and the associated UI state (modal visibility, copy confirmation).
 */

import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '../services/db';
import { generateQuestionnaireKey, encryptData, decryptData } from '../utils/crypto';
import type { PendingQuestionnaire, PractitionerProfile } from '../types';

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
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [linkCopiedConfirmed, setLinkCopiedConfirmed] = useState(false);

  // ------------------------------------------------------------------
  // Generate a new questionnaire link
  // ------------------------------------------------------------------
  const handleGenerateLink = useCallback(async () => {
    if (isDemoMode) {
      setCreatedLink(`${window.location.origin}/?q_id=demo-q1#key=demo-key`);
      setPendingQuestionnaires((prev) => [
        { id: 'demo-new', label: 'Nouveau Dossier (Simulé)', status: 'pending', createdAt: new Date().toISOString(), practitionerEncryptedKey: '' },
        ...prev,
      ]);
      toast.success('Lien sécurisé généré');
      return;
    }

    if (!practitioner || !sessionKey) return;

    const { data: member } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', practitioner.id)
      .maybeSingle();

    if (!member?.organization_id) {
      toast.error('Erreur critique: Organisation introuvable.');
      return;
    }

    const { keyString } = await generateQuestionnaireKey();
    const enc = await encryptData(keyString, sessionKey);

    // Générer un token d'accès pour sécuriser l'accès anonyme
    const accessTokenBytes = new Uint8Array(32);
    crypto.getRandomValues(accessTokenBytes);
    const accessToken = Array.from(accessTokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const label = `Dossier #${pendingQuestionnaires.length + 1} (${new Date().toLocaleDateString()})`;

    const { data, error } = await supabase
      .from('pending_questionnaires')
      .insert({
        practitioner_id: practitioner.id,
        organization_id: member.organization_id,
        label,
        status: 'pending',
        practitioner_encrypted_key: `${enc.iv}:${enc.content}`,
        access_token: accessToken,
      })
      .select()
      .single();

    if (error) {
      toast.error('Impossible de créer le lien.');
      return;
    }

    if (data) {
      setCreatedLink(`${window.location.origin}/?q_id=${data.id}&t=${accessToken}#key=${keyString}`);
      setLinkCopiedConfirmed(false);
      setPendingQuestionnaires((prev) => [
        {
          id: data.id,
          label: data.label,
          status: 'pending',
          createdAt: data.created_at,
          practitionerEncryptedKey: data.practitioner_encrypted_key,
        },
        ...prev,
      ]);
      toast.success('Lien sécurisé généré');
    }
  }, [isDemoMode, sessionKey, practitioner, pendingQuestionnaires, setPendingQuestionnaires, toast]);

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

      try {
        const [iv, content] = q.practitionerEncryptedKey.split(':');
        const keyString = await decryptData({ iv, content }, sessionKey);
        await navigator.clipboard.writeText(`${window.location.origin}/?q_id=${q.id}#key=${keyString}`);
        toast.success('Lien copié');
      } catch {
        toast.error('Erreur déchiffrement lien');
      }
    },
    [isDemoMode, sessionKey, toast],
  );

  return {
    createdLink,
    setCreatedLink,
    linkCopiedConfirmed,
    setLinkCopiedConfirmed,
    handleGenerateLink,
    handleCopyLink,
  };
};
