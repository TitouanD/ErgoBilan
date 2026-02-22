-- Mitigate permissive supabase_admin default ACL by auto-revoking grants on new public objects.

CREATE OR REPLACE FUNCTION public.enforce_public_acl_on_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE schema_name = 'public'
      AND command_tag IN (
        'CREATE TABLE',
        'CREATE TABLE AS',
        'CREATE VIEW',
        'CREATE MATERIALIZED VIEW',
        'CREATE SEQUENCE',
        'CREATE FUNCTION'
      )
  LOOP
    IF obj.object_type IN ('table', 'view', 'materialized view', 'foreign table') THEN
      EXECUTE format('REVOKE ALL ON TABLE %s FROM anon, authenticated', obj.object_identity);
    ELSIF obj.object_type = 'sequence' THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon, authenticated', obj.object_identity);
    ELSIF obj.object_type = 'function' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', obj.object_identity);
    END IF;
  END LOOP;
END;
$function$;

DROP EVENT TRIGGER IF EXISTS trg_enforce_public_acl_on_ddl;
CREATE EVENT TRIGGER trg_enforce_public_acl_on_ddl
ON ddl_command_end
EXECUTE FUNCTION public.enforce_public_acl_on_ddl();
