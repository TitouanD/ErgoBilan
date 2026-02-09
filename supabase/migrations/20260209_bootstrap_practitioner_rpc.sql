-- Migration: bootstrap_practitioner_for_user RPC
-- Purpose: Repair accounts where the handle_new_user trigger failed to create the practitioner row.
-- Creates practitioner if missing. Idempotent. Runs as SECURITY DEFINER to bypass RLS.

CREATE OR REPLACE FUNCTION public.bootstrap_practitioner_for_user(
    p_user_id uuid,
    p_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Guard: caller must be the same user
    IF auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden: you can only bootstrap your own profile';
    END IF;

    IF p_email IS NULL OR length(p_email) = 0 THEN
        RAISE EXCEPTION 'Missing email';
    END IF;

    IF EXISTS (SELECT 1 FROM practitioners WHERE id = p_user_id) THEN
        RETURN true;
    END IF;

    INSERT INTO practitioners (id, email, encryption_salt, encryption_validator)
    VALUES (p_user_id, p_email, 'pending', 'pending');

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_practitioner_for_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_practitioner_for_user(uuid, text) TO authenticated;
