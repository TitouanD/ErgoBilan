import { supabase } from './db';
import { calculateFromZ } from '../utils/scoring';
import { Logger } from '../utils/logger';

export interface ComputationResult {
    raw: number;
    standard: string | null;
    percentile: string | null;
    zScore: number | null;
    method: 'PARAMETRIC' | 'LOOKUP' | 'NONE';
    normFound: boolean;
    warnings: string[];
}

export type NormsStatusCode = 'ok' | 'no_norms' | 'no_applicable_age_gender' | 'onboarding_required' | 'access_restricted';

export interface NormsStatusRow {
    subtestId: string;
    hasNorms: boolean;
    hasApplicableNorms: boolean;
    statusCode: NormsStatusCode;
}

// ============================================================
// DEMO SUBTEST: Test des Cloches barrées (id: "cloches-barrees")
//
// Why hardcoded here?
//   This subtest is bundled with every ErgoBilan demo account as a
//   fully functional scoring example. Its norms are derived from the
//   original published study (Albaret & Tomás, 1994) which are publicly
//   available in the literature and therefore carry no confidentiality
//   obligation.
//
// Architecture note:
//   All other subtests are scored via `compute_score` (SECURITY DEFINER
//   RPC). Norms never leave the backend. The demo shortcut below:
//   - Skips the RPC entirely and runs the z-score math in the browser.
//   - Uses class_level first, age_months as fallback, CM1 as last resort.
//   - Returns direction higher_better (more cloches found = better).
//
// ⚠️  VISIBILITY WARNING: These values ship in the JavaScript bundle and
//     are visible to anyone with DevTools. This is intentional and
//     acceptable for public-domain demo data. DO NOT replicate this
//     pattern for norm sets.
// ============================================================
const CLOCHES_NORMS: Record<string, { mean: number; sd: number }> = {
    CE1: { mean: 26.8, sd: 4.2 },
    CE2: { mean: 29.0, sd: 4.1 },
    CM1: { mean: 29.8, sd: 3.8 },
    CM2: { mean: 31.4, sd: 3.3 },
    '5EME': { mean: 32.3, sd: 2.6 },
    '7': { mean: 26.8, sd: 4.2 },
    '8': { mean: 29.0, sd: 4.1 },
    '9': { mean: 29.8, sd: 3.8 },
    '10': { mean: 31.4, sd: 3.3 },
    '11': { mean: 32.3, sd: 2.6 },
    '12': { mean: 32.3, sd: 2.6 },
};

export const ScoringEngine = {
    /**
     * Computes normalized scores via server-side RPC.
     * Proprietary norms never leave the backend.
     */
    compute: async (
        subtestId: string,
        rawScore: number,
        ageInMonths: number,
        gender: 'M' | 'F' | 'Mixed' = 'Mixed',
        classLevel?: string,
    ): Promise<ComputationResult | null> => {
        // Demo fallback for the bells test.
        if (subtestId === 'cloches-barrees') {
            Logger.info('SYSTEM', 'Computing Demo Test: Cloches');

            let norm = null;
            if (classLevel) {
                const normalizedClass = classLevel.toUpperCase().replace('ÈME', 'EME').replace('È', 'E');
                const key = Object.keys(CLOCHES_NORMS).find((k) => normalizedClass.includes(k));
                if (key) norm = CLOCHES_NORMS[key];
            }
            if (!norm) {
                const ageYears = Math.floor(ageInMonths / 12);
                norm = CLOCHES_NORMS[ageYears.toString()];
            }
            if (!norm) norm = CLOCHES_NORMS.CM1;

            const z = (rawScore - norm.mean) / norm.sd;
            const converted = calculateFromZ(z, 'standard');

            return {
                raw: rawScore,
                standard: converted.standard,
                percentile: converted.percentile,
                zScore: parseFloat(z.toFixed(2)),
                method: 'PARAMETRIC',
                normFound: true,
                warnings: [],
            };
        }

        try {
            const { data, error } = await supabase.rpc('compute_score', {
                p_subtest_id: subtestId,
                p_raw_score: rawScore,
                p_age_months: ageInMonths,
                p_gender: gender,
                p_class_level: classLevel || null,
            });

            if (error) {
                Logger.error('SYSTEM', 'Server-side compute_score failed', error);
                return null;
            }

            if (!data) return null;

            return {
                raw: data.raw,
                standard: data.standard !== null && data.standard !== undefined ? String(data.standard) : null,
                percentile: data.percentile !== null && data.percentile !== undefined ? String(data.percentile) : null,
                zScore: typeof data.zScore === 'number' ? data.zScore : null,
                method: (data.method as 'PARAMETRIC' | 'LOOKUP' | 'NONE') || 'NONE',
                normFound: data.norm_found === true,
                warnings: Array.isArray(data.warnings) ? data.warnings.map((item: unknown) => String(item)) : [],
            };
        } catch (e) {
            Logger.error('SYSTEM', 'Unexpected scoring error', e);
            return null;
        }
    },

    checkNormsStatus: async (
        subtestIds: string[],
        ageInMonths: number,
        gender: 'M' | 'F' | 'Mixed' = 'Mixed',
    ): Promise<NormsStatusRow[] | null> => {
        if (!Array.isArray(subtestIds) || subtestIds.length === 0) return [];

        try {
            const { data, error } = await supabase.rpc('check_norms_status', {
                p_subtest_ids: subtestIds,
                p_age_months: ageInMonths,
                p_gender: gender,
            });

            if (error || !Array.isArray(data)) {
                Logger.warn('SYSTEM', 'check_norms_status failed, fallback required', error || data);
                return null;
            }

            return data.map((row: any) => ({
                subtestId: String(row.subtest_id),
                hasNorms: row.has_norms === true,
                hasApplicableNorms: row.has_applicable_norms === true,
                statusCode: (String(row.status_code || 'no_norms') as NormsStatusCode),
            }));
        } catch (e) {
            Logger.warn('SYSTEM', 'Unexpected check_norms_status error', e);
            return null;
        }
    },

    upsertRawDirectionOverrideClone: async (
        sourceSubtestId: string,
        rawDirection: 'higher_better' | 'lower_better',
        reason = 'step2_user_override',
    ): Promise<{ effectiveSubtestId: string; created: boolean; updatedNormsCount: number } | null> => {
        try {
            const { data, error } = await supabase.rpc('admin_create_or_update_subtest_override_clone', {
                p_source_subtest_id: sourceSubtestId,
                p_raw_direction: rawDirection,
                p_reason: reason,
            });

            if (error) {
                Logger.error('SYSTEM', 'admin_create_or_update_subtest_override_clone failed', error);
                return null;
            }

            const row = Array.isArray(data) ? data[0] : data;
            if (!row) return null;

            return {
                effectiveSubtestId: String(row.effective_subtest_id),
                created: row.created === true,
                updatedNormsCount: Number(row.updated_norms_count || 0),
            };
        } catch (e) {
            Logger.error('SYSTEM', 'Unexpected override clone error', e);
            return null;
        }
    },
};

