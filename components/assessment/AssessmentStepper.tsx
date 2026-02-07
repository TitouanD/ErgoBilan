import React from 'react';
import { Check, User, Activity, Brain, FileCheck, Download } from 'lucide-react';

interface Props {
    currentStep: number;
    onStepClick: (step: number) => void;
}

export const AssessmentStepper: React.FC<Props> = ({ currentStep, onStepClick }) => {
    const STEPS = [
        { num: 1, label: 'Dossier', icon: User },
        { num: 2, label: 'Tests', icon: Activity },
        { num: 3, label: 'Synthèse', icon: Brain },
        { num: 4, label: 'Validation', icon: FileCheck },
        { num: 5, label: 'Export', icon: Download },
    ];

    return (
        <div className="max-w-3xl mx-auto mb-12 relative px-4 animate-in slide-in-from-top-4 duration-700 no-print">
            {/* Background Line */}
            <div className="absolute top-5 left-10 right-10 h-1 bg-stone-100 -z-10 rounded-full">
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
                            onClick={() => !isFuture && onStepClick(s.num)}
                            disabled={isFuture}
                            className={`flex flex-col items-center gap-3 group focus:outline-none ${isFuture ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 shadow-sm relative z-10 ${
                                isActive ? 'bg-[#E07A5F] border-[#E07A5F] text-white scale-110 shadow-lg shadow-orange-200' :
                                isCompleted ? 'bg-white border-emerald-400 text-emerald-500' :
                                'bg-white border-stone-200 text-stone-300'
                            }`}>
                                {isCompleted ? <Check size={16} strokeWidth={4} /> : <s.icon size={16} strokeWidth={isActive ? 3 : 2} />}
                            </div>
                            <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors duration-300 ${
                                isActive ? 'text-[#3D405B] translate-y-0' : 
                                isCompleted ? 'text-emerald-600' : 'text-stone-300'
                            }`}>
                                {s.label}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    );
};