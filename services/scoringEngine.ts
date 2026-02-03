
import { supabase } from './db';
import { calculateFromZ, zScoreToPercentile } from '../utils/scoring';
import { Logger } from '../utils/logger';

export interface ComputationResult {
    raw: number;
    standard: string;
    percentile: string;
    zScore: number;
    method: 'PARAMETRIC' | 'LOOKUP' | 'NONE';
}

export const ScoringEngine = {
    /**
     * Calcule les scores normés à partir du brut, de l'âge et du sexe via Supabase.
     */
    compute: async (
        subtestId: string, 
        rawScore: number, 
        ageInMonths: number, 
        gender: 'M' | 'F' | 'Mixed' = 'Mixed'
    ): Promise<ComputationResult | null> => {
        
        // 1. Récupérer la définition du sous-test
        const { data: subtest } = await supabase
            .from('official_subtests')
            .select('*')
            .eq('id', subtestId)
            .maybeSingle();

        if (!subtest) {
            Logger.warn('SYSTEM', `[ScoringEngine] Sous-test introuvable: ${subtestId}`);
            return null;
        }

        // 2. Chercher la norme
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
        // On relance une requête spécifique ou on filtre si on a tout récupéré
        // Ici, activeNorm est une ligne générique, mais le lookup implique souvent plusieurs lignes pour un même âge (intervalles)
        // Correction : Pour le lookup, il faut chercher la ligne qui correspond au RAW SCORE.
        
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
