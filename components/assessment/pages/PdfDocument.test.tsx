import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Page, renderToBuffer } from '@react-pdf/renderer';
import type { CategoryDef } from '../../../data/testCatalog';
import { DEFAULT_BRANDING } from '../../../data/brandingDefaults';
import { buildFictiveTests } from '../../../dev/fictiveScores';
import { buildCatalogIndex } from '../../../utils/catalogIndex';
import { resolveReportTheme } from '../../../utils/reportTheme';
import { PdfAnnexes } from './PdfDocument';

// A test as long as NEPSY-2: its table and its chart are taller than one A4 page.
const SUBTESTS = 60;
const catalog: CategoryDef[] = [
  {
    id: 'neuro',
    name: 'Neuropsychologie',
    iconKey: 'Brain',
    sortOrder: 1,
    tests: [
      {
        id: 'long',
        name: 'Test long',
        subtests: Array.from({ length: SUBTESTS }, (_, i) => ({
          id: `s${i}`,
          name: `Précision visuomotrice, note étalonnée composite ${i}`,
          unit: 'pts',
          scoreType: 'scaled' as const,
          inputModel: 'numeric_4mode' as const,
        })),
      },
    ],
  },
];
const index = buildCatalogIndex(catalog);
const tests = buildFictiveTests(index, [{ testId: 'long' }], { level: -1, fill: 'zones' }).tests;
const theme = resolveReportTheme(DEFAULT_BRANDING);

/**
 * Renders the annexes alone (built-in Helvetica: no font download). Returns the
 * page count and react-pdf's warnings: an unbreakable block taller than a page
 * is squashed onto it, rows overlapping (« can't wrap between pages »).
 */
const renderAnnexes = async (chartType: 'bar' | 'radar') => {
  const warnings: string[] = [];
  const collect = (...a: unknown[]) => void warnings.push(a.map(String).join(' '));
  vi.spyOn(console, 'warn').mockImplementation(collect);
  vi.spyOn(console, 'error').mockImplementation(collect);
  vi.spyOn(console, 'log').mockImplementation(collect);
  const buffer = await renderToBuffer(
    <Document>
      <Page size="A4" style={{ padding: 42, paddingBottom: 80, fontFamily: 'Helvetica' }}>
        <PdfAnnexes tests={tests} index={index} theme={theme} font="Helvetica" chartType={chartType} />
      </Page>
    </Document>,
  );
  const pages = buffer.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
  return { pages, squashed: warnings.filter((w) => w.includes("can't wrap between pages")) };
};

afterEach(() => vi.restoreAllMocks());

describe('PdfAnnexes, pagination', () => {
  it('flows a test longer than a page over several pages instead of squashing it', async () => {
    // Radar: no profile chart, only the score table (60 rows ≈ 1.5 page).
    const { pages, squashed } = await renderAnnexes('radar');
    expect(squashed).toEqual([]);
    expect(pages).toBeGreaterThanOrEqual(2);
  });

  it('flows a profile chart longer than a page over several pages', async () => {
    // Chart (60 rows ≈ 1 page) then the table (≈ 1.5 page).
    const { pages, squashed } = await renderAnnexes('bar');
    expect(squashed).toEqual([]);
    expect(pages).toBeGreaterThanOrEqual(3);
  });
});
