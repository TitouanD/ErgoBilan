import React, { useState, useEffect } from 'react';
import { ShieldCheck, Sparkles, Brain, FileText, Clock, XCircle } from 'lucide-react';

interface Props {
  isVisible: boolean;
  onCancel: () => void; // Permet à l'utilisateur d'abandonner si c'est trop long
}

const STEPS = [
  { id: 1, label: 'Sécurisation & Pseudonymisation', icon: ShieldCheck, duration: 3000 },
  { id: 2, label: 'Analyse Structurelle (IA)', icon: Brain, duration: 15000 },
  { id: 3, label: 'Rédaction Clinique & Mise en page', icon: FileText, duration: 25000 },
];

const ROI_MESSAGES = [
  'Ce chargement vous économise environ 45 minutes de rédaction manuelle.',
  "L'IA vérifie la cohérence entre vos observations et les scores étalonnés.",
  'Analyse des écarts-types en cours...',
  'Génération des hypothèses diagnostiques selon le modèle PPH.',
  'Formatage du document pour une impression directe.',
];

export const GenerationLoader: React.FC<Props> = ({ isVisible, onCancel }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [showCancel, setShowCancel] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      setElapsed(0);
      setCurrentStep(0);
      return;
    }

    const startTime = Date.now();

    // Timer global pour gérer l'affichage progressif
    const timer = setInterval(() => {
      const now = Date.now();
      const diff = now - startTime;
      setElapsed(diff);

      // Gestion des étapes visuelles (Simulation)
      if (diff < STEPS[0].duration) setCurrentStep(0);
      else if (diff < STEPS[0].duration + STEPS[1].duration) setCurrentStep(1);
      else setCurrentStep(2);

      // Rotation des messages ROI toutes les 6s
      if (Math.floor(diff / 6000) % ROI_MESSAGES.length !== messageIndex) {
        setMessageIndex((prev) => (prev + 1) % ROI_MESSAGES.length);
      }

      // Afficher le bouton annuler après 45s d'attente
      if (diff > 45000 && !showCancel) {
        setShowCancel(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isVisible, messageIndex, showCancel]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-[var(--secondary)]/90 backdrop-blur-md flex flex-col items-center justify-center p-6 animate-in fade-in duration-500">
      <div className="w-full max-w-md bg-[var(--card-bg)] rounded-[40px] p-8 shadow-2xl relative overflow-hidden">
        {/* Header Animé */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-24 h-24 bg-[var(--primary)]/10 rounded-full flex items-center justify-center mb-6 relative">
            <div className="absolute inset-0 border-4 border-[var(--primary)]/20 rounded-full border-t-[#E07A5F] animate-spin"></div>
            <Sparkles size={40} className="text-[var(--primary)] animate-pulse" />
          </div>
          <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)] text-center">Génération en cours</h2>
          <div className="flex items-center gap-2 mt-2 text-[var(--text-secondary)] text-xs font-mono bg-[var(--hover-bg)] px-3 py-1 rounded-full">
            <Clock size={12} />
            <span>{Math.floor(elapsed / 1000)}s écoulées</span>
          </div>
        </div>

        {/* Stepper Vertical */}
        <div className="space-y-6 relative mb-10 pl-4">
          {/* Ligne de connexion */}
          <div className="absolute left-[27px] top-4 bottom-4 w-0.5 bg-[var(--border-color)] -z-10"></div>

          {STEPS.map((step, idx) => {
            const isActive = idx === currentStep;
            const isDone = idx < currentStep;

            return (
              <div
                key={step.id}
                className={`flex items-center gap-4 transition-all duration-500 ${isActive || isDone ? 'opacity-100' : 'opacity-40'}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all shadow-sm z-10 ${
                    isActive
                      ? 'bg-[var(--primary)] border-[var(--primary)] text-white scale-110'
                      : isDone
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-disabled)]'
                  }`}
                >
                  <step.icon size={14} strokeWidth={3} />
                </div>
                <div>
                  <p className={`text-sm font-bold ${isActive ? 'text-[var(--text-heading)]' : 'text-[var(--text-secondary)]'}`}>
                    {step.label}
                  </p>
                  {isActive && <p className="text-[10px] text-[var(--primary)] font-bold animate-pulse">Traitement...</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* ROI Message Carousel */}
        <div className="bg-[#fffdf5] dark:bg-amber-950/30 border border-[#F2CC8F]/30 dark:border-amber-800/30 p-4 rounded-2xl text-center relative overflow-hidden min-h-[80px] flex items-center justify-center">
          <p className="text-sm font-medium text-[#d97706] italic animate-in slide-in-from-bottom-2 fade-in duration-500 key={messageIndex}">
            "{ROI_MESSAGES[messageIndex]}"
          </p>
        </div>

        {/* Timeout / Cancel Action */}
        {showCancel && (
          <div className="mt-6 pt-6 border-t border-[var(--border-color)] text-center animate-in fade-in slide-in-from-bottom-4">
            <p className="text-xs text-rose-500 font-bold mb-3 flex items-center justify-center gap-2">
              <XCircle size={14} /> Le traitement est plus long que prévu.
            </p>
            <button
              onClick={onCancel}
              className="text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] underline decoration-[var(--border-color)] underline-offset-4 transition-colors"
            >
              Annuler et réessayer
            </button>
          </div>
        )}
      </div>

      <p className="text-white/40 text-xs mt-8 font-bold uppercase tracking-widest animate-pulse">Ne fermez pas cette fenêtre</p>
    </div>
  );
};
