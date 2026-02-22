BEGIN;

REVOKE EXECUTE ON FUNCTION public.finalize_generation(uuid, boolean, text) FROM authenticated;

COMMIT;
