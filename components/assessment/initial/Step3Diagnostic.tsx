import React from 'react';
import type { ClinicalSynthesis, TestData, Patient } from '../../../types';
import { Sparkles, Brain, Target, Lightbulb } from 'lucide-react';
import { VoiceTextarea } from '../../shared/VoiceTextarea';
import { StepNavFooter } from '../shared/StepNavFooter';
import { ScoresAndObservationsPanel } from '../shared/ScoresAndObservationsPanel';

interface Props {
  synthesis: ClinicalSynthesis;
  updateSynthesis: (data: Partial<ClinicalSynthesis>) => void;
  tests: TestData;
  patient?: Patient;
  onNext: () => void;
  onBack: () => void;
  isGenerating: boolean;
}

export const Step3BisDiagnostic: React.FC<Props> = ({ synthesis, updateSynthesis, tests, patient, onNext, onBack, isGenerating }) => {
  const handleDiagChange = (val: string) => updateSynthesis({ diagnosticInput: val });
  const handleProjectChange = (val: string) => updateSynthesis({ projectInput: val });
  const handleRecoChange = (val: string) => updateSynthesis({ recommendationsInput: val });

  const isReadyToGenerate = synthesis.diagnosticInput.trim().length > 0 && !isGenerating;

  return (
    <div className="max-w-6xl mx-auto pb-10 animate-in fade-in duration-500">
      <div className="mb-8 border-b border-[var(--border-color)] pb-6">
        <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Diagnostic et projet d'accompagnement</h2>
        <p className="text-[var(--text-secondary)] font-medium mt-2">Posez votre diagnostic. L'IA se chargera de le rédiger.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LEFT COLUMN (INPUT) */}
        <div className="lg:col-span-2 space-y-8">
          {/* DIAGNOSTIC BLOCK */}
          <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm relative group hover:border-indigo-200/50 transition-all">
            <div className="flex items-center gap-3 mb-4 text-[var(--text-heading)]">
              <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
                <Brain size={24} />
              </div>
              <div>
                <h3 className="font-bold text-xl">Diagnostic</h3>
                <p className="text-xs text-stone-400 mt-0.5">Votre conclusion clinique argumentée</p>
              </div>
            </div>

            <VoiceTextarea
              value={synthesis.diagnosticInput}
              onChange={handleDiagChange}
              placeholder={
                synthesis.diagnosticInput.trim()
                  ? 'Précisez ou complétez...'
                  : "Ex: TDC mixte associé à une dysgraphie. L'impact sur la scolarité est majeur..."
              }
              className="bg-[var(--app-bg)] rounded-2xl border-2 border-transparent focus:bg-[var(--card-bg)] focus:border-indigo-200 transition-all mt-4"
              rows={8}
            />
          </div>

          {/* PROJECT BLOCK */}
          <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm relative group hover:border-emerald-200/50 transition-all">
            <div className="flex items-center gap-3 mb-4 text-[var(--text-heading)]">
              <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl">
                <Target size={24} />
              </div>
              <div>
                <h3 className="font-bold text-xl">Projet d'accompagnement</h3>
                <p className="text-xs text-stone-400 mt-0.5">Orientations globales du suivi</p>
              </div>
            </div>

            <VoiceTextarea
              value={synthesis.projectInput || ''}
              onChange={handleProjectChange}
              placeholder={
                synthesis.projectInput?.trim()
                  ? 'Précisez ou complétez...'
                  : 'Ex: Suivi ergo hebdomadaire. Accompagnement parental. Coordination équipe pluridisciplinaire.'
              }
              className="bg-[var(--app-bg)] rounded-2xl border-2 border-transparent focus:bg-[var(--card-bg)] focus:border-emerald-200 transition-all mt-4"
              rows={8}
            />
          </div>

          {/* RECOMMENDATIONS BLOCK */}
          <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm relative group hover:border-teal-200/50 transition-all">
            <div className="flex items-center gap-3 mb-4 text-[var(--text-heading)]">
              <div className="p-2 bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-xl">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-xl">Préconisations</h3>
                <p className="text-xs text-stone-400 mt-0.5">Aménagements, aides, outils concrets</p>
              </div>
            </div>

            <VoiceTextarea
              value={synthesis.recommendationsInput}
              onChange={handleRecoChange}
              placeholder={
                synthesis.recommendationsInput.trim()
                  ? 'Précisez ou complétez...'
                  : 'Ex: Tiers-temps aux examens. Mise en place du clavier caché. PAP.'
              }
              className="bg-[var(--app-bg)] rounded-2xl border-2 border-transparent focus:bg-[var(--card-bg)] focus:border-teal-200 transition-all mt-4"
              rows={8}
            />
          </div>

          {/* INFO BOX (moved under Préconisations) */}
          <div className="bg-[#fffdf5] dark:bg-amber-950/30 border border-[#F2CC8F]/50 dark:border-amber-800/30 p-6 rounded-2xl">
            <h4 className="font-bold text-[#d97706] dark:text-amber-400 mb-3 flex items-center gap-2 text-sm">
              <Lightbulb size={16} /> Conseils de rédaction
            </h4>
            <p className="text-xs text-[#92400e] dark:text-amber-200/80 leading-relaxed mb-2">
              L'IA ne pose pas de diagnostic, <strong>c'est votre rôle légal</strong>.
            </p>
            <p className="text-xs text-[#92400e] dark:text-amber-200/80 leading-relaxed">
              En remplissant ces champs, vous orientez la rédaction. L'IA utilisera vos conclusions pour structurer l'argumentaire et lier
              les preuves (scores) à votre diagnostic.
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN (CONTEXT) */}
        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <ScoresAndObservationsPanel tests={tests} interviewNotes={patient?.interviewNotes} />
        </div>
      </div>

      {/* NAVIGATION FOOTER */}
      <StepNavFooter onBack={onBack}>
        <button
          onClick={onNext}
          disabled={isGenerating || !synthesis.diagnosticInput.trim()}
          className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all duration-300 disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed ${
            isReadyToGenerate
              ? 'bg-gradient-to-r from-[#E07A5F] to-[#d97706] hover:shadow-orange-200 dark:hover:shadow-orange-900/40 hover:scale-[1.02]'
              : 'bg-[#3D405B] hover:bg-[#E07A5F]'
          }`}
        >
          {isGenerating ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Génération du rapport...</span>
            </>
          ) : (
            <>
              <Sparkles size={20} className={isReadyToGenerate ? 'animate-bounce' : ''} />
              <span>{!synthesis.diagnosticInput.trim() ? 'Diagnostic requis' : 'Générer'}</span>
            </>
          )}
        </button>
      </StepNavFooter>
    </div>
  );
};
