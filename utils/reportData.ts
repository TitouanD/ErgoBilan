/**
 * reportData.ts — renderer-agnostic data for the report (annexes + layout).
 *
 * The HTML preview (`ReportView`) and the PDF (`PdfDocument`) used to compute
 * charts, colors and score tables independently and had drifted apart. Both
 * now only *render* what these functions return.
 */

import type { PatientAssessmentKind, ReportSection, ScoreResult, TestData } from '../types';
import { CUSTOM_OBSERVATIONS_TEST_ID, type CatalogIndex, getScaleType, getSubtestDef, getSubtestName, getTestName } from './catalogIndex';
import {
  type ScoreZone,
  deriveDisplayScores,
  formatScoreCompact,
  formatZ,
  getPercentileFromScore,
  getZFromScore,
  hasScoreValue,
  zoneFromPercentile,
  zoneFromZ,
} from './scoring';

export type ChartType = 'radar' | 'bar' | 'percentile';
export type ScoreDisplayMode = 'NS' | 'ET' | '%';
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

const scoredEntries = (tests: TestData) =>
  Object.entries(tests).flatMap(([testId, subtests]) =>
    Object.entries(subtests)
      .filter(([, score]) => hasScoreValue(score))
      .map(([subtestId, score]) => ({ testId, subtestId, score })),
  );

// ─── Charts ─────────────────────────────────────────────────────────────────

export interface ZChartItem {
  key: string;
  label: string;
  z: number;
  zone: ScoreZone;
}

export const computeZChartItems = (tests: TestData, index: CatalogIndex): ZChartItem[] =>
  scoredEntries(tests).flatMap(({ testId, subtestId, score }) => {
    const z = getZFromScore(score, getScaleType(index, testId, subtestId));
    if (z === null) return [];
    return [{ key: `${testId}:${subtestId}`, label: getSubtestName(index, testId, subtestId, score.customLabel), z, zone: zoneFromZ(z)! }];
  });

export interface PercentileChartItem {
  key: string;
  label: string;
  pct: number;
  zone: ScoreZone;
}

export const computePercentileChartItems = (tests: TestData, index: CatalogIndex): PercentileChartItem[] =>
  scoredEntries(tests).flatMap(({ testId, subtestId, score }) => {
    const pct = getPercentileFromScore(score, getScaleType(index, testId, subtestId));
    if (pct === null) return [];
    return [
      {
        key: `${testId}:${subtestId}`,
        label: getSubtestName(index, testId, subtestId, score.customLabel),
        pct,
        zone: zoneFromPercentile(pct)!,
      },
    ];
  });

export interface RadarPoint {
  label: string;
  /** Mean z-score of the category, clamped to RADAR_RANGE. */
  value: number;
}

/** Mean z-score per catalogue category. Returns [] when fewer than 3 categories (a radar needs 3 axes). */
export const computeRadarData = (tests: TestData, index: CatalogIndex): RadarPoint[] => {
  const stats = new Map<string, { label: string; sum: number; count: number }>();
  for (const { testId, subtestId, score } of scoredEntries(tests)) {
    const z = getZFromScore(score, getScaleType(index, testId, subtestId));
    if (z === null) continue;
    const category = index.categoryByTestId.get(testId);
    const key = category?.id ?? '__other__';
    const entry = stats.get(key) ?? { label: category?.name ?? 'Autres', sum: 0, count: 0 };
    entry.sum += clamp(z, RADAR_RANGE.min, RADAR_RANGE.max);
    entry.count += 1;
    stats.set(key, entry);
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

const isStandardized = (score: ScoreResult) => score.unit === 'NS' || score.unit === 'ET' || score.unit === '%';

/**
 * Text shown in the score column for the chosen mode. When the requested
 * metric cannot be derived (unknown scale), the value typed by the
 * practitioner is shown with its unit instead of an empty dash.
 */
export const formatScoreForMode = (score: ScoreResult, mode: ScoreDisplayMode, scaleType: string): string => {
  if (!score.value) return '-';
  if (!isStandardized(score)) return formatScoreCompact(score);
  const derived = deriveDisplayScores(score, scaleType);
  if (mode === 'ET') {
    const z = getZFromScore(score, scaleType);
    return z !== null ? `${formatZ(z)} ET` : formatScoreCompact(score);
  }
  if (mode === 'NS') {
    const ns = score.unit === 'NS' ? score.value : derived.standard;
    return ns ?? formatScoreCompact(score);
  }
  const pct = score.unit === '%' ? score.value : derived.percentile;
  return pct !== undefined ? `${pct} %` : formatScoreCompact(score);
};

export const buildTestScoreBlocks = (
  tests: TestData,
  index: CatalogIndex,
  modes: Record<string, ScoreDisplayMode> = {},
): TestScoreBlock[] =>
  Object.entries(tests).flatMap(([testId, subtests]) => {
    const scored = Object.entries(subtests).filter(([, s]) => hasScoreValue(s));
    if (scored.length === 0) return [];
    const mode = modes[testId] ?? DEFAULT_SCORE_DISPLAY_MODE;
    const block: TestScoreBlock = {
      testId,
      testName: getTestName(index, testId),
      isFreeObservations: testId === CUSTOM_OBSERVATIONS_TEST_ID,
      hasStandardizedScores: scored.some(([, s]) => isStandardized(s)),
      mode,
      rows: [],
      qualitativeRows: [],
      notes: [],
    };

    for (const [subtestId, score] of scored) {
      const def = getSubtestDef(index, testId, subtestId);
      const label = getSubtestName(index, testId, subtestId, score.customLabel);
      const observation = score.observation?.trim() || '';

      if (block.isFreeObservations || def?.inputModel === 'custom_text') {
        block.notes.push({ label, observation });
      } else if (def?.inputModel === 'qualitative_category' || score.unit === 'qualitative') {
        const option = def?.inputConfig?.options?.find((o) => o.code === score.value || o.label === score.qualitativeLabel);
        block.qualitativeRows.push({
          subtestId,
          label,
          category: score.qualitativeLabel || option?.label || score.value || '-',
          interpretation: option?.reportText || '-',
          observation,
        });
      } else {
        const scaleType = getScaleType(index, testId, subtestId);
        const z = getZFromScore(score, scaleType);
        block.rows.push({
          subtestId,
          label,
          display: formatScoreForMode(score, mode, scaleType),
          zone: isStandardized(score) ? (zoneFromZ(z) ?? zoneFromPercentile(getPercentileFromScore(score, scaleType))) : null,
          observation,
        });
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
