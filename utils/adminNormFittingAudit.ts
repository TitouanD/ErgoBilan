import type {
  AdminNormFittingDatasetRow,
  AdminNormFittingSubtestAudit,
  FittingIssue,
  FittingResult,
  FittingRow,
  FittingStructure,
} from '../types';
import { analyzeFitting, normalizeScoreTypeToken } from './normFittingEngine';

type AdminFittingIssueRef = {
  issue: FittingIssue;
  issueKey: string;
};

const toStructure = (value?: string | null): FittingStructure => (
  String(value || '').toUpperCase() === 'PARAMETRIC' ? 'PARAMETRIC' : 'LOOKUP'
);

const toFittingRow = (row: AdminNormFittingDatasetRow): FittingRow => ({
  normId: row.norm_id,
  seriesKey: `${row.age_min_months ?? 'na'}|${row.age_max_months ?? 'na'}|${(row.gender || 'Mixed').toLowerCase()}`,
  rawMin: row.raw_min,
  rawMax: row.raw_max,
  standardScore: row.standard_score,
  percentile: row.percentile,
  mean: row.mean,
  sd: row.sd,
});

export const buildAdminFittingIssueKey = (subtestId: string, issue: Pick<FittingIssue, 'id' | 'code'>): string => (
  `${subtestId}::${issue.code}::${issue.id}`
);

const toIssueRefs = (subtestId: string, result: FittingResult): AdminFittingIssueRef[] => (
  result.issues.map((issue) => ({
    issue,
    issueKey: buildAdminFittingIssueKey(subtestId, issue),
  }))
);

export const analyzeAdminNormFittingDataset = (
  rows: AdminNormFittingDatasetRow[],
  dismissedIssueKeys?: Set<string>,
): AdminNormFittingSubtestAudit[] => {
  const bySubtest = new Map<string, AdminNormFittingDatasetRow[]>();
  rows.forEach((row) => {
    const current = bySubtest.get(row.subtest_id) || [];
    current.push(row);
    bySubtest.set(row.subtest_id, current);
  });

  const audits: AdminNormFittingSubtestAudit[] = [];
  bySubtest.forEach((subRows, subtestId) => {
    const first = subRows[0];
    const structure = toStructure(first.computation_mode);
    const currentScoreType = normalizeScoreTypeToken(first.score_type) || 'none';
    const result = analyzeFitting({
      rows: subRows.map(toFittingRow),
      structure,
      currentScoreType,
    });

    const filteredIssues = dismissedIssueKeys
      ? toIssueRefs(subtestId, result)
        .filter((ref) => !dismissedIssueKeys.has(ref.issueKey))
        .map((ref) => ref.issue)
      : result.issues;

    const riskScore = Math.min(100, result.riskScore + (result.issues.length - filteredIssues.length) * 0);
    audits.push({
      testId: first.test_id,
      testName: first.test_name,
      organizationId: first.organization_id,
      subtestId,
      subtestName: first.subtest_name,
      structure,
      currentScoreType: result.currentScoreType,
      suggestedScoreType: result.suggestedScoreType,
      confidence: result.confidence,
      riskScore,
      issues: filteredIssues,
      suggestions: result.suggestions,
    });
  });

  return audits.sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    if (b.issues.length !== a.issues.length) return b.issues.length - a.issues.length;
    if (a.testName !== b.testName) return a.testName.localeCompare(b.testName);
    return a.subtestName.localeCompare(b.subtestName);
  });
};

export const buildFittingIssueCountByTest = (audits: AdminNormFittingSubtestAudit[]): Map<string, number> => {
  const counts = new Map<string, number>();
  audits.forEach((audit) => {
    counts.set(audit.testId, (counts.get(audit.testId) || 0) + audit.issues.length);
  });
  return counts;
};
