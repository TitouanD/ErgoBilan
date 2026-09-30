/**
 * assessment.ts — pure helpers around `PatientAssessment` records.
 *
 * Shared by every flow (initial, réévaluation, historique) so that the way an
 * assessment is built, and read back for a re-evaluation, is defined once.
 */

import type { PatientAssessment, PatientAssessmentKind, ReportSection, ScoreResult, TestData } from '../types';
import { type CatalogIndex, getTestName } from './catalogIndex';
import { normalizeTestData, pruneEmptyScores } from './scoring';

/**
 * Regroup the flat `results` map of assessments saved by older versions
 * (no `tests` field) into `TestData`, using the catalogue to find each
 * subtest's parent test. Subtests unknown to the catalogue are dropped.
 */
export const rebuildTestsFromResults = (results: Record<string, ScoreResult> | undefined, index: CatalogIndex): TestData => {
  const rebuilt: TestData = {};
  for (const [subtestId, score] of Object.entries(results ?? {})) {
    const testId = index.testIdBySubtestId.get(subtestId);
    if (!testId) continue;
    (rebuilt[testId] ??= {})[subtestId] = score;
  }
  return rebuilt;
};

/** Scores of an assessment as `TestData`, rebuilding them from flat results when needed. */
export const getAssessmentTests = (assessment: PatientAssessment | null | undefined, index: CatalogIndex): TestData => {
  if (!assessment) return {};
  const stored = assessment.tests ?? {};
  const tests = Object.keys(stored).length > 0 ? stored : rebuildTestsFromResults(assessment.results, index);
  return normalizeTestData(tests);
};

/** Most recent assessment that produced a formal report (the reference for a re-evaluation). */
export const getLatestFormalAssessment = (assessments: PatientAssessment[] | undefined): PatientAssessment | null =>
  [...(assessments ?? [])].filter((a) => a.hasFormalReport).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ??
  null;

/**
 * Tests and subtests picked in the catalogue (`TestCatalogModal`) added with
 * empty scores; existing scores are kept. `newTestIds`: tests that were not there.
 */
export const addCatalogSelection = (tests: TestData, selection: Record<string, string[]>): { tests: TestData; newTestIds: string[] } => {
  const next: TestData = { ...tests };
  const newTestIds: string[] = [];
  for (const [testId, subtestIds] of Object.entries(selection)) {
    if (!next[testId]) newTestIds.push(testId);
    next[testId] = { ...(next[testId] ?? {}) };
    for (const id of subtestIds) next[testId][id] ??= {};
  }
  return { tests: next, newTestIds };
};

/**
 * Same tests/subtests as the previous assessment, with empty scores.
 * A re-evaluation starts from this: a subtest the practitioner does not
 * re-measure stays empty and shows as "non mesuré" instead of a fake
 * "stable" delta of 0.
 */
export const buildEmptyTestsFrom = (previousTests: TestData): TestData =>
  Object.fromEntries(
    Object.entries(previousTests).map(([testId, subtests]) => [testId, Object.fromEntries(Object.keys(subtests).map((id) => [id, {}]))]),
  );

interface BuildAssessmentInput {
  kind: PatientAssessmentKind;
  date: string;
  tests: TestData;
  sections: ReportSection[];
  patientName: string;
  previousAssessmentId?: string;
  /** Page layout chosen at the export step. */
  pages?: string[][] | null;
  index: CatalogIndex;
}

/** Build the record persisted when an assessment is finalized. Empty scores and empty sections are dropped. */
export const buildAssessmentRecord = ({
  kind,
  date,
  tests,
  sections,
  patientName,
  previousAssessmentId,
  pages,
  index,
}: BuildAssessmentInput): PatientAssessment => {
  const kept = pruneEmptyScores(tests);
  const filledSections = sections.filter((s) => s.content?.trim());
  const results: Record<string, ScoreResult> = {};
  for (const subtests of Object.values(kept)) Object.assign(results, subtests);

  return {
    id: crypto.randomUUID(),
    date,
    kind,
    hasFormalReport: true,
    testName:
      Object.keys(kept)
        .map((id) => getTestName(index, id))
        .join(', ') || (kind === 'reevaluation' ? 'Réévaluation' : 'Bilan'),
    ...(previousAssessmentId ? { previousAssessmentId } : {}),
    results,
    tests: kept,
    ...(filledSections.length > 0
      ? { report: { status: 'completed' as const, patientName, sections: filledSections, ...(pages ? { pages } : {}) } }
      : {}),
  };
};
