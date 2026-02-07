
import { supabase } from './db';
import { calculateFromZ } from '../utils/scoring';
import { Logger } from '../utils/logger';

export interface ComputationResult {
    raw: number;
    standard: string;
    percentile: string;
    zScore: number;
    method: 'PARAMETRIC' | 'LOOKUP' | 'NONE';
}

// Données hardcodées pour le Test des Cloches (Démo)
// Source: Photo utilisateur (Gauthier, 1989 / ODEDYS)
const CLOCHES_NORMS: Record<string, { mean: number, sd: number }> = {
    'CE1': { mean: 26.8, sd: 4.2 },
    'CE2': { mean: 29.0, sd: 4.1 },
    'CM1': { mean: 29.8, sd: 3.8 },
    'CM2': { mean: 31.4, sd: 3.3 },
    '5EME': { mean: 32.3, sd: 2.6 },
    // Mapping Age -> Classe approx pour la démo si classe non fournie
    '7': { mean: 26.8, sd: 4.2 }, // ~CE1
    '8': { mean: 29.0, sd: 4.1 }, // ~CE2
    '9': { mean: 29.8, sd: 3.8 }, // ~CM1
    '10': { mean: 31.4, sd: 3.3 }, // ~CM2
    '11': { mean: 32.3, sd: 2.6 }, // ~5eme
    '12': { mean: 32.3, sd: 2.6 }  // ~5eme+
};

export const ScoringEngine = {
    /**
     * Calcule les scores normés à partir du brut, de l'âge et du sexe via Supabase.
     */
    compute: async (
        subtestId: string, 
        rawScore: number, 
        ageInMonths: number, 
        gender: 'M' | 'F' | 'Mixed' = 'Mixed',
        classLevel?: string // Paramètre optionnel ajouté pour le test des cloches
    ): Promise<ComputationResult | null> => {
        
        // --- 0. DÉMO : TEST DES CLOCHES (HARDCODÉ) ---
        if (subtestId === 'cloches-barrees') {
            Logger.info('SYSTEM', 'Computing Demo Test: Cloches');
            
            // Déterminer la norme à utiliser (Classe > Âge)
            let norm = null;
            
            // 1. Essai par Classe (Normalisation string)
            if (classLevel) {
                const normalizedClass = classLevel.toUpperCase().replace('ÈME', 'EME').replace('È', 'E');
                // Cherche correspondance exacte ou partielle (ex: "CM1" dans "CM1 A")
                const key = Object.keys(CLOCHES_NORMS).find(k => normalizedClass.includes(k));
                if (key) norm = CLOCHES_NORMS[key];
            }

            // 2. Essai par Âge (si pas de classe ou pas de match)
            if (!norm) {
                const ageYears = Math.floor(ageInMonths / 12);
                norm = CLOCHES_NORMS[ageYears.toString()];
            }

            // Défaut si rien ne matche (CM1 par défaut pour la démo Léo)
            if (!norm) norm = CLOCHES_NORMS['CM1'];

            const z = (rawScore - norm.mean) / norm.sd;
            // Note: Le test des cloches utilise souvent des scores standards ou simplement le Z-Score.
            // On va simuler un score standard (100 +/- 15) pour l'affichage unifié.
            const converted = calculateFromZ(z, 'standard');

            return {
                raw: rawScore,
                standard: converted.standard,
                percentile: converted.percentile,
                zScore: parseFloat(z.toFixed(2)),
                method: 'PARAMETRIC'
            };
        }

        // --- 1. SUPABASE (PRODUCTION) ---
        
        // Récupérer la définition du sous-test
        const { data: subtest } = await supabase
            .from('official_subtests')
            .select('*')
            .eq('id', subtestId)
            .maybeSingle();

        if (!subtest) {
            // Si pas trouvé en DB et pas cloches, c'est peut-être un autre test démo ou une erreur
            return null;
        }

        // Chercher la norme
        const { data: norms } = await supabase
            .from('official_norms')
            .select('*')
            .eq('subtest_id', subtestId)
            .lte('age_min_months', ageInMonths)
            .gte('age_max_months', ageInMonths);

        if (!norms || norms.length === 0) return null;

        // Filtrage priorité genre en JS (M/F > Mixed)
        const specificNorm = norms.find((n: any) => n.gender === gender);
        let activeNorm = specificNorm || norms.find((n: any) => n.gender === 'Mixed');

        if (!activeNorm) return null;

        // --- BRANCHE A : MODE PARAMÉTRIQUE ---
        if (activeNorm.mean !== null && activeNorm.sd !== null) {
            const mean = activeNorm.mean;
            const sd = activeNorm.sd;
            
            const z = (rawScore - mean) / sd; 
            const converted = calculateFromZ(z, subtest.score_type as any);

            return {
                raw: rawScore,
                standard: converted.standard,
                percentile: converted.percentile,
                zScore: converted.zScore,
                method: 'PARAMETRIC'
            };
        }

        // --- BRANCHE B : MODE LOOKUP ---
        const { data: lookupMatch } = await supabase
            .from('official_norms')
            .select('*')
            .eq('subtest_id', subtestId)
            .lte('age_min_months', ageInMonths)
            .gte('age_max_months', ageInMonths)
            .lte('raw_min', rawScore)
            .gte('raw_max', rawScore)
            .maybeSingle();

        if (lookupMatch) {
            return {
                raw: rawScore,
                standard: lookupMatch.standard_score?.toString() || '',
                percentile: lookupMatch.percentile?.toString() || '',
                zScore: 0, 
                method: 'LOOKUP'
            };
        }

        return null;
    }
};
