/**
 * useAssessmentFlow — Encapsulates the AI report generation, finalization,
 * draft save/resume logic that was previously inlined in AppRouter.
 */

import { useState, useCallback } from 'react';
import { AIService, type GenerationPayload, type GenerationResult } from '../services/ai';
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
  PatientAssessment,
  ReportSection,
  PatientFile,
  ScoreResult,
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
  reportType: 'initial' | 'reevaluation';
  step: number;
  setSections: (s: ReportSection[]) => void;
  setReportType: (t: 'initial' | 'reevaluation') => void;
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
    id: 'project',
    title: "Projet d'accompagnement",
    content: "- Suivi en ergotherapie individualise axe sur la graphomotricite et la posture a l'ecrit.\n- Travail sur la planification motrice et la gestion de la fatigue lors des taches ecrites.\n- Collaboration avec l'equipe enseignante pour la mise en oeuvre des adaptations en classe.\n- Reevaluation des acquis a 6 mois.",
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

      // ── Build catalog lookup maps FIRST (needed for readable subtest observation labels) ──
      const testNameById = new Map<string, string>();
      const subtestNameByTestAndId = new Map<string, string>();
      catalog.forEach((category) => {
        category.tests.forEach((test) => {
          testNameById.set(test.id, test.name);
          (test.subtests || []).forEach((subtest: any) => {
            subtestNameByTestAndId.set(`${test.id}:${subtest.id}`, subtest.name || subtest.id);
          });
        });
      });

      // ── Helper: only include line if value is meaningful ──
      const line = (label: string, value: string | undefined | null): string => {
        const v = (value || '').trim();
        return v && v !== '?' && v !== '-' ? `${label}: ${v}` : '';
      };

      const tracking =
        p.medicalTracking?.map((t) => {
          let entry = `- ${t.name || '-'}${t.profession ? ` (${t.profession})` : t.type ? ` (${t.type})` : ''}`;
          if (t.assessmentDate?.trim()) entry += `, bilan: ${t.assessmentDate}`;
          if (t.since?.trim()) entry += `, début: ${t.since}`;
          if (t.frequency?.trim()) entry += `, périodicité: ${t.frequency}`;
          if (t.sessionCount?.trim()) entry += `, ${t.sessionCount} séances`;
          if (t.endDate?.trim()) entry += ` (fin: ${t.endDate})`;
          if (t.reason?.trim()) entry += `. Objectif: ${t.reason}`;
          return entry;
        }).join('\n') ||
        'Aucun suivi renseigné';

      const schoolStr = p.school && p.classLevel && p.school.toLowerCase().includes(p.classLevel.toLowerCase())
        ? p.school
        : `${p.school || ''} ${p.classLevel || ''}`.trim();

      const siblingsStr = p.siblings?.length ? `${p.siblings.length} enfant(s) dans la fratrie` : '';

      const rawQ = [
        line('Motif de consultation', p.reason),
        line('Attentes de la famille', p.familyExpectations),
        line('Priorités thérapeutiques', p.priorities),
        '',
        '--- SCOLARITÉ ---',
        line('École / Classe', schoolStr),
        line('Plan de soin scolaire', p.carePlan),
        line('Attention scolaire', p.schoolAttention),
        line('Aménagements en place', p.schoolAccommodations),
        line('Difficultés scolaires', p.schoolDifficulties),
        line('Précisions difficultés scolaires', p.schoolDifficultiesOther),
        p.avs === 'OUI' ? [
          line('AVS', `${p.avsHours || '?'}h`),
          line('Missions AVS', p.avsMissions),
          line('Détail AVS', p.avsDetails),
        ].filter(Boolean).join('\n') : '',
        '',
        '--- MÉDICAL ---',
        line('Médecin prescripteur', p.prescribingDoctor),
        line('Profession prescripteur', p.prescribingDoctorProfession),
        line('Diagnostic médical', p.medicalDiagnosis),
        line('Traitements', p.medicalTreatments),
        line('Suivi médical', p.medicalFollowup),
        `Suivi paramédical:\n${tracking}`,
        '',
        '--- DÉVELOPPEMENT ---',
        line('Grossesse / Naissance', p.pregnancyBirth),
        line('Développement moteur', p.developmentMotor),
        line('Âge de marche', p.walkingAge),
        line('Quatre pattes', p.crawlingFourPattes || p.crawling),
        line('Ramper', p.crawlingRamper),
        line('Développement du langage', p.developmentLanguage),
        line('Statut langage actuel', p.languageStatus),
        line('Propreté', p.cleanliness),
        line('Latéralité', p.handDominance),
        '',
        '--- VIE QUOTIDIENNE & AUTONOMIE ---',
        line('Repas', p.meals),
        line('Habitudes alimentaires', p.eatingHabits),
        line('Autonomie habillage', p.dressingAutonomy),
        line('Habillage', p.dressing),
        line('Boutons', p.clothingButtons),
        line('Lacets', p.clothingLaces),
        line('Zippers/fermetures', p.clothingZippers),
        line('Observations habillage', p.dressingObservations),
        line('Continence', p.continence),
        line('Observations hygiène', p.hygieneObservations),
        line('Lecture de l\'heure', p.timeSpaceClockReading),
        line('Observations temps/espace', p.timeSpaceObservations),
        line('Orientation temps/espace', p.timeSpace),
        '',
        '--- ÉCRITURE & OUTILS ---',
        line('Difficultés d\'écriture', p.writingIssues),
        line('Douleur à l\'écriture', p.writingPain),
        line('Utilisation des outils', p.toolUsage),
        line('Outils / ciseaux', p.toolScissors),
        line('Observations écriture autres', p.writingOther),
        '',
        '--- COMPORTEMENT & SOCIAL ---',
        line('Profil sensoriel', p.sensory),
        line('Sommeil', p.sleepStatus || p.sleep),
        line('Comportement global', p.emotionalGlobalTags),
        line('Émotions & réactions', p.emotionalReactionTags),
        line('Régulation émotionnelle', p.emotionalNotes || p.emotionalRegulation),
        line('Comportement social', p.socialBehavior),
        '',
        '--- CONTEXTE FAMILIAL ---',
        line('Garde', `${p.guardArrangement || ''} ${p.guardMode || ''}`.trim()),
        siblingsStr ? line('Fratrie', siblingsStr) : '',
        '',
        '--- NOTES LIBRES ---',
        line('Remarques', p.remarks),
        line('Notes d\'entretien', p.interviewNotes),
        p.goals?.length ? `Objectifs exprimés par la famille: ${p.goals.join(', ')}` : '',
      ].filter(Boolean).join('\n');

      // ── Build observations (clinical notes + legacy + per-subtest with readable labels) ──
      const clinicalNotes = p.interviewNotes || '';
      const legacyObs = [assessment.observations.anamnese, assessment.observations.motricite, assessment.observations.graphique]
        .filter(Boolean).join('\n');

      const subtestObs: string[] = [];
      Object.entries(assessment.tests).forEach(([testId, subtests]) => {
        Object.entries(subtests).forEach(([subId, res]) => {
          if (res.observation?.trim()) {
            const subtestName = subtestNameByTestAndId.get(`${testId}:${subId}`) || subId;
            const testName = testNameById.get(testId) || testId;
            subtestObs.push(`[${subtestName} — ${testName}] (id:${subId}) ${res.observation.trim()}`);
          }
        });
      });

      const rawObs = [
        clinicalNotes ? `Notes cliniques d'entretien:\n${clinicalNotes}` : '',
        legacyObs ? `Observations générales: ${legacyObs}` : '',
        subtestObs.length > 0 ? `Observations par épreuve:\n${subtestObs.join('\n')}` : '',
      ].filter(Boolean).join('\n\n') || 'RAS';

      const scoresEvidence = Object.entries(assessment.tests).flatMap(([testId, subtests]) =>
        Object.entries(subtests).map(([subtestId, res]) => {
          const qualitative = !!(res.qualitativeCode || res.qualitativeLabel);
          const source = res.derived?.source || (res.scoreSource === 'auto' ? 'auto' : 'manual');
          const normFound = qualitative ? null : source === 'auto';
          return {
            testId,
            testName: testNameById.get(testId) || testId,
            subtestId,
            subtestName: subtestNameByTestAndId.get(`${testId}:${subtestId}`) || subtestId,
            type: qualitative ? 'qualitative' : 'quantitative',
            raw: res.raw || null,
            standard: res.standard || null,
            percentile: res.percentile || null,
            zScore: typeof res.zScore === 'number' && Number.isFinite(res.zScore) ? res.zScore : null,
            qualitativeCode: res.qualitativeCode || null,
            qualitativeLabel: res.qualitativeLabel || null,
            observation: res.observation || null,
            source,
            norm_found: normFound,
            review_state: res.reviewState || null,
            reviewed_at: res.reviewedAt || null,
          };
        }),
      );

      const payload: GenerationPayload = {
        safeQuestionnaire: anonymizeData(rawQ, p).text,
        safeObservations: anonymizeData(rawObs, p).text,
        scoresEvidence,
        childContext: `L'enfant est ${genderString} de ${p.age}.`,
        synthesis: assessment.synthesis,
      };

      const { sections, reformulatedObservations }: GenerationResult =
        await AIService.generateFullReport(payload, assessment.patient);

      // Patch subtest observations with AI-reformulated versions (for PDF annex table)
      if (Object.keys(reformulatedObservations).length > 0) {
        const updatedTests: TestData = {};
        Object.entries(assessment.tests).forEach(([testId, subtests]) => {
          updatedTests[testId] = {};
          Object.entries(subtests).forEach(([subId, result]) => {
            updatedTests[testId][subId] = reformulatedObservations[subId]
              ? { ...result, observation: reformulatedObservations[subId] }
              : result;
          });
        });
        assessment.setTests(updatedTests);
      }

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

      const newAssessment: PatientAssessment = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        kind: assessment.reportType,
        hasFormalReport: true,
        testName: testNames.join(', ') || 'Bilan',
        results: flatResultsClean,
        report: {
          status: 'completed',
          patientName: `${patientSnapshot.firstName} ${patientSnapshot.lastName}`,
          sections: assessment.sections,
        },
      };

      const currentFileIndex = patientFiles.findIndex((f) => f.id === patientId);
      const currentFile: PatientFile =
        currentFileIndex === -1
          ? { id: patientId, patient: patientSnapshot, assessments: [], lastInteraction: new Date().toISOString(), archived: false }
          : patientFiles[currentFileIndex];

      const updatedFile: PatientFile = {
        ...currentFile,
        lastInteraction: new Date().toISOString(),
        assessments: [newAssessment, ...(currentFile.assessments || [])],
      };

      await StorageService.saveFile(updatedFile, orgKey);
      if (assessment.reportType === 'initial') {
        try {
          const dueAt = new Date(newAssessment.date);
          dueAt.setMonth(dueAt.getMonth() + 6);
          await StorageService.upsertPatientFollowup({
            patientId,
            status: 'upcoming',
            dueAt: dueAt.toISOString(),
            note: 'Rappel genere apres bilan initial',
          });
        } catch {
          // Follow-up status is best effort and must not block finalization
        }
      } else if (assessment.reportType === 'reevaluation') {
        try {
          await StorageService.markFollowupCompleted(patientId);
        } catch {
          // Follow-up status is best effort and must not block finalization
        }
      }
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
        reportType: assessment.reportType,
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
