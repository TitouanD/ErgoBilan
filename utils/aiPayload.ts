/**
 * aiPayload.ts — builds the (not yet anonymized) inputs sent to the AI.
 *
 * Only `utils/reportGenerator.ts` calls it, and anonymizes the result before
 * sending it: this module only formats data, it does not remove identifiers.
 */

import type { ClinicalSynthesis, Observations, Patient, PatientAssessment, TestData } from '../types';
import { type CatalogIndex, getSubtestName, getTestName } from './catalogIndex';
import { type DeltaEntry, buildEvolutionSummaryText, buildScoresSummaryText } from './reevaluationHelpers';
import { htmlToPlainText, sectionToHtml } from './reportContent';
import { resolveScores } from './resolvedScore';

/** Inputs of an initial report (anonymized before sending). */
export interface InitialReportPayload {
  questionnaire: string;
  observations: string;
  scoresEvidence: unknown;
  childContext: string;
  synthesis: ClinicalSynthesis;
}

/** Inputs of a re-evaluation (anonymized before sending). */
export interface ReevaluationPayload {
  childContext: string;
  previousScoresSummary: string;
  newScoresSummary: string;
  evolutionSummary: string;
  previousReportContext?: string;
}

/** `Label: value`, or '' when the value is empty / a placeholder. */
const line = (label: string, value: string | undefined | null): string => {
  const v = (value || '').trim();
  return v && v !== '?' && v !== '-' ? `${label}: ${v}` : '';
};

/** Anamnesis / questionnaire as labelled lines grouped by theme. */
export const buildQuestionnaireText = (p: Patient): string => {
  const tracking =
    p.medicalTracking
      ?.map((t) => {
        let entry = `- ${t.name || '-'}${t.profession ? ` (${t.profession})` : t.type ? ` (${t.type})` : ''}`;
        if (t.assessmentDate?.trim()) entry += `, bilan: ${t.assessmentDate}`;
        if (t.since?.trim()) entry += `, début: ${t.since}`;
        if (t.frequency?.trim()) entry += `, périodicité: ${t.frequency}`;
        if (t.sessionCount?.trim()) entry += `, ${t.sessionCount} séances`;
        if (t.endDate?.trim()) entry += ` (fin: ${t.endDate})`;
        if (t.reason?.trim()) entry += `. Objectif: ${t.reason}`;
        return entry;
      })
      .join('\n') || 'Aucun suivi renseigné';

  const school =
    p.school && p.classLevel && p.school.toLowerCase().includes(p.classLevel.toLowerCase())
      ? p.school
      : `${p.school || ''} ${p.classLevel || ''}`.trim();

  return [
    line('Motif de consultation', p.reason),
    line('Attentes de la famille', p.familyExpectations),
    line('Priorités thérapeutiques', p.priorities),
    '',
    '--- SCOLARITÉ ---',
    line('École / Classe', school),
    line('Redoublement', [p.schoolRepeatYear, p.schoolRepeatClass].filter(Boolean).join(', classe : ')),
    line('Plan de soin scolaire', p.carePlan),
    line('Attention scolaire', p.schoolAttention),
    line('Aménagements en place', p.schoolAccommodations),
    line('Difficultés scolaires', p.schoolDifficulties),
    line('Précisions difficultés scolaires', p.schoolDifficultiesOther),
    p.avs === 'OUI'
      ? [line('AVS', `${p.avsHours || '?'}h`), line('Missions AVS', p.avsMissions), line('Détail AVS', p.avsDetails)]
          .filter(Boolean)
          .join('\n')
      : '',
    '',
    '--- MÉDICAL ---',
    line('Médecin prescripteur', p.prescribingDoctor),
    line('Profession prescripteur', p.prescribingDoctorProfession),
    line('Diagnostic médical', p.medicalDiagnosis),
    line('Traitements', p.medicalTreatments),
    line('Suivi par la PCO', [p.pcoFollowup, p.pcoFollowupDate].filter(Boolean).join(', depuis le ')),
    line('Suivi médical', p.medicalFollowup),
    `Suivi paramédical:\n${tracking}`,
    '',
    '--- DÉVELOPPEMENT ---',
    line('Grossesse / Naissance', p.pregnancyBirth),
    line('Déroulé du développement moteur', p.motorDevelopmentTags),
    line('Développement moteur', p.developmentMotor),
    line('Âge de marche', p.walkingAge),
    line('Quatre pattes', p.crawlingFourPattes || p.crawling),
    line('Ramper', p.crawlingRamper),
    line('Activité sportive extra-scolaire', p.extracurricularSport),
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
    line("Lecture de l'heure", p.timeSpaceClockReading),
    line('Observations temps/espace', p.timeSpaceObservations),
    line('Orientation temps/espace', p.timeSpace),
    '',
    '--- APPRENTISSAGES ---',
    line('Apprentissages', p.learningNotes),
    line('Mémorisation', p.schoolMemory),
    line('Organisation', p.schoolOrganization),
    line('Devoirs', p.homeworkHabits),
    line('Utilisation des outils', p.toolUsage),
    '',
    '--- ÉCRITURE & OUTILS ---',
    line("Difficultés d'écriture", p.writingIssues),
    line("Douleur à l'écriture", p.writingPain),
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
    line('Garde', [p.guardArrangement, p.guardMode].filter(Boolean).join(' ; ')),
    p.siblings?.length ? line('Fratrie', `${p.siblings.length} enfant(s) dans la fratrie`) : '',
    '',
    '--- NOTES LIBRES ---',
    line('Remarques', p.remarks),
    line("Notes d'entretien", p.interviewNotes),
    p.goals?.length ? `Objectifs exprimés par la famille: ${p.goals.join(' ; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

/** Clinical notes + per-subtest observations with readable labels. */
export const buildObservationsText = (patient: Patient, observations: Observations, tests: TestData, index: CatalogIndex): string => {
  const legacy = [observations.anamnese, observations.motricite, observations.graphique].filter(Boolean).join('\n');
  const perSubtest = Object.entries(tests).flatMap(([testId, subtests]) =>
    Object.entries(subtests)
      .filter(([, res]) => res.observation?.trim())
      .map(([subId, res]) => {
        const testName = getTestName(index, testId);
        const subtestName = getSubtestName(index, testId, subId, res.customLabel);
        const label = subtestName === testName ? testName : `${subtestName} — ${testName}`;
        return `[${label}] ${res.observation!.trim()}`;
      }),
  );
  return (
    [
      patient.interviewNotes ? `Notes cliniques d'entretien:\n${patient.interviewNotes}` : '',
      legacy ? `Observations générales: ${legacy}` : '',
      perSubtest.length > 0 ? `Observations par épreuve:\n${perSubtest.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n') || 'RAS'
  );
};

/**
 * Structured scores for the diagnostic prompt, including the scale and derived z / percentile.
 * z and percentile are read in the common direction (negative = difficulty); `lecture` flags a
 * scale where the typed value runs the other way (#122).
 */
export const buildScoresEvidence = (tests: TestData, index: CatalogIndex) =>
  resolveScores(tests, index).flatMap((test) =>
    test.subtests.map((r) => ({
      testId: r.testId,
      testName: r.testName,
      subtestId: r.subtestId,
      subtestName: r.label,
      type: r.score.unit === 'qualitative' ? 'qualitative' : 'quantitative',
      scale: r.scale,
      value: r.score.value || null,
      unit: r.score.unit || null,
      zScore: r.z !== null ? parseFloat(r.z.toFixed(2)) : null,
      percentile: r.pct,
      qualitativeLabel: r.score.qualitativeLabel || null,
      observation: r.score.observation || null,
      ...(r.higherIsWorse
        ? { lecture: 'note élevée = difficulté ; zScore et percentile déjà inversés (négatif ou bas = difficulté)' }
        : {}),
    })),
  );

export const buildChildContext = (patient: Patient): string => {
  const who = patient.gender === 'F' ? 'une fille' : patient.gender === 'M' ? 'un garçon' : 'un enfant';
  return `L'enfant est ${who} de ${patient.age || 'âge non renseigné'}.`;
};

export const buildInitialReportPayload = (input: {
  patient: Patient;
  observations: Observations;
  tests: TestData;
  synthesis: ClinicalSynthesis;
  index: CatalogIndex;
}): InitialReportPayload => ({
  questionnaire: buildQuestionnaireText(input.patient),
  observations: buildObservationsText(input.patient, input.observations, input.tests, input.index),
  scoresEvidence: buildScoresEvidence(input.tests, input.index),
  childContext: buildChildContext(input.patient),
  synthesis: input.synthesis,
});

const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: '2-digit', year: 'numeric' };
/**
 * Sections of the reference report reused as context for the re-evaluation:
 * the clinical sections of an initial assessment, or the conclusion and
 * recommendations of a previous re-evaluation (decision of 2026-09-30, #70).
 */
const PREVIOUS_CONTEXT_SECTIONS: Record<PatientAssessment['kind'], string[]> = {
  initial: ['profil', 'diagnostic', 'objectifs', 'project', 'recommandations'],
  reevaluation: ['conclusion', 'recommandations_reev'],
};

export const buildReevaluationPayload = (input: {
  patient: Patient;
  previousAssessment: PatientAssessment | null;
  previousTests: TestData;
  newTests: TestData;
  deltas: DeltaEntry[];
  index: CatalogIndex;
  reevaluationDate?: Date;
}): ReevaluationPayload => {
  const prevDate = input.previousAssessment?.date
    ? new Date(input.previousAssessment.date).toLocaleDateString('fr-FR', MONTH_YEAR)
    : undefined;
  const reevDate = (input.reevaluationDate ?? new Date()).toLocaleDateString('fr-FR', MONTH_YEAR);
  const afterReevaluation = input.previousAssessment?.kind === 'reevaluation';
  const contextSections = PREVIOUS_CONTEXT_SECTIONS[afterReevaluation ? 'reevaluation' : 'initial'];
  const previousReportContext = (input.previousAssessment?.report?.sections ?? [])
    .filter((s) => contextSections.includes(s.id) && s.content?.trim())
    .map((s) => `[${s.title}]\n${htmlToPlainText(sectionToHtml(s))}`)
    .join('\n\n');

  return {
    childContext: [
      `${buildChildContext(input.patient)} Classe : ${input.patient.classLevel || 'non renseignée'}.`,
      prevDate ? `${afterReevaluation ? 'Réévaluation précédente réalisée' : 'Bilan initial réalisé'} : ${prevDate}` : '',
      `Réévaluation réalisée : ${reevDate}`,
    ]
      .filter(Boolean)
      .join(' | '),
    previousScoresSummary: buildScoresSummaryText(input.previousTests, input.index, prevDate),
    newScoresSummary: buildScoresSummaryText(input.newTests, input.index, reevDate),
    evolutionSummary: buildEvolutionSummaryText(input.deltas),
    ...(previousReportContext ? { previousReportContext } : {}),
  };
};
