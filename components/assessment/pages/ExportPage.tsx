
import React, { useState } from 'react';
import type { Patient, ReportSection, TestData, BrandingConfig } from '../../../types';
import { Download, Check, Palette, ArrowLeft, Loader2 } from 'lucide-react';
import { ReportView } from './ReportView';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useCatalog } from '../../../contexts/CatalogContext';
import { Logger } from '../../../utils/logger';
import { ReportToolbar } from './export/ReportToolbar';
import { BrandingEditor } from './export/BrandingEditor';

interface Props {
    patient: Patient;
    sections: ReportSection[];
    tests: TestData;
    reportType?: 'initial' | 'reevaluation' | 'historique';
    onValidate: () => Promise<void>; // Promise pour gérer le loading
    onUpdateSection: (sectionId: string, updates: Partial<ReportSection>) => void;
    branding: BrandingConfig;
    onUpdateBranding: (newBranding: BrandingConfig) => void;
    isPremium: boolean;
    onShowPricing: () => void;
    onBack: () => void;
    isDemoMode: boolean;
    onDemoConvert: (action: string) => void;
    onOpenProfile?: () => void;
}

export const Step5Export: React.FC<Props> = ({ patient, sections, tests, reportType = 'initial', onValidate, onUpdateSection, branding, onUpdateBranding, isPremium, onShowPricing, onBack, isDemoMode, onDemoConvert, onOpenProfile }) => {
    const [showBranding, setShowBranding] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [scoreDisplayModes, setScoreDisplayModes] = useState<Record<string, 'Brut' | 'NS' | 'ET' | '%'>>({});
    const [chartType, setChartType] = useState<'radar' | 'bar' | 'percentile'>('bar');
    const { toast } = useToast();
    const { catalog } = useCatalog();

    const handlePrint = async () => {
        setIsExporting(true);
        try {
            const { pdf } = await import('@react-pdf/renderer');
            const { ensurePdfFontsRegistered } = await import('../../../utils/pdfStyles');
            await ensurePdfFontsRegistered();
            const { PdfDocument } = await import('./PdfDocument');
            const attachmentUrls = await convertBlobAttachments();
            const blob = await pdf(
                <PdfDocument
                    patient={patient}
                    sections={sections}
                    tests={tests}
                    branding={branding}
                    catalog={catalog}
                    scoreDisplayModes={scoreDisplayModes}
                    chartType={chartType}
                    attachmentUrls={attachmentUrls}
                />
            ).toBlob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        } catch (err) {
            Logger.error('SYSTEM', 'Print PDF error', err);
            toast?.error?.('Erreur lors de la génération du PDF pour impression');
        } finally {
            setIsExporting(false);
        }
    };

    /** Convert blob: URLs to base64 data URLs for @react-pdf compatibility */
    const convertBlobAttachments = async (): Promise<Record<string, string>> => {
        const map: Record<string, string> = {};
        for (const section of sections) {
            for (const att of section.attachments || []) {
                if (att.url.startsWith('blob:')) {
                    try {
                        const resp = await fetch(att.url);
                        const blob = await resp.blob();
                        const base64 = await new Promise<string>((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.readAsDataURL(blob);
                        });
                        map[att.id] = base64;
                    } catch {
                        // skip failed conversions
                    }
                }
            }
        }
        return map;
    };

    const handleExportPDF = async () => {
        setIsExporting(true);
        try {
            // Dynamic imports for @react-pdf/renderer (tree-shaking friendly)
            const { pdf } = await import('@react-pdf/renderer');
            const { ensurePdfFontsRegistered } = await import('../../../utils/pdfStyles');
            await ensurePdfFontsRegistered();
            const { PdfDocument } = await import('./PdfDocument');

            // Pre-convert blob attachments to base64
            const attachmentUrls = await convertBlobAttachments();

            const sanitizeFilename = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
            const fileName = `Bilan_${sanitizeFilename(patient.lastName)}_${sanitizeFilename(patient.firstName)}_${new Date().toISOString().split('T')[0]}.pdf`;

            // Generate PDF blob
            const blob = await pdf(
                <PdfDocument
                    patient={patient}
                    sections={sections}
                    tests={tests}
                    branding={branding}
                    catalog={catalog}
                    scoreDisplayModes={scoreDisplayModes}
                    chartType={chartType}
                    attachmentUrls={attachmentUrls}
                />
            ).toBlob();

            // Trigger download
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            toast.success('PDF exporté avec succès ✓');
            if (isDemoMode) {
                onDemoConvert('Exporter le PDF');
            }
        } catch (err) {
            Logger.error('SYSTEM', 'PDF export error', err);
            toast.error('Erreur lors de l\'export PDF');
        } finally {
            setIsExporting(false);
        }
    };

    const handleOpenBranding = () => {
        if (!isPremium) {
            onShowPricing();
            return;
        }
        setShowBranding(true);
    };

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

            {/* BARRE D'OUTILS STANDARDISÉE */}
            <ReportToolbar
                currentBranding={branding}
                onApply={onUpdateBranding}
                onOpenEditor={handleOpenBranding}
                isPremium={isPremium}
            />

            {/* Actions Bar (No Print) */}
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
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2.5 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[var(--hover-bg)] transition-all"
                        title="Retourner en Step4 pour modifier le texte"
                    >
                        <ArrowLeft size={14} /> Modifier le texte
                    </button>
                    <button
                        onClick={handleOpenBranding}
                        className="flex items-center gap-2 px-4 py-2.5 border border-[var(--border-color)] text-[var(--text-secondary)] rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[var(--hover-bg)] transition-all"
                    >
                        <Palette size={14} /> Design
                    </button>
                    <button
                        onClick={handlePrint}
                        className="flex items-center gap-2 px-5 py-3 bg-[var(--hover-bg)] text-[var(--text-secondary)] rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-[var(--border-color)] transition-all"
                    >
                        <Download size={16} /> Imprimer
                    </button>
                    <button
                        onClick={handleExportPDF}
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

            {/* Report Preview */}
            <div className={`pdf-viewer-panel shadow-xl shadow-black/20 min-h-[29.7cm] p-[10mm] md:p-[20mm] mx-auto print:shadow-none print:p-0 print:m-0 print:w-full transition-all duration-300 ${showBranding ? 'mr-[26rem]' : ''}`}>
                <ReportView
                    patient={patient}
                    sections={sections}
                    tests={tests}
                    reportType={reportType}
                    branding={branding}
                    scoreDisplayModes={scoreDisplayModes}
                    onScoreDisplayModeChange={setScoreDisplayModes}
                    chartType={chartType}
                    onChartTypeChange={setChartType}
                    isPerformance={isPremium}
                />
            </div>

            {/* Branding Editor Drawer */}
            {showBranding && (
                <BrandingEditor
                    branding={branding}
                    onUpdate={onUpdateBranding}
                    onClose={() => setShowBranding(false)}
                    onOpenProfile={onOpenProfile}
                />
            )}
        </div>
    );
};
