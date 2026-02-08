
/**
 * UTILITAIRES GÉNÉRAUX UI/UX
 * Note: La logique mathématique de scoring est déplacée dans ./utils/scoring.ts
 */

/**
 * Normalisation agressive d'un nom de test pour détection de doublons.
 * trim → lowercase → suppression accents (NFD) → suppression de tout non-alphanumérique.
 * Ex: "M.A.B.C.-2", "mabc 2", "MABC2", "  MABC - 2 " → "mabc2"
 */
export const normalizeTestName = (name: string): string => {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .replace(/[^a-z0-9]/g, '');      // strip everything non-alphanumeric
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
  const today = new Date();
  let years = today.getFullYear() - birthDate.getFullYear();
  let months = today.getMonth() - birthDate.getMonth();
  
  if (months < 0 || (months === 0 && today.getDate() < birthDate.getDate())) {
    years--;
    months += 12;
  }
  return `${years} ans ${months} mois`;
};
