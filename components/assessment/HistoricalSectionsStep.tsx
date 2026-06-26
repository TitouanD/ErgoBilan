/**
 * HistoricalSectionsStep — Step 3 of the "historique" import flow.
 *
 * Lets the practitioner paste the content of an existing assessment report
 * (sections) so the system stores it as a formal PatientAssessment.
 * This activates the "Réévaluation 1-clic" button for this patient.
 */
import React, { useState, useCallback } from 'react';
import type { Patient, ReportSection } from '../../types';
import { FileText, ArrowLeft, Save, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';

// ─── Standard ErgoBilan sections (same IDs as AI generation uses) ─────────────
// Order and IDs MUST match the sections emitted by AIService.generateFullReport.
// This ensures the reevaluation AI can correctly reference previous sections.

const DEFAULT_SECTIONS: { id: string; title: string }[] = [
    { id: 'mandat_ref',     title: 'Mandat de référencement en ergothérapie' },
    { id: 'mandat_eval',    title: 'Mandat d\'évaluation en ergothérapie' },
    { id: 'profil',         title: 'Profil occupationnel' },
    { id: 'diagnostic',     title: 'Diagnostique en ergothérapie' },
    { id: 'objectifs',      title: 'Les objectifs généraux' },
    { id: 'project',        title: 'Projet d\'accompagnement' },
    { id: 'recommandations', title: 'Recommandations' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface LocalSection {
    id: string;      // stable ErgoBilan section ID
    title: string;
    content: string;
    isOpen: boolean;
}

interface Props {
    patient: Patient;
    historicalDate: string;
    onBack: () => void;
    onSave: (sections: ReportSection[]) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (isoDate: string): string => {
    if (!isoDate) return '';
    try {
        return new Date(isoDate).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    } catch {
        return isoDate;
    }
};

// ─── Component ────────────────────────────────────────────────────────────────

export const HistoricalSectionsStep: React.FC<Props> = ({
    patient,
    historicalDate,
    onBack,
    onSave,
}) => {
    const toast = useToast();
    const [isSaving, setIsSaving] = useState(false);

    const [sections, setSections] = useState<LocalSection[]>(() =>
        DEFAULT_SECTIONS.map((s) => ({
            id: s.id,
            title: s.title,
            content: '',
            isOpen: false,
        }))
    );

    const updateSection = useCallback((id: string, patch: Partial<LocalSection>) => {
        setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    }, []);

    const toggleSection = useCallback((id: string) => {
        setSections((prev) =>
            prev.map((s) => (s.id === id ? { ...s, isOpen: !s.isOpen } : s))
        );
    }, []);

    const handleSave = useCallback(async () => {
        const filledSections = sections.filter((s) => s.content.trim().length > 0);
        if (filledSections.length === 0) {
            const confirm = window.confirm(
                'Aucune section ne contient de texte. Voulez-vous quand même enregistrer le bilan (sans rapport) pour activer la réévaluation 1-clic ?'
            );
            if (!confirm) return;
        }

        const reportSections: ReportSection[] = sections
            .filter((s) => s.content.trim().length > 0)
            .map((s) => ({
                id: s.id,
                title: s.title,
                content: s.content,
                contentFormat: 'plain' as const,
                status: 'validated' as const,
                isAiGenerated: false,
            }));

        setIsSaving(true);
        try {
            await onSave(reportSections);
        } finally {
            setIsSaving(false);
        }
    }, [sections, onSave]);

    const patientName = `${patient.firstName} ${patient.lastName}`.trim() || 'Patient';
    const filledCount = sections.filter((s) => s.content.trim().length > 0).length;

    return (
        <div className="max-w-3xl mx-auto pb-20 animate-in fade-in duration-500">

            {/* Header */}
            <div className="mb-8 border-b border-[var(--border-color)] pb-6">
                <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">
                    Rapport antérieur
                </h2>
                <p className="text-[var(--text-secondary)] font-medium mt-2">
                    Copiez-collez les sections du bilan de{' '}
                    <span className="font-bold text-[var(--text-heading)]">{patientName}</span>
                    {historicalDate && (
                        <>
                            {' '}réalisé le{' '}
                            <span className="font-bold text-amber-700 dark:text-amber-400">
                                {formatDate(historicalDate)}
                            </span>
                        </>
                    )}.
                </p>
            </div>

            {/* Info banner */}
            <div className="mb-6 flex items-start gap-3 rounded-[18px] border border-blue-100 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800/30 p-4">
                <Info size={16} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                    Chaque section est optionnelle. L'important est d'enregistrer le bilan pour que la{' '}
                    <strong>réévaluation 1-clic</strong> puisse réutiliser la même batterie de tests.
                    Si vous n'avez pas les textes, vous pouvez enregistrer directement sans sections.
                </p>
            </div>

            {/* Progress */}
            <div className="mb-6">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    {filledCount}/{sections.length} sections remplies
                </span>
            </div>

            {/* Sections */}
            <div className="flex flex-col gap-3">
                {sections.map((section) => (
                    <div
                        key={section.id}
                        className="rounded-[20px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-sm transition-shadow hover:shadow-md"
                    >
                        {/* Section header */}
                        <div className="flex items-center gap-3 px-5 py-3.5 bg-[var(--card-bg-raised)] border-b border-[var(--border-color)]">
                            <div className="flex-1 flex items-center gap-3">
                                <FileText size={15} className={section.content.trim() ? 'text-emerald-500' : 'text-[var(--text-disabled)]'} />
                                <span className="flex-1 text-sm font-bold text-[var(--text-heading)]">
                                    {section.title}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => toggleSection(section.id)}
                                className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)]"
                                aria-label={section.isOpen ? 'Réduire' : 'Développer'}
                            >
                                {section.isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                            </button>
                        </div>

                        {/* Section body */}
                        {section.isOpen && (
                            <div className="p-5">
                                <textarea
                                    value={section.content}
                                    onChange={(e) => updateSection(section.id, { content: e.target.value })}
                                    placeholder="Collez ou tapez le contenu de cette section..."
                                    rows={8}
                                    className="w-full resize-y rounded-xl border border-[var(--border-color)] bg-[var(--app-bg)] px-4 py-3 text-sm text-[var(--text-main)] placeholder:text-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30 transition-shadow"
                                />
                                <p className="mt-1.5 text-[10px] text-[var(--text-secondary)]">
                                    {section.content.trim().length} caractères
                                </p>
                            </div>
                        )}

                        {/* Collapsed summary */}
                        {!section.isOpen && section.content.trim() && (
                            <button
                                type="button"
                                onClick={() => toggleSection(section.id)}
                                className="w-full px-5 py-3 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors"
                            >
                                <span className="line-clamp-1">{section.content.trim()}</span>
                            </button>
                        )}

                        {/* Collapsed empty */}
                        {!section.isOpen && !section.content.trim() && (
                            <button
                                type="button"
                                onClick={() => toggleSection(section.id)}
                                className="w-full px-5 py-3 text-left text-xs italic text-[var(--text-disabled)] hover:bg-[var(--hover-bg)] transition-colors"
                            >
                                Section vide — cliquez pour saisir
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Actions */}
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                    type="button"
                    onClick={onBack}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-5 py-3 text-sm font-bold text-[var(--text-secondary)] transition-all hover:border-[var(--text-light)] hover:text-[var(--text-main)] disabled:opacity-50"
                >
                    <ArrowLeft size={16} /> Retour aux scores
                </button>

                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-2xl bg-[#E07A5F] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#E07A5F]/25 transition-all hover:bg-[#d16a4e] hover:shadow-xl disabled:opacity-60"
                >
                    {isSaving ? (
                        <>
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            Enregistrement…
                        </>
                    ) : (
                        <>
                            <Save size={16} /> Enregistrer le bilan de référence
                        </>
                    )}
                </button>
            </div>

            <p className="mt-4 text-center text-[10px] text-[var(--text-secondary)]">
                Ce bilan sera enregistré comme bilan initial formel.
                La réévaluation 1-clic sera disponible immédiatement dans la fiche patient.
            </p>
        </div>
    );
};
