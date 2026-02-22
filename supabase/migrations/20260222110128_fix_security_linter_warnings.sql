BEGIN;

-- 1) Fix mutable search_path warnings
ALTER FUNCTION public.update_admin_audit_log_timestamp() SET search_path = public;
ALTER FUNCTION public.normalize_subtest_abbreviation_tag(text) SET search_path = public;
ALTER FUNCTION public.extract_trailing_tag(text) SET search_path = public;
ALTER FUNCTION public.norm_name(text) SET search_path = public;
ALTER FUNCTION public.norm_subtest_name(text) SET search_path = public;

-- 2) Internal log tables: RLS not needed (no anon/auth grants, service-only access)
ALTER TABLE public.ai_request_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_rate_limit_log DISABLE ROW LEVEL SECURITY;

-- 3) Move extensions out of public schema
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION unaccent SET SCHEMA extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- Compatibility wrappers for functions referenced by app SQL/search_path=public routines
CREATE OR REPLACE FUNCTION public.unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = extensions
AS $$
  SELECT extensions.unaccent($1);
$$;

CREATE OR REPLACE FUNCTION public.unaccent(regdictionary, text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
STRICT
SET search_path = extensions
AS $$
  SELECT extensions.unaccent($1, $2);
$$;

CREATE OR REPLACE FUNCTION public.similarity(text, text)
RETURNS real
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = extensions
AS $$
  SELECT extensions.similarity($1, $2);
$$;

COMMIT;