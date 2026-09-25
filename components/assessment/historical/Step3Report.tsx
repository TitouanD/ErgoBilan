/**
 * HistoricalSectionsStep — Step 3 of the "historique" import flow.
 *
 * Lets the practitioner paste the content of an existing assessment report
 * (sections) so the system stores it as a formal PatientAssessment.
 * This activates the "Réévaluation 1-clic" button for this patient.
 */
import React, { useCallback, useState } from 'react';
import type { Patient, ReportSection } from '../../../types';
import { FileText, Save, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { StepNavFooter } from '../shared/StepNavFooter';

// ─── Standard ErgoBilan sections (same IDs as AI generation uses) ─────────────
// IDs MUST match the sections emitted by AIService.generateInitialReport ('objectifs' is
// hidden from reports, see HIDDEN_SECTION_IDS in utils/reportData.ts, so it is not asked here).
// This ensures the reevaluation AI can correctly reference previous sections.

const DEFAULT_SECTIONS: { id: string; title: string }[] = [
    { id: 'mandat_ref',     title: 'Mandat de référencement en ergothérapie' },
    { id: 'mandat_eval',    title: 'Mandat d\'évaluation en ergothérapie' },
    { id: 'profil',         title: 'Profil occupationnel' },
    { id: 'diagnostic',     title: 'Diagnostic en ergothérapie' },
    { id: 'project',        title: 'Projet d\'accompagnement' },
    { id: 'recommandations', title: 'Recommandations' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
    patient: Patient;
    historicalDate: string;
    /** Sections live in the assessment context so they survive navigation and are saved in the draft. */
    sections: ReportSection[];
    onChangeSection: (id: string, update: Partial<ReportSection>) => void;
    onBack: () => void;
    onSave: () => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (isoDate: string): string => {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    return Number.isNaN(date.getTime()) ? isoDate : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

// ─── Component ────────────────────────────────────────────────────────────────

export const HistoricalSectionsStep: React.FC<Props> = ({ patient, historicalDate, sections: stored, onChangeSection, onBack, onSave }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [openIds, setOpenIds] = useState<Set<string>>(new Set());

    const sections = DEFAULT_SECTIONS.map((def) => ({ ...def, content: stored.find((s) => s.id === def.id)?.content ?? '' }));
    const updateSection = (id: string, content: string) => {
        const def = DEFAULT_SECTIONS.find((d) => d.id === id)!;
        onChangeSection(id, { title: def.title, content, contentFormat: 'plain', status: 'validated', isAiGenerated: false });
    };
    const toggleSection = (id: string) =>
        setOpenIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const allExpanded = openIds.size === sections.length;
    const toggleAll = () => setOpenIds(allExpanded ? new Set() : new Set(sections.map((s) => s.id)));

    const handleSave = useCallback(async () => {
        const hasText = stored.some((s) => s.content.trim().length > 0);
        if (!hasText) {
            const confirm = window.confirm(
                'Aucune section ne contient de texte. Voulez-vous quand même enregistrer le bilan (sans rapport) pour activer la réévaluation 1-clic ?'
            );
            if (!confirm) return;
        }
        setIsSaving(true);
        try {
            await onSave();
        } finally {
            setIsSaving(false);
        }
    }, [stored, onSave]);

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
            <div className="mb-6 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    {filledCount}/{sections.length} sections remplies
                </span>
                <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs font-semibold text-[var(--primary)] hover:underline"
                >
                    {allExpanded ? 'Tout réduire' : 'Tout développer'}
                </button>
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
                                aria-label={openIds.has(section.id) ? 'Réduire' : 'Développer'}
                            >
                                {openIds.has(section.id) ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                            </button>
                        </div>

                        {/* Section body */}
                        {openIds.has(section.id) && (
                            <div className="p-5">
                                <textarea
                                    value={section.content}
                                    onChange={(e) => updateSection(section.id, e.target.value)}
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
                        {!openIds.has(section.id) && section.content.trim() && (
                            <button
                                type="button"
                                onClick={() => toggleSection(section.id)}
                                className="w-full px-5 py-3 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] transition-colors"
                            >
                                <span className="line-clamp-1">{section.content.trim()}</span>
                            </button>
                        )}

                        {/* Collapsed empty */}
                        {!openIds.has(section.id) && !section.content.trim() && (
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
            <StepNavFooter onBack={onBack} backLabel="Retour aux scores" backDisabled={isSaving}>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all duration-300 disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed bg-gradient-to-r from-[#E07A5F] to-[#d97706] hover:shadow-orange-200 hover:scale-[1.02]"
                >
                    {isSaving ? (
                        <>
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            Enregistrement…
                        </>
                    ) : (
                        <>
                            <Save size={20} /> Enregistrer
                        </>
                    )}
                </button>
            </StepNavFooter>

            <p className="mt-4 text-center text-[10px] text-[var(--text-secondary)]">
                Ce bilan sera enregistré comme bilan initial formel.
                La réévaluation 1-clic sera disponible immédiatement dans la fiche patient.
            </p>
        </div>
    );
};
