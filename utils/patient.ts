/**
 * patient.ts — patient identity helpers (age, readiness checks, identity signature).
 */

interface PatientIdentityRequiredFields {
  firstName?: string;
  lastName?: string;
  dob?: string;
}

interface PatientAdministrativeRequiredFields extends PatientIdentityRequiredFields {
  parentNames?: string;
  parentPhone?: string;
  parentEmail?: string;
  parent1Name?: string;
  parent1Phone?: string;
  parent1Email?: string;
  parent2Name?: string;
  parent2Phone?: string;
  parent2Email?: string;
  guardMode?: string;
  prescribingDoctor?: string;
  medicalDiagnosis?: string;
  medicalTracking?: Array<{ type?: string }>;
  reason?: string;
}

/**
 * Age in completed years and months at `referenceDate` (default: today).
 * Pass the assessment date for a historical assessment so the report shows
 * the age the child had at that time.
 */
export const calculateAge = (dob: string, referenceDate: Date | string = new Date()): string => {
  if (!dob) return '';
  const birthDate = new Date(dob);
  const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(ref.getTime()) || ref < birthDate) return '';
  let years = ref.getFullYear() - birthDate.getFullYear();
  let months = ref.getMonth() - birthDate.getMonth();
  if (ref.getDate() < birthDate.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return `${years} ans ${months} mois`;
};

export const isPatientCreationReady = (patient: PatientIdentityRequiredFields): boolean => {
  const firstName = patient.firstName?.trim() || '';
  const lastName = patient.lastName?.trim() || '';
  const dob = patient.dob?.trim() || '';
  return firstName.length > 0 && lastName.length > 0 && dob.length > 0;
};

export const isAdministrativeSectionReady = (patient: PatientAdministrativeRequiredFields): boolean => {
  const hasIdentity = isPatientCreationReady(patient);

  const parent1Name = patient.parent1Name?.trim() || '';
  const parent1Phone = patient.parent1Phone?.trim() || '';
  const parent1Email = patient.parent1Email?.trim() || '';
  const parent2Name = patient.parent2Name?.trim() || '';
  const parent2Phone = patient.parent2Phone?.trim() || '';
  const parent2Email = patient.parent2Email?.trim() || '';
  const legacyParentNames = patient.parentNames?.trim() || '';
  const legacyParentPhone = patient.parentPhone?.trim() || '';
  const legacyParentEmail = patient.parentEmail?.trim() || '';

  const hasParent1Contact = parent1Name.length > 0 && (parent1Phone.length > 0 || parent1Email.length > 0);
  const hasParent2Contact = parent2Name.length > 0 && (parent2Phone.length > 0 || parent2Email.length > 0);
  const hasLegacyContact = legacyParentNames.length > 0 && (legacyParentPhone.length > 0 || legacyParentEmail.length > 0);
  const hasFamilyAdministrative = hasParent1Contact || hasParent2Contact || hasLegacyContact;

  const hasMedicalAdministrative =
    (patient.prescribingDoctor?.trim() || '').length > 0 ||
    (patient.medicalDiagnosis?.trim() || '').length > 0 ||
    (patient.medicalTracking?.length || 0) > 0;

  const hasConsultationReason = (patient.reason?.trim() || '').length > 0;

  return hasIdentity && hasFamilyAdministrative && hasMedicalAdministrative && hasConsultationReason;
};

export const getPatientAgeForIdentity = (
  patient: PatientIdentityRequiredFields & { age?: string },
  referenceDate?: Date | string,
): string => {
  const derivedAge = calculateAge(patient.dob || '', referenceDate);
  if (derivedAge) return derivedAge;
  return patient.age?.trim() || '';
};

export interface PatientIdentitySummary {
  /** « Prénom NOM », vide si aucun des deux n'est saisi. */
  fullName: string;
  /** Âge en ans et mois à `referenceDate`, sinon l'âge enregistré ; vide si inconnu. */
  age: string;
  /** Classe actuelle (le texte saisi quand la classe est « Autre ») ; vide si non renseignée. */
  classLevel: string;
}

/**
 * Rappel d'identité affiché en haut d'un bilan (#116) : nom, âge, classe.
 * Affichage local seulement, rien n'est envoyé à l'IA.
 */
export const summarizePatientIdentity = (
  patient: PatientIdentityRequiredFields & { age?: string; classLevel?: string; classLevelOther?: string },
  referenceDate?: Date | string,
): PatientIdentitySummary => {
  const fullName = [patient.firstName?.trim(), patient.lastName?.trim()].filter(Boolean).join(' ');
  const rawClass = patient.classLevel?.trim() || '';
  const classLevel = rawClass === 'Autre' ? patient.classLevelOther?.trim() || '' : rawClass;
  return { fullName, age: getPatientAgeForIdentity(patient, referenceDate), classLevel };
};
