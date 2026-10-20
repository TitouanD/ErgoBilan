import React from 'react';
import { User } from 'lucide-react';
import type { Patient } from '../../../types';
import { summarizePatientIdentity } from '../../../utils/patient';

interface Props {
  patient: Pick<Patient, 'firstName' | 'lastName' | 'dob' | 'age' | 'classLevel' | 'classLevelOther'>;
  /** Date de calcul de l'âge : celle du bilan d'origine en historique, aujourd'hui sinon. */
  referenceDate?: Date | string;
}

/**
 * Rappel de l'enfant en haut d'un bilan, sur toutes les étapes (#116) : prénom, nom,
 * âge en ans et mois, classe actuelle. Affichage seulement : rien ne part vers l'IA.
 */
export const PatientIdentityBar: React.FC<Props> = ({ patient, referenceDate }) => {
  const { fullName, age, classLevel } = summarizePatientIdentity(patient, referenceDate || undefined);
  if (!fullName) return null;

  return (
    <div className="mb-6 flex justify-center no-print" data-testid="patient-identity-bar">
      <div className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-1.5 text-sm shadow-sm">
        <User size={14} className="text-[#E07A5F]" aria-hidden="true" />
        <span className="font-bold text-[var(--text-main)]">{fullName}</span>
        <span className="text-[var(--text-disabled)]" aria-hidden="true">
          •
        </span>
        <span className="text-[var(--text-secondary)]">{age || 'Âge non renseigné'}</span>
        <span className="text-[var(--text-disabled)]" aria-hidden="true">
          •
        </span>
        <span className="text-[var(--text-secondary)]">{classLevel || 'Classe non renseignée'}</span>
      </div>
    </div>
  );
};
