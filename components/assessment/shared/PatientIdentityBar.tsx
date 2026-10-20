import React from 'react';
import { CalendarDays, User } from 'lucide-react';
import type { Patient } from '../../../types';
import { summarizePatientIdentity } from '../../../utils/patient';

interface Props {
  patient: Pick<Patient, 'firstName' | 'lastName' | 'dob' | 'age' | 'classLevel' | 'classLevelOther'>;
  /** Date du bilan (passation), ISO ; vide = aujourd'hui. L'âge est calculé à cette date (#153). */
  assessmentDate?: string;
  /** Rend la date du bilan modifiable (ISO, '' = aujourd'hui). */
  onAssessmentDateChange?: (date: string) => void;
}

/** yyyy-mm-dd local, valeur d'un champ date. */
const toInputDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Rappel de l'enfant en haut d'un bilan, sur toutes les étapes (#116) : prénom, nom,
 * âge en ans et mois à la date du bilan, classe actuelle, et la date du bilan elle-même (#153).
 */
export const PatientIdentityBar: React.FC<Props> = ({ patient, assessmentDate, onAssessmentDateChange }) => {
  const { fullName, age, classLevel } = summarizePatientIdentity(patient, assessmentDate || undefined);
  if (!fullName) return null;
  const today = toInputDate(new Date());

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
        {onAssessmentDateChange && (
          <>
            <span className="text-[var(--text-disabled)]" aria-hidden="true">
              •
            </span>
            <label className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <CalendarDays size={14} className="text-[#E07A5F]" aria-hidden="true" />
              Bilan du
              <input
                type="date"
                data-testid="assessment-date"
                value={assessmentDate ? assessmentDate.slice(0, 10) : today}
                max={today}
                onChange={(e) => onAssessmentDateChange(e.target.value ? new Date(e.target.value).toISOString() : '')}
                className="bg-transparent font-medium text-[var(--text-main)] outline-none focus:ring-2 focus:ring-[#E07A5F]/40 rounded"
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
};
