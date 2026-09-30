/**
 * AssessmentWorkspace — stepper + steps of the three assessment flows:
 *
 * - initial      : Dossier → Tests → Diagnostic (AI) → Relecture → Export
 * - reevaluation : Nouveaux scores → Évolution (AI or manual) → Relecture → Export
 * - historique   : Dossier → Tests → Rapport antérieur (no AI)
 *
 * Generation, finalization and "save & quit" come from useAssessmentFlow (owned
 * by the router, which also needs "save & quit" for the header button).
 */

import React, { Suspense, useEffect, useState } from 'react';
import { FileText, Loader2, ShieldCheck } from 'lucide-react';
import { useAssessment } from '../../contexts/AssessmentContext';
import { useAuth } from '../../contexts/AuthContext';
import type { useAssessmentFlow } from '../../hooks/useAssessmentFlow';
import { AssessmentStepper } from './shared/AssessmentStepper';
import { Step1Admin } from './initial/Step1Admin';
import { GenerationLoader } from '../shared/GenerationLoader';
import { CriticalErrorModal } from '../shared/CriticalErrorModal';
import { ConfirmModal } from '../shared/ConfirmModal';
import { SuspectTermsReview, useSuspectTermChoices } from '../shared/SuspectTermsReview';

const ScorePage = React.lazy(() => import('./pages/ScorePage').then((m) => ({ default: m.ScorePage })));
const ValidationPage = React.lazy(() => import('./pages/ValidationPage').then((m) => ({ default: m.ValidationPage })));
const ExportPage = React.lazy(() => import('./pages/ExportPage').then((m) => ({ default: m.ExportPage })));
const Step3Diagnostic = React.lazy(() => import('./initial/Step3Diagnostic').then((m) => ({ default: m.Step3BisDiagnostic })));
const ReevStep1Scores = React.lazy(() => import('./reevaluation/Step1Scores').then((m) => ({ default: m.Step1Scores })));
const ReevStep2Evolution = React.lazy(() => import('./reevaluation/Step2Evolution').then((m) => ({ default: m.Step2Evolution })));
const HistoricalPatientForm = React.lazy(() => import('./historical/Step1Form').then((m) => ({ default: m.HistoricalPatientForm })));
const HistoricalSectionsStep = React.lazy(() => import('./historical/Step3Report').then((m) => ({ default: m.HistoricalSectionsStep })));

/** Step producing the report sections: going back to it (or before) may overwrite review edits. */
const GENERATION_STEP = { initial: 3, reevaluation: 2, historique: Number.POSITIVE_INFINITY } as const;

interface Props {
  flow: ReturnType<typeof useAssessmentFlow>;
  onExit: () => void;
  onOpenProfile: () => void;
  onShowPricing: (mode: 'plans' | 'paywall') => void;
  onDemoConvert: (action: string) => void;
  loadData: () => Promise<void>;
}

const StepLoader = () => (
  <div className="flex h-[40vh] items-center justify-center">
    <Loader2 size={32} className="animate-spin text-[#E07A5F]" />
  </div>
);

export const AssessmentWorkspace: React.FC<Props> = ({ flow, onExit, onOpenProfile, onShowPricing, onDemoConvert, loadData }) => {
  const assessment = useAssessment();
  const { userProfile, isDemoMode, updateBranding } = useAuth();
  const [stepperTarget, setStepperTarget] = useState<number | null>(null);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  /** Suspect words of the confirmation before the initial report; null while it is closed. */
  const [generationConfirmTerms, setGenerationConfirmTerms] = useState<string[] | null>(null);
  const termChoices = useSuspectTermChoices(generationConfirmTerms ?? []);
  const [loaderDismissed, setLoaderDismissed] = useState(false);

  const { reportType, step, setStep } = assessment;
  const hasCredits =
    isDemoMode || userProfile.credits > 0 || (userProfile.subscriptionPlan === 'expert' && userProfile.status === 'active');

  useEffect(() => {
    if (!flow.isGenerating) setLoaderDismissed(false);
  }, [flow.isGenerating]);

  // Insufficient credits → paywall instead of an error message
  useEffect(() => {
    if (flow.generationError !== 'CREDIT_INSUFFICIENT') return;
    onShowPricing('paywall');
    flow.clearGenerationError();
  }, [flow.generationError]);

  const handleStepperClick = (target: number) => {
    const generationStep = GENERATION_STEP[reportType];
    if (target < step && target <= generationStep && step > generationStep && assessment.sections.length > 0) {
      setStepperTarget(target);
      return;
    }
    setStep(target);
  };

  const handleQuit = () => {
    const hasData = Boolean(assessment.patient.firstName || assessment.patient.lastName || assessment.patient.dob);
    if (hasData) return setShowQuitConfirm(true);
    void assessment.discard();
    onExit();
  };

  const handleQuitDiscard = async () => {
    setShowQuitConfirm(false);
    if (await assessment.discard()) void loadData();
    onExit();
  };

  const handleQuitSave = async () => {
    setShowQuitConfirm(false);
    if (await flow.saveAndQuit()) onExit();
  };

  const finalizeAndExit = async () => {
    if (await flow.finalize()) onExit();
  };

  const validateSection = (id: string, html?: string) =>
    assessment.updateSection(id, { status: 'validated', ...(html !== undefined ? { content: html, contentFormat: 'html' as const } : {}) });

  const exportPage = (backStep: number) => (
    <ExportPage
      patient={assessment.patient}
      sections={assessment.sections}
      tests={assessment.tests}
      previousTests={reportType === 'reevaluation' ? (assessment.previousAssessment?.tests ?? {}) : undefined}
      reportType={reportType}
      reportPages={assessment.reportPages}
      onReportPagesChange={assessment.setReportPages}
      onValidate={finalizeAndExit}
      onUpdateSection={assessment.updateSection}
      branding={userProfile.branding}
      onUpdateBranding={updateBranding}
      isPremium={userProfile.subscriptionPlan !== 'free'}
      onShowPricing={() => onShowPricing('plans')}
      onBack={() => setStep(backStep)}
      isDemoMode={isDemoMode}
      onDemoConvert={onDemoConvert}
      onOpenProfile={onOpenProfile}
    />
  );

  return (
    <div className="max-w-7xl mx-auto p-6">
      <AssessmentStepper currentStep={step} onStepClick={handleStepperClick} disabled={flow.isGenerating} reportType={reportType} />

      <Suspense fallback={<StepLoader />}>
        {reportType === 'initial' && (
          <>
            {step === 1 && (
              <Step1Admin
                data={assessment.patient}
                updateData={assessment.updatePatient}
                onQuit={handleQuit}
                onNext={() => setStep(2)}
                onPatientCreated={loadData}
              />
            )}
            {step === 2 && (
              <ScorePage
                tests={assessment.tests}
                updateTests={assessment.updateTests}
                onNext={() => setStep(3)}
                onBack={() => setStep(1)}
              />
            )}
            {step === 3 && (
              <Step3Diagnostic
                synthesis={assessment.synthesis}
                updateSynthesis={assessment.updateSynthesis}
                tests={assessment.tests}
                patient={assessment.patient}
                onNext={() => (hasCredits ? setGenerationConfirmTerms(flow.findSuspectTerms()) : onShowPricing('paywall'))}
                onBack={() => setStep(2)}
                isGenerating={flow.isGenerating}
              />
            )}
            {step === 4 && (
              <ValidationPage
                sections={assessment.sections}
                onValidateSection={validateSection}
                onNext={() => setStep(5)}
                onBack={() => setStep(3)}
              />
            )}
            {step === 5 && exportPage(4)}
          </>
        )}

        {reportType === 'reevaluation' && (
          <>
            {step === 1 && (
              <ReevStep1Scores
                tests={assessment.tests}
                updateTests={assessment.updateTests}
                onNext={() => setStep(2)}
                onBack={handleQuit}
                previousAssessmentDate={assessment.previousAssessment?.date}
                previousTests={assessment.previousAssessment?.tests ?? {}}
              />
            )}
            {step === 2 && (
              <ReevStep2Evolution
                previousAssessment={assessment.previousAssessment}
                newTests={assessment.tests}
                sections={assessment.sections}
                onSetSections={assessment.setSections}
                onGenerate={flow.generateReevaluation}
                findSuspectTerms={flow.findSuspectTerms}
                isGenerating={flow.isGenerating}
                hasCredits={hasCredits}
                isDemoMode={isDemoMode}
                onNeedCredits={() => onShowPricing('paywall')}
                onNext={() => setStep(3)}
                onBack={() => setStep(1)}
              />
            )}
            {step === 3 && (
              <ValidationPage
                sections={assessment.sections}
                onValidateSection={validateSection}
                onNext={() => setStep(4)}
                onBack={() => setStep(2)}
              />
            )}
            {step === 4 && exportPage(3)}
          </>
        )}

        {reportType === 'historique' && (
          <>
            {step === 1 && (
              <HistoricalPatientForm
                data={assessment.patient}
                updateData={assessment.updatePatient}
                onNext={() => setStep(2)}
                onPatientCreated={loadData}
              />
            )}
            {step === 2 && (
              <ScorePage
                tests={assessment.tests}
                updateTests={assessment.updateTests}
                onNext={() => setStep(3)}
                onBack={() => setStep(1)}
                nextLabel="Passer au rapport"
              />
            )}
            {step === 3 && (
              <HistoricalSectionsStep
                patient={assessment.patient}
                historicalDate={assessment.historicalDate}
                sections={assessment.sections}
                onChangeSection={assessment.updateSection}
                onBack={() => setStep(2)}
                onSave={finalizeAndExit}
              />
            )}
          </>
        )}
      </Suspense>

      <GenerationLoader isVisible={flow.isGenerating && !loaderDismissed} onCancel={() => setLoaderDismissed(true)} />
      {flow.generationError && flow.generationError !== 'CREDIT_INSUFFICIENT' && (
        <CriticalErrorModal
          error={flow.generationError}
          onRetry={() => {
            flow.clearGenerationError();
            void (reportType === 'reevaluation' ? flow.generateReevaluation() : flow.generateInitialReport());
          }}
          onClose={flow.clearGenerationError}
        />
      )}

      <ConfirmModal
        isOpen={stepperTarget !== null}
        title="Retour en arrière"
        message={
          'Vous avez déjà un rapport généré. Si vous revenez en arrière et régénérez le bilan, vos modifications de relecture seront écrasées.\n\nContinuer ?'
        }
        confirmLabel="Continuer"
        cancelLabel="Annuler"
        variant="warning"
        onConfirm={() => {
          if (stepperTarget !== null) setStep(stepperTarget);
          setStepperTarget(null);
        }}
        onCancel={() => setStepperTarget(null)}
      />

      <ConfirmModal
        isOpen={showQuitConfirm}
        title="Quitter le bilan"
        message="Souhaitez-vous sauvegarder un brouillon avant de quitter ?"
        confirmLabel="Quitter sans sauvegarder"
        cancelLabel="Annuler"
        variant="danger"
        secondaryAction={{ label: 'Sauvegarder le brouillon', onClick: handleQuitSave }}
        onConfirm={handleQuitDiscard}
        onCancel={() => setShowQuitConfirm(false)}
      />

      {generationConfirmTerms && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--card-bg)] p-8 rounded-[32px] max-w-md text-center shadow-2xl border border-[var(--border-color)]">
            <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]">
              <FileText size={40} />
            </div>
            <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Vérification avant analyse</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4 font-medium leading-relaxed">
              La qualité du rapport dépend de la précision de vos observations et du diagnostic posé. Avez-vous tout relu ?
            </p>
            <SuspectTermsReview terms={generationConfirmTerms} isMasked={termChoices.isMasked} onToggle={termChoices.toggle} />
            <div className="bg-[var(--card-bg-raised)] p-3 rounded-xl mb-8 border border-[var(--border-color)] flex gap-2 text-left">
              <ShieldCheck size={20} className="text-[#81B29A] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                <strong>Confidentialité :</strong> les noms et coordonnées sont remplacés par des pseudonymes avant l'envoi à l'IA.
              </p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setGenerationConfirmTerms(null)}
                className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-xs uppercase tracking-wider"
              >
                Retourner ajouter des détails
              </button>
              <button
                id="demo-btn-generate"
                onClick={() => {
                  setGenerationConfirmTerms(null);
                  void flow.generateInitialReport(termChoices.decisions);
                }}
                className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all"
              >
                {isDemoMode ? 'Générer' : 'Générer (1 crédit)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
