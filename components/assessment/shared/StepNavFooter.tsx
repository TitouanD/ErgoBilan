import React from 'react';

interface StepNavFooterProps {
  onBack: () => void;
  backLabel?: string;
  backDisabled?: boolean;
  children?: React.ReactNode;
}

/**
 * Shared navigation footer for all assessment steps.
 * Reference style: initial bilan (text-only Retour, CTA slot on the right).
 */
export const StepNavFooter: React.FC<StepNavFooterProps> = ({
  onBack,
  backLabel = 'Retour',
  backDisabled,
  children,
}) => (
  <div className="mt-10 flex justify-between items-center gap-4">
    <button
      onClick={onBack}
      disabled={backDisabled}
      className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] font-bold text-sm uppercase tracking-widest px-2 transition-colors disabled:opacity-50"
    >
      {backLabel}
    </button>
    {children}
  </div>
);
