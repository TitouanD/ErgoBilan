/**
 * ReportView — interactive HTML preview of the report (export step).
 *
 * All data (charts, zones, score tables, page layout) comes from
 * utils/reportData.ts so the preview and the PDF (PdfDocument) always match.
 * When `onUpdateSection` / `onPagesChange` are given the report is editable:
 * inline rich-text editing, section titles, moving sections between pages.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  FileText,
  Home,
  Mail,
  Pencil,
  Phone,
  PieChart,
  Plus,
  Sparkles,
  Star,
} from 'lucide-react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { BrandingConfig, Patient, ReportSection, TestData } from '../../../types';
import { useCatalog } from '../../../contexts/CatalogContext';
import {
  ANNEXES_ID,
  type ChartType,
  type MoveDirection,
  type DotChartScale,
  RADAR_RANGE,
  type ScoreDisplayMode,
  type ScoreEvolution,
  TREND_COLOR,
  type TestScoreBlock,
  buildTestScoreBlocks,
  computeDotChart,
  computeRadarData,
  moveSectionInPages,
  readingGuide,
  sheetEnds,
} from '../../../utils/reportData';
import { ZONE_META, type ScoreZone } from '../../../utils/scoring';
import { sectionToHtml } from '../../../utils/reportContent';
import { assessmentDateOrToday, patientAtAssessmentDate } from '../../../utils/patient';
import { type ReportTheme, formatBirthDate, formatReportDate, resolveReportTheme } from '../../../utils/reportTheme';
import { TipTapEditor } from '../shared/TipTapEditor';

interface Props {
  patient: Patient;
  /** Date of the assessment (passation), ISO; absent = today. Age and date of the first page (#153). */
  assessmentDate?: string;
  sections: ReportSection[];
  tests: TestData;
  /** Section ids per page (see buildDefaultPages); the last page usually holds the annexes. */
  pages: string[][];
  onPagesChange?: (pages: string[][]) => void;
  onUpdateSection?: (sectionId: string, updates: Partial<ReportSection>) => void;
  branding?: BrandingConfig;
  scoreDisplayModes?: Record<string, ScoreDisplayMode>;
  onScoreDisplayModeChange?: (modes: Record<string, ScoreDisplayMode>) => void;
  chartType?: ChartType;
  onChartTypeChange?: (type: ChartType) => void;
  /** Re-evaluation: scores of the reference assessment, for the evolution column. */
  previousTests?: TestData;
  /** Full rich-text toolbar (paid plans). */
  isPerformance?: boolean;
}

const roundedClass = (corners: ReportTheme['corners']) =>
  corners === 'sharp' ? 'rounded-none' : corners === 'rounded' ? 'rounded-xl' : 'rounded-2xl';
const zoneTextColor = (zone: ScoreZone | null) => (zone ? ZONE_META[zone].color : undefined);

// ─── Section title ──────────────────────────────────────────────────────────

const SectionTitle: React.FC<{ title: string; theme: ReportTheme; onSave?: (title: string) => void }> = ({ title, theme, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const css: React.CSSProperties = { fontFamily: theme.headingFont, color: theme.primary };
  const rounded = roundedClass(theme.corners);

  useEffect(() => setValue(title), [title]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = () => {
    if (value.trim() && value !== title) onSave?.(value.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-3 mb-6 pb-2 border-b-2" style={{ borderColor: theme.primary + '20' }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="text-xl font-bold uppercase tracking-wide bg-transparent outline-none border-b-2 border-[var(--primary)] flex-1"
          style={css}
        />
        <button onClick={save} className="p-1 bg-[var(--primary)] rounded-md text-white no-print" aria-label="Enregistrer le titre">
          <Check size={14} />
        </button>
      </div>
    );
  }

  const editable = Boolean(onSave);
  const heading = (
    <h2
      className={`text-xl font-bold uppercase tracking-wide ${editable ? 'cursor-pointer group/title' : ''}`}
      style={css}
      onClick={editable ? () => setEditing(true) : undefined}
    >
      {title}
      {editable && <Pencil size={12} className="inline-block ml-2 opacity-0 group-hover/title:opacity-50 transition-opacity no-print" />}
    </h2>
  );

  if (theme.titleStyle === 'underline') {
    return (
      <div className="mb-6">
        <div className="pb-2 border-b-4 inline-block" style={{ borderColor: theme.secondary }}>
          {heading}
        </div>
      </div>
    );
  }
  if (theme.titleStyle === 'filled-shape') {
    return (
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex items-center justify-center w-10 h-10">
          <svg viewBox="0 0 100 100" className="absolute w-full h-full" style={{ fill: theme.primary }}>
            <path d="M50 0 L100 40 V100 H0 V40 Z" />
          </svg>
          <div className="relative z-10 w-2 h-2 bg-white rounded-full" />
        </div>
        {heading}
      </div>
    );
  }
  if (theme.titleStyle.startsWith('icon-')) {
    const Icon = theme.titleStyle === 'icon-house' ? Home : theme.titleStyle === 'icon-star' ? Star : Sparkles;
    return (
      <div className="flex items-center gap-3 mb-6">
        <div style={{ color: theme.secondary }}>
          <Icon size={24} fill="currentColor" className="opacity-80" />
        </div>
        {heading}
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-3 mb-6 pb-2 border-b-2"
      style={{ borderColor: theme.isCustom ? theme.primary + '20' : '#E5E7EB' }}
    >
      <div
        className={`p-1.5 ${rounded} ${theme.isCustom ? '' : 'bg-stone-100 text-stone-500'}`}
        style={theme.isCustom ? { backgroundColor: theme.primary + '15', color: theme.primary } : undefined}
      >
        <FileText size={20} />
      </div>
      {heading}
    </div>
  );
};

// ─── Layout controls ────────────────────────────────────────────────────────

const SectionControls: React.FC<{
  onMove: (direction: MoveDirection) => void;
  isFirstPage: boolean;
  isFirst: boolean;
  isLast: boolean;
}> = ({ onMove, isFirstPage, isFirst, isLast }) => (
  <div className="absolute -left-12 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-print z-50">
    <div className="bg-stone-800 text-white rounded-lg p-1 shadow-lg flex flex-col gap-1">
      <button
        onClick={() => onMove('prevPage')}
        disabled={isFirstPage}
        className="p-1 hover:bg-stone-600 rounded disabled:opacity-30"
        title="Page précédente"
      >
        <ArrowUp size={14} />
      </button>
      <button onClick={() => onMove('nextPage')} className="p-1 hover:bg-stone-600 rounded" title="Page suivante">
        <ArrowDown size={14} />
      </button>
      <div className="h-px bg-stone-600 my-0.5" />
      <button onClick={() => onMove('up')} disabled={isFirst} className="p-1 hover:bg-stone-600 rounded disabled:opacity-30" title="Monter">
        <ArrowUp size={10} />
      </button>
      <button
        onClick={() => onMove('down')}
        disabled={isLast}
        className="p-1 hover:bg-stone-600 rounded disabled:opacity-30"
        title="Descendre"
      >
        <ArrowDown size={10} />
      </button>
    </div>
  </div>
);

const AddPageMenu: React.FC<{ onAddBlank: () => void; onAddSchoolPage: () => void }> = ({ onAddBlank, onAddSchoolPage }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-6 py-3 bg-stone-200 text-stone-500 hover:bg-stone-300 hover:text-stone-700 rounded-xl font-bold uppercase text-xs tracking-wider transition-colors"
      >
        <Plus size={16} /> Ajouter une page
      </button>
      {open && (
        <div className="absolute left-0 mt-2 w-56 bg-white border border-stone-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <button
            onClick={() => {
              onAddBlank();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 flex items-center gap-3"
          >
            <FileText size={16} className="text-stone-400" /> Page vide
          </button>
          <button
            onClick={() => {
              onAddSchoolPage();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 flex items-center gap-3 border-t border-stone-100"
          >
            <ClipboardList size={16} className="text-stone-400" /> Page École
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Text section ───────────────────────────────────────────────────────────

const ReportSectionBlock: React.FC<{
  section: ReportSection;
  theme: ReportTheme;
  isPerformance: boolean;
  onUpdateSection?: (sectionId: string, updates: Partial<ReportSection>) => void;
  controls?: React.ReactNode;
}> = ({ section, theme, isPerformance, onUpdateSection, controls }) => {
  const html = useMemo(() => sectionToHtml(section), [section]);
  return (
    <div className="mb-8 relative group">
      {controls}
      <SectionTitle
        title={section.title}
        theme={theme}
        onSave={onUpdateSection ? (title) => onUpdateSection(section.id, { title }) : undefined}
      />
      <TipTapEditor
        content={html}
        onChange={(next) => onUpdateSection?.(section.id, { content: next, contentFormat: 'html' })}
        readOnly={!onUpdateSection}
        inline={Boolean(onUpdateSection)}
        isPerformance={isPerformance}
      />
    </div>
  );
};

// ─── Charts ─────────────────────────────────────────────────────────────────

const ChartCard: React.FC<{ title: string; theme: ReportTheme; children: React.ReactNode }> = ({ title, theme, children }) => (
  <div className={`mb-8 break-inside-avoid bg-white border border-stone-200 overflow-hidden shadow-sm ${roundedClass(theme.corners)}`}>
    <div
      className="bg-stone-100 p-4 border-b border-stone-200"
      style={{ backgroundColor: theme.isCustom ? theme.primary + '08' : undefined }}
    >
      <h3 className="font-bold text-sm uppercase tracking-wide" style={{ fontFamily: theme.headingFont, color: theme.primary }}>
        {title}
      </h3>
    </div>
    <div className="p-4 space-y-2">{children}</div>
  </div>
);

const ReadingGuide: React.FC<{ theme: ReportTheme; scale: DotChartScale; inverted: boolean }> = ({ theme, scale, inverted }) => {
  const guide = readingGuide(scale, inverted);
  return (
    <div className={`mb-8 p-4 bg-stone-50 border border-stone-200 text-xs ${roundedClass(theme.corners)}`}>
      <p className="font-bold mb-2">{guide.title}</p>
      <ul className="list-disc ml-4 space-y-1">
        {guide.lines.map((line) => (
          <li key={line.zone}>
            <span className="font-bold" style={{ color: ZONE_META[line.zone].color }}>
              {line.label} :
            </span>{' '}
            {line.legend}.
          </li>
        ))}
      </ul>
      {guide.note && <p className="mt-2 text-stone-600">{guide.note}</p>}
    </div>
  );
};

const ChartRow: React.FC<{ label: string; position: number; color: string; value: string; bands: React.ReactNode }> = ({
  label,
  position,
  color,
  value,
  bands,
}) => (
  <div className="flex items-center gap-3 text-xs">
    <span className="w-36 text-right text-stone-600 font-medium text-[10px] leading-tight break-words shrink-0" title={label}>
      {label}
    </span>
    <div className="flex-1 h-4 bg-stone-100 rounded-full relative overflow-hidden">
      {bands}
      <div
        className="absolute top-0.5 bottom-0.5 w-3 rounded-full shadow-sm"
        style={{ left: `calc(${position * 100}% - 6px)`, backgroundColor: color }}
      />
    </div>
    <span className="w-14 text-right font-bold shrink-0" style={{ color }}>
      {value}
    </span>
  </div>
);

const EMPTY_CHART_TEXT: Record<DotChartScale, string> = {
  z: 'Aucun score convertible en écart-type.',
  percentile: 'Aucun score convertible en rang percentile.',
};

/** z or percentile profile (dot chart over the zone bands). */
const ProfileChart: React.FC<{ scale: DotChartScale; tests: TestData; theme: ReportTheme }> = ({ scale, tests, theme }) => {
  const { index } = useCatalog();
  const chart = useMemo(() => computeDotChart(scale, tests, index), [scale, tests, index]);
  if (chart.items.length === 0) return <p className="text-xs text-stone-400 italic mb-8 text-center py-8">{EMPTY_CHART_TEXT[scale]}</p>;
  const bands = (
    <>
      {chart.bands.map((b) => (
        <div
          key={b.zone}
          className="absolute inset-y-0"
          style={{ left: `${b.from * 100}%`, width: `${(b.to - b.from) * 100}%`, backgroundColor: ZONE_META[b.zone].band }}
        />
      ))}
      <div className="absolute top-0 bottom-0 w-px bg-stone-300" style={{ left: `${chart.centerLine * 100}%` }} />
    </>
  );
  return (
    <>
      <ChartCard title={chart.title} theme={theme}>
        {chart.items.map((item) => (
          <ChartRow
            key={item.key}
            label={item.label}
            position={item.position}
            color={ZONE_META[item.zone].color}
            value={item.value}
            bands={bands}
          />
        ))}
        <div className="flex items-center gap-3 text-[9px] text-stone-400 mt-2 pt-2 border-t border-stone-100">
          <span className="w-36" />
          <div className="flex-1 flex justify-between px-1">
            {chart.ticks.map((t) => (
              <span key={t.label} className={t.bold ? 'font-bold' : ''}>
                {t.label}
              </span>
            ))}
          </div>
          <span className="w-14" />
        </div>
      </ChartCard>
      <ReadingGuide theme={theme} scale={scale} inverted={chart.inverted} />
    </>
  );
};

const RadarProfile: React.FC<{ tests: TestData; theme: ReportTheme }> = ({ tests, theme }) => {
  const { index } = useCatalog();
  const data = useMemo(() => computeRadarData(tests, index).map((p) => ({ subject: p.label, value: p.value })), [tests, index]);
  if (data.length === 0) {
    return (
      <p className="text-xs text-stone-400 italic mb-8 text-center py-8">Le radar nécessite des scores dans au moins trois domaines.</p>
    );
  }
  return (
    <div className="w-full h-[300px] mb-8 bg-stone-50 rounded-2xl border border-stone-200 relative break-inside-avoid">
      <div className="absolute top-3 left-4 text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
        <PieChart size={14} /> Profil par domaine
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#3D405B', fontSize: 10, fontWeight: 700 }} />
          <PolarRadiusAxis angle={30} domain={[RADAR_RANGE.min, RADAR_RANGE.max]} tick={false} axisLine={false} />
          <Radar name="Profil" dataKey="value" stroke={theme.secondary} strokeWidth={3} fill={theme.secondary} fillOpacity={0.4} />
          <Tooltip
            formatter={(value?: number) => [`${value ?? '-'} ET`, 'Moyenne']}
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px rgba(0,0,0,0.1)' }}
          />
        </RadarChart>
      </ResponsiveContainer>
      <div className="absolute bottom-3 right-4 text-[9px] text-stone-400 italic">0 = moyenne • -2 = seuil de difficulté</div>
    </div>
  );
};

// ─── Score tables ───────────────────────────────────────────────────────────

const EvolutionCell: React.FC<{ evolution: ScoreEvolution }> = ({ evolution }) => {
  const color = evolution.trend ? TREND_COLOR[evolution.trend] : '#A8A29E';
  return (
    <td className="py-3 text-center" style={{ color }}>
      <div className="font-bold">{evolution.text}</div>
      {evolution.trendLabel && <div className="text-[10px]">{evolution.trendLabel}</div>}
    </td>
  );
};

const ScoreBlockCard: React.FC<{ block: TestScoreBlock; theme: ReportTheme; onModeChange?: (mode: ScoreDisplayMode) => void }> = ({
  block,
  theme,
  onModeChange,
}) => {
  const headingCss: React.CSSProperties = { fontFamily: theme.headingFont, color: theme.primary };
  return (
    <div className={`break-inside-avoid bg-white border border-stone-200 overflow-hidden shadow-sm ${roundedClass(theme.corners)}`}>
      <div
        className="bg-stone-100 p-4 border-b border-stone-200 flex justify-between items-center"
        style={{ backgroundColor: theme.primary + '08' }}
      >
        <div className="flex items-center gap-4">
          <h3 className="font-bold text-lg" style={headingCss}>
            {block.testName}
          </h3>
          {!block.isFreeObservations && (
            <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">
              {block.rows.length + block.qualitativeRows.length} épreuves
            </span>
          )}
        </div>
        {onModeChange && block.hasStandardizedScores && (
          <select
            value={block.mode}
            onChange={(e) => onModeChange(e.target.value as ScoreDisplayMode)}
            className="no-print pl-3 pr-8 py-1 text-xs font-bold text-[var(--text-main)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-md cursor-pointer"
            aria-label="Unité affichée"
          >
            {(['NS', 'ET', '%'] as const).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="p-6 space-y-6">
        {block.isFreeObservations &&
          block.notes.map((note, i) => (
            <p key={i} className="text-sm text-stone-600 whitespace-pre-wrap">
              {note.observation || '-'}
            </p>
          ))}
        {!block.isFreeObservations &&
          block.notes.map((note, i) => (
            <div key={i} className="border border-stone-100 rounded-lg p-4">
              <h4 className="font-semibold text-sm text-stone-700 mb-2">{note.label}</h4>
              <p className="text-sm text-stone-600 whitespace-pre-wrap">{note.observation || '-'}</p>
            </div>
          ))}
        {block.rows.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-stone-100 text-left text-xs font-bold text-stone-400 uppercase tracking-wider">
                <th className="pb-3 w-[35%]">Épreuves</th>
                <th className="pb-3 w-[15%] text-center">{block.hasStandardizedScores ? `Score (${block.mode})` : 'Résultat'}</th>
                {block.showEvolution && <th className="pb-3 w-[15%] text-center">Évolution</th>}
                <th className={`pb-3 pl-4 ${block.showEvolution ? 'w-[35%]' : 'w-[50%]'}`}>Observations</th>
              </tr>
            </thead>
            <tbody className="text-stone-700">
              {block.rows.map((row) => (
                <tr key={row.subtestId} className="border-b border-stone-50 last:border-0 align-top">
                  <td className="py-3 pr-4 font-medium">• {row.label}</td>
                  <td className="py-3 text-center font-bold" style={{ color: zoneTextColor(row.zone) ?? '#78716C' }}>
                    {row.display}
                  </td>
                  {row.evolution && <EvolutionCell evolution={row.evolution} />}
                  <td className="py-3 pl-4 italic text-xs text-stone-500">{row.observation || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {block.qualitativeRows.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Qualitatif</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-stone-100 text-left text-xs font-bold text-stone-400 uppercase tracking-wider">
                  <th className="pb-3 w-[30%]">Épreuves</th>
                  <th className="pb-3 w-[20%] text-center">Catégorie</th>
                  <th className="pb-3 w-[25%] pl-3">Interprétation</th>
                  <th className="pb-3 w-[25%] pl-3">Observations</th>
                </tr>
              </thead>
              <tbody className="text-stone-700">
                {block.qualitativeRows.map((row) => (
                  <tr key={row.subtestId} className="border-b border-stone-50 last:border-0 align-top">
                    <td className="py-3 pr-4 font-medium">• {row.label}</td>
                    <td className="py-3 text-center font-semibold text-[var(--secondary)]">{row.category}</td>
                    <td className="py-3 pl-3 text-xs text-stone-600">{row.interpretation}</td>
                    <td className="py-3 pl-3 italic text-xs text-stone-500">{row.observation || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const AnnexesBlock: React.FC<{
  tests: TestData;
  theme: ReportTheme;
  chartType: ChartType;
  onChartTypeChange?: (type: ChartType) => void;
  scoreDisplayModes: Record<string, ScoreDisplayMode>;
  onScoreDisplayModeChange?: (modes: Record<string, ScoreDisplayMode>) => void;
  previousTests?: TestData;
  controls?: React.ReactNode;
}> = ({ tests, theme, chartType, onChartTypeChange, scoreDisplayModes, onScoreDisplayModeChange, previousTests, controls }) => {
  const { index } = useCatalog();
  const blocks = useMemo(
    () => buildTestScoreBlocks(tests, index, scoreDisplayModes, previousTests),
    [tests, index, scoreDisplayModes, previousTests],
  );
  return (
    <div className="relative group mb-8">
      {controls}
      <section>
        <div className="flex items-center justify-center gap-3 mb-8">
          <div style={{ color: theme.secondary }}>
            <ClipboardList size={24} />
          </div>
          <h2 className="text-xl font-bold uppercase tracking-wide" style={{ fontFamily: theme.headingFont, color: theme.primary }}>
            Annexes : Résultats
          </h2>
        </div>

        {onChartTypeChange && (
          <div className="flex gap-2 mb-6 no-print justify-center">
            {(['radar', 'bar', 'percentile'] as const).map((type) => (
              <button
                key={type}
                onClick={() => onChartTypeChange(type)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                  chartType === type
                    ? 'bg-[var(--secondary)] text-white border-[var(--secondary)]'
                    : 'bg-stone-50 text-stone-500 border-stone-200 hover:bg-stone-100'
                }`}
              >
                {type === 'radar' ? 'Radar' : type === 'bar' ? 'Barres ET' : 'Percentiles'}
              </button>
            ))}
          </div>
        )}

        {chartType === 'radar' && <RadarProfile tests={tests} theme={theme} />}
        {chartType !== 'radar' && <ProfileChart scale={chartType === 'bar' ? 'z' : 'percentile'} tests={tests} theme={theme} />}

        <div className="space-y-12">
          {blocks.map((block) => (
            <ScoreBlockCard
              key={block.testId}
              block={block}
              theme={theme}
              onModeChange={
                onScoreDisplayModeChange ? (mode) => onScoreDisplayModeChange({ ...scoreDisplayModes, [block.testId]: mode }) : undefined
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
};

// ─── Header ─────────────────────────────────────────────────────────────────

const PatientBlock: React.FC<{ patient: Patient; dateLabel: string; theme: ReportTheme; align: 'left' | 'right' | 'center' }> = ({
  patient,
  dateLabel,
  theme,
  align,
}) => {
  const content = (
    <>
      <h2 className="font-bold text-2xl text-stone-900 mb-1">
        {patient.firstName} {patient.lastName}
      </h2>
      {patient.dob && <p className="text-sm text-stone-600 font-medium">Né(e) le {formatBirthDate(patient.dob)}</p>}
      {patient.age && <p className="text-sm text-stone-500">{patient.age}</p>}
      <p className="text-sm text-stone-500 italic mt-1">Bilan du {dateLabel}</p>
    </>
  );
  if (theme.patientBlockStyle === 'minimal')
    return (
      <div className="w-full" style={{ textAlign: align }}>
        {content}
      </div>
    );
  return (
    <div
      className={`p-4 bg-stone-50 border border-stone-100 ${roundedClass(theme.corners)} min-w-[200px] w-full`}
      style={{ textAlign: align }}
    >
      {content}
    </div>
  );
};

const PractitionerBlock: React.FC<{ branding?: BrandingConfig; theme: ReportTheme; alignEnd?: boolean }> = ({
  branding,
  theme,
  alignEnd,
}) => {
  const logoClass = theme.logoSize === 'small' ? 'w-28 h-12' : theme.logoSize === 'medium' ? 'w-40 h-20' : 'w-64 h-32';
  return (
    <div className={alignEnd ? 'flex flex-col items-end text-right' : ''}>
      {theme.isCustom && branding?.logoUrl && (
        <img src={branding.logoUrl} alt="Logo" className={`${logoClass} object-contain mb-2`} loading="eager" decoding="async" />
      )}
      <h1 className="font-bold text-3xl tracking-tight leading-tight" style={{ fontFamily: theme.headingFont, color: theme.primary }}>
        {branding?.cabinetName || "Cabinet d'Ergothérapie"}
      </h1>
      {branding?.brandSubtitle && (
        <p className="text-sm font-bold mt-1" style={{ color: theme.secondary }}>
          {branding.brandSubtitle}
        </p>
      )}
      <div className="text-xs space-y-1 mt-3 text-stone-600">
        {branding?.practitionerName && (
          <p className="flex items-center gap-1.5 font-semibold text-stone-700">
            <Star size={10} className="shrink-0" /> {branding.practitionerName}
          </p>
        )}
        {branding?.phone && (
          <p className="flex items-center gap-1.5">
            <Phone size={10} className="shrink-0" /> {branding.phone}
          </p>
        )}
        {branding?.email && (
          <p className="flex items-center gap-1.5">
            <Mail size={10} className="shrink-0" /> {branding.email}
          </p>
        )}
        {branding?.siret && <p className="flex items-center gap-1.5 text-stone-400">SIRET : {branding.siret}</p>}
        {branding?.address && (
          <p className="flex items-center gap-1.5">
            <Home size={10} className="shrink-0" /> {branding.address}
          </p>
        )}
      </div>
    </div>
  );
};

const ReportHeader: React.FC<{ patient: Patient; dateLabel: string; branding?: BrandingConfig; theme: ReportTheme }> = ({
  patient,
  dateLabel,
  branding,
  theme,
}) => {
  if (theme.headerTemplate === 'corporate') {
    return (
      <header className="flex justify-between items-start mb-12 border-b-2 border-stone-100 pb-8">
        <div className="w-1/3 pt-4">
          <PatientBlock patient={patient} dateLabel={dateLabel} theme={theme} align="left" />
        </div>
        <div className="w-1/2">
          <PractitionerBlock branding={branding} theme={theme} alignEnd />
        </div>
      </header>
    );
  }
  if (theme.headerTemplate === 'centered') {
    return (
      <header className="flex flex-col items-center text-center mb-12 border-b-2 border-stone-100 pb-8 gap-6">
        <PractitionerBlock branding={branding} theme={theme} />
        <div className="w-2/3 border-t border-stone-100 pt-6">
          <PatientBlock patient={patient} dateLabel={dateLabel} theme={theme} align="center" />
        </div>
      </header>
    );
  }
  return (
    <header className="flex justify-between items-start gap-6 mb-12 border-b-2 border-stone-100 pb-8">
      <div className="flex-1">
        <PractitionerBlock branding={branding} theme={theme} />
      </div>
      <div className="w-1/3 pt-2">
        <PatientBlock patient={patient} dateLabel={dateLabel} theme={theme} align="right" />
      </div>
    </header>
  );
};

// ─── Page ───────────────────────────────────────────────────────────────────

/**
 * One preview page. A page taller than an A4 sheet flows over several sheets in
 * the PDF: the sheet ends are marked in the margin, outside the text (#136).
 */
const PreviewPage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState<number[]>([]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const next = sheetEnds(el.offsetHeight);
      setEnds((prev) => (prev.length === next.length && prev.every((y, i) => Math.abs(y - next[i]) < 1) ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="page-a4">
      {children}
      {ends.map((y) => (
        <div
          key={y}
          className="absolute left-full ml-3 -translate-y-1/2 no-print pointer-events-none flex items-center gap-1 text-[10px] leading-tight text-stone-400 whitespace-nowrap"
          style={{ top: y }}
          title="Le PDF passe ici à la page suivante"
        >
          <span className="w-3 border-t border-stone-300" />
          fin de page A4
        </div>
      ))}
    </div>
  );
};

// ─── Report ─────────────────────────────────────────────────────────────────

export const ReportView: React.FC<Props> = ({
  patient: storedPatient,
  assessmentDate,
  sections,
  tests,
  pages,
  onPagesChange,
  onUpdateSection,
  branding,
  scoreDisplayModes = {},
  onScoreDisplayModeChange,
  chartType = 'bar',
  onChartTypeChange,
  previousTests,
  isPerformance = false,
}) => {
  const { ensureCatalogLoaded } = useCatalog();
  useEffect(() => {
    void ensureCatalogLoaded();
  }, [ensureCatalogLoaded]);

  const theme = useMemo(() => resolveReportTheme(branding), [branding]);
  const patient = useMemo(() => patientAtAssessmentDate(storedPatient, assessmentDate), [storedPatient, assessmentDate]);
  const dateLabel = formatReportDate(assessmentDateOrToday(assessmentDate));
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const titleCss: React.CSSProperties = { fontFamily: theme.headingFont, color: theme.primary };

  const controlsFor = (sectionId: string, pageIdx: number, idx: number, count: number) =>
    onPagesChange ? (
      <SectionControls
        onMove={(direction) => onPagesChange(moveSectionInPages(pages, sectionId, direction))}
        isFirstPage={pageIdx === 0}
        isFirst={idx === 0}
        isLast={idx === count - 1}
      />
    ) : null;

  return (
    <div id="printable-report" className="w-full flex flex-col items-center gap-8 no-scrollbar">
      {pages.map((pageSections, pageIdx) => (
        <PreviewPage key={pageIdx}>
          {pageIdx === 0 && (
            <>
              <ReportHeader patient={patient} dateLabel={dateLabel} branding={branding} theme={theme} />
              <h1
                className="text-center font-bold text-3xl mb-12"
                style={
                  theme.titleStyle === 'underline'
                    ? { ...titleCss, borderBottom: `4px solid ${theme.secondary}`, display: 'inline-block', paddingBottom: '8px' }
                    : titleCss
                }
              >
                {branding?.documentTitle || 'Rapport d’évaluation'}
              </h1>
              <div
                className={`text-xs text-stone-600 text-justify mb-10 leading-relaxed border-l-4 pl-4 py-2 bg-stone-50 ${roundedClass(theme.corners)}`}
                style={{ borderColor: theme.secondary }}
              >
                <p className="mb-2">
                  <strong>{patient.firstName}</strong> et ses parents consentent à cette évaluation.
                </p>
                <p>Ce bilan a pour objectif d'analyser les capacités fonctionnelles et de proposer des axes d'intervention adaptés.</p>
              </div>
            </>
          )}

          {pageSections.map((sectionId, idx) => {
            const controls = controlsFor(sectionId, pageIdx, idx, pageSections.length);
            if (sectionId === ANNEXES_ID) {
              return (
                <AnnexesBlock
                  key={sectionId}
                  tests={tests}
                  theme={theme}
                  chartType={chartType}
                  onChartTypeChange={onChartTypeChange}
                  scoreDisplayModes={scoreDisplayModes}
                  onScoreDisplayModeChange={onScoreDisplayModeChange}
                  previousTests={previousTests}
                  controls={controls}
                />
              );
            }
            const section = sectionById.get(sectionId);
            if (!section) return null;
            return (
              <ReportSectionBlock
                key={sectionId}
                section={section}
                theme={theme}
                isPerformance={isPerformance}
                onUpdateSection={onUpdateSection}
                controls={controls}
              />
            );
          })}

          <div className="absolute bottom-10 left-[15mm] right-[15mm] border-t border-stone-200 pt-4 flex justify-between items-end text-xs text-stone-400">
            <div>
              <p>{branding?.footerText || 'Document confidentiel'}</p>
              <p className="mt-1">Profession inscrite au code de la santé publique.</p>
              {pageIdx === pages.length - 1 && <p className="mt-1 text-[9px] italic">Résultats saisis et revus par le praticien.</p>}
            </div>
            {branding?.showPageNumbers && (
              <div className="font-mono">
                Page {pageIdx + 1}/{pages.length}
              </div>
            )}
          </div>
        </PreviewPage>
      ))}

      {onUpdateSection && onPagesChange && (
        <div className="no-print pb-20 relative">
          <AddPageMenu
            onAddBlank={() => onPagesChange([...pages, []])}
            onAddSchoolPage={() => {
              onUpdateSection('ecole', {
                title: 'Recommandations scolaires',
                content: '<p>Aménagements et recommandations pour le milieu scolaire.</p>',
                contentFormat: 'html',
              });
              onPagesChange([...pages, ['ecole']]);
            }}
          />
        </div>
      )}
    </div>
  );
};
