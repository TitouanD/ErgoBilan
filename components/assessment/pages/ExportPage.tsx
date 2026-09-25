/**
 * ExportPage — final step: report preview, layout editing, PDF export and
 * finalization. The page layout lives here so the preview and the PDF use the
 * same order; chart type and score units are saved with the branding.
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Download, Loader2, Palette } from 'lucide-react';
import type { BrandingConfig, Patient, ReportSection, TestData } from '../../../types';
import { ReportView } from './ReportView';
import { useToast } from '../../../contexts/ToastContext';
import { useCatalog } from '../../../contexts/CatalogContext';
import { Logger } from '../../../utils/logger';
import { DEFAULT_CHART_TYPE, type ReportKind, type ScoreDisplayMode, buildDefaultPages, reconcilePages } from '../../../utils/reportData';
import { ReportToolbar } from './export/ReportToolbar';
import { BrandingEditor } from './export/BrandingEditor';

interface Props {
  patient: Patient;
  sections: ReportSection[];
  tests: TestData;
  reportType?: ReportKind;
  /** Save the assessment; resolves when done (the page shows a loader meanwhile). */
  onValidate: () => Promise<void>;
  onUpdateSection: (sectionId: string, updates: Partial<ReportSection>) => void;
  branding: BrandingConfig;
  onUpdateBranding: (branding: BrandingConfig) => void;
  isPremium: boolean;
  onShowPricing: () => void;
  onBack: () => void;
  isDemoMode: boolean;
  onDemoConvert: (action: string) => void;
  onOpenProfile?: () => void;
}

const safeFilePart = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');

export const ExportPage: React.FC<Props> = ({
  patient,
  sections,
  tests,
  reportType = 'initial',
  onValidate,
  onUpdateSection,
  branding,
  onUpdateBranding,
  isPremium,
  onShowPricing,
  onBack,
  isDemoMode,
  onDemoConvert,
  onOpenProfile,
}) => {
  const toast = useToast();
  const { ensureCatalogLoaded } = useCatalog();
  const [showBranding, setShowBranding] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pages, setPages] = useState<string[][]>(() => buildDefaultPages(reportType, sections));

  // Keep the layout consistent when sections are added (e.g. "Page École") or removed.
  useEffect(() => {
    setPages((prev) => reconcilePages(prev, reportType, sections));
  }, [sections, reportType]);

  const chartType = branding.chartType ?? DEFAULT_CHART_TYPE;
  const scoreDisplayModes = branding.scoreDisplayModes ?? {};

  const renderPdfBlob = async (): Promise<Blob> => {
    const [{ pdf }, { ensurePdfFontsRegistered }, { PdfDocument }, catalogIndex] = await Promise.all([
      import('@react-pdf/renderer'),
      import('../../../utils/pdfStyles'),
      import('./PdfDocument'),
      ensureCatalogLoaded(),
    ]);
    await ensurePdfFontsRegistered();
    return pdf(
      <PdfDocument
        patient={patient}
        sections={sections}
        tests={tests}
        branding={branding}
        catalogIndex={catalogIndex}
        pages={pages}
        scoreDisplayModes={scoreDisplayModes}
        chartType={chartType}
      />,
    ).toBlob();
  };

  const withExport = async (action: (blob: Blob) => void, errorMessage: string) => {
    setIsExporting(true);
    try {
      action(await renderPdfBlob());
    } catch (err) {
      Logger.error('SYSTEM', 'PDF generation error', err);
      toast.error(errorMessage);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () =>
    withExport((blob) => {
      window.open(URL.createObjectURL(blob), '_blank');
    }, 'Erreur lors de la génération du PDF pour impression');

  const handleDownload = () =>
    withExport((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Bilan_${safeFilePart(patient.lastName)}_${safeFilePart(patient.firstName)}_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('PDF exporté avec succès ✓');
      if (isDemoMode) onDemoConvert('Exporter le PDF');
    }, "Erreur lors de l'export PDF");

  const handleOpenBranding = () => (isPremium ? setShowBranding(true) : onShowPricing());

  const handleFinalValidate = async () => {
    if (isDemoMode) {
      onDemoConvert('Finaliser le bilan');
      return;
    }
    setIsValidating(true);
    try {
      await onValidate();
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-32 animate-in fade-in duration-500 relative">
      <ReportToolbar currentBranding={branding} onApply={onUpdateBranding} onOpenEditor={handleOpenBranding} isPremium={isPremium} />

      <div className="flex justify-between items-center mb-8 border-b border-[var(--border-color)] pb-6 no-print">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-heading)] rounded-xl hover:bg-[var(--hover-bg)] transition-all"
            title="Retour à la relecture"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Visualisation & Export</h2>
            <p className="text-[var(--text-secondary)] font-medium mt-2">Personnalisez la mise en page et exportez votre document.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleOpenBranding}
            className="flex items-center gap-2 px-4 py-2.5 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[var(--hover-bg)] transition-all"
          >
            <Palette size={14} /> Design
          </button>
          <button
            onClick={handlePrint}
            disabled={isExporting}
            className="flex items-center gap-2 px-5 py-3 bg-[var(--hover-bg)] text-[var(--text-secondary)] rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[var(--border-color)] transition-all disabled:opacity-70"
          >
            <Download size={16} /> Imprimer
          </button>
          <button
            onClick={handleDownload}
            disabled={isExporting}
            className="flex items-center gap-2 px-5 py-3 bg-[#3D405B] text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[#2c2e42] transition-all disabled:opacity-70"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {isExporting ? 'Export...' : 'Télécharger PDF'}
          </button>
          <button
            onClick={handleFinalValidate}
            disabled={isValidating}
            className="flex items-center gap-2 px-8 py-3 bg-[#E07A5F] text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[#d0694e] transition-all shadow-lg hover:-translate-y-1 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isValidating ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Terminer & Archiver
          </button>
        </div>
      </div>

      <div
        className={`pdf-viewer-panel shadow-xl shadow-black/20 min-h-[29.7cm] p-[10mm] md:p-[20mm] mx-auto print:shadow-none print:p-0 print:m-0 print:w-full transition-all duration-300 ${showBranding ? 'mr-[26rem]' : ''}`}
      >
        <ReportView
          patient={patient}
          sections={sections}
          tests={tests}
          pages={pages}
          onPagesChange={setPages}
          onUpdateSection={onUpdateSection}
          branding={branding}
          scoreDisplayModes={scoreDisplayModes}
          onScoreDisplayModeChange={(modes: Record<string, ScoreDisplayMode>) => onUpdateBranding({ ...branding, scoreDisplayModes: modes })}
          chartType={chartType}
          onChartTypeChange={(type) => onUpdateBranding({ ...branding, chartType: type })}
          isPerformance={isPremium}
        />
      </div>

      {showBranding && <BrandingEditor branding={branding} onUpdate={onUpdateBranding} onClose={() => setShowBranding(false)} onOpenProfile={onOpenProfile} />}
    </div>
  );
};
