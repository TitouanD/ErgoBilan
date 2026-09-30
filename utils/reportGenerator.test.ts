import { describe, expect, it } from 'vitest';
import type { CategoryDef } from '../data/testCatalog';
import { createDemoTransport } from '../data/demoReport';
import type { Observations, Patient, PatientAssessment, ReportSection } from '../types';
import { initialPatient } from './assessmentInProgress';
import { buildCatalogIndex } from './catalogIndex';
import {
  type AIRequest,
  type AITransport,
  type InitialReportInput,
  createReportGenerator,
  findInitialSuspectTerms,
  findReevaluationSuspectTerms,
} from './reportGenerator';

const catalog: CategoryDef[] = [
  {
    id: 'motor',
    name: 'Motricité',
    iconKey: 'Hand',
    sortOrder: 1,
    tests: [
      {
        id: 'mabc',
        name: 'MABC-2',
        subtests: [{ id: 'dext', name: 'Dextérité Manuelle', unit: 'pts', scoreType: 'scaled', inputModel: 'numeric_4mode' }],
      },
    ],
  },
];
const index = buildCatalogIndex(catalog);
const NOW = new Date(2026, 8, 29);

const patient: Patient = {
  ...initialPatient,
  id: 'p1',
  firstName: 'Léa',
  lastName: 'Martin',
  dob: '2018-03-20',
  age: '8 ans',
  gender: 'F',
  parent1Name: 'Sophie Martin',
  school: 'École Jean Moulin',
  prescribingDoctor: 'Dr Dupont',
  pcoFollowup: 'Oui',
  pcoFollowupDate: '12/01/2025',
  interviewNotes: 'Léa dort chez sa grand-mère Josette le mercredi. Suivie en kiné depuis mars 2024.',
  aiMaskedTerms: ['Titi'],
};
const observations: Observations = {
  anamnese: 'Titi est son surnom à la maison.',
  motricite: '',
  coordination: '',
  spatial: '',
  graphique: '',
};
const tests = { mabc: { dext: { value: '7', unit: 'NS' as const, observation: 'Léa tient le crayon avec force.' } } };
const input: InitialReportInput = {
  patient,
  observations,
  tests,
  synthesis: { diagnosticInput: 'Fragilité de la motricité fine.', projectInput: '', recommendationsInput: '' },
  index,
};

/** Fake transport: records the requests and answers from a table (or throws an Error(code)). */
const fakeTransport = (answers: Partial<Record<AIRequest['task'], Array<object | string>>>) => {
  const requests: AIRequest[] = [];
  const transport: AITransport = async (request) => {
    requests.push(request);
    const next = answers[request.task]?.shift();
    if (typeof next === 'string') throw new Error(next);
    return { text: JSON.stringify(next ?? {}), generationId: request.generationId ?? 'gen-1' };
  };
  return { transport, requests };
};

const BIO = {
  mandat_referencement: 'Demande de {{MEDECIN}}.',
  mandat_evaluation: 'Évaluer {{PATIENT_PRENOM}}.',
  profil_occupationnel: '{{PATIENT_PRENOM}} aime {{PERSONNE_1}}.',
};
const DIAG = {
  synthese_diagnostic: 'Suivi PCO depuis {{DATE_1}} (il y a 1 an et 8 mois).',
  objectifs_generaux: 'o',
  projet_accompagnement: 'p',
  recommandations: 'r',
  reformulated_observations: [{ subtestId: 'dext', text: '{{PATIENT_PRENOM}} serre le crayon.' }],
};

/** Every identifier of the fixture, and every precise date, that must never leave. */
const LEAKS = ['Léa', 'Martin', 'Sophie', 'Jean Moulin', 'Dupont', 'Titi', '2018-03-20', '12/01/2025', 'mars 2024'];

describe('reportGenerator — initial report', () => {
  it('sends only anonymized payloads and re-hydrates the answer', async () => {
    const { transport, requests } = fakeTransport({ report_bio: [BIO], report_diagnostic: [DIAG] });
    const report = await createReportGenerator(transport, { now: () => NOW }).generateInitial(input);

    expect(requests.map((r) => r.task)).toEqual(['report_bio', 'report_diagnostic']);
    const sent = JSON.stringify(requests);
    for (const leak of LEAKS) expect(sent).not.toContain(leak);
    expect(sent).toContain('{{DATE_1}} (il y a 1 an et 8 mois)');
    expect(requests[1].generationId).toBe('gen-1');

    const byId = Object.fromEntries(report.sections.map((s) => [s.id, s]));
    expect(byId.mandat_ref.content).toBe('Demande de Dr Dupont.');
    expect(byId.profil.content).toBe('Léa aime Titi.');
    expect(byId.diagnostic.content).toBe('Suivi PCO depuis 12/01/2025.');
    expect(byId.recommandations.title).toBe('Recommandations');
    expect(report.reformulatedObservations).toEqual({ dext: 'Léa serre le crayon.' });
  });

  it('resumes at the diagnostic after a failure, without a new bio call', async () => {
    const { transport, requests } = fakeTransport({ report_bio: [BIO], report_diagnostic: ['TIMEOUT_AI', DIAG] });
    const generator = createReportGenerator(transport, { now: () => NOW });
    await expect(generator.generateInitial(input)).rejects.toThrow('TIMEOUT_AI');
    await generator.generateInitial(input);
    expect(requests.map((r) => r.task)).toEqual(['report_bio', 'report_diagnostic', 'report_diagnostic']);
    expect(requests[2].generationId).toBe('gen-1');
  });

  it('decodes the HTML entities of a plain-text answer (#74)', async () => {
    const withEntities = {
      ...DIAG,
      synthese_diagnostic:
        '{{PATIENT_PRENOM}}, scolaris&eacute;e &agrave; l&#39;&eacute;cole, s&#x27;investit &laquo;&nbsp;bien&nbsp;&raquo;.',
      reformulated_observations: [{ subtestId: 'dext', text: 'Pr&eacute;hension &amp; force.' }],
    };
    const { transport } = fakeTransport({ report_bio: [BIO], report_diagnostic: [withEntities] });
    const report = await createReportGenerator(transport, { now: () => NOW }).generateInitial(input);

    const diagnostic = report.sections.find((s) => s.id === 'diagnostic')!;
    expect(diagnostic.content).toBe("Léa, scolarisée à l'école, s'investit « bien ».");
    expect(diagnostic.originalContent).toBe('<p>Léa, scolarisée à l&#39;école, s&#39;investit « bien ».</p>');
    expect(report.reformulatedObservations).toEqual({ dext: 'Préhension & force.' });
  });

  it('refuses an empty answer', async () => {
    const { transport } = fakeTransport({ report_bio: [{}] });
    await expect(createReportGenerator(transport).generateInitial(input)).rejects.toThrow('AI_EMPTY_RESPONSE');
  });

  it('runs the demo answers through the same parsing and re-hydration', async () => {
    const report = await createReportGenerator(createDemoTransport(0)).generateInitial(input);
    expect(report.sections).toHaveLength(7);
    expect(report.sections.find((s) => s.id === 'profil')!.content).toMatch(/^Léa est une jeune fille/);
  });
});

describe('reportGenerator — re-evaluation', () => {
  const previousAssessment: PatientAssessment = {
    id: 'a1',
    date: '2026-02-10',
    kind: 'initial',
    hasFormalReport: true,
    tests: { mabc: { dext: { value: '5', unit: 'NS' } } },
    report: { sections: [{ id: 'diagnostic', title: 'Diagnostic', content: 'Léa, suivie par Mme Josette.', status: 'validated' }] },
  } as unknown as PatientAssessment;

  it('masks the assessment dates and escapes the re-hydrated HTML', async () => {
    const html = { ...patient, firstName: '<b>Léa</b>' };
    const { transport, requests } = fakeTransport({
      report_reevaluation: [
        {
          resume_initial: '<p>Bilan du {{DATE_1}} (il y a 7 mois) pour {{PATIENT_PRENOM}}.</p>',
          evolution_commentee: 'e',
          conclusion: 'c',
          recommandations: 'r',
        },
      ],
    });
    const sections = await createReportGenerator(transport, { now: () => NOW }).generateReevaluation({
      patient: html,
      previousAssessment,
      tests,
      index,
    });

    const payload = requests[0].payload as Record<string, string>;
    expect(payload.childContext).toContain('Bilan initial réalisé : {{DATE_1}} (il y a 7 mois)');
    expect(payload.childContext).toContain('Réévaluation réalisée : {{DATE_2}} (ce mois-ci)');
    expect(JSON.stringify(payload)).not.toMatch(/\d{2}\/2026/);
    expect(sections[0].content).toBe('<p>Bilan du 02/2026 pour &lt;b&gt;Léa&lt;/b&gt;.</p>');
    expect(sections.map((s) => s.id)).toEqual(['resume_initial', 'evolution', 'conclusion', 'recommandations_reev']);
  });

  it('lists the suspect words of the previous report context', () => {
    expect(findReevaluationSuspectTerms({ patient, previousAssessment, tests, index }, NOW)).toEqual(['Josette']);
  });
});

describe('reportGenerator — suspect words and style learning', () => {
  it('lists the names left in the free text, not the masked or allowed ones', () => {
    expect(findInitialSuspectTerms(input, NOW)).toEqual(['Josette']);
    expect(findInitialSuspectTerms({ ...input, patient: { ...patient, aiAllowedTerms: ['josette'] } }, NOW)).toEqual([]);
  });

  const section = (id: string, original: string, content: string): ReportSection => ({
    id,
    title: id,
    content,
    originalContent: `<p>${original}</p>`,
    contentFormat: 'plain',
    status: 'validated',
    isAiGenerated: true,
  });

  it('sends anonymized corrections and drops those holding a suspect word', async () => {
    const { transport, requests } = fakeTransport({ extract_style_feedback: [{}] });
    const sent = await createReportGenerator(transport, { now: () => NOW }).learnStyle({
      patient,
      index,
      sections: [
        section('recommandations_reev', 'Léa progresse.', 'Léa progresse depuis le 12/01/2025.'),
        section('profil', 'Profil.', 'Profil vu avec Mme Josette.'),
        section('project', 'Même texte.', 'Même texte.'),
      ],
    });
    expect(sent).toBe(true);
    const { diffs } = requests[0].payload as { diffs: Array<{ sectionId: string; corrected: string }> };
    expect(diffs).toEqual([
      {
        sectionId: 'recommandations',
        original: '{{PATIENT_PRENOM}} progresse.',
        corrected: '{{PATIENT_PRENOM}} progresse depuis le {{DATE_1}} (il y a 1 an et 8 mois).',
      },
    ]);
  });

  it('sends nothing when no correction is left', async () => {
    const { transport, requests } = fakeTransport({});
    const sent = await createReportGenerator(transport).learnStyle({
      patient,
      index,
      sections: [section('profil', 'a', 'Vu avec Mme Josette.')],
    });
    expect(sent).toBe(false);
    expect(requests).toEqual([]);
  });
});
