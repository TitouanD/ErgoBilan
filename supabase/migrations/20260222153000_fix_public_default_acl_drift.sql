BEGIN;

-- Enforce deny-by-default on future public objects for non-privileged API roles.
DO $$
BEGIN
  BEGIN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not alter default privileges for role postgres: %', SQLERRM;
  END;

  BEGIN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not alter default privileges for role supabase_admin: %', SQLERRM;
  END;
END
$$;

COMMIT;
