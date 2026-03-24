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
    AdminNormFittingIssueOverride,
    SubtestDirectionIssue
} from '../types';
import { Logger } from '../utils/logger';
import { captureAppMetric } from './sentryService';
import { featureFlag } from '../utils/featureFlags';

const ATTACH_MAX_SUBTESTS_PER_CHUNK = 10;
const ATTACH_MAX_NORMS_PER_CHUNK = 450;
const ATTACH_MAX_NORMS_PER_SUBTEST_FRAGMENT = 450;
const ATTACH_CHUNK_TIMEOUT_RETRIES = 2;
const ATTACH_CHUNK_RETRY_BASE_MS = 1200;
const ATTACH_MIN_FRAGMENT_NORMS = 50;
const ATTACH_RESUME_STATE_KEY = 'contrib_attach_resume_v1';
const ATTACH_RECHUNK_ENABLED = featureFlag('VITE_FEATURE_ATTACH_RECHUNK', false);
const ATTACH_RESUME_ENABLED = featureFlag('VITE_FEATURE_ATTACH_RESUME', true);

type ContributionSubtestPayload = {
    norms?: unknown[];
    [key: string]: unknown;
};

type ContributionTestPayload = {
    test?: Record<string, unknown>;
    subtests?: ContributionSubtestPayload[];
    [key: string]: unknown;
};

type AttachProgress = {
    current: number;
    total: number;
    attempt: number;
    chunkSubtests: number;
    chunkNorms: number;
    message: string;
};

type AttachChunkTask = {
    payload: ContributionTestPayload;
    maxSubtestsPerChunk: number;
    maxNormsPerChunk: number;
    maxNormsPerSubtestFragment: number;
    retriesUsed: number;
};

type AttachResumeState = {
    testId: string;
    payloadSignature: string;
    completedChunkFingerprints: string[];
    updatedAt: string;
};

const getSubtestNorms = (subtest: ContributionSubtestPayload): unknown[] => (
    Array.isArray(subtest.norms) ? subtest.norms : []
);

const cloneSubtestWithNorms = (subtest: ContributionSubtestPayload, norms: unknown[]): ContributionSubtestPayload => ({
    ...subtest,
    norms,
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const canUseLocalStorage = (): boolean => (
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
);

const quickHash = (value: string): string => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return String(hash >>> 0);
};

const computePayloadSignature = (payload: ContributionTestPayload): string => {
    const serialized = JSON.stringify(payload || {});
    return `p:${quickHash(serialized)}:${serialized.length}`;
};

const computeChunkFingerprint = (payload: ContributionTestPayload): string => {
    const serialized = JSON.stringify(payload || {});
    return `c:${quickHash(serialized)}:${serialized.length}`;
};

const loadAttachResumeState = (testId: string, payloadSignature: string): AttachResumeState | null => {
    if (!canUseLocalStorage()) return null;
    try {
        const raw = window.localStorage.getItem(ATTACH_RESUME_STATE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as AttachResumeState;
        if (!parsed || parsed.testId !== testId || parsed.payloadSignature !== payloadSignature) return null;
        if (!Array.isArray(parsed.completedChunkFingerprints)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const saveAttachResumeState = (state: AttachResumeState): void => {
    if (!canUseLocalStorage()) return;
    try {
        window.localStorage.setItem(ATTACH_RESUME_STATE_KEY, JSON.stringify(state));
    } catch {
        // Ignore local storage failures.
    }
};

const clearAttachResumeState = (testId: string, payloadSignature: string): void => {
    if (!canUseLocalStorage()) return;
    try {
        const raw = window.localStorage.getItem(ATTACH_RESUME_STATE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as AttachResumeState;
        if (parsed?.testId === testId && parsed?.payloadSignature === payloadSignature) {
            window.localStorage.removeItem(ATTACH_RESUME_STATE_KEY);
        }
    } catch {
        // Ignore local storage failures.
    }
};

const computeChunkStats = (payload: ContributionTestPayload): { subtests: number; norms: number } => {
    const subtests = Array.isArray(payload?.subtests) ? payload.subtests : [];
    const chunkSubtests = subtests.length;
    const chunkNorms = subtests.reduce((sum, subtest) => sum + getSubtestNorms(subtest).length, 0);
    return {
        subtests: chunkSubtests,
        norms: chunkNorms,
    };
};

const splitAttachChunkTask = (task: AttachChunkTask): AttachChunkTask[] | null => {
    const nextMaxSubtests = Math.max(1, Math.floor(task.maxSubtestsPerChunk / 2));
    const nextMaxNorms = Math.max(ATTACH_MIN_FRAGMENT_NORMS, Math.floor(task.maxNormsPerChunk / 2));
    const nextMaxNormsPerSubtestFragment = Math.max(
        ATTACH_MIN_FRAGMENT_NORMS,
        Math.floor(task.maxNormsPerSubtestFragment / 2),
    );

    const unchanged =
        nextMaxSubtests === task.maxSubtestsPerChunk
        && nextMaxNorms === task.maxNormsPerChunk
        && nextMaxNormsPerSubtestFragment === task.maxNormsPerSubtestFragment;

    if (unchanged) return null;

    const splitPayloads = splitContributionPayloadIntoChunks(task.payload, {
        maxSubtestsPerChunk: nextMaxSubtests,
        maxNormsPerChunk: nextMaxNorms,
        maxNormsPerSubtestFragment: nextMaxNormsPerSubtestFragment,
    });

    if (splitPayloads.length <= 1) return null;

    return splitPayloads.map((payload) => ({
        payload,
        maxSubtestsPerChunk: nextMaxSubtests,
        maxNormsPerChunk: nextMaxNorms,
        maxNormsPerSubtestFragment: nextMaxNormsPerSubtestFragment,
        retriesUsed: 0,
    }));
};

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

const toFiniteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const stringifyViolation = (violations: string[]): string => {
    if (violations.length <= 6) return violations.join(' | ');
    return `${violations.slice(0, 6).join(' | ')} | +${violations.length - 6} autre(s)`;
};

const validateContributionPayloadStrict = (payload: ContributionTestPayload): void => {
    const subtests = Array.isArray(payload?.subtests) ? payload.subtests : [];
    const violations: string[] = [];

    subtests.forEach((subtest, subtestIndex) => {
        const norms = getSubtestNorms(subtest) as Array<Record<string, unknown>>;
        const subtestName = String(subtest?.name || `subtest#${subtestIndex + 1}`);
        const computationMode = String(subtest?.computation_mode || 'LOOKUP').toUpperCase();

        const byAgeGender = new Map<string, Array<{ rawMin: number; rawMax: number; standard: number | null; percentile: number | null; normIndex: number }>>();

        norms.forEach((norm, normIndex) => {
            const ageMin = toFiniteNumber(norm.age_min_months);
            const ageMax = toFiniteNumber(norm.age_max_months);
            const rawMin = toFiniteNumber(norm.raw_min);
            const rawMax = toFiniteNumber(norm.raw_max);
            const mean = toFiniteNumber(norm.mean);
            const sd = toFiniteNumber(norm.sd);
            const standard = toFiniteNumber(norm.standard_score);
            const percentile = toFiniteNumber(norm.percentile);
            const gender = String(norm.gender || 'Mixed');

            if (ageMin === null || ageMax === null || ageMin > ageMax) {
                violations.push(`${subtestName}[${normIndex + 1}] age invalid (${String(norm.age_min_months)}-${String(norm.age_max_months)})`);
            }

            if (percentile !== null && (percentile < 0 || percentile > 100)) {
                violations.push(`${subtestName}[${normIndex + 1}] percentile out of bounds (${percentile})`);
            }

            const hasRawRange = rawMin !== null || rawMax !== null;
            if (hasRawRange) {
                if (rawMin === null || rawMax === null || rawMin > rawMax) {
                    violations.push(`${subtestName}[${normIndex + 1}] raw range invalid (${String(norm.raw_min)}-${String(norm.raw_max)})`);
                }
            }

            const hasMean = mean !== null;
            const hasSd = sd !== null;
            if (hasMean !== hasSd || (hasSd && sd <= 0)) {
                violations.push(`${subtestName}[${normIndex + 1}] mean/sd invalid (mean=${String(norm.mean)}, sd=${String(norm.sd)})`);
            }

            if (mean === null && standard === null && percentile === null) {
                violations.push(`${subtestName}[${normIndex + 1}] missing all score metrics`);
            }

            if (computationMode === 'LOOKUP' && rawMin !== null && rawMax !== null && ageMin !== null && ageMax !== null) {
                const ageGenderKey = `${ageMin}|${ageMax}|${gender}`;
                const existing = byAgeGender.get(ageGenderKey) || [];
                const sameRange = existing.find((item) => item.rawMin === rawMin && item.rawMax === rawMax);
                if (sameRange) {
                    const scoreConflict = (
                        (sameRange.standard !== null && standard !== null && Math.abs(sameRange.standard - standard) > 0.5)
                        || (sameRange.percentile !== null && percentile !== null && Math.abs(sameRange.percentile - percentile) > 1)
                    );
                    if (scoreConflict) {
                        violations.push(`${subtestName}[${normIndex + 1}] duplicate raw range conflict (${rawMin}-${rawMax})`);
                    }
                }
                existing.push({ rawMin, rawMax, standard, percentile, normIndex: normIndex + 1 });
                byAgeGender.set(ageGenderKey, existing);
            }
        });

        if (computationMode === 'LOOKUP') {
            byAgeGender.forEach((items, key) => {
                if (items.length < 2) return;
                const sorted = [...items].sort((a, b) => a.rawMin - b.rawMin || a.rawMax - b.rawMax);
                for (let i = 1; i < sorted.length; i += 1) {
                    const prev = sorted[i - 1];
                    const curr = sorted[i];
                    if (curr.rawMin <= prev.rawMax) {
                        violations.push(`${subtestName} overlap in group ${key} between norms ${prev.normIndex} and ${curr.normIndex}`);
                    }
                }
            });
        }
    });

    if (violations.length > 0) {
        throw new Error(`VALIDATION_BLOQUANTE: ${stringifyViolation(violations)}`);
    }
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const toFiniteNumberOrZero = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const validateCreatePrivateTestResult = (data: unknown): string => {
    if (typeof data === 'string' && data.trim().length > 0) return data;
    throw new Error('RPC_CONTRACT_ERROR:create_private_test returned invalid test id');
};

const validateMergeResult = (data: unknown, rpcName: 'merge_private_test' | 'attach_subtests_to_test'): AttachResult => {
    if (!isObjectRecord(data)) {
        throw new Error(`RPC_CONTRACT_ERROR:${rpcName} returned invalid payload`);
    }
    return {
        new_subtests: toFiniteNumberOrZero(data.new_subtests),
        new_norms: toFiniteNumberOrZero(data.new_norms),
        test_id: typeof data.test_id === 'string' ? data.test_id : '',
    };
};

const validateSimilarTestsResult = (data: unknown): SimilarTestMatch[] => {
    if (!Array.isArray(data)) return [];
    return data
        .filter((item) => isObjectRecord(item) && typeof item.id === 'string' && typeof item.name === 'string')
        .map((item) => ({
            ...(item as SimilarTestMatch),
            similarity_score: toFiniteNumberOrZero(item.similarity_score),
        }));
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
        validateContributionPayloadStrict(bundle as unknown as ContributionTestPayload);
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
        return validateSimilarTestsResult(data);
    },

    createPrivateTest: async (payload: any): Promise<string> => {
        validateContributionPayloadStrict(payload as ContributionTestPayload);
        const { data, error } = await supabase.rpc('create_private_test', { p_payload: payload });
        if (error) throw error;
        return validateCreatePrivateTestResult(data);
    },

    mergePrivateTest: async (targetId: string, payload: any): Promise<{ new_subtests: number; new_norms: number }> => {
        validateContributionPayloadStrict(payload as ContributionTestPayload);
        const { data, error } = await supabase.rpc('merge_private_test', { p_target_id: targetId, p_payload: payload });
        if (error) throw error;
        const parsed = validateMergeResult(data, 'merge_private_test');
        return {
            new_subtests: parsed.new_subtests,
            new_norms: parsed.new_norms,
        };
    },

    /**
     * Attach private subtests/norms to an existing test (public or private).
     * Subtests are scoped to the user's organization.
     */
    attachSubtestsToTest: async (
        testId: string,
        payload: any,
        onProgress?: (progress: AttachProgress) => void,
    ): Promise<AttachResult> => {
        const startedAt = performance.now();
        const typedPayload = (payload || {}) as ContributionTestPayload;
        validateContributionPayloadStrict(typedPayload);
        const chunks = splitContributionPayloadIntoChunks(typedPayload);
        const payloadSignature = computePayloadSignature(typedPayload);
        const resumeState = ATTACH_RESUME_ENABLED ? loadAttachResumeState(testId, payloadSignature) : null;
        const completedFingerprints = new Set(resumeState?.completedChunkFingerprints || []);
        let resumedChunks = 0;
        let timeoutRetries = 0;
        let timeoutSplits = 0;
        const taskQueue: AttachChunkTask[] = chunks.map((chunkPayload) => ({
            payload: chunkPayload,
            maxSubtestsPerChunk: ATTACH_MAX_SUBTESTS_PER_CHUNK,
            maxNormsPerChunk: ATTACH_MAX_NORMS_PER_CHUNK,
            maxNormsPerSubtestFragment: ATTACH_MAX_NORMS_PER_SUBTEST_FRAGMENT,
            retriesUsed: 0,
        }));

        Logger.info('DB', `Attach payload split into ${taskQueue.length} chunks for test ${testId}`);

        let totalNewSubtests = 0;
        let totalNewNorms = 0;

        for (let index = 0; index < taskQueue.length;) {
            const task = taskQueue[index];
            const chunkPayload = task.payload;
            const stats = computeChunkStats(chunkPayload);
            const attempt = task.retriesUsed + 1;
            const chunkFingerprint = computeChunkFingerprint(chunkPayload);

            if (completedFingerprints.has(chunkFingerprint)) {
                resumedChunks += 1;
                onProgress?.({
                    current: index + 1,
                    total: taskQueue.length,
                    attempt: 0,
                    chunkSubtests: stats.subtests,
                    chunkNorms: stats.norms,
                    message: `Lot ${index + 1}/${taskQueue.length} déjà envoyé, reprise en cours...`,
                });
                index += 1;
                continue;
            }

            onProgress?.({
                current: index + 1,
                total: taskQueue.length,
                attempt,
                chunkSubtests: stats.subtests,
                chunkNorms: stats.norms,
                message: `Envoi du lot ${index + 1}/${taskQueue.length} (${stats.subtests} sous-tests, ${stats.norms} normes)...`,
            });

            Logger.info(
                'DB',
                `Attach chunk ${index + 1}/${taskQueue.length} (attempt ${attempt}) -> ${stats.subtests} subtests, ${stats.norms} norms`,
            );

            const { data, error } = await supabase.rpc('attach_subtests_to_test', {
                p_test_id: testId,
                p_payload: chunkPayload,
            });

            if (error) {
                if (isStatementTimeoutError(error)) {
                    if (task.retriesUsed < ATTACH_CHUNK_TIMEOUT_RETRIES) {
                        task.retriesUsed += 1;
                        timeoutRetries += 1;
                        const waitMs = ATTACH_CHUNK_RETRY_BASE_MS * Math.max(1, task.retriesUsed);
                        Logger.warn('DB', `Attach chunk ${index + 1}/${taskQueue.length} timeout; retry in ${waitMs}ms`);
                        onProgress?.({
                            current: index + 1,
                            total: taskQueue.length,
                            attempt: task.retriesUsed + 1,
                            chunkSubtests: stats.subtests,
                            chunkNorms: stats.norms,
                            message: `Lot ${index + 1} temporairement bloqué. Nouvelle tentative...`,
                        });
                        await sleep(waitMs);
                        continue;
                    }

                    // NOTE: We intentionally do not rechunk the task queue after a timeout.
                    // Dynamically splitting chunks here would change chunk identities between runs
                    // and can break resume logic that relies on stable chunk fingerprints.
                    const splitTasks = ATTACH_RECHUNK_ENABLED ? splitAttachChunkTask(task) : null;
                    if (splitTasks && splitTasks.length > 1) {
                        timeoutSplits += 1;
                        taskQueue.splice(index, 1, ...splitTasks);
                        Logger.warn('DB', `Attach chunk ${index + 1} split into ${splitTasks.length} smaller chunks after timeout`);
                        onProgress?.({
                            current: index + 1,
                            total: taskQueue.length,
                            attempt: 1,
                            chunkSubtests: stats.subtests,
                            chunkNorms: stats.norms,
                            message: `Lot ${index + 1} redécoupé automatiquement pour reprise.`,
                        });
                        continue;
                    }

                    captureAppMetric('contribution.attach.failed', 1, { operation: 'attach', reason: 'timeout' }, {
                        chunkIndex: index + 1,
                        queueSize: taskQueue.length,
                        retriesUsed: task.retriesUsed,
                    });
                    throw new Error(
                        `ATTACH_TIMEOUT_CHUNK_${index + 1}_OF_${taskQueue.length}: opération volumineuse, relancez pour reprendre (idempotent).`,
                    );
                }
                captureAppMetric('contribution.attach.failed', 1, { operation: 'attach' }, {
                    chunkIndex: index + 1,
                    queueSize: taskQueue.length,
                    retriesUsed: task.retriesUsed,
                });
                throw error;
            }

            const chunkResult = validateMergeResult(data, 'attach_subtests_to_test');
            totalNewSubtests += Number(chunkResult.new_subtests || 0);
            totalNewNorms += Number(chunkResult.new_norms || 0);
            completedFingerprints.add(chunkFingerprint);
            if (ATTACH_RESUME_ENABLED) {
                saveAttachResumeState({
                    testId,
                    payloadSignature,
                    completedChunkFingerprints: Array.from(completedFingerprints.values()),
                    updatedAt: new Date().toISOString(),
                });
            }
            onProgress?.({
                current: index + 1,
                total: taskQueue.length,
                attempt,
                chunkSubtests: stats.subtests,
                chunkNorms: stats.norms,
                message: `Lot ${index + 1}/${taskQueue.length} terminé.`,
            });
            index += 1;
        }

        if (ATTACH_RESUME_ENABLED) {
            clearAttachResumeState(testId, payloadSignature);
        }

        captureAppMetric('contribution.attach.completed', 1, { operation: 'attach' }, {
            durationMs: Math.round(performance.now() - startedAt),
            queueSize: taskQueue.length,
            resumedChunks,
            timeoutRetries,
            timeoutSplits,
            newSubtests: totalNewSubtests,
            newNorms: totalNewNorms,
        });
        const attachKpiPass = timeoutSplits === 0 && timeoutRetries <= 1;
        captureAppMetric('contribution.attach.kpi', attachKpiPass ? 1 : 0, {
            operation: 'attach',
            gate: attachKpiPass ? 'pass' : 'fail',
        }, {
            queueSize: taskQueue.length,
            resumedChunks,
            timeoutRetries,
            timeoutSplits,
        });

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

    // --- DIRECTION QUALITY ---

    /**
     * Returns subtest-level direction quality issues:
     *  - DIRECTION_AUTO_WITH_NORMS  (blocking): raw_direction='auto' but norms exist
     *  - DIRECTION_NAME_MISMATCH    (warning):  DB says higher_better but name implies lower
     */
    listDirectionIssues: async (): Promise<SubtestDirectionIssue[]> => {
        const { data, error } = await supabase.rpc('admin_list_direction_issues');
        if (error) throw error;
        return (data || []) as SubtestDirectionIssue[];
    },

    // --- PHASE 4 : OPS & MONITORING (IA) ---

    getAIHealthStats: async (): Promise<{
        daily: Array<{ date: string; requests: number; errors: number }>;
        total_requests: number;
        total_errors: number;
        error_rate_pct: number;
    }> => {
        const { data, error } = await supabase.rpc('admin_get_ai_health_stats');
        if (error) throw error;
        return data as {
            daily: Array<{ date: string; requests: number; errors: number }>;
            total_requests: number;
            total_errors: number;
            error_rate_pct: number;
        };
    }
};




