
import React from 'react';
import { Check, User, Activity, Brain, FileCheck, Download, TrendingUp, FileText } from 'lucide-react';

interface Props {
    currentStep: number;
    onStepClick: (step: number) => void;
    disabled?: boolean;
    reportType?: 'initial' | 'reevaluation' | 'historique';
}

export const AssessmentStepper: React.FC<Props> = ({ currentStep, onStepClick, disabled, reportType = 'initial' }) => {
    const INITIAL_STEPS = [
        { num: 1, label: 'Dossier', icon: User },
        { num: 2, label: 'Tests & Obs.', icon: Activity },
        { num: 3, label: 'Diagnostic', icon: Brain },
        { num: 4, label: 'Validation', icon: FileCheck },
        { num: 5, label: 'Visualisation', icon: Download },
    ];

    const REEV_STEPS = [
        { num: 1, label: 'Tests', icon: Activity },
        { num: 2, label: 'Évolution', icon: TrendingUp },
        { num: 3, label: 'Validation', icon: FileCheck },
        { num: 4, label: 'Export', icon: Download },
    ];

    const HISTORICAL_STEPS = [
        { num: 1, label: 'Dossier', icon: User },
        { num: 2, label: 'Scores', icon: Activity },
        { num: 3, label: 'Rapport', icon: FileText },
    ];

    const STEPS = reportType === 'reevaluation' ? REEV_STEPS : reportType === 'historique' ? HISTORICAL_STEPS : INITIAL_STEPS;

    return (
        <div className="max-w-3xl mx-auto mb-12 relative px-4 animate-in slide-in-from-top-4 duration-700 no-print">
            {/* Badge type */}
            {reportType === 'reevaluation' && (
                <div className="flex justify-center mb-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--secondary)]/10 border border-[var(--secondary)]/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--secondary)]">
                        Réévaluation 1 clic
                    </span>
                </div>
            )}
            {reportType === 'historique' && (
                <div className="flex justify-center mb-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-200 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:bg-amber-900/30 dark:border-amber-700/40 dark:text-amber-400">
                        Import bilan antérieur
                    </span>
                </div>
            )}
            {/* Background Line */}
            <div className="absolute top-5 left-10 right-10 h-1 bg-[var(--progress-bg)] -z-10 rounded-full" style={{ top: (reportType === 'reevaluation' || reportType === 'historique') ? '2.8rem' : '1.25rem' }}>
                <div
                    className="h-full bg-gradient-to-r from-[#E07A5F] to-[#F2CC8F] transition-all duration-500 rounded-full"
                    style={{ width: `${((currentStep - 1) / (STEPS.length - 1)) * 100}%` }}
                ></div>
            </div>

            <div className="flex justify-between relative">
                {STEPS.map((s) => {
                    const isActive = s.num === currentStep;
                    const isCompleted = s.num < currentStep;
                    const isFuture = s.num > currentStep;

                    return (
                        <button
                            key={s.num}
                            onClick={() => !isFuture && !disabled && onStepClick(s.num)}
                            disabled={isFuture || disabled}
                            className={`flex flex-col items-center gap-3 group focus:outline-none ${(isFuture || disabled) ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
                        >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 shadow-sm relative z-10 ${
                                isActive ? 'bg-[#E07A5F] border-[#E07A5F] text-white scale-110 shadow-lg shadow-orange-200 dark:shadow-black/30' :
                                isCompleted ? 'bg-[var(--card-bg)] border-emerald-400 text-emerald-500' :
                                'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-disabled)]'
                            }`}>
                                {isCompleted ? <Check size={16} strokeWidth={4} /> : <s.icon size={16} strokeWidth={isActive ? 3 : 2} />}
                            </div>
                            <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors duration-300 ${
                                isActive ? 'text-[var(--text-heading)] translate-y-0' :
                                isCompleted ? 'text-emerald-600' : 'text-[var(--text-disabled)]'
                            }`}>
                                {s.label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
