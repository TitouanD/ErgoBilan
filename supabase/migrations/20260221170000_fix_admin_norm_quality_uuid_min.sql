-- Hotfix: replace invalid min(uuid) aggregate in admin_norm_quality_check.
-- This migration is idempotent and safe to run even if already patched.

DO $$
DECLARE
  fn_def text;
  patched text;
BEGIN
  SELECT pg_get_functiondef('public.admin_norm_quality_check(text,text)'::regprocedure)
    INTO fn_def;

  IF fn_def IS NULL THEN
    RAISE EXCEPTION 'Function public.admin_norm_quality_check(text,text) not found';
  END IF;

  patched := regexp_replace(
    fn_def,
    'min\\(b\\.id\\)\\s+AS\\s+norm_id,',
    '(array_agg(b.id ORDER BY b.id))[1] AS norm_id,',
    'g'
  );

  IF patched <> fn_def THEN
    EXECUTE patched;
  END IF;
END
$$;
