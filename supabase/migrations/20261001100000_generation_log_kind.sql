-- Type de génération dans generation_log (#60, docs/TECH_DEBT.md P1-8).
--
-- 1. Colonne `kind` nullable : tâche qui a ouvert la session ('report_bio' pour
--    un bilan initial, dont la session couvre aussi report_diagnostic ;
--    'report_reevaluation'). NULL pour les lignes antérieures.
-- 2. consume_credit_for_user reçoit un paramètre FACULTATIF p_kind (défaut NULL).
--    L'ancienne signature (uuid) est remplacée dans la même transaction : un appel
--    { p_user_id } de l'edge actuellement déployée se résout sur la nouvelle
--    fonction grâce au défaut. Garder les deux surcharges rendrait cet appel
--    ambigu, d'où le DROP.
--
-- Ordre : appliquer cette migration AVANT de déployer l'edge `generate` qui envoie
-- p_kind (sinon PostgREST ne trouve pas la fonction et toute génération renvoie 402).

ALTER TABLE public.generation_log ADD COLUMN IF NOT EXISTS kind text;

COMMENT ON COLUMN public.generation_log.kind IS
  'Tâche qui a ouvert la session (report_bio : bilan initial, bio + diagnostic ; report_reevaluation). NULL avant 2026-10.';

DROP FUNCTION IF EXISTS public.consume_credit_for_user(uuid);

CREATE OR REPLACE FUNCTION public.consume_credit_for_user(p_user_id uuid, p_kind text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := p_user_id;
  v_kind text := nullif(btrim(p_kind), '');
  v_credits integer;
  v_is_admin boolean;
  v_plan_id text;
  v_status text;
  v_gen_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT public.is_practitioner_pin_configured(v_user_id) THEN
    RETURN NULL;
  END IF;

  SELECT p.credits, p.is_admin
  INTO v_credits, v_is_admin
  FROM public.practitioners p
  WHERE p.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT s.plan_id, s.status
  INTO v_plan_id, v_status
  FROM public.subscriptions s
  WHERE s.user_id = v_user_id
  ORDER BY s.created_at DESC NULLS LAST, s.id DESC
  LIMIT 1;

  IF COALESCE(v_is_admin, false) THEN
    INSERT INTO public.generation_log (user_id, status, kind)
    VALUES (v_user_id, 'pending', v_kind)
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  IF COALESCE(v_status, 'inactive') NOT IN ('active', 'trialing') THEN
    RETURN NULL;
  END IF;

  IF v_plan_id = 'expert' AND v_status = 'active' THEN
    INSERT INTO public.generation_log (user_id, status, kind)
    VALUES (v_user_id, 'pending', v_kind)
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  IF COALESCE(v_credits, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners
  SET credits = credits - 1
  WHERE id = v_user_id
    AND credits > 0;
  PERFORM set_config('app.internal_operation', 'false', true);

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.generation_log (user_id, status, kind)
  VALUES (v_user_id, 'pending', v_kind)
  RETURNING id INTO v_gen_id;

  RETURN v_gen_id;
END;
$function$;

-- Mêmes droits que l'ancienne fonction : service_role uniquement (edge `generate`).
REVOKE EXECUTE ON FUNCTION public.consume_credit_for_user(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit_for_user(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
