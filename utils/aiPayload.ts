/**
 * aiPayload.ts — builds the (not yet pseudonymized) inputs sent to the AI.
 *
 * Always pass the result through `anonymizeDeep(payload, patient)` before
 * sending it: this module only formats data, it does not remove identifiers.
 */

import type { ClinicalSynthesis, Observations, Patient, PatientAssessment, TestData } from '../types';
import type { InitialReportPayload, ReevaluationPayload } from '../services/ai';
import { CUSTOM_OBSERVATIONS_TEST_ID, type CatalogIndex, getScaleType, getSubtestName, getTestName } from './catalogIndex';
import { type DeltaEntry, buildEvolutionSummaryText, buildScoresSummaryText } from './reevaluationHelpers';
import { htmlToPlainText, sectionToHtml } from './reportContent';
import { getPercentileFromScore, getZFromScore, hasScoreValue } from './scoring';

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
    line('Suivi par la PCO', [p.pcoFollowup, p.pcoFollowupDate].filter(Boolean).join(', date : ')),
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
    line("Lecture de l'heure", p.timeSpaceClockReading),
    line('Observations temps/espace', p.timeSpaceObservations),
    line('Orientation temps/espace', p.timeSpace),
    '',
    '--- ÉCRITURE & OUTILS ---',
    line("Difficultés d'écriture", p.writingIssues),
    line("Douleur à l'écriture", p.writingPain),
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
    p.siblings?.length ? line('Fratrie', `${p.siblings.length} enfant(s) dans la fratrie`) : '',
    '',
    '--- NOTES LIBRES ---',
    line('Remarques', p.remarks),
    line("Notes d'entretien", p.interviewNotes),
    p.goals?.length ? `Objectifs exprimés par la famille: ${p.goals.join(', ')}` : '',
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
        const testName = testId === CUSTOM_OBSERVATIONS_TEST_ID ? 'Observations libres' : getTestName(index, testId);
        return `[${getSubtestName(index, testId, subId, res.customLabel)} — ${testName}] ${res.observation!.trim()}`;
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

/** Structured scores for the diagnostic prompt, including the scale and derived z / percentile. */
export const buildScoresEvidence = (tests: TestData, index: CatalogIndex) =>
  Object.entries(tests).flatMap(([testId, subtests]) =>
    Object.entries(subtests)
      .filter(([, res]) => hasScoreValue(res))
      .map(([subtestId, res]) => {
        const scale = getScaleType(index, testId, subtestId);
        const z = getZFromScore(res, scale);
        return {
          testId,
          testName: getTestName(index, testId),
          subtestId,
          subtestName: getSubtestName(index, testId, subtestId, res.customLabel),
          type: res.unit === 'qualitative' ? 'qualitative' : 'quantitative',
          scale,
          value: res.value || null,
          unit: res.unit || null,
          zScore: z !== null ? parseFloat(z.toFixed(2)) : null,
          percentile: getPercentileFromScore(res, scale),
          qualitativeLabel: res.qualitativeLabel || null,
          observation: res.observation || null,
        };
      }),
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
/** Sections of the previous report reused as context for the re-evaluation. */
const PREVIOUS_CONTEXT_SECTIONS = ['profil', 'diagnostic', 'objectifs', 'project', 'recommandations'];

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
  const previousReportContext = (input.previousAssessment?.report?.sections ?? [])
    .filter((s) => PREVIOUS_CONTEXT_SECTIONS.includes(s.id) && s.content?.trim())
    .map((s) => `[${s.title}]\n${htmlToPlainText(sectionToHtml(s))}`)
    .join('\n\n');

  return {
    childContext: [
      `${buildChildContext(input.patient)} Classe : ${input.patient.classLevel || 'non renseignée'}.`,
      prevDate ? `Bilan initial réalisé : ${prevDate}` : '',
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
