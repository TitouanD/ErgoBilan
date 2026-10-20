/**
 * PdfDocument — @react-pdf/renderer document for the exported report.
 *
 * Separate renderer from the HTML preview (ReportView) but fed by the same
 * data functions (utils/reportData.ts), the same page order and the same
 * section HTML (utils/reportContent.ts), so what is exported matches the preview.
 */

import React from 'react';
import { Circle, Document, G, Image, Line as SvgLine, Page, Polygon, Rect, Svg, Text, Text as SvgText, View } from '@react-pdf/renderer';
import type { BrandingConfig, Patient, ReportSection, TestData } from '../../../types';
import type { CatalogIndex } from '../../../utils/catalogIndex';
import { COLORS, baseStyles, getCornerRadius, getLogoHeight } from '../../../utils/pdfStyles';
import { htmlToPdfNodes } from '../../../utils/pdfRenderer';
import { sectionToHtml } from '../../../utils/reportContent';
import {
  ANNEXES_ID,
  type ChartType,
  type DotChart,
  type DotChartScale,
  RADAR_RANGE,
  type ScoreDisplayMode,
  type ScoreEvolution,
  TREND_COLOR,
  type TestScoreBlock,
  buildTestScoreBlocks,
  computeDotChart,
  computeRadarData,
  readingGuide,
} from '../../../utils/reportData';
import { ZONE_META } from '../../../utils/scoring';
import { assessmentDateOrToday, patientAtAssessmentDate } from '../../../utils/patient';
import { type ReportTheme, formatBirthDate, formatReportDate, resolveReportTheme } from '../../../utils/reportTheme';

interface PdfDocumentProps {
  patient: Patient;
  /** Date of the assessment (passation), ISO; absent = today. Age and date of the first page (#153). */
  assessmentDate?: string;
  sections: ReportSection[];
  tests: TestData;
  branding: BrandingConfig;
  catalogIndex: CatalogIndex;
  /** Section ids per page, as laid out in the preview (annexes included). Each page starts on a new PDF page. */
  pages: string[][];
  scoreDisplayModes?: Record<string, ScoreDisplayMode>;
  chartType?: ChartType;
  /** Re-evaluation: scores of the reference assessment, for the evolution column. */
  previousTests?: TestData;
}

/** Body font of the PDF (Quicksand unless the branding sets one). */
const bodyFont = (branding: BrandingConfig, theme: ReportTheme) => (theme.isCustom ? branding.fontFamily : 'Quicksand');

// ─── Section title ──────────────────────────────────────────────────────────

const PdfSectionTitle: React.FC<{ title: string; theme: ReportTheme; font: string }> = ({ title, theme, font }) => {
  const text = {
    fontSize: 13,
    fontWeight: 700 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    fontFamily: font,
    color: theme.primary,
  };
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 16, marginTop: 12 };

  if (theme.titleStyle === 'underline') {
    return (
      <View style={{ marginBottom: 16, marginTop: 12, alignItems: 'flex-start' }}>
        <Text style={{ ...text, borderBottomWidth: 3, borderBottomColor: theme.secondary, paddingBottom: 6 }}>{title}</Text>
      </View>
    );
  }
  if (theme.titleStyle === 'filled-shape') {
    return (
      <View style={row}>
        <View
          style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.white }} />
        </View>
        <Text style={{ ...text, color: theme.secondary }}>{title}</Text>
      </View>
    );
  }
  if (theme.titleStyle.startsWith('icon-')) {
    return (
      <View style={row}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: theme.secondary + '20',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.secondary }} />
        </View>
        <Text style={text}>{title}</Text>
      </View>
    );
  }
  return (
    <View style={row}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          backgroundColor: theme.primary + '15',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 10, height: 2, backgroundColor: theme.primary, borderRadius: 1 }} />
      </View>
      <View>
        <Text style={text}>{title}</Text>
        <View style={{ height: 2, backgroundColor: theme.primary + '20', marginTop: 4 }} />
      </View>
    </View>
  );
};

// ─── Header ─────────────────────────────────────────────────────────────────

const PdfPatientBlock: React.FC<{ patient: Patient; dateLabel: string; theme: ReportTheme; align: 'left' | 'right' | 'center' }> = ({
  patient,
  dateLabel,
  theme,
  align,
}) => {
  const textAlign = align;
  const lines = (
    <>
      <Text style={{ fontSize: theme.patientBlockStyle === 'minimal' ? 16 : 13, fontWeight: 700, color: COLORS.stone800, textAlign }}>
        {patient.firstName} {patient.lastName}
      </Text>
      {patient.dob ? (
        <Text style={{ fontSize: 9, color: COLORS.stone600, marginTop: 2, textAlign }}>Né(e) le {formatBirthDate(patient.dob)}</Text>
      ) : null}
      {patient.age ? <Text style={{ fontSize: 9, color: COLORS.stone600, marginTop: 1, textAlign }}>{patient.age}</Text> : null}
      <Text style={{ fontSize: 9, fontStyle: 'italic', color: COLORS.stone500, marginTop: 3, textAlign }}>Bilan du {dateLabel}</Text>
    </>
  );
  if (theme.patientBlockStyle === 'minimal') return <View>{lines}</View>;
  return (
    <View
      style={{
        padding: 10,
        backgroundColor: COLORS.stone50,
        border: `0.5pt solid ${COLORS.stone100}`,
        borderRadius: getCornerRadius(theme.corners),
      }}
    >
      <Text
        style={{
          fontSize: 8,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          color: COLORS.stone400,
          marginBottom: 4,
          textAlign,
        }}
      >
        Patient
      </Text>
      {lines}
    </View>
  );
};

const PdfPractitionerBlock: React.FC<{ branding: BrandingConfig; theme: ReportTheme; font: string; alignEnd?: boolean }> = ({
  branding,
  theme,
  font,
  alignEnd,
}) => {
  const small = (size: number, color: string, bold = false) => ({ fontSize: size, color, fontWeight: bold ? 700 : 400, marginBottom: 1 });
  return (
    <View style={{ alignItems: alignEnd ? 'flex-end' : 'flex-start' }}>
      {theme.isCustom && branding.logoUrl ? (
        <View style={{ marginBottom: 8 }}>
          <Image src={branding.logoUrl} style={{ height: getLogoHeight(theme.logoSize), objectFit: 'contain' }} />
        </View>
      ) : null}
      {branding.cabinetName ? (
        <Text style={{ fontSize: 16, fontWeight: 700, color: theme.primary, fontFamily: font }}>{branding.cabinetName}</Text>
      ) : null}
      {branding.brandSubtitle ? (
        <Text style={{ fontSize: 10, color: theme.secondary, fontWeight: 600, marginTop: 2, fontFamily: font }}>
          {branding.brandSubtitle}
        </Text>
      ) : null}
      <View style={{ marginTop: 6, alignItems: alignEnd ? 'flex-end' : 'flex-start' }}>
        {branding.practitionerName ? <Text style={small(9, COLORS.stone700, true)}>{branding.practitionerName}</Text> : null}
        {branding.phone ? <Text style={small(8, COLORS.stone500)}>{branding.phone}</Text> : null}
        {branding.email ? <Text style={small(8, COLORS.stone500)}>{branding.email}</Text> : null}
        {branding.siret ? <Text style={small(7, COLORS.stone400)}>SIRET : {branding.siret}</Text> : null}
        {branding.address ? <Text style={small(8, COLORS.stone500)}>{branding.address}</Text> : null}
      </View>
    </View>
  );
};

const PdfHeader: React.FC<{ patient: Patient; dateLabel: string; branding: BrandingConfig; theme: ReportTheme; font: string }> = ({
  patient,
  dateLabel,
  branding,
  theme,
  font,
}) => {
  const frame = { marginBottom: 32, borderBottomWidth: 1.5, borderBottomColor: COLORS.stone100, paddingBottom: 20 };
  if (theme.headerTemplate === 'corporate') {
    return (
      <View style={{ ...frame, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ width: '33%', paddingTop: 4 }}>
          <PdfPatientBlock patient={patient} dateLabel={dateLabel} theme={theme} align="left" />
        </View>
        <View style={{ width: '50%' }}>
          <PdfPractitionerBlock branding={branding} theme={theme} font={font} alignEnd />
        </View>
      </View>
    );
  }
  if (theme.headerTemplate === 'centered') {
    return (
      <View style={{ ...frame, alignItems: 'center' }}>
        <PdfPractitionerBlock branding={branding} theme={theme} font={font} />
        <View style={{ width: '66%', borderTopWidth: 1, borderTopColor: COLORS.stone100, paddingTop: 12, marginTop: 12 }}>
          <PdfPatientBlock patient={patient} dateLabel={dateLabel} theme={theme} align="center" />
        </View>
      </View>
    );
  }
  return (
    <View style={{ ...frame, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <View style={{ flexGrow: 1 }}>
        <PdfPractitionerBlock branding={branding} theme={theme} font={font} />
      </View>
      <View style={{ width: '33%', paddingTop: 4 }}>
        <PdfPatientBlock patient={patient} dateLabel={dateLabel} theme={theme} align="right" />
      </View>
    </View>
  );
};

// ─── Charts ─────────────────────────────────────────────────────────────────

// Chart width within the page (A4 minus padding and frame); the label column takes what the longest name needs.
const CHART_W = 470;
const VALUE_W = 40;
const LABEL_W_MIN = 130;
const LABEL_W_MAX = 230;
/** Average width of a 7pt bold Helvetica character. */
const LABEL_CHAR_W = 3.9;
const ROW_H = 14;
/** Rows per chart slice: a slice never breaks, the chart flows over several pages. */
const CHART_SLICE = 40;
/** Score rows above which a test card may break across pages (below, it moves whole). */
const UNBREAKABLE_ROWS = 20;

const PdfChartFrame: React.FC<{ title: string; theme: ReportTheme; font: string; breakable?: boolean; children: React.ReactNode }> = ({
  title,
  theme,
  font,
  breakable,
  children,
}) => (
  <View
    style={{
      marginBottom: 12,
      backgroundColor: COLORS.white,
      border: `0.5pt solid ${COLORS.stone200}`,
      borderRadius: getCornerRadius(theme.corners),
      overflow: 'hidden',
    }}
    wrap={breakable ?? false}
  >
    <View
      wrap={false}
      minPresenceAhead={ROW_H * 5}
      style={{
        backgroundColor: theme.isCustom ? theme.primary + '08' : COLORS.stone100,
        padding: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.stone200,
      }}
    >
      <Text
        style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: theme.primary, fontFamily: font }}
      >
        {title}
      </Text>
    </View>
    <View style={{ padding: 10 }}>{children}</View>
  </View>
);

const PdfReadingGuide: React.FC<{ theme: ReportTheme; scale: DotChartScale; inverted: boolean }> = ({ theme, scale, inverted }) => {
  const guide = readingGuide(scale, inverted);
  return (
    <View
      wrap={false}
      style={{
        marginBottom: 20,
        padding: 10,
        backgroundColor: COLORS.stone50,
        border: `0.5pt solid ${COLORS.stone200}`,
        borderRadius: getCornerRadius(theme.corners),
      }}
    >
      <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 6 }}>{guide.title}</Text>
      {guide.lines.map((line) => (
        <View key={line.zone} style={{ flexDirection: 'row', gap: 4, marginBottom: 2 }}>
          <Text style={{ fontSize: 8, fontWeight: 700, color: ZONE_META[line.zone].color }}>{line.label} :</Text>
          <Text style={{ fontSize: 8, color: COLORS.stone600 }}>{line.legend}.</Text>
        </View>
      ))}
      {guide.note && <Text style={{ fontSize: 8, color: COLORS.stone600, marginTop: 4 }}>{guide.note}</Text>}
    </View>
  );
};

const sliceRows = <T,>(items: T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / CHART_SLICE) }, (_, i) => items.slice(i * CHART_SLICE, (i + 1) * CHART_SLICE));

/** Horizontal dot chart of the z and percentile profiles, in unbreakable slices of `CHART_SLICE` rows. */
const PdfDotChart: React.FC<{ chart: DotChart }> = ({ chart: { items, bands, centerLine, ticks } }) => {
  const longest = Math.max(0, ...items.map((item) => item.label.length));
  const labelW = Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, Math.ceil(longest * LABEL_CHAR_W) + 8));
  const barW = CHART_W - labelW - VALUE_W;
  const slices = sliceRows(items);
  return (
    <>
      {slices.map((slice, s) => (
        <PdfDotChartSlice
          key={s}
          items={slice}
          bands={bands}
          centerLine={centerLine}
          ticks={s === slices.length - 1 ? ticks : []}
          labelW={labelW}
          barW={barW}
        />
      ))}
    </>
  );
};

const PdfDotChartSlice: React.FC<Pick<DotChart, 'items' | 'bands' | 'centerLine' | 'ticks'> & { labelW: number; barW: number }> = ({
  items,
  bands,
  centerLine,
  ticks,
  labelW,
  barW,
}) => {
  const height = items.length * ROW_H;
  const total = height + (ticks.length > 0 ? 24 : 0);
  const x = (fraction: number) => labelW + fraction * barW;
  return (
    <Svg width={CHART_W} height={total} viewBox={`0 0 ${CHART_W} ${total}`}>
      {bands.map((b) => (
        <Rect key={b.zone} x={x(b.from)} y={0} width={(b.to - b.from) * barW} height={height} fill={ZONE_META[b.zone].band} />
      ))}
      <SvgLine x1={x(centerLine)} y1={0} x2={x(centerLine)} y2={height} stroke={COLORS.stone300} strokeWidth={0.5} />
      {items.map((item, i) => {
        const y = i * ROW_H + ROW_H / 2;
        const color = ZONE_META[item.zone].color;
        return (
          <G key={item.key}>
            <SvgText x={labelW - 6} y={y + 3} textAnchor="end" style={{ fontSize: 7, fill: COLORS.stone600, fontWeight: 600 }}>
              {item.label}
            </SvgText>
            <Circle cx={x(item.position)} cy={y} r={4} fill={color} />
            <SvgText x={labelW + barW + 6} y={y + 3} style={{ fontSize: 7, fontWeight: 700, fill: color }}>
              {item.value}
            </SvgText>
          </G>
        );
      })}
      {ticks.map((t, i) => (
        <SvgText
          key={i}
          x={x(t.position)}
          y={height + 16}
          textAnchor="middle"
          style={{ fontSize: 6, fill: COLORS.stone400, fontWeight: t.bold ? 700 : 400 }}
        >
          {t.label}
        </SvgText>
      ))}
    </Svg>
  );
};

const PdfProfileChart: React.FC<{ scale: DotChartScale; tests: TestData; index: CatalogIndex; theme: ReportTheme; font: string }> = ({
  scale,
  tests,
  index,
  theme,
  font,
}) => {
  const chart = computeDotChart(scale, tests, index);
  if (chart.items.length === 0) return null;
  return (
    <>
      <PdfChartFrame title={chart.title} theme={theme} font={font} breakable={chart.items.length > CHART_SLICE}>
        <PdfDotChart chart={chart} />
      </PdfChartFrame>
      <PdfReadingGuide theme={theme} scale={scale} inverted={chart.inverted} />
    </>
  );
};

const PdfRadarChart: React.FC<{ tests: TestData; index: CatalogIndex; theme: ReportTheme }> = ({ tests, index, theme }) => {
  const data = computeRadarData(tests, index);
  if (data.length === 0) return null;
  const cx = 150;
  const cy = 120;
  const outerR = 85;
  const angleStep = (2 * Math.PI) / data.length;
  const toXY = (value: number, i: number) => {
    const r = ((value - RADAR_RANGE.min) / (RADAR_RANGE.max - RADAR_RANGE.min)) * outerR;
    const angle = i * angleStep - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const polygon = data
    .map((d, i) => toXY(d.value, i))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  return (
    <View
      style={{ marginBottom: 20, backgroundColor: COLORS.stone50, borderRadius: 16, border: `0.5pt solid ${COLORS.stone200}`, padding: 12 }}
      wrap={false}
    >
      <Text
        style={{ fontSize: 8, fontWeight: 700, color: COLORS.stone400, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}
      >
        Profil par domaine
      </Text>
      <View style={{ alignItems: 'center' }}>
        <Svg width={300} height={260} viewBox="0 0 300 260">
          {[0.33, 0.66, 1].map((level) => (
            <Circle key={level} cx={cx} cy={cy} r={outerR * level} fill="none" stroke="#e5e7eb" strokeWidth={0.5} />
          ))}
          {data.map((d, i) => {
            const end = toXY(RADAR_RANGE.max, i);
            const label = toXY(RADAR_RANGE.max + 0.6, i);
            return (
              <G key={d.label}>
                <SvgLine x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#e5e7eb" strokeWidth={0.5} />
                <SvgText x={label.x} y={label.y} textAnchor="middle" style={{ fontSize: 7, fontWeight: 700, fill: theme.primary }}>
                  {d.label}
                </SvgText>
              </G>
            );
          })}
          <Polygon points={polygon} fill={theme.secondary} fillOpacity={0.35} stroke={theme.secondary} strokeWidth={2} />
          {data.map((d, i) => {
            const p = toXY(d.value, i);
            return <Circle key={`pt-${d.label}`} cx={p.x} cy={p.y} r={3} fill={theme.secondary} />;
          })}
        </Svg>
      </View>
      <Text style={{ fontSize: 7, color: COLORS.stone400, fontStyle: 'italic', textAlign: 'right', marginTop: 4 }}>
        0 = moyenne • -2 = seuil de difficulté
      </Text>
    </View>
  );
};

// ─── Score tables ───────────────────────────────────────────────────────────

const headCell = { fontSize: 7, fontWeight: 700 as const, textTransform: 'uppercase' as const, letterSpacing: 0.8, color: COLORS.stone400 };

const EVOLUTION_W = '15%';

// Score tables (#139): ruled grid, compact text like the observations.
const GRID = COLORS.stone200;
const tableFrame = { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: GRID };
const gridRow = { flexDirection: 'row' as const, borderBottomWidth: 0.5, borderBottomColor: GRID };
const gridCell = (width: string) => ({ width, paddingVertical: 3, paddingHorizontal: 4, borderRightWidth: 0.5, borderRightColor: GRID });
const headRow = { ...gridRow, backgroundColor: COLORS.stone50 };
const labelText = { fontSize: 8, fontWeight: 600 as const, color: COLORS.stone700 };
const noteText = { fontSize: 7.5, fontStyle: 'italic' as const, color: COLORS.stone500 };

const PdfEvolutionCell: React.FC<{ evolution: ScoreEvolution }> = ({ evolution }) => {
  const color = evolution.trend ? TREND_COLOR[evolution.trend] : COLORS.stone400;
  return (
    <View style={{ ...gridCell(EVOLUTION_W), alignItems: 'center' }}>
      <Text style={{ fontSize: 8, fontWeight: 700, color }}>{evolution.text}</Text>
      {evolution.trendLabel ? <Text style={{ fontSize: 6.5, color }}>{evolution.trendLabel}</Text> : null}
    </View>
  );
};

// `last`: no trailing margin, which would push an empty page when the block ends at the bottom of a page.
// A long test (NEPSY-2) is taller than a page: it then breaks between rows, its header kept with the first ones.
const PdfScoreBlock: React.FC<{ block: TestScoreBlock; theme: ReportTheme; font: string; last?: boolean }> = ({
  block,
  theme,
  font,
  last,
}) => {
  const obsW = block.showEvolution ? '35%' : '50%';
  return (
    <View
      style={{
        marginBottom: last ? 0 : 10,
        backgroundColor: COLORS.white,
        border: `0.5pt solid ${COLORS.stone200}`,
        borderRadius: getCornerRadius(theme.corners),
        overflow: 'hidden',
      }}
      wrap={block.rows.length + block.qualitativeRows.length > UNBREAKABLE_ROWS}
    >
      <View
        wrap={false}
        minPresenceAhead={80}
        style={{
          backgroundColor: theme.isCustom ? theme.primary + '08' : COLORS.stone100,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderBottomWidth: 0.5,
          borderBottomColor: COLORS.stone200,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: 700, color: theme.primary, fontFamily: font }}>{block.testName}</Text>
        {block.hasStandardizedScores ? <Text style={headCell}>Score ({block.mode})</Text> : null}
      </View>
      <View style={{ padding: 8, gap: 6 }}>
        {block.isFreeObservations &&
          block.notes.map((note, i) => (
            <Text key={i} style={{ fontSize: 9, color: COLORS.stone600, lineHeight: 1.5 }}>
              {note.observation || '-'}
            </Text>
          ))}
        {!block.isFreeObservations &&
          block.notes.map((note, i) => (
            <View key={i} style={{ border: `0.5pt solid ${GRID}`, borderRadius: 3, padding: 6 }}>
              <Text style={{ ...labelText, marginBottom: 2 }}>{note.label}</Text>
              <Text style={{ fontSize: 7.5, color: COLORS.stone600 }}>{note.observation || '-'}</Text>
            </View>
          ))}
        {block.rows.length > 0 && (
          <View style={tableFrame}>
            <View wrap={false} minPresenceAhead={40} style={headRow}>
              <Text style={{ ...headCell, ...gridCell('35%') }}>Épreuves</Text>
              <Text style={{ ...headCell, ...gridCell('15%'), textAlign: 'center' }}>
                {block.hasStandardizedScores ? 'Score' : 'Résultat'}
              </Text>
              {block.showEvolution && <Text style={{ ...headCell, ...gridCell(EVOLUTION_W), textAlign: 'center' }}>Évolution</Text>}
              <Text style={{ ...headCell, ...gridCell(obsW) }}>Observations</Text>
            </View>
            {block.rows.map((row, i) => (
              <View key={row.subtestId} wrap={false}>
                {row.groupLabel && row.groupLabel !== block.rows[i - 1]?.groupLabel ? (
                  <View style={{ ...gridRow, backgroundColor: COLORS.stone100 }} minPresenceAhead={20}>
                    <Text style={{ ...headCell, ...gridCell('100%'), color: theme.primary }}>{row.groupLabel}</Text>
                  </View>
                ) : null}
                <View style={gridRow}>
                  <Text style={{ ...labelText, ...gridCell('35%') }}>{row.label}</Text>
                  <Text
                    style={{
                      ...gridCell('15%'),
                      fontSize: 8,
                      textAlign: 'center',
                      fontWeight: 700,
                      color: row.zone ? ZONE_META[row.zone].color : COLORS.stone500,
                    }}
                  >
                    {row.display}
                  </Text>
                  {row.evolution && <PdfEvolutionCell evolution={row.evolution} />}
                  <Text style={{ ...noteText, ...gridCell(obsW) }}>{row.observation || '-'}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
        {block.qualitativeRows.length > 0 && (
          <View>
            <Text style={{ ...headCell, marginBottom: 3 }}>Qualitatif</Text>
            <View style={tableFrame}>
              <View wrap={false} minPresenceAhead={40} style={headRow}>
                <Text style={{ ...headCell, ...gridCell('30%') }}>Épreuves</Text>
                <Text style={{ ...headCell, ...gridCell('20%'), textAlign: 'center' }}>Catégorie</Text>
                <Text style={{ ...headCell, ...gridCell('25%') }}>Interprétation</Text>
                <Text style={{ ...headCell, ...gridCell('25%') }}>Observations</Text>
              </View>
              {block.qualitativeRows.map((row) => (
                <View key={row.subtestId} wrap={false} style={gridRow}>
                  <Text style={{ ...labelText, ...gridCell('30%') }}>{row.label}</Text>
                  <Text style={{ ...gridCell('20%'), fontSize: 8, textAlign: 'center', fontWeight: 700, color: theme.primary }}>
                    {row.category}
                  </Text>
                  <Text style={{ ...gridCell('25%'), fontSize: 7.5, color: COLORS.stone600 }}>{row.interpretation}</Text>
                  <Text style={{ ...noteText, ...gridCell('25%') }}>{row.observation || '-'}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const PdfAnnexes: React.FC<{
  tests: TestData;
  index: CatalogIndex;
  theme: ReportTheme;
  font: string;
  chartType: ChartType;
  scoreDisplayModes?: Record<string, ScoreDisplayMode>;
  previousTests?: TestData;
}> = ({ tests, index, theme, font, chartType, scoreDisplayModes, previousTests }) => (
  <View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          backgroundColor: theme.primary + '15',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 8, height: 2, backgroundColor: theme.primary, borderRadius: 1 }} />
      </View>
      <Text style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: theme.primary, fontFamily: font }}>
        Annexes : Résultats
      </Text>
    </View>
    {chartType === 'radar' && <PdfRadarChart tests={tests} index={index} theme={theme} />}
    {chartType !== 'radar' && (
      <PdfProfileChart scale={chartType === 'bar' ? 'z' : 'percentile'} tests={tests} index={index} theme={theme} font={font} />
    )}
    {buildTestScoreBlocks(tests, index, scoreDisplayModes, previousTests).map((block, i, blocks) => (
      <PdfScoreBlock key={block.testId} block={block} theme={theme} font={font} last={i === blocks.length - 1} />
    ))}
  </View>
);

// ─── Document ───────────────────────────────────────────────────────────────

/** Exported for the pagination tests. */
export { PdfAnnexes };

export const PdfDocument: React.FC<PdfDocumentProps> = ({
  patient: storedPatient,
  assessmentDate,
  sections,
  tests,
  branding,
  catalogIndex,
  pages,
  scoreDisplayModes,
  chartType = 'bar',
  previousTests,
}) => {
  const theme = resolveReportTheme(branding);
  const patient = patientAtAssessmentDate(storedPatient, assessmentDate);
  const dateLabel = formatReportDate(assessmentDateOrToday(assessmentDate));
  const font = bodyFont(branding, theme);
  const headingFont = theme.isCustom ? theme.headingFont : font;
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  return (
    <Document
      title={`Bilan_${patient.lastName}_${patient.firstName}`}
      author={branding.practitionerName || 'Ergothérapeute'}
      subject="Rapport d'évaluation en ergothérapie"
    >
      <Page size="A4" style={[baseStyles.page, { fontFamily: font }]}>
        <View style={baseStyles.footer} fixed>
          <View>
            <Text style={baseStyles.footerText}>{branding.footerText || 'Document confidentiel'}</Text>
            <Text style={[baseStyles.footerText, { marginTop: 2 }]}>Profession inscrite au code de la santé publique.</Text>
          </View>
          {branding.showPageNumbers && (
            <Text
              style={[baseStyles.footerText, { fontFamily: 'Roboto' }]}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber}/${totalPages}`}
            />
          )}
        </View>

        <PdfHeader patient={patient} dateLabel={dateLabel} branding={branding} theme={theme} font={headingFont} />

        <Text
          style={{
            fontSize: 24,
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: 32,
            fontFamily: headingFont,
            color: theme.primary,
            ...(theme.titleStyle === 'underline' ? { borderBottomWidth: 4, borderBottomColor: theme.secondary, paddingBottom: 8 } : {}),
          }}
        >
          {branding.documentTitle || "Rapport d'évaluation"}
        </Text>

        <View
          style={{
            marginBottom: 24,
            borderLeftWidth: 3,
            borderLeftColor: theme.secondary,
            paddingLeft: 10,
            paddingVertical: 6,
            backgroundColor: COLORS.stone50,
            borderRadius: getCornerRadius(theme.corners),
          }}
        >
          <Text style={{ fontSize: 9, color: COLORS.stone600, lineHeight: 1.6, marginBottom: 4 }}>
            <Text style={{ fontWeight: 700 }}>{patient.firstName}</Text> et ses parents consentent à cette évaluation.
          </Text>
          <Text style={{ fontSize: 9, color: COLORS.stone600, lineHeight: 1.6 }}>
            Ce bilan a pour objectif d'analyser les capacités fonctionnelles et de proposer des axes d'intervention adaptés.
          </Text>
        </View>

        {pages.flatMap((pageIds, pageIdx) =>
          pageIds.map((id, i) => {
            // A preview page starts a new PDF page (the first one follows the header). Long pages still flow over several PDF pages.
            const breakBefore = pageIdx > 0 && i === 0;
            if (id === ANNEXES_ID) {
              return (
                <View key={id} break={breakBefore}>
                  <PdfAnnexes
                    tests={tests}
                    index={catalogIndex}
                    theme={theme}
                    font={headingFont}
                    chartType={chartType}
                    scoreDisplayModes={scoreDisplayModes}
                    previousTests={previousTests}
                  />
                </View>
              );
            }
            const section = sectionById.get(id);
            if (!section) return null;
            return (
              <View key={id} break={breakBefore} style={{ marginBottom: 16 }}>
                <View wrap={false}>
                  <PdfSectionTitle title={section.title} theme={theme} font={headingFont} />
                </View>
                <View>{htmlToPdfNodes(sectionToHtml(section), branding, font)}</View>
              </View>
            );
          }),
        )}
      </Page>
    </Document>
  );
};

export default PdfDocument;
