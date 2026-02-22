import { callAIProxyTask } from './aiProxy';
import { cleanAndParseJson } from '../utils/aiHelpers';
import type { ClinicalSynthesis, GeneratedReportSection, Patient } from '../types';
import { hydrateReport } from '../utils/anonymizer';
import { Logger } from '../utils/logger';
import { sanitizeReportText } from '../utils/textSanitizer';

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
          title: 'Mandat de r\u00e9f\u00e9rencement en ergoth\u00e9rapie',
          content: sanitizeReportText(hydrateReport(jsonBio?.mandat_referencement || 'Non g\u00e9n\u00e9r\u00e9.', patient)),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'mandat_eval',
          title: "Mandat d'\u00e9valuation en ergoth\u00e9rapie",
          content: sanitizeReportText(hydrateReport(jsonBio?.mandat_evaluation || 'Non g\u00e9n\u00e9r\u00e9.', patient)),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'profil',
          title: 'Profil occupationnel',
          content: sanitizeReportText(hydrateReport(jsonBio?.profil_occupationnel || 'Non g\u00e9n\u00e9r\u00e9.', patient)),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'diagnostic',
          title: 'Diagnostique en ergoth\u00e9rapie',
          content: sanitizeReportText(hydrateReport(jsonDiag?.synthese_diagnostic || 'Non g\u00e9n\u00e9r\u00e9.', patient)),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'recommandations',
          title: profile === 'adult' ? 'Pr\u00e9conisations' : 'Recommandations',
          content: sanitizeReportText(hydrateReport(jsonDiag?.recommandations || 'Non g\u00e9n\u00e9r\u00e9.', patient)),
          status: 'draft',
          isAiGenerated: true,
        },
        {
          id: 'objectifs',
          title: 'Les objectifs g\u00e9n\u00e9raux',
          content: sanitizeReportText(hydrateReport(jsonDiag?.objectifs_generaux || 'Non g\u00e9n\u00e9r\u00e9.', patient)),
          status: 'draft',
          isAiGenerated: true,
        },
      ];

      return sections;
    } catch (e: unknown) {
      Logger.error('AI', 'Generation failed', e);
      throw e;
    }
  },
};
