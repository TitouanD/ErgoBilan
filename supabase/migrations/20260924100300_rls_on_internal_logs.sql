-- Defense in depth (docs/TECH_DEBT.md P0-8): RLS was disabled on two internal
-- journals. No client role has privileges on them today, and they are only written
-- by SECURITY DEFINER functions running with row_security = off (or by the service
-- role), so enabling RLS without policies changes nothing for the app while
-- guaranteeing they stay unreadable if a grant is ever added by mistake.

ALTER TABLE public.ai_request_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_rate_limit_log ENABLE ROW LEVEL SECURITY;
