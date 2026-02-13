/**
 * useAssessmentFlow — Encapsulates the AI report generation, finalization,
 * draft save/resume logic that was previously inlined in AppRouter.
 */

import { useState, useCallback } from 'react';
import { AIService, type GenerationPayload } from '../services/ai';
import { StorageService } from '../services/storage';
import { AdminService } from '../services/admin';
import { ensureFreshSession } from '../services/db';
import { anonymizeData } from '../utils/anonymizer';
import { getPatientAgeForIdentity, isPatientCreationReady } from '../utils';
import type {
  Patient,
  TestData,
  Observations,
  ClinicalSynthesis,
  ReportSection,
  PatientFile,
  ScoreResult,
  TestSession,
  ReportMetadata,
} from '../types';
import { Logger } from '../utils/logger';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Minimal assessment shape needed by this hook (mirrors AssessmentContext) */
export interface AssessmentHandle {
  patient: Patient;
  tests: TestData;
  observations: Observations;
  synthesis: ClinicalSynthesis;
  sections: ReportSection[];
  step: number;
  setSections: (s: ReportSection[]) => void;
  setStep: (n: number) => void;
  setPatient: (p: Patient) => void;
  setTests: (t: TestData) => void;
  setObservations: (o: Observations) => void;
  updatePatient: (p: Partial<Patient>) => void;
  resetAssessment: () => void;
  loadFromDraft: (draft: unknown) => void;
  updateSection: (id: string, update: Partial<ReportSection>) => void;
}

interface CatalogTest { id: string; name: string; subtests?: unknown[] }
interface CatalogCategory { id: string; tests: CatalogTest[] }

interface UseAssessmentFlowParams {
  assessment: AssessmentHandle;
  sessionKey: CryptoKey | null;
  orgKey: CryptoKey | null;
  isDemoMode: boolean;
  catalog: CatalogCategory[];
  refreshProfile: () => Promise<void>;
  patientFiles: PatientFile[];
  loadData: () => Promise<void>;
  toast: { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void };
}

// Demo sections for offline simulation
const DEMO_SECTIONS: ReportSection[] = [
  {
    id: 'mandat_ref',
    title: 'Mandat de referencement',
    content: "**Motif de la demande**\nL'evaluation est sollicitee par la famille et l'equipe enseignante en raison d'une lenteur marquée, de difficultes d'organisation et d'une ecriture couteuse. Les enseignants signalent une fatigabilite et une perte de confiance lors des taches ecrites.",
    status: 'draft',
    isAiGenerated: true,
  },
  {
    id: 'mandat_eval',
    title: "Motif de l'evaluation",
    content: "**Contexte scolaire**\nElya, 7 ans, scolarisee en CE1. Un PAP est en discussion. Le bilan vise a objectiver les difficultes graphomotrices, la regulation de l'effort et a proposer des adaptations efficaces a l'ecole comme a la maison.",
    status: 'draft',
    isAiGenerated: true,
  },
  {
    id: 'profil',
    title: 'Profil occupationnel',
    content: "**Habitudes de vie**\nElya est volontaire mais se decourage vite quand la tache dure. A la maison, l'autonomie est acquise mais la lenteur est notable (habillage, douche, brossage des dents). Elle a besoin de bouger et beneficie d'activites sportives reguliere.",
    status: 'draft',
    isAiGenerated: true,
  },
  {
    id: 'diagnostic',
    title: 'Synthese clinique',
    content: "### Analyse du profil\nLes resultats orientent vers un **trouble des coordinations et de la graphomotricite** avec impact sur l'efficience scolaire.\n\n### Elements saillants\n- **BHK** : Vitesse P10 (ET -1.3) et Qualite P4 (ET -1.8) avec tension de la main et irregularites.\n- **MABC-2** : Dexterite manuelle P9 et Equilibre P5, en faveur d'une lenteur motrice fine et d'une fatigabilite.\n- **Cloches** : P25, rythme inconstant, besoin de pauses.\n\n### Retentissement fonctionnel\nLenteur d'execution, charge cognitive elevee a l'ecrit et decouragement, avec tendance a la devalorisation.",
    status: 'draft',
    isAiGenerated: true,
  },
  {
    id: 'objectifs',
    title: "Projet d'intervention",
    content: "### Objectifs a court terme\n- Diminuer le cout graphomoteur et la fatigue.\n- Stabiliser la tenue de crayon et la posture.\n\n### Objectifs a moyen terme\n- Renforcer l'efficience a l'ecrit (vitesse + lisibilite).\n- Consolider l'autonomie sur les taches scolaires chronophages.\n\n### Objectifs a long terme\n- Maintien de l'estime de soi et des strategies d'organisation.",
    status: 'draft',
    isAiGenerated: true,
  },
  {
    id: 'recommandations',
    title: 'Preconisations',
    content: "### A l'ecole\n- **Allegement de la trace ecrite** : photocopies, textes a trous, reduction du volume de copie.\n- **Temps majore** pour les evaluations longues.\n- **Aides visuelles** : consignes segmentees, timer discret, repere sur l'horloge.\n\n### A la maison\n- Installer des routines courtes avec pauses motrices.\n- Utiliser un minuteur pour se reperer dans le temps.\n\n### Suivi therapeutique\n- Ergotherapie axee sur la graphomotricite, la posture, et la planification motrice.",
    status: 'draft',
    isAiGenerated: true,
  },
];

// --------------------------------------------------------------------------
// Hook
// --------------------------------------------------------------------------

export const useAssessmentFlow = ({
  assessment,
  sessionKey,
  orgKey,
  isDemoMode,
  catalog,
  refreshProfile,
  patientFiles,
  loadData,
  toast,
}: UseAssessmentFlowParams) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Generate AI report
  // ------------------------------------------------------------------
  const handleGenerateReport = useCallback(async () => {
    // Demo path — simulate with static data
    if (isDemoMode) {
      setIsGenerating(true);
      setTimeout(() => {
        assessment.setSections(DEMO_SECTIONS);
        assessment.setStep(4);
        setIsGenerating(false);
        toast.success('Rapport généré (Simulation)');
      }, 3000);
      return;
    }

    setGenerationError(null);
    setIsGenerating(true);

    try {
      // Fire-and-forget telemetry
      AdminService.logAnonymousStats(assessment.tests, assessment.patient);

      const p = assessment.patient;
      const genderString = p.gender === 'F' ? 'une fille' : 'un garçon';

      const tracking =
        p.medicalTracking?.map((t) => `- ${t.type} (${t.name}): ${t.frequency} depuis ${t.since}`).join('\n') ||
        'Aucun suivi renseigné';
      const clothing = `Boutons: ${p.clothingButtons || '?'}, Lacets: ${p.clothingLaces || '?'}, Zippers: ${p.clothingZippers || '?'}`;
      const dev = `Marche: ${p.walkingAge || '?'}, Propreté: ${p.cleanliness || '?'}, Latéralité: ${p.handDominance || '?'}`;
      const behavior = `Temps écran: ${p.screenTime || '?'}, Emotions: ${p.emotionalRegulation || '?'}, Social: ${p.socialBehavior || '?'}`;
      const sensory = `Profil sensoriel: ${p.sensory || '?'}, Sommeil: ${p.sleepStatus || p.sleep || '?'}`;
      const writing = `Écriture: ${p.writingIssues || '?'}, Douleur: ${p.writingPain || '?'}, Outils/Ciseaux: ${p.toolScissors || '?'}`;
      const school = `Attention scolaire: ${p.schoolAttention || '?'}, Aménagements: ${p.schoolAccommodations || '?'}`;
      const goals = p.goals?.length ? `Priorités famille: ${p.goals.join(', ')}` : '';
      const avs = p.avs === 'OUI' ? `AVS: ${p.avsHours || '?'}h, Missions: ${p.avsMissions || '?'}` : '';
      const medical = `Diagnostic médical: ${p.medicalDiagnosis || 'Aucun'}, Traitements: ${p.medicalTreatments || 'Aucun'}`;

      const rawQ = `
Motif: ${p.reason}
Scolarité: ${p.school} ${p.classLevel} (Plan: ${p.carePlan})
${school}
${avs}
Vie Quotidienne: ${p.meals} ${p.dressing} ${p.continence}
Autonomie Habillage: ${clothing}
${writing}
${sensory}
${medical}
Suivi Paramédical: ${tracking}
Développement: ${dev}
Comportement: ${behavior}
${goals}
Attentes: ${p.familyExpectations}
`;

      // Build observations from: 1) Clinical interview notes (interviewNotes), 2) Per-subtest observations, 3) Legacy domain observations
      const clinicalNotes = p.interviewNotes || '';
      const legacyObs = [assessment.observations.anamnese, assessment.observations.motricite, assessment.observations.graphique].filter(Boolean).join('\n');
      
      // Extract per-subtest observations for the AI
      const subtestObs: string[] = [];
      Object.entries(assessment.tests).forEach(([, subtests]) => {
          Object.entries(subtests).forEach(([subId, res]) => {
              if (res.observation?.trim()) {
                  subtestObs.push(`[${subId}] ${res.observation.trim()}`);
              }
          });
      });
      
      const rawObs = [
          clinicalNotes ? `Notes cliniques d'entretien:\n${clinicalNotes}` : '',
          legacyObs ? `Observations générales: ${legacyObs}` : '',
          subtestObs.length > 0 ? `Observations par épreuve:\n${subtestObs.join('\n')}` : '',
      ].filter(Boolean).join('\n\n') || 'RAS';

      const payload: GenerationPayload = {
        safeQuestionnaire: anonymizeData(rawQ, p).text,
        safeObservations: anonymizeData(rawObs, p).text,
        scoresRaw: JSON.stringify(assessment.tests, null, 2),
        childContext: `L'enfant est ${genderString} de ${p.age}.`,
        synthesis: assessment.synthesis,
      };

      const sections = await AIService.generateFullReport(payload, assessment.patient);
      assessment.setSections(sections as ReportSection[]);
      assessment.setStep(4);
      refreshProfile();
      toast.success('Rapport généré avec succès');
    } catch (e: unknown) {
      Logger.error('AI', 'Generation Error', e);
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'CREDIT_INSUFFICIENT') {
        // Caller should open paywall — we signal via a special error string
        setGenerationError('CREDIT_INSUFFICIENT');
      } else if (msg === 'RATE_LIMITED') {
        setGenerationError("Trop de requêtes. Réessayez dans quelques minutes.");
      } else if (msg === 'SESSION_EXPIRED') {
        setGenerationError("Session expirée. Veuillez vous reconnecter.");
      } else if (msg === 'TIMEOUT_AI') {
        setGenerationError("Le serveur IA ne répond pas.");
      } else {
        setGenerationError(msg || 'Erreur inconnue.');
      }
    } finally {
      setIsGenerating(false);
    }
  }, [assessment, isDemoMode, refreshProfile, toast]);

  const ensurePatientIdentityPersisted = useCallback(
    async (action: 'save_quit' | 'finalize'): Promise<{ patientId: string; patientSnapshot: Patient } | null> => {
      if (!orgKey) return null;

      const normalizedPatient: Patient = {
        ...assessment.patient,
        age: getPatientAgeForIdentity(assessment.patient),
      };

      let patientId = normalizedPatient.id;
      if (!patientId) {
        if (!isPatientCreationReady(normalizedPatient)) {
          Logger.warn('DB', 'missing_required_fields', { action });
          toast.error('Nom, prénom et date de naissance requis.');
          return null;
        }

        patientId = await StorageService.ensurePatientId(normalizedPatient, orgKey);
      }

      const patientSnapshot: Patient = {
        ...normalizedPatient,
        id: patientId,
      };

      if (assessment.patient.id !== patientId || assessment.patient.age !== patientSnapshot.age) {
        assessment.updatePatient({ id: patientId, age: patientSnapshot.age });
      }

      await StorageService.syncPatientIdentityPreview(patientId, patientSnapshot, orgKey);
      return { patientId, patientSnapshot };
    },
    [assessment, orgKey, toast],
  );

  // ------------------------------------------------------------------
  // Finalize assessment (save to Supabase + clean up)
  // ------------------------------------------------------------------
  const handleFinalize = useCallback(async () => {
    if (isDemoMode) return 'dashboard' as const;
    if (!sessionKey || !orgKey) return null;

    setIsGenerating(true);
    try {
      // Ensure JWT is fresh before critical save operation
      await ensureFreshSession();
      const persisted = await ensurePatientIdentityPersisted('finalize');
      if (!persisted) return null;
      const { patientId, patientSnapshot } = persisted;

      const testNames: string[] = [];
      const flatResultsClean: Record<string, ScoreResult> = {};
      Object.entries(assessment.tests).forEach(([tId, subtests]) => {
        const catalogDef = catalog.flatMap((c) => c.tests).find((t) => t.id === tId);
        testNames.push(catalogDef ? catalogDef.name : tId);
        Object.entries(subtests).forEach(([sId, res]) => {
          flatResultsClean[sId] = res as ScoreResult;
        });
      });

      const newSession: TestSession = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        testId: 'multi',
        testName: testNames.join(', ') || 'Bilan',
        results: flatResultsClean,
      };
      const newReport: ReportMetadata = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        type: 'initial',
        status: 'completed',
        patientName: `${patientSnapshot.firstName} ${patientSnapshot.lastName}`,
        sections: assessment.sections,
      };

      const currentFileIndex = patientFiles.findIndex((f) => f.id === patientId);
      const currentFile: PatientFile =
        currentFileIndex === -1
          ? { id: patientId, patient: patientSnapshot, reports: [], sessions: [], lastInteraction: new Date().toISOString(), archived: false }
          : patientFiles[currentFileIndex];

      const updatedFile: PatientFile = {
        ...currentFile,
        lastInteraction: new Date().toISOString(),
        sessions: [newSession, ...(currentFile.sessions || [])],
        reports: [newReport, ...(currentFile.reports || [])],
      };

      await StorageService.saveFile(updatedFile, orgKey);
      await StorageService.deleteDraft(patientId);
      loadData();
      assessment.resetAssessment();
      toast.success('Bilan sauvegardé.');
      return 'dashboard' as const;
    } catch (e: unknown) {
      Logger.error('DB', 'Erreur Finalisation', e);
      toast.error('Erreur sauvegarde.');
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [assessment, sessionKey, orgKey, isDemoMode, catalog, patientFiles, loadData, toast, ensurePatientIdentityPersisted]);

  // ------------------------------------------------------------------
  // Save draft and quit
  // ------------------------------------------------------------------
  const handleSaveAndQuit = useCallback(async () => {
    if (isDemoMode) {
      assessment.resetAssessment();
      return 'dashboard' as const;
    }

    if (!sessionKey || !orgKey) return null;

    try {
      await ensureFreshSession();
      const persisted = await ensurePatientIdentityPersisted('save_quit');
      if (!persisted) return null;

      const draftData = {
        patient: persisted.patientSnapshot,
        tests: assessment.tests,
        observations: assessment.observations,
        synthesis: assessment.synthesis,
        sections: assessment.sections,
        step: assessment.step,
        timestamp: new Date().toISOString(),
      };
      await StorageService.saveDraft(draftData, sessionKey);
      assessment.resetAssessment();
      toast.success('Brouillon sauvegardé');
      return 'dashboard' as const;
    } catch (e) {
      Logger.error('DB', 'Save error', e);
      toast.error('Impossible de sauvegarder le brouillon.');
      return null;
    }
  }, [assessment, sessionKey, orgKey, isDemoMode, toast, ensurePatientIdentityPersisted]);

  // ------------------------------------------------------------------
  // Resume a draft
  // ------------------------------------------------------------------
  const handleResumeDraft = useCallback(
    async (patientId?: string) => {
      if (!sessionKey && !isDemoMode) return false;
      const draftContent = await StorageService.getDraft(sessionKey!, patientId);
      if (draftContent) {
        assessment.resetAssessment();
        assessment.loadFromDraft(draftContent);
        return true;
      }
      if (isDemoMode) {
        toast.info('Brouillons désactivés en démo.');
      } else {
        toast.error('Impossible de charger ce brouillon.');
      }
      return false;
    },
    [assessment, sessionKey, isDemoMode, toast],
  );

  return {
    isGenerating,
    setIsGenerating,
    generationError,
    setGenerationError,
    handleGenerateReport,
    handleFinalize,
    handleSaveAndQuit,
    handleResumeDraft,
  };
};
