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
  PERCENTILE_TICKS,
  RADAR_RANGE,
  type ScoreDisplayMode,
  type TestScoreBlock,
  Z_AXIS,
  buildTestScoreBlocks,
  computePercentileChartItems,
  computeRadarData,
  computeZChartItems,
  pctToFraction,
  zToFraction,
} from '../../../utils/reportData';
import { ZONE_META, ZONE_PERCENTILE_THRESHOLDS, formatZ } from '../../../utils/scoring';
import { type ReportTheme, formatBirthDate, formatReportDate, resolveReportTheme } from '../../../utils/reportTheme';

interface PdfDocumentProps {
  patient: Patient;
  sections: ReportSection[];
  tests: TestData;
  branding: BrandingConfig;
  catalogIndex: CatalogIndex;
  /** Section ids per page, as laid out in the preview (annexes included). Each page starts on a new PDF page. */
  pages: string[][];
  scoreDisplayModes?: Record<string, ScoreDisplayMode>;
  chartType?: ChartType;
}

/** Body font of the PDF (Quicksand unless the branding sets one). */
const bodyFont = (branding: BrandingConfig, theme: ReportTheme) => (theme.isCustom ? branding.fontFamily : 'Quicksand');

// ─── Section title ──────────────────────────────────────────────────────────

const PdfSectionTitle: React.FC<{ title: string; theme: ReportTheme; font: string }> = ({ title, theme, font }) => {
  const text = { fontSize: 13, fontWeight: 700 as const, textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: font, color: theme.primary };
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
        <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.white }} />
        </View>
        <Text style={{ ...text, color: theme.secondary }}>{title}</Text>
      </View>
    );
  }
  if (theme.titleStyle.startsWith('icon-')) {
    return (
      <View style={row}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.secondary + '20', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.secondary }} />
        </View>
        <Text style={text}>{title}</Text>
      </View>
    );
  }
  return (
    <View style={row}>
      <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: theme.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
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

const PdfPatientBlock: React.FC<{ patient: Patient; theme: ReportTheme; align: 'left' | 'right' | 'center' }> = ({ patient, theme, align }) => {
  const textAlign = align;
  const lines = (
    <>
      <Text style={{ fontSize: theme.patientBlockStyle === 'minimal' ? 16 : 13, fontWeight: 700, color: COLORS.stone800, textAlign }}>
        {patient.firstName} {patient.lastName}
      </Text>
      {patient.dob ? <Text style={{ fontSize: 9, color: COLORS.stone600, marginTop: 2, textAlign }}>Né(e) le {formatBirthDate(patient.dob)}</Text> : null}
      {patient.age ? <Text style={{ fontSize: 9, color: COLORS.stone600, marginTop: 1, textAlign }}>{patient.age}</Text> : null}
    </>
  );
  if (theme.patientBlockStyle === 'minimal') return <View>{lines}</View>;
  return (
    <View style={{ padding: 10, backgroundColor: COLORS.stone50, border: `0.5pt solid ${COLORS.stone100}`, borderRadius: getCornerRadius(theme.corners) }}>
      <Text style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: COLORS.stone400, marginBottom: 4, textAlign }}>Patient</Text>
      {lines}
    </View>
  );
};

const PdfPractitionerBlock: React.FC<{ branding: BrandingConfig; theme: ReportTheme; font: string; alignEnd?: boolean }> = ({ branding, theme, font, alignEnd }) => {
  const small = (size: number, color: string, bold = false) => ({ fontSize: size, color, fontWeight: bold ? 700 : 400, marginBottom: 1 });
  return (
    <View style={{ alignItems: alignEnd ? 'flex-end' : 'flex-start' }}>
      {theme.isCustom && branding.logoUrl ? (
        <View style={{ marginBottom: 8 }}>
          <Image src={branding.logoUrl} style={{ height: getLogoHeight(theme.logoSize), objectFit: 'contain' }} />
        </View>
      ) : null}
      {branding.cabinetName ? <Text style={{ fontSize: 16, fontWeight: 700, color: theme.primary, fontFamily: font }}>{branding.cabinetName}</Text> : null}
      {branding.brandSubtitle ? (
        <Text style={{ fontSize: 10, color: theme.secondary, fontWeight: 600, marginTop: 2, fontFamily: font }}>{branding.brandSubtitle}</Text>
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

const PdfHeader: React.FC<{ patient: Patient; branding: BrandingConfig; theme: ReportTheme; font: string }> = ({ patient, branding, theme, font }) => {
  const frame = { marginBottom: 32, borderBottomWidth: 1.5, borderBottomColor: COLORS.stone100, paddingBottom: 20 };
  if (theme.headerTemplate === 'corporate') {
    return (
      <View style={{ ...frame, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ width: '33%', paddingTop: 4 }}>
          <PdfPatientBlock patient={patient} theme={theme} align="left" />
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
          <PdfPatientBlock patient={patient} theme={theme} align="center" />
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
        <PdfPatientBlock patient={patient} theme={theme} align="right" />
      </View>
    </View>
  );
};

// ─── Charts ─────────────────────────────────────────────────────────────────

const LABEL_W = 130;
const BAR_W = 250;
const VALUE_W = 40;
const ROW_H = 14;

const PdfChartFrame: React.FC<{ title: string; theme: ReportTheme; font: string; children: React.ReactNode }> = ({ title, theme, font, children }) => (
  <View
    style={{ marginBottom: 12, backgroundColor: COLORS.white, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: getCornerRadius(theme.corners), overflow: 'hidden' }}
    wrap={false}
  >
    <View style={{ backgroundColor: theme.isCustom ? theme.primary + '08' : COLORS.stone100, padding: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.stone200 }}>
      <Text style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: theme.primary, fontFamily: font }}>{title}</Text>
    </View>
    <View style={{ padding: 10 }}>{children}</View>
  </View>
);

const PdfReadingGuide: React.FC<{ theme: ReportTheme; scale: 'z' | 'percentile' }> = ({ theme, scale }) => (
  <View wrap={false} style={{ marginBottom: 20, padding: 10, backgroundColor: COLORS.stone50, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: getCornerRadius(theme.corners) }}>
    <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 6 }}>Guide de lecture{scale === 'percentile' ? ' (percentiles)' : ''} :</Text>
    {(['normal', 'fragile', 'deficit'] as const).map((zone) => (
      <View key={zone} style={{ flexDirection: 'row', gap: 4, marginBottom: 2 }}>
        <Text style={{ fontSize: 8, fontWeight: 700, color: ZONE_META[zone].color }}>{ZONE_META[zone].label} :</Text>
        <Text style={{ fontSize: 8, color: COLORS.stone600 }}>{scale === 'z' ? ZONE_META[zone].zLegend : ZONE_META[zone].pctLegend}.</Text>
      </View>
    ))}
  </View>
);

/** Horizontal dot chart shared by the z and percentile profiles. */
const PdfDotChart: React.FC<{
  items: Array<{ key: string; label: string; position: number; color: string; value: string }>;
  bands: Array<{ from: number; to: number; color: string }>;
  centerLine: number;
  ticks: Array<{ position: number; label: string; bold?: boolean }>;
}> = ({ items, bands, centerLine, ticks }) => {
  const height = items.length * ROW_H;
  const x = (fraction: number) => LABEL_W + fraction * BAR_W;
  return (
    <Svg width={LABEL_W + BAR_W + VALUE_W} height={height + 24} viewBox={`0 0 ${LABEL_W + BAR_W + VALUE_W} ${height + 24}`}>
      {bands.map((b, i) => (
        <Rect key={i} x={x(b.from)} y={0} width={(b.to - b.from) * BAR_W} height={height} fill={b.color} />
      ))}
      <SvgLine x1={x(centerLine)} y1={0} x2={x(centerLine)} y2={height} stroke={COLORS.stone300} strokeWidth={0.5} />
      {items.map((item, i) => {
        const y = i * ROW_H + ROW_H / 2;
        return (
          <G key={item.key}>
            <SvgText x={LABEL_W - 6} y={y + 3} textAnchor="end" style={{ fontSize: 7, fill: COLORS.stone600, fontWeight: 600 }}>
              {item.label}
            </SvgText>
            <Circle cx={x(item.position)} cy={y} r={4} fill={item.color} />
            <SvgText x={LABEL_W + BAR_W + 6} y={y + 3} style={{ fontSize: 7, fontWeight: 700, fill: item.color }}>
              {item.value}
            </SvgText>
          </G>
        );
      })}
      {ticks.map((t, i) => (
        <SvgText key={i} x={x(t.position)} y={height + 16} textAnchor="middle" style={{ fontSize: 6, fill: COLORS.stone400, fontWeight: t.bold ? 700 : 400 }}>
          {t.label}
        </SvgText>
      ))}
    </Svg>
  );
};

const PdfZChart: React.FC<{ tests: TestData; index: CatalogIndex; theme: ReportTheme; font: string }> = ({ tests, index, theme, font }) => {
  const items = computeZChartItems(tests, index);
  if (items.length === 0) return null;
  return (
    <>
      <PdfChartFrame title="Profil des scores (écarts-types)" theme={theme} font={font}>
        <PdfDotChart
          items={items.map((i) => ({ key: i.key, label: i.label, position: zToFraction(i.z), color: ZONE_META[i.zone].color, value: formatZ(i.z, 1) }))}
          bands={[
            { from: 0, to: zToFraction(-2), color: ZONE_META.deficit.band },
            { from: zToFraction(-2), to: zToFraction(-1), color: ZONE_META.fragile.band },
            { from: zToFraction(-1), to: 1, color: ZONE_META.normal.band },
          ]}
          centerLine={zToFraction(0)}
          ticks={Z_AXIS.ticks.map((t) => ({ position: zToFraction(t), label: t === 0 ? '0' : `${t > 0 ? '+' : ''}${t} ET`, bold: t === 0 }))}
        />
      </PdfChartFrame>
      <PdfReadingGuide theme={theme} scale="z" />
    </>
  );
};

const PdfPercentileChart: React.FC<{ tests: TestData; index: CatalogIndex; theme: ReportTheme; font: string }> = ({ tests, index, theme, font }) => {
  const items = computePercentileChartItems(tests, index);
  if (items.length === 0) return null;
  const deficitEnd = pctToFraction(ZONE_PERCENTILE_THRESHOLDS.deficit);
  const fragileEnd = pctToFraction(ZONE_PERCENTILE_THRESHOLDS.fragile);
  return (
    <>
      <PdfChartFrame title="Profil des scores (percentiles)" theme={theme} font={font}>
        <PdfDotChart
          items={items.map((i) => ({ key: i.key, label: i.label, position: pctToFraction(i.pct), color: ZONE_META[i.zone].color, value: `${i.pct}e` }))}
          bands={[
            { from: 0, to: deficitEnd, color: ZONE_META.deficit.band },
            { from: deficitEnd, to: fragileEnd, color: ZONE_META.fragile.band },
            { from: fragileEnd, to: 1, color: ZONE_META.normal.band },
          ]}
          centerLine={0.5}
          ticks={PERCENTILE_TICKS.map((t) => ({ position: pctToFraction(t), label: String(t), bold: t === 50 }))}
        />
      </PdfChartFrame>
      <PdfReadingGuide theme={theme} scale="percentile" />
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
  const polygon = data.map((d, i) => toXY(d.value, i)).map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View style={{ marginBottom: 20, backgroundColor: COLORS.stone50, borderRadius: 16, border: `0.5pt solid ${COLORS.stone200}`, padding: 12 }} wrap={false}>
      <Text style={{ fontSize: 8, fontWeight: 700, color: COLORS.stone400, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Profil par domaine</Text>
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
      <Text style={{ fontSize: 7, color: COLORS.stone400, fontStyle: 'italic', textAlign: 'right', marginTop: 4 }}>0 = moyenne • -2 = seuil de difficulté</Text>
    </View>
  );
};

// ─── Score tables ───────────────────────────────────────────────────────────

const headCell = { fontSize: 7, fontWeight: 700 as const, textTransform: 'uppercase' as const, letterSpacing: 0.8, color: COLORS.stone400 };

// `last`: no trailing margin, which would push an empty page when the block ends at the bottom of a page.
const PdfScoreBlock: React.FC<{ block: TestScoreBlock; theme: ReportTheme; font: string; last?: boolean }> = ({ block, theme, font, last }) => (
  <View
    style={{ marginBottom: last ? 0 : 16, backgroundColor: COLORS.white, border: `0.5pt solid ${COLORS.stone200}`, borderRadius: getCornerRadius(theme.corners), overflow: 'hidden' }}
    wrap={false}
  >
    <View
      style={{
        backgroundColor: theme.isCustom ? theme.primary + '08' : COLORS.stone100,
        padding: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.stone200,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: 700, color: theme.primary, fontFamily: font }}>{block.testName}</Text>
      {block.hasStandardizedScores ? <Text style={headCell}>Score ({block.mode})</Text> : null}
    </View>
    <View style={{ padding: 12, gap: 10 }}>
      {block.notes.map((note, i) => (
        <View key={i} style={{ border: `0.5pt solid ${COLORS.stone100}`, borderRadius: 4, padding: 8 }}>
          <Text style={{ fontSize: 9, fontWeight: 700, color: COLORS.stone700, marginBottom: 4 }}>{note.label}</Text>
          <Text style={{ fontSize: 8, color: COLORS.stone600 }}>{note.observation || '-'}</Text>
        </View>
      ))}
      {block.rows.length > 0 && (
        <View>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.stone100, paddingBottom: 4, marginBottom: 2 }}>
            <Text style={{ ...headCell, width: '35%' }}>Épreuves</Text>
            <Text style={{ ...headCell, width: '15%', textAlign: 'center' }}>{block.hasStandardizedScores ? 'Score' : 'Résultat'}</Text>
            <Text style={{ ...headCell, width: '50%', paddingLeft: 8 }}>Observations</Text>
          </View>
          {block.rows.map((row) => (
            <View key={row.subtestId} style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.stone50, paddingVertical: 4 }}>
              <Text style={{ width: '35%', fontSize: 9, fontWeight: 600, color: COLORS.stone700, paddingRight: 6 }}>• {row.label}</Text>
              <Text style={{ width: '15%', fontSize: 9, textAlign: 'center', fontWeight: 700, color: row.zone ? ZONE_META[row.zone].color : COLORS.stone500 }}>
                {row.display}
              </Text>
              <Text style={{ width: '50%', fontSize: 8, fontStyle: 'italic', color: COLORS.stone500, paddingLeft: 8 }}>{row.observation || '-'}</Text>
            </View>
          ))}
        </View>
      )}
      {block.qualitativeRows.length > 0 && (
        <View>
          <Text style={{ ...headCell, marginBottom: 6 }}>Qualitatif</Text>
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.stone100, paddingBottom: 4, marginBottom: 2 }}>
            <Text style={{ ...headCell, width: '30%' }}>Épreuves</Text>
            <Text style={{ ...headCell, width: '20%', textAlign: 'center' }}>Catégorie</Text>
            <Text style={{ ...headCell, width: '25%', paddingLeft: 6 }}>Interprétation</Text>
            <Text style={{ ...headCell, width: '25%', paddingLeft: 6 }}>Observations</Text>
          </View>
          {block.qualitativeRows.map((row) => (
            <View key={row.subtestId} style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.stone50, paddingVertical: 4 }}>
              <Text style={{ width: '30%', fontSize: 9, fontWeight: 600, color: COLORS.stone700, paddingRight: 4 }}>• {row.label}</Text>
              <Text style={{ width: '20%', fontSize: 9, textAlign: 'center', fontWeight: 700, color: theme.primary }}>{row.category}</Text>
              <Text style={{ width: '25%', fontSize: 8, color: COLORS.stone600, paddingLeft: 6 }}>{row.interpretation}</Text>
              <Text style={{ width: '25%', fontSize: 8, fontStyle: 'italic', color: COLORS.stone500, paddingLeft: 6 }}>{row.observation || '-'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  </View>
);

const PdfAnnexes: React.FC<{
  tests: TestData;
  index: CatalogIndex;
  theme: ReportTheme;
  font: string;
  chartType: ChartType;
  scoreDisplayModes?: Record<string, ScoreDisplayMode>;
}> = ({ tests, index, theme, font, chartType, scoreDisplayModes }) => (
  <View>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
      <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: theme.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 8, height: 2, backgroundColor: theme.primary, borderRadius: 1 }} />
      </View>
      <Text style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: theme.primary, fontFamily: font }}>Annexes : Résultats</Text>
    </View>
    {chartType === 'radar' && <PdfRadarChart tests={tests} index={index} theme={theme} />}
    {chartType === 'bar' && <PdfZChart tests={tests} index={index} theme={theme} font={font} />}
    {chartType === 'percentile' && <PdfPercentileChart tests={tests} index={index} theme={theme} font={font} />}
    {buildTestScoreBlocks(tests, index, scoreDisplayModes).map((block, i, blocks) => (
      <PdfScoreBlock key={block.testId} block={block} theme={theme} font={font} last={i === blocks.length - 1} />
    ))}
  </View>
);

// ─── Document ───────────────────────────────────────────────────────────────

export const PdfDocument: React.FC<PdfDocumentProps> = ({ patient, sections, tests, branding, catalogIndex, pages, scoreDisplayModes, chartType = 'bar' }) => {
  const theme = resolveReportTheme(branding);
  const font = bodyFont(branding, theme);
  const headingFont = theme.isCustom ? theme.headingFont : font;
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  return (
    <Document title={`Bilan_${patient.lastName}_${patient.firstName}`} author={branding.practitionerName || 'Ergothérapeute'} subject="Rapport d'évaluation en ergothérapie">
      <Page size="A4" style={[baseStyles.page, { fontFamily: font }]}>
        <View style={baseStyles.footer} fixed>
          <View>
            <Text style={baseStyles.footerText}>{branding.footerText || 'Document confidentiel'}</Text>
            <Text style={[baseStyles.footerText, { marginTop: 2 }]}>Profession inscrite au code de la santé publique.</Text>
          </View>
          {branding.showPageNumbers && (
            <Text style={[baseStyles.footerText, { fontFamily: 'Roboto' }]} render={({ pageNumber, totalPages }) => `Page ${pageNumber}/${totalPages}`} />
          )}
        </View>

        <PdfHeader patient={patient} branding={branding} theme={theme} font={headingFont} />

        <Text style={{ fontSize: 9, fontStyle: 'italic', color: COLORS.stone500, textAlign: 'right', marginBottom: 20 }}>Fait le {formatReportDate()}</Text>

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
                  <PdfAnnexes tests={tests} index={catalogIndex} theme={theme} font={headingFont} chartType={chartType} scoreDisplayModes={scoreDisplayModes} />
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
