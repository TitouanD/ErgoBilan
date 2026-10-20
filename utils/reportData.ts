/**
 * reportData.ts — renderer-agnostic data for the report (annexes + layout).
 *
 * The HTML preview (`ReportView`) and the PDF (`PdfDocument`) used to compute
 * charts, colors and score tables independently and had drifted apart. Both
 * now only *render* what these functions return.
 */

import type { PatientAssessmentKind, ReportSection, TestData } from '../types';
import type { CatalogIndex } from './catalogIndex';
import type { InitialSectionId, ReevaluationSectionId } from './reportSections';
import { type Trend, TREND_LABEL, trendFromZDelta } from './reevaluationHelpers';
import { type Metric, type ResolvedScore, describeScore, formatMetricValue, resolveScores } from './resolvedScore';
import { type ScoreZone, ZONE_META, ZONE_PERCENTILE_THRESHOLDS, formatZ } from './scoring';

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

export type DotChartScale = 'z' | 'percentile';

/** Horizontal dot chart (z or percentile profile): everything but the drawing. */
export interface DotChart {
  title: string;
  items: Array<{ key: string; label: string; zone: ScoreZone; /** 0..1 on the axis. */ position: number; value: string }>;
  /** Zone backgrounds, left to right, as 0..1 fractions of the axis. */
  bands: Array<{ zone: ScoreZone; from: number; to: number }>;
  centerLine: number;
  ticks: Array<{ position: number; label: string; bold: boolean }>;
  /** Some items are on a scale where a high score signals a difficulty: their label ends with ` *`, see `readingGuide`. */
  inverted: boolean;
}

/** Chart label: ` *` marks a score turned around (high score = difficulty). */
const chartLabel = (r: ResolvedScore): string => (r.higherIsWorse ? `${r.label} *` : r.label);

export const computeDotChart = (scale: DotChartScale, tests: TestData, index: CatalogIndex): DotChart => {
  const entries = resolvedEntries(tests, index);
  const inverted = entries.some((r) => r.higherIsWorse && (scale === 'z' ? r.z : r.pct) !== null && r.zone);
  if (scale === 'z') {
    const [deficitEnd, fragileEnd] = [zToFraction(-2), zToFraction(-1)];
    return {
      title: 'Profil des scores (écarts-types)',
      items: entries.flatMap((r) =>
        r.z !== null && r.zone
          ? [{ key: r.key, label: chartLabel(r), zone: r.zone, position: zToFraction(r.z), value: formatZ(r.z, 1) }]
          : [],
      ),
      bands: [
        { zone: 'deficit', from: 0, to: deficitEnd },
        { zone: 'fragile', from: deficitEnd, to: fragileEnd },
        { zone: 'normal', from: fragileEnd, to: 1 },
      ],
      centerLine: zToFraction(0),
      ticks: Z_AXIS.ticks.map((t) => ({ position: zToFraction(t), label: t === 0 ? '0' : `${t > 0 ? '+' : ''}${t} ET`, bold: t === 0 })),
      inverted,
    };
  }
  const [deficitEnd, fragileEnd] = [pctToFraction(ZONE_PERCENTILE_THRESHOLDS.deficit), pctToFraction(ZONE_PERCENTILE_THRESHOLDS.fragile)];
  return {
    title: 'Profil des scores (percentiles)',
    items: entries.flatMap((r) =>
      r.pct !== null && r.zone
        ? [{ key: r.key, label: chartLabel(r), zone: r.zone, position: pctToFraction(r.pct), value: `${r.pct}e` }]
        : [],
    ),
    bands: [
      { zone: 'deficit', from: 0, to: deficitEnd },
      { zone: 'fragile', from: deficitEnd, to: fragileEnd },
      { zone: 'normal', from: fragileEnd, to: 1 },
    ],
    centerLine: 0.5,
    ticks: PERCENTILE_TICKS.map((t) => ({ position: pctToFraction(t), label: String(t), bold: t === 50 })),
    inverted,
  };
};

/** Legend shown under a dot chart; `inverted` = the chart holds turned-around scores (`DotChart.inverted`). */
export const readingGuide = (
  scale: DotChartScale,
  inverted = false,
): { title: string; lines: Array<{ zone: ScoreZone; label: string; legend: string }>; note: string | null } => ({
  title: `Guide de lecture${scale === 'percentile' ? ' (percentiles)' : ''} :`,
  lines: (['normal', 'fragile', 'deficit'] as const).map((zone) => ({
    zone,
    label: ZONE_META[zone].label,
    legend: scale === 'z' ? ZONE_META[zone].zLegend : ZONE_META[zone].pctLegend,
  })),
  note: inverted
    ? `* Épreuve où une note élevée signale une difficulté : ${scale === 'z' ? 'son écart-type est inversé' : 'son percentile est inversé'} sur le graphique, pour que la difficulté soit toujours à gauche. Le tableau des scores donne la valeur du manuel.`
    : null,
});

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
  /** Re-evaluation only (see TestScoreBlock.showEvolution). */
  evolution?: ScoreEvolution;
}

/** Change since the reference assessment, in the metric shown on the row. */
export interface ScoreEvolution {
  /** `+5 NS`, `-0.8 ET`, or `—` when not comparable (new subtest, other scale, not measured). */
  text: string;
  trend: Trend | null;
  /** `amélioration`, `stable`, `régression`, or '' when there is no trend. */
  trendLabel: string;
}

/** Trend colors of the evolution column (zone colors: green, neutral, red). */
export const TREND_COLOR: Record<Trend, string> = {
  improved: ZONE_META.normal.color,
  stable: '#78716C',
  declined: ZONE_META.deficit.color,
};

const NO_EVOLUTION: ScoreEvolution = { text: '—', trend: null, trendLabel: '' };

const scoreEvolution = (current: ResolvedScore, previous: ResolvedScore, mode: ScoreDisplayMode): ScoreEvolution => {
  const shown: Metric | null = current.valueIn(mode) !== null ? mode : current.metric;
  const now = shown && current.valueIn(shown);
  const before = shown && previous.valueIn(shown);
  if (!shown || now === null || before === null) return NO_EVOLUTION;
  const trend = trendFromZDelta(current.z !== null && previous.z !== null ? current.z - previous.z : null);
  return {
    text: formatMetricValue(parseFloat((now - before).toFixed(2)), shown, true),
    trend,
    trendLabel: trend ? TREND_LABEL[trend] : '',
  };
};

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
  /** One free observation (pseudo-test): `testName` is its title, its single note is the text (no inner card). */
  isFreeObservations: boolean;
  /** At least one row can be shown as NS/ET/% → show the display-mode selector. */
  hasStandardizedScores: boolean;
  /** Re-evaluation: score rows carry `evolution` (show an "Évolution" column). */
  showEvolution: boolean;
  mode: ScoreDisplayMode;
  rows: ScoreTableRow[];
  qualitativeRows: QualitativeRow[];
  notes: Array<{ label: string; observation: string }>;
}

const freeObservationBlock = (testId: string, r: ResolvedScore): TestScoreBlock => ({
  testId: `${testId}:${r.subtestId}`,
  testName: r.label,
  isFreeObservations: true,
  hasStandardizedScores: false,
  showEvolution: false,
  mode: DEFAULT_SCORE_DISPLAY_MODE,
  rows: [],
  qualitativeRows: [],
  notes: [{ label: '', observation: r.score.observation?.trim() || '' }],
});

export const buildTestScoreBlocks = (
  tests: TestData,
  index: CatalogIndex,
  modes: Record<string, ScoreDisplayMode> = {},
  /** Scores of the reference assessment (re-evaluation): adds the evolution of each score row. */
  previousTests?: TestData,
): TestScoreBlock[] =>
  resolveScores(tests, index).flatMap((test) => {
    if (test.subtests.length === 0) return [];
    // Free observations: one card per note, titled by the title the practitioner typed (#143).
    if (test.isFreeObservations) return test.subtests.map((r) => freeObservationBlock(test.testId, r));
    const mode = modes[test.testId] ?? DEFAULT_SCORE_DISPLAY_MODE;
    const block: TestScoreBlock = {
      testId: test.testId,
      testName: test.testName,
      isFreeObservations: test.isFreeObservations,
      hasStandardizedScores: test.subtests.some((r) => r.metric !== null),
      showEvolution: previousTests !== undefined,
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
        const row: ScoreTableRow = { subtestId: r.subtestId, label: r.label, display: r.display(mode), zone: r.zone, observation };
        if (previousTests) {
          const previous = describeScore(index, test.testId, r.subtestId, previousTests[test.testId]?.[r.subtestId]);
          row.evolution = scoreEvolution(r, previous, mode);
        }
        block.rows.push(row);
      }
    }
    return [block];
  });

// ─── Section layout ─────────────────────────────────────────────────────────

/** Height of an A4 sheet in CSS px (297 mm at 96 dpi). */
export const A4_HEIGHT_PX = (297 * 96) / 25.4;

/**
 * Preview: offsets (px from the top of a preview page) where an A4 sheet ends,
 * for a page taller than one sheet. The PDF flows such a page over several
 * sheets; the preview marks these ends in the margin, never across the text (#136).
 */
export const sheetEnds = (pageHeight: number, sheetHeight = A4_HEIGHT_PX): number[] => {
  const ends: number[] = [];
  // 1 px of tolerance: a page of exactly one sheet has no end to mark.
  for (let y = sheetHeight; y < pageHeight - 1; y += sheetHeight) ends.push(y);
  return ends;
};

/** Placeholder id of the annexes block (scores) in the page layout. */
export const ANNEXES_ID = 'annexes';

/**
 * Generated sections that are intentionally left out of the report (validation,
 * preview and PDF alike). `objectifs` duplicates `project` (same content, same
 * prompt constraints) and was already hidden at the validation step.
 */
export const HIDDEN_SECTION_IDS: ReadonlySet<string> = new Set(['objectifs']);

export const isReportSectionVisible = (section: Pick<ReportSection, 'id'>): boolean => !HIDDEN_SECTION_IDS.has(section.id);

const PAGE_TEMPLATES: { initial: InitialSectionId[][]; reevaluation: ReevaluationSectionId[][] } = {
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
  const template: string[][] = PAGE_TEMPLATES[reportKind === 'reevaluation' ? 'reevaluation' : 'initial'];
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

/** Layout shown at the export step: the saved one kept consistent with the sections, else the default one. */
export const resolvePages = (saved: string[][] | null | undefined, reportKind: ReportKind, sections: ReportSection[]): string[][] =>
  saved ? reconcilePages(saved, reportKind, sections) : buildDefaultPages(reportKind, sections);

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
