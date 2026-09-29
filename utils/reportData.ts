/**
 * reportData.ts — renderer-agnostic data for the report (annexes + layout).
 *
 * The HTML preview (`ReportView`) and the PDF (`PdfDocument`) used to compute
 * charts, colors and score tables independently and had drifted apart. Both
 * now only *render* what these functions return.
 */

import type { PatientAssessmentKind, ReportSection, TestData } from '../types';
import type { CatalogIndex } from './catalogIndex';
import { type Metric, type ResolvedScore, resolveScores } from './resolvedScore';
import type { ScoreZone } from './scoring';

export type ChartType = 'radar' | 'bar' | 'percentile';
export type ScoreDisplayMode = Metric;
export type ReportKind = PatientAssessmentKind | 'historique';

export const DEFAULT_CHART_TYPE: ChartType = 'bar';
export const DEFAULT_SCORE_DISPLAY_MODE: ScoreDisplayMode = 'ET';

// ─── Chart axes ─────────────────────────────────────────────────────────────

export const Z_AXIS = { min: -3.5, max: 3.5, ticks: [-3.5, -2, -1, 0, 1, 2, 3.5] } as const;
export const PERCENTILE_TICKS = [2, 16, 50, 84, 98] as const;
export const RADAR_RANGE = { min: -3, max: 3 } as const;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Horizontal position (0..1) of a z-score on the bar chart axis. */
export const zToFraction = (z: number): number => (clamp(z, Z_AXIS.min, Z_AXIS.max) - Z_AXIS.min) / (Z_AXIS.max - Z_AXIS.min);
/** Horizontal position (0..1) of a percentile rank. */
export const pctToFraction = (pct: number): number => clamp(pct, 0, 100) / 100;

const resolvedEntries = (tests: TestData, index: CatalogIndex): ResolvedScore[] => resolveScores(tests, index).flatMap((t) => t.subtests);

// ─── Charts ─────────────────────────────────────────────────────────────────

export interface ZChartItem {
  key: string;
  label: string;
  z: number;
  zone: ScoreZone;
}

export const computeZChartItems = (tests: TestData, index: CatalogIndex): ZChartItem[] =>
  resolvedEntries(tests, index).flatMap((r) => (r.z !== null && r.zone ? [{ key: r.key, label: r.label, z: r.z, zone: r.zone }] : []));

export interface PercentileChartItem {
  key: string;
  label: string;
  pct: number;
  zone: ScoreZone;
}

export const computePercentileChartItems = (tests: TestData, index: CatalogIndex): PercentileChartItem[] =>
  resolvedEntries(tests, index).flatMap((r) =>
    r.pct !== null && r.zone ? [{ key: r.key, label: r.label, pct: r.pct, zone: r.zone }] : [],
  );

export interface RadarPoint {
  label: string;
  /** Mean z-score of the category, clamped to RADAR_RANGE. */
  value: number;
}

/** Mean z-score per catalogue category. Returns [] when fewer than 3 categories (a radar needs 3 axes). */
export const computeRadarData = (tests: TestData, index: CatalogIndex): RadarPoint[] => {
  const stats = new Map<string, { label: string; sum: number; count: number }>();
  for (const test of resolveScores(tests, index)) {
    const key = test.category?.id ?? '__other__';
    for (const { z } of test.subtests) {
      if (z === null) continue;
      const entry = stats.get(key) ?? { label: test.category?.name ?? 'Autres', sum: 0, count: 0 };
      entry.sum += clamp(z, RADAR_RANGE.min, RADAR_RANGE.max);
      entry.count += 1;
      stats.set(key, entry);
    }
  }
  const points = [...stats.values()].map((s) => ({ label: s.label, value: parseFloat((s.sum / s.count).toFixed(2)) }));
  return points.length >= 3 ? points : [];
};

// ─── Score tables ───────────────────────────────────────────────────────────

export interface ScoreTableRow {
  subtestId: string;
  label: string;
  display: string;
  zone: ScoreZone | null;
  observation: string;
}

export interface QualitativeRow {
  subtestId: string;
  label: string;
  category: string;
  interpretation: string;
  observation: string;
}

export interface TestScoreBlock {
  testId: string;
  testName: string;
  /** Free-text observations pseudo-test: render as notes, not as a table. */
  isFreeObservations: boolean;
  /** At least one row can be shown as NS/ET/% → show the display-mode selector. */
  hasStandardizedScores: boolean;
  mode: ScoreDisplayMode;
  rows: ScoreTableRow[];
  qualitativeRows: QualitativeRow[];
  notes: Array<{ label: string; observation: string }>;
}

export const buildTestScoreBlocks = (
  tests: TestData,
  index: CatalogIndex,
  modes: Record<string, ScoreDisplayMode> = {},
): TestScoreBlock[] =>
  resolveScores(tests, index).flatMap((test) => {
    if (test.subtests.length === 0) return [];
    const mode = modes[test.testId] ?? DEFAULT_SCORE_DISPLAY_MODE;
    const block: TestScoreBlock = {
      testId: test.testId,
      testName: test.testName,
      isFreeObservations: test.isFreeObservations,
      hasStandardizedScores: test.subtests.some((r) => r.metric !== null),
      mode,
      rows: [],
      qualitativeRows: [],
      notes: [],
    };

    for (const r of test.subtests) {
      const observation = r.score.observation?.trim() || '';
      if (r.isFreeText) {
        block.notes.push({ label: r.label, observation });
      } else if (r.isQualitative) {
        const option = r.def?.inputConfig?.options?.find((o) => o.code === r.score.value || o.label === r.score.qualitativeLabel);
        block.qualitativeRows.push({
          subtestId: r.subtestId,
          label: r.label,
          category: r.score.qualitativeLabel || option?.label || r.score.value || '-',
          interpretation: option?.reportText || '-',
          observation,
        });
      } else {
        block.rows.push({ subtestId: r.subtestId, label: r.label, display: r.display(mode), zone: r.zone, observation });
      }
    }
    return [block];
  });

// ─── Section layout ─────────────────────────────────────────────────────────

/** Placeholder id of the annexes block (scores) in the page layout. */
export const ANNEXES_ID = 'annexes';

/**
 * Generated sections that are intentionally left out of the report (validation,
 * preview and PDF alike). `objectifs` duplicates `project` (same content, same
 * prompt constraints) and was already hidden at the validation step.
 */
export const HIDDEN_SECTION_IDS: ReadonlySet<string> = new Set(['objectifs']);

export const isReportSectionVisible = (section: Pick<ReportSection, 'id'>): boolean => !HIDDEN_SECTION_IDS.has(section.id);

const PAGE_TEMPLATES: Record<'initial' | 'reevaluation', string[][]> = {
  initial: [
    ['mandat_ref', 'mandat_eval', 'profil'],
    ['diagnostic', 'project', 'recommandations'],
  ],
  reevaluation: [
    ['resume_initial', 'evolution'],
    ['conclusion', 'recommandations_reev'],
  ],
};

/**
 * Default page layout: the template of the report kind, restricted to the
 * sections that exist, then any other visible section (e.g. historical or
 * school page), then the annexes on their own page.
 */
export const buildDefaultPages = (reportKind: ReportKind, sections: ReportSection[]): string[][] => {
  const visible = sections.filter(isReportSectionVisible);
  const existing = new Set(visible.map((s) => s.id));
  const template = PAGE_TEMPLATES[reportKind === 'reevaluation' ? 'reevaluation' : 'initial'];
  const pages = template.map((page) => page.filter((id) => existing.has(id))).filter((page) => page.length > 0);
  const placed = new Set(pages.flat());
  const extra = visible.map((s) => s.id).filter((id) => !placed.has(id));
  if (extra.length > 0) {
    if (pages.length === 0) pages.push(extra);
    else pages[pages.length - 1].push(...extra);
  }
  return [...pages, [ANNEXES_ID]];
};

/** Keep a stored layout consistent with the current sections (drop removed ids, append new ones). */
export const reconcilePages = (pages: string[][], reportKind: ReportKind, sections: ReportSection[]): string[][] => {
  const visibleIds = new Set(sections.filter(isReportSectionVisible).map((s) => s.id));
  const cleaned = pages.map((page) => page.filter((id) => id === ANNEXES_ID || visibleIds.has(id)));
  const placed = new Set(cleaned.flat());
  const missing = [...visibleIds].filter((id) => !placed.has(id));
  if (!placed.has(ANNEXES_ID)) cleaned.push([ANNEXES_ID]);
  if (missing.length > 0) {
    const annexesPage = cleaned.findIndex((p) => p.includes(ANNEXES_ID));
    const target = annexesPage > 0 ? annexesPage - 1 : 0;
    cleaned[target] = [...cleaned[target], ...missing];
  }
  const result = cleaned.filter((page, idx) => idx === 0 || page.length > 0);
  return result.length > 0 ? result : buildDefaultPages(reportKind, sections);
};

export type MoveDirection = 'up' | 'down' | 'prevPage' | 'nextPage';

/** Move a section inside the layout. Returns a new array (never mutates). */
export const moveSectionInPages = (pages: string[][], sectionId: string, direction: MoveDirection): string[][] => {
  const next = pages.map((p) => [...p]);
  const pageIdx = next.findIndex((p) => p.includes(sectionId));
  if (pageIdx === -1) return pages;
  const page = next[pageIdx];
  const idx = page.indexOf(sectionId);

  if (direction === 'up' && idx > 0) [page[idx - 1], page[idx]] = [page[idx], page[idx - 1]];
  else if (direction === 'down' && idx < page.length - 1) [page[idx + 1], page[idx]] = [page[idx], page[idx + 1]];
  else if (direction === 'nextPage') {
    page.splice(idx, 1);
    if (pageIdx + 1 < next.length) next[pageIdx + 1].unshift(sectionId);
    else next.push([sectionId]);
  } else if (direction === 'prevPage' && pageIdx > 0) {
    page.splice(idx, 1);
    next[pageIdx - 1].push(sectionId);
  } else return pages;

  return next.filter((p, i) => i === 0 || p.length > 0);
};
