-- score_type_reports: practitioners signal a potentially wrong score_type on a subtest
-- Admin reviews and optionally corrects the official catalog.

CREATE TABLE IF NOT EXISTS public.score_type_reports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subtest_id      text        NOT NULL,
    reporter_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    current_score_type  text   NOT NULL,
    suggested_score_type text  NULL,
    entered_ns      numeric(10,3) NULL,
    entered_et      numeric(10,3) NULL,
    entered_pct     numeric(10,3) NULL,
    note            text        NULL,
    status          text        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'reviewed', 'dismissed')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    reviewed_at     timestamptz NULL,
    reviewed_by     uuid        NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS score_type_reports_subtest_idx ON public.score_type_reports (subtest_id);
CREATE INDEX IF NOT EXISTS score_type_reports_status_idx  ON public.score_type_reports (status);

ALTER TABLE public.score_type_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "score_type_reports_insert" ON public.score_type_reports
    FOR INSERT TO authenticated
    WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "score_type_reports_select_own" ON public.score_type_reports
    FOR SELECT TO authenticated
    USING (reporter_id = auth.uid() OR check_is_admin());

CREATE POLICY "score_type_reports_update_admin" ON public.score_type_reports
    FOR UPDATE TO authenticated
    USING (check_is_admin())
    WITH CHECK (check_is_admin());

CREATE POLICY "score_type_reports_delete_admin" ON public.score_type_reports
    FOR DELETE TO authenticated
    USING (check_is_admin());

GRANT SELECT, INSERT ON public.score_type_reports TO authenticated;
GRANT UPDATE, DELETE ON public.score_type_reports TO authenticated;;
