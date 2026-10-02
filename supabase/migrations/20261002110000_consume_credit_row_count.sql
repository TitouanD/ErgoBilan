-- consume_credit_for_user : le contrôle de l'UPDATE du crédit devient opérant (#88).
--
-- Le second PERFORM set_config(...) remettait FOUND à vrai : un UPDATE qui ne
-- touchait aucune ligne ouvrait quand même une session, sans crédit consommé.
-- Sans effet aujourd'hui (ligne verrouillée FOR UPDATE et credits > 0 vérifié juste
-- avant), mais le contrôle ne protégeait de rien. Le nombre de lignes est lu par
-- GET DIAGNOSTICS juste après l'UPDATE. Rien d'autre ne change : même signature,
-- mêmes droits, compatible avec l'edge déployée. Idempotente.

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
  v_rows integer;
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
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('app.internal_operation', 'false', true);

  IF v_rows = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.generation_log (user_id, status, kind)
  VALUES (v_user_id, 'pending', v_kind)
  RETURNING id INTO v_gen_id;

  RETURN v_gen_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
