
// Fonctions de conversion Z-Score <-> Percentile <-> Standard Scores

// --- 1. Z-SCORE (ET) VERS PERCENTILE ---
// Approximation de la fonction d'erreur (erf)
function erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
}

export const zScoreToPercentile = (z: number): number => {
    const p = 0.5 * (1 + erf(z / Math.sqrt(2)));
    // On arrondit pour l'affichage (0-100), mais on garde la précision pour les calculs internes si besoin
    // Ici on retourne un entier pour l'UI, sauf pour les extrêmes
    const percent = p * 100;
    if (percent < 0.1) return 0.1;
    if (percent > 99.9) return 99.9;
    return Math.round(percent);
};

// --- 2. PERCENTILE VERS Z-SCORE (ET) ---
// Approximation de la fonction inverse de la distribution normale cumulative (Probit)
// Acklam's algorithm (simplifié pour JS)
export const percentileToZScore = (p: number): number => {
    if (p <= 0 || p >= 100) return 0; // Sécurité

    const q = p / 100;

    // Approximation simple de Rational pour Inverse Normal CDF
    const a1 = -3.969683028665376e+01;
    const a2 = 2.209460984245205e+02;
    const a3 = -2.759285104469687e+02;
    const a4 = 1.383577518672690e+02;
    const a5 = -3.066479806614716e+01;
    const a6 = 2.506628277459239e+00;

    const b1 = -5.447609879822406e+01;
    const b2 = 1.615858368580409e+02;
    const b3 = -1.556989798598866e+02;
    const b4 = 6.680131188771972e+01;
    const b5 = -1.328068155288572e+01;

    const c1 = -7.784894002430293e-03;
    const c2 = -3.223964580411365e-01;
    const c3 = -2.400758277161838e+00;
    const c4 = -2.549732539343734e+00;
    const c5 = 4.374664141464968e+00;
    const c6 = 2.938163982698783e+00;

    const d1 = 7.784695709041462e-03;
    const d2 = 3.224671290700398e-01;
    const d3 = 2.445134137142996e+00;
    const d4 = 3.754408661907416e+00;

    const p_low = 0.02425;
    const p_high = 1 - p_low;

    let z = 0;

    if (q < p_low) {
        const t = Math.sqrt(-2 * Math.log(q));
        z = (((((c1 * t + c2) * t + c3) * t + c4) * t + c5) * t + c6) /
            ((((d1 * t + d2) * t + d3) * t + d4) * t + 1);
    } else if (q <= p_high) {
        const t = q - 0.5;
        const r = t * t;
        z = (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * t /
            (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
    } else {
        const t = Math.sqrt(-2 * Math.log(1 - q));
        z = -(((((c1 * t + c2) * t + c3) * t + c4) * t + c5) * t + c6) /
            ((((d1 * t + d2) * t + d3) * t + d4) * t + 1);
    }

    return parseFloat(z.toFixed(2));
};

// Types de scores standards supportés
export const SCALES = {
    'standard': { mean: 100, sd: 15, name: 'Standard (100 ± 15)' },
    'scaled': { mean: 10, sd: 3, name: 'Note Standard (10 ± 3)' },
    't-score': { mean: 50, sd: 10, name: 'T-Score (50 ± 10)' },
    'sten': { mean: 5.5, sd: 2, name: 'Sten (5.5 ± 2)' },
    'stanine': { mean: 5, sd: 2, name: 'Stanine (5 ± 2)' },
    'percentile': { mean: 50, sd: 0, name: 'Percentile' } // Cas particulier
};

// --- FONCTIONS DE CALCUL UNIFIÉES ---

// Appelé quand on modifie NS
export const calculateFromStandard = (val: number, scoreType: 'standard' | 'scaled' | 't-score' | 'percentile' | 'sten' | 'stanine' | 'none') => {
    if (scoreType === 'none') {
        return { standard: '', zScore: 0, percentile: '' };
    }
    if (scoreType === 'percentile') {
        // Pour le mode percentile, on traite la valeur standard comme un percentile
        return calculateFromPercentile(val, scoreType);
    }
    const scale = SCALES[scoreType];
    const z = parseFloat(((val - scale.mean) / scale.sd).toFixed(2));
    const p = zScoreToPercentile(z);
    return { standard: val.toString(), zScore: z, percentile: p.toString() };
};

// Appelé quand on modifie ET (Z-Score)
export const calculateFromZ = (z: number, scoreType: 'standard' | 'scaled' | 't-score' | 'percentile' | 'sten' | 'stanine' | 'none') => {
    if (scoreType === 'none') {
        return { standard: '', zScore: z, percentile: '' };
    }
    const p = zScoreToPercentile(z);
    if (scoreType === 'percentile') {
        return { standard: p.toString(), zScore: z, percentile: p.toString() };
    }
    const scale = SCALES[scoreType];
    const standard = Math.round(z * scale.sd + scale.mean);
    return { standard: standard.toString(), zScore: z, percentile: p.toString() };
};

// Appelé quand on modifie Percentile
export const calculateFromPercentile = (p: number, scoreType: 'standard' | 'scaled' | 't-score' | 'percentile' | 'sten' | 'stanine' | 'none') => {
    if (scoreType === 'none') {
        return { standard: '', zScore: 0, percentile: '' };
    }
    const z = percentileToZScore(p);
    if (scoreType === 'percentile') {
        return { standard: p.toString(), zScore: z, percentile: p.toString() };
    }
    const scale = SCALES[scoreType];
    const standard = Math.round(z * scale.sd + scale.mean);
    return { standard: standard.toString(), zScore: z, percentile: p.toString() };
};
