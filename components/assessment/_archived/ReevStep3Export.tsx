/**
 * ReevStep3Export — Step 3 of the reevaluation flow.
 *
 * Shows a preview of the 4 reevaluation sections + comparison table.
 * Offers PDF export and "Enregistrer et terminer" finalisation.
 */
import React, { useState, useMemo, Suspense } from 'react';
import type { Patient, ReportSection, TestData, BrandingConfig, PatientAssessment, ScoreResult } from '../../types';
import { Download, Save, ArrowLeft, TrendingUp, TrendingDown, Minus, Loader2, FileText, CheckCircle2 } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';
import { useToast } from '../../contexts/ToastContext';
import { Logger } from '../../utils/logger';
import { decodeResidualEntities } from '../../utils/textSanitizer';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DeltaEntry {
    subtestId: string;
    subtestName: string;
    testName: string;
    prevNS: number | null;
    newNS: number | null;
    delta: number | null;
}

interface Props {
    patient: Patient;
    sections: ReportSection[];
    newTests: TestData;
    previousAssessment: PatientAssessment | null;
    branding: BrandingConfig;
    onValidate: () => Promise<void>;
    onBack: () => void;
    isDemoMode?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseNS = (score?: ScoreResult): number | null => {
    if (!score?.standard) return null;
    const n = parseFloat(String(score.standard).replace(',', '.'));
    return isFinite(n) ? n : null;
};

const deltaIcon = (delta: number | null) => {
    if (delta === null) return <Minus size={14} className="text-[var(--text-disabled)]" />;
    if (delta > 0.5) return <TrendingUp size={14} className="text-emerald-500" />;
    if (delta < -0.5) return <TrendingDown size={14} className="text-rose-500" />;
    return <Minus size={14} className="text-amber-400" />;
};

const deltaClass = (delta: number | null) => {
    if (delta === null) return 'text-[var(--text-disabled)]';
    if (delta > 0.5) return 'text-emerald-600 font-bold';
    if (delta < -0.5) return 'text-rose-600 font-bold';
    return 'text-amber-500';
};

const sanitizeFilename = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');

// ─── Simple HTML section renderer ─────────────────────────────────────────────

const SectionPreview: React.FC<{ section: ReportSection }> = ({ section }) => {
    const html = section.contentFormat === 'html'
        ? decodeResidualEntities(section.content)
        : section.content;

    return (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
                <FileText size={16} className="text-[var(--primary)]" />
                <h3 className="font-bold text-sm text-[var(--text-heading)]">{section.title}</h3>
                {section.status === 'validated' && (
                    <CheckCircle2 size={14} className="text-emerald-500 ml-auto" />
                )}
                {section.isAiGenerated && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--secondary)] bg-[var(--secondary)]/10 px-2 py-0.5 rounded-full ml-auto">IA</span>
                )}
            </div>
            <div
                className="px-5 py-4 prose prose-sm prose-stone dark:prose-invert max-w-none text-[var(--text-main)]"
                dangerouslySetInnerHTML={{ __html: html || '<p><em>Section vide.</em></p>' }}
            />
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const ReevStep3Export: React.FC<Props> = ({
    patient,
    sections,
    newTests,
    previousAssessment,
    branding,
    onValidate,
    onBack,
    isDemoMode,
}) => {
    const { catalog } = useCatalog();
    const toast = useToast();
    const [isExporting, setIsExporting] = useState(false);
    const [isValidating, setIsValidating] = useState(false);

    const subtestNameMap = useMemo(() =>
        new Map(catalog.flatMap(c => c.tests.flatMap(t =>
            t.subtests.map(s => [s.id, (s as any).displayName ?? s.name] as [string, string])
        ))),
    [catalog]);

    const testNameMap = useMemo(() => {
        const map = new Map<string, string>();
        catalog.forEach(c => c.tests.forEach(t => map.set(t.id, t.name)));
        return map;
    }, [catalog]);

    // Build delta entries
    const deltas = useMemo((): DeltaEntry[] => {
        const prevTests = previousAssessment?.tests ?? {};
        const result: DeltaEntry[] = [];
        const allTestIds = new Set([...Object.keys(prevTests), ...Object.keys(newTests)]);
        allTestIds.forEach(testId => {
            const prevSubtests = prevTests[testId] ?? {};
            const newSubtests = newTests[testId] ?? {};
            const allSubIds = new Set([...Object.keys(prevSubtests), ...Object.keys(newSubtests)]);
            allSubIds.forEach(subtestId => {
                const prevNS = parseNS(prevSubtests[subtestId] as ScoreResult | undefined);
                const newNS = parseNS(newSubtests[subtestId] as ScoreResult | undefined);
                result.push({
                    subtestId,
                    subtestName: subtestNameMap.get(subtestId) ?? subtestId,
                    testName: testNameMap.get(testId) ?? testId,
                    prevNS,
                    newNS,
                    delta: prevNS !== null && newNS !== null ? newNS - prevNS : null,
                });
            });
        });
        return result;
    }, [previousAssessment, newTests, subtestNameMap, testNameMap]);

    // Stats for summary bar
    const stats = useMemo(() => {
        const withDelta = deltas.filter(d => d.delta !== null);
        const improved = withDelta.filter(d => d.delta! > 0.5).length;
        const declined = withDelta.filter(d => d.delta! < -0.5).length;
        const stable = withDelta.filter(d => Math.abs(d.delta!) <= 0.5).length;
        return { total: withDelta.length, improved, declined, stable };
    }, [deltas]);

    // Group deltas by test
    const deltasByTest = useMemo(() => {
        const grouped: Record<string, DeltaEntry[]> = {};
        deltas.forEach(d => {
            if (!grouped[d.testName]) grouped[d.testName] = [];
            grouped[d.testName].push(d);
        });
        return grouped;
    }, [deltas]);

    const handleExportPDF = async () => {
        if (isDemoMode) {
            toast.info('Export PDF non disponible en mode démo.');
            return;
        }
        setIsExporting(true);
        try {
            const { pdf } = await import('@react-pdf/renderer');
            const { ensurePdfFontsRegistered } = await import('../../utils/pdfStyles');
            await ensurePdfFontsRegistered();
            const { PdfDocument } = await import('./PdfDocument');

            const fileName = `Reevaluation_${sanitizeFilename(patient.lastName)}_${sanitizeFilename(patient.firstName)}_${new Date().toISOString().split('T')[0]}.pdf`;

            const blob = await pdf(
                <PdfDocument
                    patient={patient}
                    sections={sections}
                    tests={newTests}
                    branding={branding}
                    catalog={catalog}
                    scoreDisplayModes={{}}
                    chartType="bar"
                    attachmentUrls={{}}
                />
            ).toBlob();

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            toast.success('PDF exporté avec succès.');
        } catch (err) {
            Logger.error('SYSTEM', 'Reev PDF export error', err);
            toast.error('Erreur lors de l\'export PDF.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleFinalize = async () => {
        setIsValidating(true);
        try {
            await onValidate();
        } finally {
            setIsValidating(false);
        }
    };

    const prevDate = previousAssessment?.date
        ? new Date(previousAssessment.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
        : null;

    return (
        <div className="animate-in slide-in-from-right duration-500">
            {/* Header */}
            <div className="mb-8">
                <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)]">
                    Rapport de réévaluation — {patient.firstName} {patient.lastName}
                </h1>
                {prevDate && (
                    <p className="text-sm text-[var(--text-secondary)] mt-1">
                        Référence bilan initial : {prevDate}  •  Réévaluation : {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </p>
                )}
            </div>

            {/* Stats bar */}
            {stats.total > 0 && (
                <div className="grid grid-cols-3 gap-4 mb-8">
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-4 text-center">
                        <p className="text-2xl font-bold text-emerald-600">{stats.improved}</p>
                        <p className="text-xs font-bold uppercase tracking-wider text-emerald-600 mt-1">Améliorés</p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 text-center">
                        <p className="text-2xl font-bold text-amber-500">{stats.stable}</p>
                        <p className="text-xs font-bold uppercase tracking-wider text-amber-500 mt-1">Stables</p>
                    </div>
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 p-4 text-center">
                        <p className="text-2xl font-bold text-rose-500">{stats.declined}</p>
                        <p className="text-xs font-bold uppercase tracking-wider text-rose-500 mt-1">En baisse</p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-10">
                {/* Comparison table */}
                <div className="xl:col-span-2">
                    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm sticky top-4">
                        <div className="px-5 py-4 border-b border-[var(--border-color)]">
                            <h2 className="font-bold text-[var(--text-heading)] flex items-center gap-2">
                                <TrendingUp size={18} className="text-[var(--primary)]" />
                                Évolution des scores
                            </h2>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto">
                            {Object.keys(deltasByTest).length === 0 ? (
                                <p className="p-6 text-sm text-center text-[var(--text-secondary)]">Aucun score à comparer.</p>
                            ) : (
                                Object.entries(deltasByTest).map(([testName, entries]) => (
                                    <div key={testName}>
                                        <div className="px-4 py-2 bg-[var(--card-bg-raised)] border-b border-[var(--border-color)]">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{testName}</p>
                                        </div>
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-[var(--border-color)]">
                                                    <th className="text-left px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Sous-test</th>
                                                    <th className="text-center px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Avant</th>
                                                    <th className="text-center px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Après</th>
                                                    <th className="text-center px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Δ</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--border-color)]">
                                                {entries.map(entry => (
                                                    <tr key={entry.subtestId} className="hover:bg-[var(--hover-bg)]">
                                                        <td className="px-4 py-2 text-xs text-[var(--text-heading)] max-w-[100px] truncate" title={entry.subtestName}>
                                                            {entry.subtestName}
                                                        </td>
                                                        <td className="px-2 py-2 text-center text-xs font-mono text-[var(--text-secondary)]">{entry.prevNS ?? '—'}</td>
                                                        <td className="px-2 py-2 text-center text-xs font-mono font-bold text-[var(--text-heading)]">{entry.newNS ?? '—'}</td>
                                                        <td className="px-2 py-2 text-center">
                                                            <span className={`text-xs font-mono flex items-center justify-center gap-1 ${deltaClass(entry.delta)}`}>
                                                                {deltaIcon(entry.delta)}
                                                                {entry.delta !== null
                                                                    ? `${entry.delta > 0 ? '+' : ''}${entry.delta.toFixed(1)}`
                                                                    : '—'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Sections preview */}
                <div className="xl:col-span-3 space-y-4">
                    {sections.length === 0 ? (
                        <p className="text-center py-12 text-[var(--text-secondary)] text-sm">
                            Aucune section rédigée. Retournez à l'étape précédente.
                        </p>
                    ) : (
                        sections.map(section => (
                            <SectionPreview key={section.id} section={section} />
                        ))
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6 mb-6 flex flex-col sm:flex-row items-center gap-4">
                <div className="flex-1">
                    <p className="font-bold text-[var(--text-heading)]">Prêt à enregistrer ?</p>
                    <p className="text-sm text-[var(--text-secondary)]">
                        Le rapport sera sauvegardé dans l'historique du patient.
                        Vous pourrez y accéder depuis la fiche patient.
                    </p>
                </div>
                <div className="flex gap-3 flex-shrink-0">
                    <button
                        onClick={handleExportPDF}
                        disabled={isExporting}
                        className="flex items-center gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-3 text-sm font-bold text-[var(--text-heading)] hover:border-[var(--primary)] hover:bg-[var(--hover-bg)] disabled:opacity-50"
                    >
                        {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        Exporter PDF
                    </button>
                    <button
                        onClick={handleFinalize}
                        disabled={isValidating}
                        className="flex items-center gap-2 rounded-2xl bg-emerald-500 px-8 py-3 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50 shadow-lg"
                    >
                        {isValidating ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Enregistrer et terminer
                    </button>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-[var(--border-color)]">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] px-6 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                >
                    <ArrowLeft size={16} /> Retour
                </button>
            </div>
        </div>
    );
};
