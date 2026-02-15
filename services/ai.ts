import { callAIProxyTask } from './aiProxy';
import { SubscriptionService } from './subscription';
import { supabase } from './db';
import { cleanAndParseJson } from '../utils/aiHelpers';
import type { ClinicalSynthesis, GeneratedReportSection, Patient } from '../types';
import { hydrateReport } from '../utils/anonymizer';
import { Logger } from '../utils/logger';

interface BioResponse {
  mandat_referencement?: string;
  mandat_evaluation?: string;
  profil_occupationnel?: string;
}

interface DiagResponse {
  synthese_diagnostic?: string;
  recommandations?: string;
  objectifs_generaux?: string;
}

export interface GenerationPayload {
  safeQuestionnaire: string;
  safeObservations: string;
  scoresEvidence: unknown;
  childContext: string;
  synthesis: ClinicalSynthesis;
}

const getAgeYears = (ageStr: string): number => {
  const match = ageStr.match(/(\d+)\s*(?:ans|yrs|years)?/i);
  if (ageStr.toLowerCase().includes('mois') && !ageStr.toLowerCase().includes('ans')) return 0;
  return match ? parseInt(match[1], 10) : 0;
};

export const AIService = {
  generateFullReport: async (payload: GenerationPayload, patient: Patient): Promise<GeneratedReportSection[]> => {
    Logger.info('AI', 'Starting report generation process', { patientId: patient.id });

    const ageYears = getAgeYears(patient.age);
    const profile = ageYears >= 20 ? 'adult' : 'pediatric';

    let sessionGenerationId: string | null = null;

    try {
      const bioResponse = await callAIProxyTask({
        task: 'report_bio',
        payload: {
          profile,
          childContext: payload.childContext,
          safeQuestionnaire: payload.safeQuestionnaire,
        },
      });

      sessionGenerationId = bioResponse.generationId ?? null;
      const jsonBio = cleanAndParseJson(bioResponse.text) as BioResponse | null;

      const diagResponse = await callAIProxyTask({
        task: 'report_diagnostic',
        payload: {
          profile,
          profilContext: jsonBio?.profil_occupationnel || 'Non disponible',
          safeObservations: payload.safeObservations,
          scoresEvidence: payload.scoresEvidence,
          synthesis: payload.synthesis,
        },
        generationId: sessionGenerationId ?? undefined,
      });

      const jsonDiag = cleanAndParseJson(diagResponse.text) as DiagResponse | null;

      const sections: GeneratedReportSection[] = [
        {
          id: 'mandat_ref',
          title: 'Mandat de référencement',
          content: hydrateReport(jsonBio?.mandat_referencement || 'Non généré.', patient),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'mandat_eval',
          title: "Motif de l'évaluation",
          content: hydrateReport(jsonBio?.mandat_evaluation || 'Non généré.', patient),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'profil',
          title: 'Profil occupationnel',
          content: hydrateReport(jsonBio?.profil_occupationnel || 'Non généré.', patient),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'diagnostic',
          title: 'Synthèse Clinique',
          content: hydrateReport(jsonDiag?.synthese_diagnostic || 'Non généré.', patient),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'recommandations',
          title: profile === 'adult' ? 'Préconisations' : 'Recommandations Pédagogiques',
          content: hydrateReport(jsonDiag?.recommandations || 'Non généré.', patient),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'objectifs',
          title: "Projet d'Intervention",
          content: hydrateReport(jsonDiag?.objectifs_generaux || 'Non généré.', patient),
          status: 'draft',
          isAiGenerated: true,
        },
      ];

      if (sessionGenerationId) {
        const genId = sessionGenerationId;
        (async () => {
          try {
            const { error } = await supabase.from('generation_log').update({ status: 'completed' }).eq('id', genId);
            if (error) Logger.warn('AI', 'Failed to mark generation completed', error);
          } catch (e) {
            Logger.warn('AI', 'Exception marking generation completed', e);
          }
        })();
      }

      return sections;
    } catch (e: unknown) {
      Logger.error('AI', 'Generation failed', e);
      if (sessionGenerationId) {
        await SubscriptionService.refundCredit(sessionGenerationId).catch(() => undefined);
      }
      throw e;
    }
  },
};
