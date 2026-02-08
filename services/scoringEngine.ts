
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
    '7': { mean: 26.8, sd: 4.2 },
    '8': { mean: 29.0, sd: 4.1 },
    '9': { mean: 29.8, sd: 3.8 },
    '10': { mean: 31.4, sd: 3.3 },
    '11': { mean: 32.3, sd: 2.6 },
    '12': { mean: 32.3, sd: 2.6 }
};

export const ScoringEngine = {
    /**
     * Calcule les scores normés via la RPC server-side compute_score.
     * Les normes propriétaires ne sont JAMAIS exposées au client.
     * Fallback local uniquement pour le test démo (cloches-barrees).
     */
    compute: async (
        subtestId: string, 
        rawScore: number, 
        ageInMonths: number, 
        gender: 'M' | 'F' | 'Mixed' = 'Mixed',
        classLevel?: string
    ): Promise<ComputationResult | null> => {
        
        // --- 0. DÉMO : TEST DES CLOCHES (HARDCODÉ) ---
        if (subtestId === 'cloches-barrees') {
            Logger.info('SYSTEM', 'Computing Demo Test: Cloches');
            
            let norm = null;
            if (classLevel) {
                const normalizedClass = classLevel.toUpperCase().replace('ÈME', 'EME').replace('È', 'E');
                const key = Object.keys(CLOCHES_NORMS).find(k => normalizedClass.includes(k));
                if (key) norm = CLOCHES_NORMS[key];
            }
            if (!norm) {
                const ageYears = Math.floor(ageInMonths / 12);
                norm = CLOCHES_NORMS[ageYears.toString()];
            }
            if (!norm) norm = CLOCHES_NORMS['CM1'];

            const z = (rawScore - norm.mean) / norm.sd;
            const converted = calculateFromZ(z, 'standard');

            return {
                raw: rawScore,
                standard: converted.standard,
                percentile: converted.percentile,
                zScore: parseFloat(z.toFixed(2)),
                method: 'PARAMETRIC'
            };
        }

        // --- 1. PRODUCTION : RPC SERVER-SIDE (normes jamais exposées) ---
        try {
            const { data, error } = await supabase.rpc('compute_score', {
                p_subtest_id: subtestId,
                p_raw_score: rawScore,
                p_age_months: ageInMonths,
                p_gender: gender,
                p_class_level: classLevel || null
            });

            if (error) {
                Logger.error('SYSTEM', 'Server-side compute_score failed', error);
                return null;
            }

            if (!data) return null;

            return {
                raw: data.raw,
                standard: String(data.standard ?? ''),
                percentile: String(data.percentile ?? ''),
                zScore: data.zScore ?? 0,
                method: data.method as 'PARAMETRIC' | 'LOOKUP'
            };
        } catch (e) {
            Logger.error('SYSTEM', 'Unexpected scoring error', e);
            return null;
        }
    }
};
