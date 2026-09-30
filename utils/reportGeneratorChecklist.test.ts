/**
 * Cases of the manual checklists of #53 (A1–A5) and #54 (B1–B4), on the demo
 * records and catalogue, with the demo transport or a fake one (no network).
 */
import { describe, expect, it } from 'vitest';
import { DEMO_CATALOG } from '../data/demoCatalog';
import { DEMO_PATIENTS } from '../data/demoData';
import { createDemoTransport } from '../data/demoReport';
import type { Patient, PatientAssessment, ReportSection } from '../types';
import { initialPatient } from './assessmentInProgress';
import { buildCatalogIndex } from './catalogIndex';
import {
  type AIRequest,
  type AITransport,
  type InitialReportInput,
  type ReevaluationInput,
  createReportGenerator,
  findInitialSuspectTerms,
  findReevaluationSuspectTerms,
} from './reportGenerator';
import { applySuspectTermDecisions } from './suspectTerms';

const index = buildCatalogIndex(DEMO_CATALOG);
const NOW = new Date(2026, 8, 29);

const elya = (patient: Partial<Patient> = {}): InitialReportInput => ({
  patient: { ...initialPatient, ...DEMO_PATIENTS.ELYA.patient, id: 'demo-elya', ...patient },
  observations: DEMO_PATIENTS.ELYA.observations,
  tests: DEMO_PATIENTS.ELYA.tests,
  synthesis: { diagnosticInput: 'Fragilité de la motricité fine.', projectInput: '', recommendationsInput: '' },
  index,
});

/** SARAH's initial assessment, as the demo storage builds it, at a fixed date. */
const sarahInitial = DEMO_PATIENTS.SARAH.reports[0];
const sarah = (patient: Partial<Patient> = {}): ReevaluationInput => ({
  patient: { ...initialPatient, ...DEMO_PATIENTS.SARAH.patient, id: 'demo-sarah', ...patient },
  previousAssessment: {
    id: sarahInitial.id,
    date: '2026-07-30T10:00:00.000Z',
    kind: 'initial',
    hasFormalReport: true,
    testName: 'Bilan initial',
    tests: sarahInitial.tests,
    report: { status: 'completed', patientName: sarahInitial.patientName, sections: sarahInitial.sections as ReportSection[] },
  } as PatientAssessment,
  tests: DEMO_PATIENTS.SARAH.reports[1].tests,
  index,
});

const B1_NOTES = 'Le mercredi, elle va chez sa tante Josette. Suivie par Mme lefort.';

/** Date markers of a payload, as sent: `{{DATE_n}}` followed by its duration. */
const dateMarkers = (request: AIRequest): string[] => JSON.stringify(request.payload).match(/\{\{DATE_\d+\}\} \([^)]*\)/g) ?? [];

/**
 * Fake transport of an AI that quotes every date it received, once with the
 * duration and once without, in every field of its answer.
 */
const quotingTransport = (fields: Record<AIRequest['task'], string[]>) => {
  const requests: AIRequest[] = [];
  const transport: AITransport = async (request) => {
    requests.push(request);
    const markers = dateMarkers(request);
    const quoted = markers.map((m) => `depuis ${m}, vu le ${m.replace(/ \(.*$/, '')}`).join(' ; ');
    const answer = Object.fromEntries(fields[request.task].map((f) => [f, `{{PATIENT_PRENOM}} : ${quoted || 'aucune date'}.`]));
    return { text: JSON.stringify(answer), generationId: 'gen-1' };
  };
  return { transport, requests };
};

const FIELDS: Record<AIRequest['task'], string[]> = {
  report_bio: ['mandat_referencement', 'mandat_evaluation', 'profil_occupationnel'],
  report_diagnostic: ['synthese_diagnostic', 'objectifs_generaux', 'projet_accompagnement', 'recommandations'],
  report_reevaluation: ['resume_initial', 'evolution_commentee', 'conclusion', 'recommandations'],
  extract_style_feedback: [],
};

const NO_MARKER = /\{\{|\}\}|il y a \d|ce mois-ci/;

describe('#53 A1 : bilan initial en démo', () => {
  it('7 sections ; le profil occupationnel commence par le prénom du patient du bilan', async () => {
    const report = await createReportGenerator(createDemoTransport(0)).generateInitial(elya({ firstName: 'Nina' }));
    expect(report.sections.map((s) => s.id)).toEqual([
      'mandat_ref',
      'mandat_eval',
      'profil',
      'diagnostic',
      'objectifs',
      'project',
      'recommandations',
    ]);
    expect(report.sections.every((s) => s.content.length > 0 && !NO_MARKER.test(s.content))).toBe(true);
    expect(report.sections[2].content).toMatch(/^Nina est une jeune fille/);
  });
});

describe('#53 A2 : réévaluation en démo (SARAH)', () => {
  it('4 sections ; la conclusion commence par « Sarah »', async () => {
    const sections = await createReportGenerator(createDemoTransport(0), { now: () => NOW }).generateReevaluation(sarah());
    expect(sections.map((s) => s.title)).toEqual(['Rappel du bilan initial', 'Évolution des résultats', 'Conclusion', 'Préconisations']);
    expect(sections.find((s) => s.id === 'conclusion')!.content).toMatch(/^<p>Sarah progresse/);
    expect(sections.every((s) => !NO_MARKER.test(s.content))).toBe(true);
  });
});

describe('#53 A3 : dates du bilan initial', () => {
  it('suivi daté et date PCO partent en marqueurs et reviennent en vraies dates, sans marqueur ni durée', async () => {
    const input = elya({ pcoFollowup: 'Oui', pcoFollowupDate: '12/01/2025' });
    const { transport, requests } = quotingTransport(FIELDS);
    const report = await createReportGenerator(transport, { now: () => NOW }).generateInitial(input);

    const sent = JSON.stringify(requests);
    for (const date of ['08/2025', '12/2024', '01/2026', '12/01/2025', '2018-10-12']) expect(sent).not.toContain(date);
    expect(dateMarkers(requests[0]).length).toBeGreaterThanOrEqual(4);

    const text = report.sections.map((s) => s.content).join('\n');
    expect(text).not.toMatch(NO_MARKER);
    for (const date of ['08/2025', '12/2024', '01/2026', '12/01/2025']) expect(text).toContain(date);
    expect(report.sections[2].content).toMatch(/^Elya : /);
  });
});

describe('#53 A4 : dates de la réévaluation', () => {
  it('rappel et évolution citent la vraie date du bilan initial, sans marqueur', async () => {
    const { transport, requests } = quotingTransport(FIELDS);
    const sections = await createReportGenerator(transport, { now: () => NOW }).generateReevaluation(sarah());

    expect(JSON.stringify(requests)).not.toMatch(/07\/2026|2026-07-30|11\/2025/);
    for (const id of ['resume_initial', 'evolution']) {
      const content = sections.find((s) => s.id === id)!.content;
      expect(content).toContain('07/2026');
      expect(content).not.toMatch(NO_MARKER);
    }
  });
});

describe('#53 A5 : style appris à la finalisation', () => {
  it('une section corrigée part anonymisée vers extract_style_feedback, avec les préférences existantes', async () => {
    const report = await createReportGenerator(createDemoTransport(0)).generateInitial(elya());
    const edited = report.sections.map((s) => (s.id === 'profil' ? { ...s, content: `${s.content} Elya adore la boxe.` } : s));
    const requests: AIRequest[] = [];
    const sent = await createReportGenerator(
      async (r) => {
        requests.push(r);
        return { text: '{}' };
      },
      { now: () => NOW },
    ).learnStyle({ patient: elya().patient, sections: edited, index, existingPreferences: '{"global":"Phrases courtes."}' });

    expect(sent).toBe(true);
    expect(requests.map((r) => r.task)).toEqual(['extract_style_feedback']);
    const payload = requests[0].payload as { diffs: Array<{ sectionId: string; corrected: string }>; existingPreferences: string };
    expect(payload.diffs.map((d) => d.sectionId)).toEqual(['profil']);
    expect(payload.diffs[0].corrected).toContain('{{PATIENT_PRENOM}} adore la boxe.');
    expect(JSON.stringify(payload)).not.toContain('Elya');
    expect(payload.existingPreferences).toBe('{"global":"Phrases courtes."}');
  });
});

describe('#54 B1–B3 : noms repérés dans le texte libre (bilan initial démo)', () => {
  it('B1 : « Josette » et « lefort » repérés dans les notes d’entretien, rien d’autre', () => {
    expect(findInitialSuspectTerms(elya({ interviewNotes: B1_NOTES }), NOW)).toEqual(['Josette', 'lefort']);
  });

  it('B2 : aucun mot repéré sur les dossiers de démo ordinaires', () => {
    expect(findInitialSuspectTerms(elya(), NOW)).toEqual([]);
    const noObservations = { anamnese: '', motricite: '', coordination: '', spatial: '', graphique: '' };
    expect(
      findInitialSuspectTerms({ ...elya(), patient: sarah().patient, observations: noObservations, tests: sarahInitial.tests }, NOW),
    ).toEqual([]);
  });

  it('B3 : Josette masqué, lefort autorisé ; plus rien de repéré ensuite, Josette ne part pas et revient dans le rapport', async () => {
    const input = elya({ interviewNotes: B1_NOTES });
    const patient = { ...input.patient, ...applySuspectTermDecisions(input.patient, { masked: ['Josette'], allowed: ['lefort'] }) };
    const next = { ...input, patient };
    expect(findInitialSuspectTerms(next, NOW)).toEqual([]);

    const requests: AIRequest[] = [];
    const report = await createReportGenerator(
      async (r) => {
        requests.push(r);
        return {
          text: JSON.stringify({ profil_occupationnel: 'Le mercredi, {{PERSONNE_1}} garde {{PATIENT_PRENOM}}.' }),
          generationId: 'g',
        };
      },
      { now: () => NOW },
    ).generateInitial(next);
    const sent = JSON.stringify(requests[0].payload);
    expect(sent).not.toContain('Josette');
    expect(sent).toContain('tante {{PERSONNE_1}}');
    expect(sent).toContain('Mme lefort');
    expect(report.sections.find((s) => s.id === 'profil')!.content).toBe('Le mercredi, Josette garde Elya.');
  });
});

describe('#54 B4 : réévaluation démo (SARAH)', () => {
  it('rien de repéré sur le dossier ordinaire', () => {
    expect(findReevaluationSuspectTerms(sarah(), NOW)).toEqual([]);
  });

  it('un nom du bilan initial est repéré, puis plus après un choix', () => {
    const input = sarah();
    const withName = {
      ...input,
      previousAssessment: {
        ...input.previousAssessment!,
        report: { sections: [{ id: 'diagnostic', title: 'Diagnostic', content: 'Suivie avec Mme Bernard.', status: 'validated' }] },
      } as PatientAssessment,
    };
    expect(findReevaluationSuspectTerms(withName, NOW)).toEqual(['Bernard']);
    expect(findReevaluationSuspectTerms({ ...withName, patient: { ...input.patient, aiAllowedTerms: ['Bernard'] } }, NOW)).toEqual([]);
  });
});
