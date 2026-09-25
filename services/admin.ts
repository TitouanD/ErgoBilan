import { supabase } from './db';
import type {
    AdminTestSummary,
    AdminTestRecord,
    AdminSubtestRecord,
    AdminUserRow,
    AdminUserUpdatePayload,
} from '../types';

export const AdminService = {

    // ── Auth ───────────────────────────────────────────────────────────
    adminCheck: async (): Promise<boolean> => {
        const { data, error } = await supabase.rpc('admin_check');
        if (error) throw error;
        return data === true;
    },

    // ── Catalogue — tests list ─────────────────────────────────────────
    listTests: async (scope: 'public' | 'private' | 'all' = 'public'): Promise<AdminTestSummary[]> => {
        const { data, error } = await supabase.rpc('admin_list_tests', { p_scope: scope });
        if (error) throw error;
        return data || [];
    },

    // ── Catalogue — test detail (test + subtests) ───────────────────────
    loadTestDetail: async (testId: string): Promise<{ test: AdminTestRecord; subtests: AdminSubtestRecord[] }> => {
        const { data, error } = await supabase.rpc('admin_get_test_detail', { p_test_id: testId });
        if (error) throw error;
        const detail = data as unknown as { test: AdminTestRecord; subtests?: AdminSubtestRecord[] };
        return { test: detail.test, subtests: detail.subtests ?? [] };
    },

    // ── Catalogue — save (test metadata + subtests) ────────────────────
    saveTestDetail: async (
        test: AdminTestRecord,
        subtests: AdminSubtestRecord[],
        deletedSubtestIds: string[],
    ): Promise<void> => {
        const { error } = await supabase.rpc('admin_save_test_detail', {
            p_test_id: test.id,
            p_test_data: { name: test.name, category_id: test.category_id, author: test.author ?? null, version: test.version ?? null },
            p_subtests: subtests.map((s, idx) => ({
                id: s.id,
                test_id: s.test_id,
                name: s.name,
                unit: s.unit ?? null,
                // Columns are NOT NULL: unknown scale / standard input model / empty config.
                score_type: s.score_type ?? 'none',
                input_model: s.input_model ?? 'numeric_4mode',
                input_config: s.input_config ?? {},
                display_order: s.display_order ?? idx + 1,
                display_group_order: s.display_group_order ?? null,
                organization_id: s.organization_id ?? null,
            })),
            p_deleted_subtest_ids: deletedSubtestIds,
        });
        if (error) throw error;
    },

    // ── Catalogue — delete ─────────────────────────────────────────────
    deleteTest: async (testId: string): Promise<void> => {
        const { error } = await supabase.rpc('admin_delete_test', { p_test_id: testId });
        if (error) throw error;
    },

    deleteSubtest: async (subtestId: string): Promise<void> => {
        const { error } = await supabase.rpc('admin_delete_subtest', { p_subtest_id: subtestId });
        if (error) throw error;
    },

    // ── Custom tests (practitioner-scoped) ─────────────────────────────
    saveCustomTest: async (payload: {
        test: { name: string; abbreviation?: string; category_id: string };
        subtests: Array<{ name: string; abbreviation?: string; score_type: string; order_index: number }>;
    }): Promise<void> => {
        const { error } = await supabase.rpc('practitioner_save_custom_test', { payload });
        if (error) throw error;
    },

    // ── Users & subscriptions ──────────────────────────────────────────
    listUsers: async (): Promise<AdminUserRow[]> => {
        const { data, error } = await supabase.rpc('admin_list_users');
        if (error) throw error;
        return (data || []) as AdminUserRow[];
    },

    updateUser: async (payload: AdminUserUpdatePayload): Promise<{ ok: boolean; user_id: string }> => {
        const { data, error } = await supabase.rpc('admin_update_user', {
            p_user_id: payload.userId,
            // Omitted parameters default to NULL server-side = "keep the current value".
            p_is_admin: payload.isAdmin,
            p_credits: payload.credits,
            p_plan_id: payload.planId,
            p_status: payload.status,
            p_trial_ends_at: payload.trialEndsAt ?? undefined,
            p_current_period_end: payload.currentPeriodEnd ?? undefined,
            p_monthly_extraction_quota: payload.monthlyExtractionQuota,
        });
        if (error) throw error;
        return data as { ok: boolean; user_id: string };
    },

    // ── AI health (OpsMonitoring) ──────────────────────────────────────
    getAIHealthStats: async (): Promise<{
        daily: Array<{ date: string; requests: number; errors: number }>;
        total_requests: number;
        total_errors: number;
        error_rate_pct: number;
    }> => {
        const { data, error } = await supabase.rpc('admin_get_ai_health_stats');
        if (error) throw error;
        return data as { daily: Array<{ date: string; requests: number; errors: number }>; total_requests: number; total_errors: number; error_rate_pct: number; };
    },
};
