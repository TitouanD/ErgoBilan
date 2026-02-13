
/**
 * UTILITAIRES GÉNÉRAUX UI/UX
 * Note: La logique mathématique de scoring est déplacée dans ./utils/scoring.ts
 */

/**
 * Normalisation agressive d'un nom de test pour détection de doublons.
 * trim → lowercase → suppression accents (NFD) → suppression de tout non-alphanumérique.
 * Ex: "M.A.B.C.-2", "mabc 2", "MABC2", "  MABC - 2 " → "mabc2"
 */
interface PatientIdentityRequiredFields {
  firstName?: string;
  lastName?: string;
  dob?: string;
}

interface PatientIdentityPreviewFields extends PatientIdentityRequiredFields {
  age?: string;
  classLevel?: string;
  gender?: string;
}

export const normalizeTestName = (name: string): string => {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .replace(/[^a-z0-9]/g, '');      // strip everything non-alphanumeric
};

const SUBTEST_STOPWORDS = new Set([
  'avec', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'en', 'au', 'aux', 'a',
  'mabc', 'mabc2'
]);

const SUBTEST_TOKEN_MAP: Record<string, string> = {
  une: '1',
  un: '1',
  one: '1',
  deux: '2',
  two: '2',
  trois: '3',
  three: '3',
  meilleure: 'meilleur',
  meilleur: 'meilleur',
  prefered: 'prefere',
  preferred: 'prefere',
  preferee: 'prefere',
  prefere: 'prefere'
};

export const normalizeSubtestName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '';

  const base = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^m[^a-z0-9]*abc[^a-z0-9]*2[^a-z0-9]*/i, '')
    .replace(/\(([^)]*(age|ans|mois)[^)]*)\)/gi, ' ')
    .replace(/\bage\s*\d.*$/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!base) return '';

  const tokens = base
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(token => SUBTEST_TOKEN_MAP[token] || token)
    .map(token => (token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token))
    .filter(token => token && !SUBTEST_STOPWORDS.has(token));

  const hasNumber = tokens.some(token => /^\d+$/.test(token));
  const hasHand = tokens.includes('main');
  const impliesPreferred = tokens.includes('meilleur') || tokens.includes('prefere');
  if (hasHand && impliesPreferred && !hasNumber) {
    tokens.push('1');
  }

  return tokens.join('');
};

// Génération des données pour la courbe de Gauss (Recharts)
export const generateGaussianData = (mean: number, sd: number) => {
  const data = [];
  // On génère de -4 SD à +4 SD pour une courbe bien large visuellement
  const start = mean - 4 * sd;
  const end = mean + 4 * sd;
  const points = 100;
  const step = (end - start) / points;

  for (let i = 0; i <= points; i++) {
    const x = start + i * step;
    // Fonction de densité de probabilité normale
    const y = (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * Math.pow((x - mean) / sd, 2));
    data.push({ x: parseFloat(x.toFixed(2)), y });
  }
  return data;
};

// Calcul précis de l'âge (Années + Mois)
export const calculateAge = (dob: string): string => {
  if (!dob) return "";
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return "";
  const today = new Date();
  let years = today.getFullYear() - birthDate.getFullYear();
  let months = today.getMonth() - birthDate.getMonth();
  
  if (months < 0 || (months === 0 && today.getDate() < birthDate.getDate())) {
    years--;
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

export const getPatientAgeForIdentity = (patient: PatientIdentityRequiredFields & { age?: string }): string => {
  const derivedAge = calculateAge(patient.dob || '');
  if (derivedAge) return derivedAge;
  return patient.age?.trim() || '';
};

export const buildPatientIdentitySignature = (patient: PatientIdentityPreviewFields): string => {
  const age = getPatientAgeForIdentity(patient);
  return [
    patient.firstName?.trim().toLowerCase() || '',
    patient.lastName?.trim().toLowerCase() || '',
    patient.dob?.trim() || '',
    age,
    patient.classLevel?.trim().toLowerCase() || '',
    patient.gender?.trim().toLowerCase() || '',
  ].join('|');
};
