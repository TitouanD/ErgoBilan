/**
 * HistoricalPatientForm — Step 1 of the "historique" import flow.
 *
 * Collects only the fields needed to display the patient profile:
 * name, DOB, gender, school, class level.
 * Does NOT ask for family, medical, development or autonomy data —
 * those are only needed for AI report generation.
 */
import React, { useState } from 'react';
import type { Patient } from '../../../types';
import { isPatientCreationReady } from '../../../utils/patient';
import { History, ArrowRight, Loader2 } from 'lucide-react';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../contexts/ToastContext';
import { useAssessment } from '../../../contexts/AssessmentContext';
import { SharedQuestionnaire } from '../../shared/SharedQuestionnaire';

interface Props {
    data: Patient;
    updateData: (data: Partial<Patient>) => void;
    onNext: () => void;
    onPatientCreated: () => void;
}

export const HistoricalPatientForm: React.FC<Props> = ({
    data,
    updateData,
    onNext,
    onPatientCreated,
}) => {
    const toast = useToast();
    const { historicalDate, setHistoricalDate, ensurePatient } = useAssessment();
    const [isSaving, setIsSaving] = useState(false);

    const handleNext = async () => {
        if (!isPatientCreationReady(data)) {
            toast.error('Prénom, nom et date de naissance sont obligatoires.');
            return;
        }
        if (!historicalDate) {
            toast.error("Veuillez indiquer la date du bilan d'origine.");
            return;
        }

        setIsSaving(true);
        try {
            const result = await ensurePatient({ syncPreview: true });
            if (!result.ok) throw new Error(result.reason);
            onPatientCreated();
            onNext();
        } catch (e) {
            Logger.error('DB', 'HistoricalPatientForm: save failed', e);
            toast.error('Impossible de créer le patient. Réessayez.');
        } finally {
            setIsSaving(false);
        }
    };

    const isReady = isPatientCreationReady(data) && !!historicalDate;

    return (
        <div className="max-w-2xl mx-auto pb-20 animate-in fade-in duration-500">

            {/* Header */}
            <div className="mb-8 border-b border-[var(--border-color)] pb-6">
                <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Dossier Patient</h2>
                <p className="text-[var(--text-secondary)] font-medium mt-2">
                    Informations de base pour identifier le patient dans l'application.
                </p>
            </div>

            {/* Import banner */}
            <div className="mb-8 flex items-start gap-3 rounded-[20px] border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/40 p-5">
                <div className="rounded-xl bg-amber-100 dark:bg-amber-900/40 p-2.5 text-amber-700 dark:text-amber-400 shrink-0">
                    <History size={18} />
                </div>
                <div>
                    <p className="font-bold text-sm text-amber-800 dark:text-amber-300">Mode import — Bilan antérieur</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                        Seules les informations d'affichage sont nécessaires ici. Les données cliniques détaillées
                        (famille, médical, développement…) ne sont utiles que pour la génération IA du rapport initial,
                        que vous ne faites pas dans ce cas.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-5">

            {/* Date du bilan d'origine */}
            <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6 shadow-sm">
                <h3 className="font-bold text-sm uppercase tracking-wider text-[var(--text-secondary)] mb-4">
                    Date du bilan
                </h3>
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-[var(--text-main)]">
                        Date du bilan d'origine <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="date"
                        value={historicalDate ? historicalDate.slice(0, 10) : ''}
                        onChange={(e) =>
                            setHistoricalDate(e.target.value ? new Date(e.target.value).toISOString() : '')
                        }
                        max={new Date().toISOString().slice(0, 10)}
                        className="w-full max-w-xs rounded-xl border border-[var(--border-color)] bg-[var(--app-bg)] px-4 py-2.5 text-sm font-medium text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
                    />
                    <p className="text-[10px] text-[var(--text-secondary)]">
                        Date à laquelle le bilan original a été réalisé.
                    </p>
                </div>
            </div>

            {/* Identity + school fields via shared component */}
            <SharedQuestionnaire mode="historical" data={data} onChange={updateData} />

            </div>{/* end flex-col gap-5 */}

            {/* Navigation */}
            <div className="mt-10 flex justify-end">
                <button
                    type="button"
                    onClick={handleNext}
                    disabled={!isReady || isSaving}
                    className="flex items-center gap-2 rounded-2xl bg-[#E07A5F] px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#E07A5F]/25 transition-all hover:bg-[#d16a4e] hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving ? (
                        <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
                    ) : (
                        <>Suivant — Saisir les scores <ArrowRight size={16} /></>
                    )}
                </button>
            </div>

            {!isReady && (
                <p className="mt-3 text-right text-[10px] text-[var(--text-secondary)]">
                    {!isPatientCreationReady(data) ? 'Prénom, nom et date de naissance sont obligatoires.' : 'La date du bilan d\'origine est obligatoire.'}
                </p>
            )}
        </div>
    );
};
