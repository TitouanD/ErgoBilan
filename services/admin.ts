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
    NormQualityFlag,
    AdminIssueBacklogItem,
    AdminUserRow,
    AdminUserUpdatePayload,
    InsightQualityAlert,
    AdminNormFittingDatasetRow,
    AdminNormFittingIssueOverride
} from '../types';
import { Logger } from '../utils/logger';

const ATTACH_MAX_SUBTESTS_PER_CHUNK = 10;
const ATTACH_MAX_NORMS_PER_CHUNK = 450;
const ATTACH_MAX_NORMS_PER_SUBTEST_FRAGMENT = 450;

type ContributionSubtestPayload = {
    norms?: unknown[];
    [key: string]: unknown;
};

type ContributionTestPayload = {
    test?: Record<string, unknown>;
    subtests?: ContributionSubtestPayload[];
    [key: string]: unknown;
};

const getSubtestNorms = (subtest: ContributionSubtestPayload): unknown[] => (
    Array.isArray(subtest.norms) ? subtest.norms : []
);

const cloneSubtestWithNorms = (subtest: ContributionSubtestPayload, norms: unknown[]): ContributionSubtestPayload => ({
    ...subtest,
    norms,
});

const flattenSubtestsForChunking = (
    subtests: ContributionSubtestPayload[],
    maxNormsPerSubtestFragment: number,
): ContributionSubtestPayload[] => {
    const flattened: ContributionSubtestPayload[] = [];

    subtests.forEach((subtest) => {
        const norms = getSubtestNorms(subtest);
        if (norms.length <= maxNormsPerSubtestFragment) {
            flattened.push(cloneSubtestWithNorms(subtest, norms));
            return;
        }

        for (let start = 0; start < norms.length; start += maxNormsPerSubtestFragment) {
            const fragment = norms.slice(start, start + maxNormsPerSubtestFragment);
            flattened.push(cloneSubtestWithNorms(subtest, fragment));
        }
    });

    return flattened;
};

const splitContributionPayloadIntoChunks = (
    payload: ContributionTestPayload,
    options?: {
        maxSubtestsPerChunk?: number;
        maxNormsPerChunk?: number;
        maxNormsPerSubtestFragment?: number;
    },
): ContributionTestPayload[] => {
    const maxSubtestsPerChunk = options?.maxSubtestsPerChunk ?? ATTACH_MAX_SUBTESTS_PER_CHUNK;
    const maxNormsPerChunk = options?.maxNormsPerChunk ?? ATTACH_MAX_NORMS_PER_CHUNK;
    const maxNormsPerSubtestFragment = options?.maxNormsPerSubtestFragment ?? ATTACH_MAX_NORMS_PER_SUBTEST_FRAGMENT;

    const subtests = Array.isArray(payload?.subtests) ? payload.subtests : [];
    if (subtests.length === 0) {
        return [{ ...payload, subtests: [] }];
    }

    const flattenedSubtests = flattenSubtestsForChunking(subtests, maxNormsPerSubtestFragment);

    const chunks: ContributionTestPayload[] = [];
    let currentSubtests: ContributionSubtestPayload[] = [];
    let currentNormCount = 0;

    const pushCurrentChunk = () => {
        if (currentSubtests.length === 0) return;
        chunks.push({
            ...payload,
            subtests: currentSubtests,
        });
        currentSubtests = [];
        currentNormCount = 0;
    };

    flattenedSubtests.forEach((subtest) => {
        const normCount = getSubtestNorms(subtest).length;
        const wouldOverflow =
            currentSubtests.length > 0
            && (
                currentSubtests.length >= maxSubtestsPerChunk
                || (currentNormCount + normCount > maxNormsPerChunk)
            );

        if (wouldOverflow) {
            pushCurrentChunk();
        }

        currentSubtests.push(subtest);
        currentNormCount += normCount;
    });

    pushCurrentChunk();
    return chunks;
};

const isStatementTimeoutError = (error: unknown): boolean => {
    const value = error as { code?: string; message?: string } | null;
    const code = String(value?.code || '');
    const message = String(value?.message || '').toLowerCase();
    return code === '57014' || message.includes('statement timeout');
};

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
     * Global cross-test issue backlog (missing tags, dedup, quality)
     */
    listIssueBacklog: async (): Promise<AdminIssueBacklogItem[]> => {
        const { data, error } = await supabase.rpc('admin_list_issue_backlog');
        if (error) throw error;
        return (data || []) as AdminIssueBacklogItem[];
    },

    /**
     * Admin users + subscriptions overview
     */
    listUsers: async (): Promise<AdminUserRow[]> => {
        const { data, error } = await supabase.rpc('admin_list_users');
        if (error) throw error;
        return (data || []) as AdminUserRow[];
    },

    /**
     * Update a user's admin/subscription state
     */
    updateUser: async (payload: AdminUserUpdatePayload): Promise<{ ok: boolean; user_id: string }> => {
        const { data, error } = await supabase.rpc('admin_update_user', {
            p_user_id: payload.userId,
            p_is_admin: payload.isAdmin ?? null,
            p_credits: payload.credits ?? null,
            p_plan_id: payload.planId ?? null,
            p_status: payload.status ?? null,
            p_trial_ends_at: payload.trialEndsAt ?? null,
            p_current_period_end: payload.currentPeriodEnd ?? null,
            p_monthly_extraction_quota: payload.monthlyExtractionQuota ?? null,
        });
        if (error) throw error;
        return data as { ok: boolean; user_id: string };
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
        const typedPayload = (payload || {}) as ContributionTestPayload;
        const chunks = splitContributionPayloadIntoChunks(typedPayload);

        if (chunks.length === 1) {
            const { data, error } = await supabase.rpc('attach_subtests_to_test', { p_test_id: testId, p_payload: typedPayload });
            if (error) throw error;
            return data as AttachResult;
        }

        Logger.info('DB', `Attach payload split into ${chunks.length} chunks for test ${testId}`);

        let totalNewSubtests = 0;
        let totalNewNorms = 0;

        for (let index = 0; index < chunks.length; index += 1) {
            const chunkPayload = chunks[index];
            const chunkSubtests = Array.isArray(chunkPayload.subtests) ? chunkPayload.subtests.length : 0;
            const chunkNorms = (chunkPayload.subtests || []).reduce((sum, subtest) => {
                const norms = getSubtestNorms(subtest);
                return sum + norms.length;
            }, 0);

            Logger.info(
                'DB',
                `Attach chunk ${index + 1}/${chunks.length} -> ${chunkSubtests} subtests, ${chunkNorms} norms`,
            );

            const { data, error } = await supabase.rpc('attach_subtests_to_test', {
                p_test_id: testId,
                p_payload: chunkPayload,
            });

            if (error) {
                if (isStatementTimeoutError(error)) {
                    throw new Error(
                        `ATTACH_TIMEOUT_CHUNK_${index + 1}_OF_${chunks.length}: opération volumineuse, relancez pour reprendre (idempotent).`,
                    );
                }
                throw error;
            }

            const chunkResult = (data || {}) as Partial<AttachResult>;
            totalNewSubtests += Number(chunkResult.new_subtests || 0);
            totalNewNorms += Number(chunkResult.new_norms || 0);
        }

        return {
            new_subtests: totalNewSubtests,
            new_norms: totalNewNorms,
            test_id: testId,
        };
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

    /**
     * Dismiss or restore a specific norm quality issue
     */
    setNormIssueDismissed: async (params: { normId: string; flagCode: string; dismissed: boolean; reason?: string | null }) => {
        const { data, error } = await supabase.rpc('admin_set_norm_issue_dismissed', {
            p_norm_id: params.normId,
            p_flag_code: params.flagCode,
            p_dismissed: params.dismissed,
            p_reason: params.reason ?? null,
        });
        if (error) throw error;
        return data as { ok: boolean; norm_id: string; flag_code: string; dismissed: boolean };
    },

    /**
     * Create/update an organization-scoped direction override clone for a subtest.
     */
    createOrUpdateSubtestOverrideClone: async (params: {
        sourceSubtestId: string;
        rawDirection: 'higher_better' | 'lower_better';
        reason?: string | null;
    }): Promise<{ effective_subtest_id: string; created: boolean; updated_norms_count: number } | null> => {
        const { data, error } = await supabase.rpc('admin_create_or_update_subtest_override_clone', {
            p_source_subtest_id: params.sourceSubtestId,
            p_raw_direction: params.rawDirection,
            p_reason: params.reason ?? null,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return null;
        return row as { effective_subtest_id: string; created: boolean; updated_norms_count: number };
    },

    // --- NORM FITTING AUDIT ---

    listNormFittingDataset: async (params?: {
        scope?: 'all' | 'public' | 'private';
        testId?: string | null;
        subtestId?: string | null;
    }): Promise<AdminNormFittingDatasetRow[]> => {
        const { data, error } = await supabase.rpc('admin_list_norm_fitting_dataset', {
            p_scope: params?.scope || 'all',
            p_test_id: params?.testId ?? null,
            p_subtest_id: params?.subtestId ?? null,
        });
        if (error) throw error;
        return (data || []) as AdminNormFittingDatasetRow[];
    },

    listNormFittingIssueOverrides: async (params?: {
        testId?: string | null;
        subtestId?: string | null;
    }): Promise<AdminNormFittingIssueOverride[]> => {
        const { data, error } = await supabase.rpc('admin_list_norm_fitting_issue_overrides', {
            p_test_id: params?.testId ?? null,
            p_subtest_id: params?.subtestId ?? null,
        });
        if (error) throw error;
        return (data || []) as AdminNormFittingIssueOverride[];
    },

    setNormFittingIssueDismissed: async (params: {
        issueKey: string;
        testId: string;
        subtestId: string;
        issueCode: string;
        dismissed: boolean;
        reason?: string | null;
    }) => {
        const { data, error } = await supabase.rpc('admin_set_norm_fitting_issue_dismissed', {
            p_issue_key: params.issueKey,
            p_test_id: params.testId,
            p_subtest_id: params.subtestId,
            p_issue_code: params.issueCode,
            p_dismissed: params.dismissed,
            p_reason: params.reason ?? null,
        });
        if (error) throw error;
        return data as { ok: boolean; issue_key: string; dismissed: boolean };
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

    getQualityAlerts: async (): Promise<InsightQualityAlert[]> => {
        const { data, error } = await supabase.rpc('admin_insight_extreme_alerts', {
            p_min_samples: 10,
            p_min_extreme_rate: 5,
        });
        if (error) throw error;

        return ((data || []) as Array<{
            test_id: string;
            test_name: string;
            total_samples: number;
            extreme_samples: number;
            extreme_rate: number;
        }>).map((row) => ({
            testId: row.test_id,
            testName: row.test_name,
            total: row.total_samples,
            extreme: row.extreme_samples,
            extremeRate: row.extreme_rate,
        }));
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




