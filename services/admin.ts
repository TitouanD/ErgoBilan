import { supabase } from './db';
import type {
    Patient,
    TestData,
    CandidateRow,
    CandidateDetails,
    ExtractedRow,
    AdminTestBundle,
    AdminTestSummary,
    SimilarTestMatch,
    DuplicatePair,
    MergeResult,
    AttachResult,
    SubtestDuplicatePair,
    NormDuplicateSummary,
    NormQualityFlag
} from '../types';
import { Logger } from '../utils/logger';

// Données simulées pour le Dashboard Ops
const MOCK_AI_STATS = {
    dailyUsage: [
        { date: '10/01', tokens: 12500, cost: 0.04, errors: 0 },
        { date: '11/01', tokens: 15000, cost: 0.05, errors: 1 },
        { date: '12/01', tokens: 42000, cost: 0.14, errors: 0 },
        { date: '13/01', tokens: 38000, cost: 0.12, errors: 2 },
        { date: '14/01', tokens: 55000, cost: 0.18, errors: 0 },
        { date: '15/01', tokens: 48000, cost: 0.15, errors: 0 },
        { date: '16/01', tokens: 62000, cost: 0.21, errors: 1 },
    ],
    failures: [
        { id: 'err_1', date: '2023-10-13T14:30:00Z', type: 'TIMEOUT_AI', context: 'Anamnèse très longue (> 4000 chars)', user: 'doc.martin@email.com' },
        { id: 'err_2', date: '2023-10-13T16:15:00Z', type: 'INVALID_JSON', context: 'Structure réponse corrompue (Markdown missing)', user: 'ergo.sophie@email.com' },
        { id: 'err_3', date: '2023-10-16T09:10:00Z', type: 'SAFETY_BLOCK', context: 'Contenu potentiellement flaggé par Google', user: 'test.user@email.com' }
    ]
};

/**
 * Service dédié aux opérations Administrateur.
 * Toutes les opérations sensibles passent par des RPC sécurisées.
 */
export const AdminService = {

    // --- SECURITÉ ---
    adminCheck: async (): Promise<boolean> => {
        const { data, error } = await supabase.rpc('admin_check');
        if (error) throw error;
        return data === true;
    },

    /**
     * Liste des tests candidats à la promotion (privés)
     */
    getCandidates: async (): Promise<CandidateRow[]> => {
        const { data, error } = await supabase.rpc('admin_list_candidates');
        if (error) throw error;
        return data || [];
    },

    /**
     * Détail complet d'un test candidat pour prévisualisation
     */
    getCandidateDetails: async (testId: string): Promise<CandidateDetails> => {
        const { data, error } = await supabase.rpc('admin_get_test_bundle', { p_test_id: testId });
        if (error) throw error;
        if (!data || !data.test) throw new Error('Test introuvable');

        const test = data.test;
        const subtests = Array.isArray(data.subtests) ? data.subtests : [];
        const norms = Array.isArray(data.norms) ? data.norms : [];

        const rows: ExtractedRow[] = [];

        subtests.forEach((sub: any) => {
            const subNorms = norms.filter((n: any) => n.subtest_id === sub.id);
            subNorms.forEach((norm: any) => {
                const ageLabel = norm.age_min_months !== null && norm.age_min_months !== undefined
                    ? `${Math.floor(norm.age_min_months / 12)} ans`
                    : 'Global';

                const rawLabel = (norm.raw_min !== null && norm.raw_min !== undefined && norm.raw_max !== null && norm.raw_max !== undefined)
                    ? (norm.raw_min === norm.raw_max ? String(norm.raw_min) : `${norm.raw_min}-${norm.raw_max}`)
                    : '';

                rows.push({
                    id: norm.id || `${sub.id}_${rows.length}`,
                    subtest: sub.name,
                    label: ageLabel,
                    raw: rawLabel,
                    standard: norm.standard_score !== null && norm.standard_score !== undefined ? String(norm.standard_score) : '',
                    percentile: norm.percentile !== null && norm.percentile !== undefined ? String(norm.percentile) : '',
                    mean: norm.mean !== null && norm.mean !== undefined ? String(norm.mean) : undefined,
                    sd: norm.sd !== null && norm.sd !== undefined ? String(norm.sd) : undefined,
                    zScore: ''
                });
            });
        });

        return {
            id: test.id,
            testName: test.name,
            author: test.author,
            submittedAt: test.created_at,
            rows
        };
    },

    /**
     * Suppression d'un test (admin)
     */
    deleteTest: async (testId: string) => {
        const { error } = await supabase.rpc('admin_delete_test', { p_test_id: testId });
        if (error) throw error;
    },

    /**
     * Suppression d'un sous-test (admin)
     */
    deleteSubtest: async (subtestId: string) => {
        const { error } = await supabase.rpc('admin_delete_subtest', { p_subtest_id: subtestId });
        if (error) throw error;
    },

    /**
     * Promotion d'un test privé vers public (fusion si nécessaire)
     */
    promoteTest: async (testId: string): Promise<{ merged: boolean; targetName: string }> => {
        const { data, error } = await supabase.rpc('admin_promote_test', { p_test_id: testId });
        if (error) throw error;

        return {
            merged: data?.merged === true,
            targetName: data?.target_name || ''
        };
    },

    /**
     * Liste des tests (admin library)
     */
    listTests: async (scope: 'public' | 'private' | 'all' = 'public'): Promise<AdminTestSummary[]> => {
        const { data, error } = await supabase.rpc('admin_list_tests', { p_scope: scope });
        if (error) throw error;
        return data || [];
    },

    /**
     * Charger un bundle complet (test + subtests + normes)
     */
    getTestBundle: async (testId: string): Promise<AdminTestBundle> => {
        const { data, error } = await supabase.rpc('admin_get_test_bundle', { p_test_id: testId });
        if (error) throw error;
        if (!data) throw new Error('Bundle introuvable');
        return data as AdminTestBundle;
    },

    /**
     * Sauvegarder un bundle (admin)
     */
    saveTestBundle: async (bundle: AdminTestBundle) => {
        const { error } = await supabase.rpc('admin_save_test_bundle', { p_payload: bundle });
        if (error) throw error;
    },

    // --- CONTRIBUTIONS (USER RPC) ---
    findPrivateTestByName: async (name: string): Promise<Array<{ id: string; name: string; subtest_count?: number }>> => {
        const { data, error } = await supabase.rpc('find_private_test_by_name', { p_name: name });
        if (error) throw error;
        return data || [];
    },

    /**
     * Cross-scope fuzzy search for similar tests (public + user's org)
     * Uses pg_trgm similarity scoring
     */
    findSimilarTests: async (name: string, threshold = 0.3): Promise<SimilarTestMatch[]> => {
        const { data, error } = await supabase.rpc('find_similar_tests', { p_name: name, p_threshold: threshold });
        if (error) throw error;
        return (data || []) as SimilarTestMatch[];
    },

    createPrivateTest: async (payload: any): Promise<string> => {
        const { data, error } = await supabase.rpc('create_private_test', { p_payload: payload });
        if (error) throw error;
        return data as string;
    },

    mergePrivateTest: async (targetId: string, payload: any): Promise<{ new_subtests: number; new_norms: number }> => {
        const { data, error } = await supabase.rpc('merge_private_test', { p_target_id: targetId, p_payload: payload });
        if (error) throw error;
        return data as { new_subtests: number; new_norms: number };
    },

    /**
     * Attach private subtests/norms to an existing test (public or private).
     * Subtests are scoped to the user's organization.
     */
    attachSubtestsToTest: async (testId: string, payload: any): Promise<AttachResult> => {
        const { data, error } = await supabase.rpc('attach_subtests_to_test', { p_test_id: testId, p_payload: payload });
        if (error) throw error;
        return data as AttachResult;
    },

    // --- ADMIN DEDUPLICATION ---

    /**
     * Find clusters of duplicate tests across all scopes (admin only)
     */
    findDuplicates: async (threshold = 0.4): Promise<DuplicatePair[]> => {
        const { data, error } = await supabase.rpc('admin_find_duplicates', { p_threshold: threshold });
        if (error) throw error;
        return (data || []) as DuplicatePair[];
    },

    /**
     * Merge N source tests into 1 target test (admin only)
     * Moves subtests, migrates norms, updates session references
     */
    mergeTests: async (sourceIds: string[], targetId: string): Promise<MergeResult> => {
        const { data, error } = await supabase.rpc('admin_merge_tests', { p_source_ids: sourceIds, p_target_id: targetId });
        if (error) throw error;
        return data as MergeResult;
    },

    /**
     * Promote private subtests to public (admin only)
     */
    promoteSubtests: async (subtestIds: string[]): Promise<{ promoted: number }> => {
        const { data, error } = await supabase.rpc('admin_promote_subtests', { p_subtest_ids: subtestIds });
        if (error) throw error;
        return data as { promoted: number };
    },

    /**
     * Promote org-scoped norms to public (admin only).
     * Can target a specific subtest+org, all orgs for a subtest, or all pending norms for a test.
     */
    promoteNorms: async (params: { subtestId?: string; testId?: string; organizationId?: string }): Promise<{ promoted: number }> => {
        const { data, error } = await supabase.rpc('admin_promote_norms', {
            p_subtest_id: params.subtestId || null,
            p_test_id: params.testId || null,
            p_organization_id: params.organizationId || null,
        });
        if (error) throw error;
        return data as { promoted: number };
    },

    /**
     * Reject (delete) org-scoped norms (admin only).
     */
    rejectNorms: async (params: { subtestId?: string; testId?: string; organizationId?: string }): Promise<{ rejected: number }> => {
        const { data, error } = await supabase.rpc('admin_reject_norms', {
            p_subtest_id: params.subtestId || null,
            p_test_id: params.testId || null,
            p_organization_id: params.organizationId || null,
        });
        if (error) throw error;
        return data as { rejected: number };
    },

    // --- SUBTEST DEDUP ---

    /**
     * Find duplicate subtests within a test (by name similarity)
     */
    findDuplicateSubtests: async (testId: string, threshold = 0.5): Promise<SubtestDuplicatePair[]> => {
        const { data, error } = await supabase.rpc('admin_find_duplicate_subtests', { p_test_id: testId, p_threshold: threshold });
        if (error) throw error;
        return (data || []) as SubtestDuplicatePair[];
    },

    /**
     * Merge source subtests into a target subtest (move norms, delete sources)
     */
    mergeSubtests: async (sourceIds: string[], targetId: string): Promise<{ merged_subtests: number; migrated_norms: number; target_name: string }> => {
        const { data, error } = await supabase.rpc('admin_merge_subtests', { p_source_ids: sourceIds, p_target_id: targetId });
        if (error) throw error;
        return data as { merged_subtests: number; migrated_norms: number; target_name: string };
    },

    // --- NORM DEDUP ---

    /**
     * Find exact duplicate norms (grouped by subtest)
     */
    findDuplicateNorms: async (params: { subtestId?: string; testId?: string }): Promise<NormDuplicateSummary[]> => {
        const { data, error } = await supabase.rpc('admin_find_duplicate_norms', {
            p_subtest_id: params.subtestId || null,
            p_test_id: params.testId || null,
        });
        if (error) throw error;
        return (data || []) as NormDuplicateSummary[];
    },

    /**
     * Deduplicate norms: keep one per unique key, delete extras
     */
    deduplicateNorms: async (params: { subtestId?: string; testId?: string }): Promise<{ deleted: number }> => {
        const { data, error } = await supabase.rpc('admin_deduplicate_norms', {
            p_subtest_id: params.subtestId || null,
            p_test_id: params.testId || null,
        });
        if (error) throw error;
        return data as { deleted: number };
    },

    // --- NORM QUALITY ---

    /**
     * Run quality checks on norms and return flagged entries
     */
    normQualityCheck: async (params: { testId?: string; subtestId?: string }): Promise<NormQualityFlag[]> => {
        const { data, error } = await supabase.rpc('admin_norm_quality_check', {
            p_test_id: params.testId || null,
            p_subtest_id: params.subtestId || null,
        });
        if (error) throw error;
        return (data || []) as NormQualityFlag[];
    },

    // --- MODULE C : Télémétrie Passive & Anonyme ---

    logAnonymousStats: async (tests: TestData, patient: Patient) => {
        try {
            if (!patient.dob) return;
            const birthDate = new Date(patient.dob);
            const now = new Date();
            const ageMonths = (now.getFullYear() - birthDate.getFullYear()) * 12 + (now.getMonth() - birthDate.getMonth());

            if (ageMonths < 0) return;

            const payload: any[] = [];
            const sessionHash = 'anon_' + crypto.randomUUID();

            for (const [testId, subtests] of Object.entries(tests)) {
                for (const [subtestId, result] of Object.entries(subtests)) {
                    if (result.status === 'validated' && result.raw) {
                        const rawVal = parseFloat(result.raw.replace(',', '.').replace(/[^0-9.-]/g, ''));

                        if (!isNaN(rawVal)) {
                            payload.push({
                                test_id: testId,
                                subtest_id: subtestId,
                                age_months: ageMonths,
                                gender: patient.gender || 'Mixed',
                                raw_score: rawVal,
                                computed_standard: result.standard ? parseFloat(result.standard) : null,
                                computed_percentile: result.percentile ? parseFloat(result.percentile) : null,
                                source_hash: sessionHash,
                                is_clinical: true
                            });
                        }
                    }
                }
            }

            if (payload.length > 0) {
                const { error } = await supabase.from('contribution_insights').insert(payload);
                if (error) Logger.warn('DB', 'Telemetry insert failed', error.message);
            }

        } catch (e) {
            Logger.warn('DB', 'Telemetry error (Silent)', e);
        }
    },

    // --- PHASE 3 : ANALYTIQUE ---

    getInsightsForSubtest: async (subtestId: string) => {
        const { data, error } = await supabase
            .from('contribution_insights')
            .select('computed_standard')
            .eq('subtest_id', subtestId)
            .not('computed_standard', 'is', null);

        if (error) throw error;
        return data.map((d: any) => parseFloat(d.computed_standard));
    },

    getQualityAlerts: async () => {
        const { data, error } = await supabase
            .from('contribution_insights')
            .select('test_id, computed_standard')
            .not('computed_standard', 'is', null);

        if (error) throw error;

        const stats: Record<string, { total: number, extreme: number }> = {};

        data.forEach((row: any) => {
            if (!stats[row.test_id]) stats[row.test_id] = { total: 0, extreme: 0 };
            const score = parseFloat(row.computed_standard);
            if (score > 145 || score < 55) {
                stats[row.test_id].extreme++;
            }
            stats[row.test_id].total++;
        });

        return Object.entries(stats)
            .map(([testId, s]) => ({
                testId,
                total: s.total,
                extremeRate: (s.extreme / s.total) * 100
            }))
            .filter(s => s.total > 10 && s.extremeRate > 5);
    },

    // --- PHASE 4 : OPS & MONITORING (IA) ---

    getAIHealthStats: async () => {
        return new Promise<{daily: any[], totalCost: number, errorRate: number}>(resolve => {
            setTimeout(() => {
                const totalCost = MOCK_AI_STATS.dailyUsage.reduce((acc, d) => acc + d.cost, 0);
                const totalErrors = MOCK_AI_STATS.dailyUsage.reduce((acc, d) => acc + d.errors, 0);
                const totalRequests = 150;

                resolve({
                    daily: MOCK_AI_STATS.dailyUsage,
                    totalCost: parseFloat(totalCost.toFixed(2)),
                    errorRate: parseFloat(((totalErrors / totalRequests) * 100).toFixed(1))
                });
            }, 500);
        });
    }
};




