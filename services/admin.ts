import { supabase } from './db';
import type {
    AdminTestSummary,
    AdminTestRecord,
    AdminSubtestRecord,
    AdminUserRow,
    AdminUserUpdatePayload,
} from '../types';
import { Logger } from '../utils/logger';

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
        const [{ data: test, error: testError }, { data: subtests, error: subError }] = await Promise.all([
            supabase.from('official_tests').select('*').eq('id', testId).single(),
            supabase.from('official_subtests').select('*').eq('test_id', testId).order('display_order', { ascending: true }).order('name', { ascending: true }),
        ]);
        if (testError) throw testError;
        if (subError) throw subError;
        return {
            test: test as AdminTestRecord,
            subtests: (subtests || []) as AdminSubtestRecord[],
        };
    },

    // ── Catalogue — save (test metadata + subtests) ────────────────────
    saveTestDetail: async (
        test: AdminTestRecord,
        subtests: AdminSubtestRecord[],
        deletedSubtestIds: string[],
    ): Promise<void> => {
        const { error: testError } = await supabase
            .from('official_tests')
            .update({ name: test.name, category_id: test.category_id, author: test.author, version: test.version })
            .eq('id', test.id);
        if (testError) throw testError;

        for (const sid of deletedSubtestIds) {
            const { error } = await supabase.rpc('admin_delete_subtest', { p_subtest_id: sid });
            if (error) Logger.warn('DB', `Failed to delete subtest ${sid}`, error);
        }

        if (subtests.length > 0) {
            const rows = subtests.map((s, idx) => ({
                id: s.id,
                test_id: s.test_id,
                name: s.name,
                abbreviation: s.abbreviation ?? null,
                unit: s.unit ?? null,
                score_type: s.score_type ?? 'standard',
                computation_mode: s.computation_mode ?? 'NONE',
                input_model: s.input_model ?? null,
                input_config: s.input_config ?? null,
                raw_direction: s.raw_direction ?? null,
                always_show_raw: s.always_show_raw ?? false,
                raw_display_decimals: s.raw_display_decimals ?? null,
                display_order: s.display_order ?? idx + 1,
                display_group_order: (s as any).display_group_order ?? null,
                organization_id: s.organization_id ?? null,
            }));
            const { error: upsertError } = await supabase.from('official_subtests').upsert(rows, { onConflict: 'id' });
            if (upsertError) throw upsertError;
        }
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
