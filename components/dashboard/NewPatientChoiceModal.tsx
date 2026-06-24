import React, { useEffect, useRef } from 'react';
import { Link as LinkIcon, UserPlus, History, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onChooseFamilyLink: () => void;
  onChooseManual: () => void;
  onChooseHistorical: () => void;
}

export const NewPatientChoiceModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onChooseFamilyLink,
  onChooseManual,
  onChooseHistorical,
}) => {
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    firstButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFamily = () => {
    onChooseFamilyLink();
    onClose();
  };

  const handleManual = () => {
    onChooseManual();
    onClose();
  };

  const handleHistorical = () => {
    onChooseHistorical();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--secondary)]/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-full max-w-[620px] rounded-[28px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6 shadow-2xl md:p-7"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-2xl font-bold text-[var(--text-heading)]">Nouveau patient</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Choisissez comment démarrer le dossier.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-xl border border-[var(--border-color)] p-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--text-light)] hover:text-[var(--text-main)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <button
            ref={firstButtonRef}
            type="button"
            onClick={handleFamily}
            className="group flex min-h-[140px] flex-col items-start justify-between rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-left transition-all hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 focus:outline-none focus:ring-4 focus:ring-[#E07A5F]/15"
          >
            <span className="rounded-xl bg-[var(--hover-bg)] p-2.5 text-[var(--text-main)] transition-colors group-hover:bg-[var(--primary)]/15 group-hover:text-[var(--primary)]">
              <LinkIcon size={18} />
            </span>
            <div>
              <div className="text-sm font-bold text-[var(--text-main)]">Envoyer un lien famille</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">La famille remplit le questionnaire à distance.</div>
            </div>
          </button>

          <button
            type="button"
            onClick={handleManual}
            className="group flex min-h-[140px] flex-col items-start justify-between rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-left transition-all hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 focus:outline-none focus:ring-4 focus:ring-[#E07A5F]/15"
          >
            <span className="rounded-xl bg-[var(--hover-bg)] p-2.5 text-[var(--text-main)] transition-colors group-hover:bg-[var(--primary)]/15 group-hover:text-[var(--primary)]">
              <UserPlus size={18} />
            </span>
            <div>
              <div className="text-sm font-bold text-[var(--text-main)]">Saisie manuelle</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">Création immédiate du dossier par le praticien.</div>
            </div>
          </button>

          <button
            type="button"
            onClick={handleHistorical}
            className="group flex min-h-[140px] flex-col items-start justify-between rounded-2xl border border-[var(--secondary)]/30 bg-[var(--secondary)]/5 p-4 text-left transition-all hover:border-[var(--secondary)] hover:bg-[var(--secondary)]/10 focus:outline-none focus:ring-4 focus:ring-[var(--secondary)]/15"
          >
            <span className="rounded-xl bg-[var(--secondary)]/10 p-2.5 text-[var(--secondary)] transition-colors group-hover:bg-[var(--secondary)]/20">
              <History size={18} />
            </span>
            <div>
              <div className="text-sm font-bold text-[var(--text-main)]">Bilan antérieur</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">Importer un bilan existant pour activer la réévaluation 1-clic.</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
