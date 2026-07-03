/**
 * reevaluation/Step1Scores.tsx
 *
 * Thin wrapper around ScorePage for the reevaluation flow.
 * The previous assessment scores are pre-populated into assessment.tests
 * by App.tsx before this step is rendered — ScorePage sees them as normal
 * current scores without knowing it's a reevaluation.
 *
 * This wrapper only adds a contextual banner so the therapist knows
 * the fields are pre-filled and just needs to update them.
 */

import React, { useState } from 'react';
import type { Patient, TestData, Observations, UserProfile } from '../../../types';
import { Info, X } from 'lucide-react';
import { Step2Tests } from '../pages/ScorePage';

interface Props {
    patient: Patient;
    tests: TestData;
    updateTests: (data: TestData) => void;
    observations: Observations;
    updateObservations: (data: Partial<Observations>) => void;
    onNext: () => void;
    onBack: () => void;
    userProfile?: UserProfile;
    previousAssessmentDate?: string;
}

export const Step1Scores: React.FC<Props> = ({
    previousAssessmentDate,
    ...scorePageProps
}) => {
    const [bannerDismissed, setBannerDismissed] = useState(false);

    const formattedDate = previousAssessmentDate
        ? new Date(previousAssessmentDate).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
          })
        : null;

    return (
        <div>
            {!bannerDismissed && formattedDate && (
                <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[var(--secondary)]/25 bg-[var(--secondary)]/8 px-5 py-4 animate-in slide-in-from-top-2 duration-300">
                    <Info size={18} className="mt-0.5 flex-shrink-0 text-[var(--secondary)]" />
                    <div className="flex-1">
                        <p className="text-sm font-bold text-[var(--text-heading)]">
                            Scores pré-remplis depuis le bilan du {formattedDate}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                            Modifiez directement les nouvelles valeurs dans les champs ci-dessous.
                            Les scores non modifiés seront repris tels quels.
                        </p>
                    </div>
                    <button
                        onClick={() => setBannerDismissed(true)}
                        className="flex-shrink-0 text-[var(--text-disabled)] hover:text-[var(--text-main)] transition-colors"
                        aria-label="Fermer"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}
            <Step2Tests {...scorePageProps} />
        </div>
    );
};
