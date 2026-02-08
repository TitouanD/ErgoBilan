/**
 * useAssessmentFlow — Encapsulates the AI report generation, finalization,
 * draft save/resume logic that was previously inlined in AppRouter.
 */

import { useState, useCallback } from 'react';
import { AIService, type GenerationPayload } from '../services/ai';
import { StorageService } from '../services/storage';
import { AdminService } from '../services/admin';
import { anonymizeData } from '../utils/anonymizer';
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
  { id: 'mandat_ref', title: 'Mandat de référencement', content: "**Motif de la demande**\nL'évaluation a été sollicitée par Mme Martin et l'équipe enseignante de l'école Jules Ferry suite à des difficultés persistantes dans le domaine scolaire, notamment concernant l'écriture manuscrite et une fatigabilité importante l'après-midi.", status: 'draft', isAiGenerated: true },
  { id: 'mandat_eval', title: "Motif de l'évaluation", content: "**Contexte**\nLéo, 9 ans, est scolarisé en CM1. Il bénéficie actuellement d'un PAP. Le bilan vise à objectiver les difficultés graphiques et à proposer des adaptations pour la suite de la scolarité.", status: 'draft', isAiGenerated: true },
  { id: 'profil', title: 'Profil occupationnel', content: "**Habitudes de vie**\nLéo est un enfant volontaire mais qui exprime une frustration face à ses échecs scolaires. À la maison, l'autonomie est acquise pour l'habillage mais les gestes fins (boutons, lacets) restent coûteux.", status: 'draft', isAiGenerated: true },
  { id: 'diagnostic', title: 'Synthèse Clinique', content: "### Analyse du profil\nL'évaluation met en évidence un **Trouble Développemental de la Coordination (TDC)** affectant de manière significative la sphère graphique.\n\n### Points clés\n- **Dysgraphie mixte** : Les scores au BHK (Vitesse à -1.2 ET et Qualité à -2.1 ET) confirment une écriture à la fois lente et coûteuse sur le plan cognitif.\n- **Fatigabilité** : Lenteur d'exécution motrice généralisée, impactant la double tâche (écouter et écrire).\n- **Impact Psychologique** : On note une anxiété de performance importante, majorant les symptômes en situation de classe.", status: 'draft', isAiGenerated: true },
  { id: 'objectifs', title: "Projet d'Intervention", content: "### Objectifs à court terme\n- Améliorer le confort graphique pour réduire les douleurs au poignet.\n- Mettre en place l'outil informatique (Clavier caché).\n\n### Objectifs à moyen terme\n- Restaurer l'estime de soi scolaire.\n- Autonomie complète dans la prise de cours informatisée.", status: 'draft', isAiGenerated: true },
  { id: 'recommandations', title: 'Préconisations', content: "### À l'école\n- **Allègement de la trace écrite** : Fournir des photocopies de cours ou permettre l'utilisation d'une tablette/ordinateur (GEVA-Sco).\n- **Tiers-temps** : À envisager pour les évaluations longues.\n\n### Suivi thérapeutique\n- Poursuite du suivi en ergothérapie axé sur :\n  - L'apprentissage du clavier caché.\n  - La gestion de la fatigue et l'ergonomie posturale.", status: 'draft', isAiGenerated: true },
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
      } else if (msg === 'TIMEOUT_AI') {
        setGenerationError("Le serveur IA ne répond pas.");
      } else {
        setGenerationError(msg || 'Erreur inconnue.');
      }
    } finally {
      setIsGenerating(false);
    }
  }, [assessment, isDemoMode, refreshProfile, toast]);

  // ------------------------------------------------------------------
  // Finalize assessment (save to Supabase + clean up)
  // ------------------------------------------------------------------
  const handleFinalize = useCallback(async () => {
    if (isDemoMode) return 'dashboard' as const;
    if (!sessionKey || !orgKey) return null;

    const patientId = assessment.patient.id;
    if (!patientId) {
      toast.error('Erreur ID Patient.');
      return null;
    }

    setIsGenerating(true);
    try {
      const flatResults: Record<string, ScoreResult> = {};
      const testNames: string[] = [];

      Object.entries(assessment.tests).forEach(([tId, subtests]) => {
        const catalogDef = catalog.flatMap((c) => c.tests).find((t) => t.id === tId);
        testNames.push(catalogDef ? catalogDef.name : tId);
        Object.entries(subtests).forEach(([, res]) => {
          flatResults[(res as ScoreResult & { id?: string }).id ?? tId] = res as ScoreResult;
        });
      });

      // Build flat results properly
      const flatResultsClean: Record<string, ScoreResult> = {};
      Object.entries(assessment.tests).forEach(([tId, subtests]) => {
        const catalogDef = catalog.flatMap((c) => c.tests).find((t) => t.id === tId);
        if (testNames.length === 0) testNames.push(catalogDef ? catalogDef.name : tId);
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
        patientName: `${assessment.patient.firstName} ${assessment.patient.lastName}`,
        sections: assessment.sections,
      };

      const currentFileIndex = patientFiles.findIndex((f) => f.id === patientId);
      const currentFile: PatientFile =
        currentFileIndex === -1
          ? { id: patientId, patient: assessment.patient, reports: [], sessions: [], lastInteraction: new Date().toISOString(), archived: false }
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
  }, [assessment, sessionKey, orgKey, isDemoMode, catalog, patientFiles, loadData, toast]);

  // ------------------------------------------------------------------
  // Save draft and quit
  // ------------------------------------------------------------------
  const handleSaveAndQuit = useCallback(async () => {
    if (sessionKey && assessment.patient.id) {
      try {
        const draftData = {
          patient: assessment.patient,
          tests: assessment.tests,
          observations: assessment.observations,
          synthesis: assessment.synthesis,
          sections: assessment.sections,
          step: assessment.step,
          timestamp: new Date().toISOString(),
        };
        await StorageService.saveDraft(draftData, sessionKey);
        toast.success('Brouillon sauvegardé');
      } catch (e) {
        Logger.error('DB', 'Save error', e);
      }
    }
    assessment.resetAssessment();
  }, [assessment, sessionKey, toast]);

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
