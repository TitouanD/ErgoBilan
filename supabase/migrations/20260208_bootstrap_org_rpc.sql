-- Migration: bootstrap_org_for_user RPC
-- Purpose: Repair accounts where the handle_new_user trigger failed partially.
-- Creates org + membership + subscription if missing. Idempotent.
-- Runs as SECURITY DEFINER to bypass RLS.

CREATE OR REPLACE FUNCTION public.bootstrap_org_for_user(
    p_user_id uuid,
    p_org_name text DEFAULT 'Mon Cabinet'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_has_sub boolean;
BEGIN
    -- Guard: caller must be the same user
    IF auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden: you can only bootstrap your own organisation';
    END IF;

    -- 1. Organisation + Membership
    SELECT organization_id INTO v_org_id
    FROM organization_members
    WHERE user_id = p_user_id
    LIMIT 1;

    IF v_org_id IS NULL THEN
        INSERT INTO organizations (name)
        VALUES (p_org_name)
        RETURNING id INTO v_org_id;

        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (v_org_id, p_user_id, 'owner');
    END IF;

    -- 2. Subscription (trial 14 days if missing)
    SELECT EXISTS(
        SELECT 1 FROM subscriptions WHERE user_id = p_user_id
    ) INTO v_has_sub;

    IF NOT v_has_sub THEN
        INSERT INTO subscriptions (user_id, plan_id, status, trial_ends_at)
        VALUES (
            p_user_id,
            'free',
            'trialing',
            now() + interval '14 days'
        );
    END IF;

    RETURN v_org_id;
END;
$$;

-- Only authenticated users can call this function
REVOKE ALL ON FUNCTION public.bootstrap_org_for_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_for_user(uuid, text) TO authenticated;
