-- Robustesse du paiement Stripe (#111). Corrige les RPC billing_* appelées par les edges
-- billing et stripe-webhook, et le remboursement d'un crédit du mois.
--
-- 1. Double abonnement : tant que l'abonnement retenu (stripe_subscription_id) est actif ou
--    en impayé, un autre abonnement du même client est ignoré (formule et renouvellement).
--    L'edge billing renvoie déjà vers le portail quand un abonnement existe chez Stripe.
-- 2. invoice.paid tardif : l'edge ne renouvelle plus un abonnement qui n'est plus actif chez
--    Stripe ; la RPC ignore le renouvellement d'un autre abonnement que celui retenu.
-- 3. Client Stripe en double : billing_set_customer n'écrase plus un client déjà rattaché
--    (sauf remplacement explicite de p_previous). Les RPC du webhook retrouvent le compte par
--    p_user_id (métadonnée user_id posée par l'edge billing) quand le client n'est pas
--    rattaché, et n'enregistrent l'événement qu'une fois le compte trouvé : un rejeu depuis
--    Stripe l'applique alors.
-- 4. Passage d'une formule offerte à Solo payée : la formule offerte compte pour son quota.
-- 5. Remboursement d'un crédit du mois plafonné au quota en cours (essai : 3, formule : son
--    quota, sans formule : 0).
--
-- Compatibilité : main n'appelle aucune de ces RPC. Les nouveaux paramètres ont une valeur
-- par défaut : les edges déployées avant cette migration (paramètres nommés) continuent de
-- fonctionner. Les anciennes signatures sont retirées (deux surcharges rendraient l'appel
-- par PostgREST ambigu).
--
-- CREATE FUNCTION déclenche enforce_public_acl_on_ddl : les GRANT sont rejoués.

DROP FUNCTION IF EXISTS public.billing_set_customer(uuid, text);
DROP FUNCTION IF EXISTS public.billing_apply_subscription(text, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.billing_renew_credits(text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.billing_add_credits(text, text, integer);

-- Rattache le client Stripe créé par l'edge billing. N'écrase un autre client que s'il est
-- celui passé en p_previous (client inconnu du mode Stripe courant, remplacé par l'edge).
CREATE FUNCTION public.billing_set_customer(p_user_id uuid, p_customer_id text, p_previous text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_user_id IS NULL OR nullif(btrim(p_customer_id), '') IS NULL THEN
    RETURN FALSE;
  END IF;
  UPDATE public.subscriptions SET stripe_customer_id = p_customer_id
  WHERE user_id = p_user_id
    AND (stripe_customer_id IS NULL OR stripe_customer_id = p_customer_id OR stripe_customer_id = p_previous);
  RETURN FOUND;
END;
$function$;

-- Compte d'un client Stripe, ou à défaut de l'utilisateur indiqué par Stripe (métadonnée).
CREATE OR REPLACE FUNCTION public.billing_find_subscription(p_customer_id text, p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT id FROM (
    SELECT id, 1 AS rank FROM public.subscriptions WHERE stripe_customer_id = p_customer_id
    UNION ALL
    SELECT id, 2 FROM public.subscriptions WHERE p_user_id IS NOT NULL AND user_id = p_user_id
  ) found
  ORDER BY rank
  LIMIT 1;
$function$;

-- État courant d'un abonnement Stripe (relu par l'edge dans Stripe).
--   p_status : 'active' | 'past_due' | 'canceled'.
-- Retour : 'applied' | 'duplicate' | 'unknown_customer' | 'ignored'.
CREATE FUNCTION public.billing_apply_subscription(
  p_event_id text,
  p_customer_id text,
  p_subscription_id text,
  p_plan_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_old_quota integer;
  v_new_quota integer;
BEGIN
  IF p_status NOT IN ('active', 'past_due', 'canceled') OR p_plan_id NOT IN ('solo', 'essential', 'performance', 'expert') THEN
    RAISE EXCEPTION 'billing_apply_subscription: état invalide (%, %)', p_plan_id, p_status;
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions
  WHERE id = public.billing_find_subscription(p_customer_id, p_user_id)
  FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN 'unknown_customer';
  END IF;

  IF NOT public.billing_record_event(p_event_id, 'subscription') THEN
    RETURN 'duplicate';
  END IF;

  -- Fin d'un ancien abonnement alors qu'un autre a pris sa place : rien à faire.
  IF p_status = 'canceled' AND v_sub.stripe_subscription_id IS DISTINCT FROM p_subscription_id THEN
    RETURN 'ignored';
  END IF;

  -- Second abonnement alors que celui retenu court encore : il ne remplace rien.
  IF v_sub.billing_source = 'stripe' AND v_sub.status IN ('active', 'past_due')
     AND v_sub.stripe_subscription_id IS NOT NULL AND v_sub.stripe_subscription_id <> p_subscription_id THEN
    RETURN 'ignored';
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);

  IF p_status = 'canceled' THEN
    UPDATE public.subscriptions
    SET status = 'canceled', plan_id = 'free', billing_source = NULL, stripe_subscription_id = NULL,
        current_period_end = p_current_period_end
    WHERE id = v_sub.id;
    UPDATE public.practitioners SET monthly_credits = 0 WHERE id = v_sub.user_id;
    PERFORM set_config('app.internal_operation', 'false', true);
    RETURN 'applied';
  END IF;

  IF v_sub.status = 'trialing' THEN
    UPDATE public.practitioners
    SET credits = credits + monthly_credits, monthly_credits = 0
    WHERE id = v_sub.user_id;
  END IF;

  -- Quota déjà donné ce mois-ci : formule payée, ou formule offerte en cours.
  v_old_quota := CASE
    WHEN v_sub.billing_source = 'stripe' THEN public.plan_monthly_credits(v_sub.plan_id)
    WHEN v_sub.billing_source = 'offerte' AND v_sub.status = 'active' THEN public.plan_monthly_credits(v_sub.plan_id)
    ELSE 0
  END;
  v_new_quota := public.plan_monthly_credits(p_plan_id);
  IF p_status = 'active' AND v_new_quota > v_old_quota THEN
    UPDATE public.practitioners
    SET monthly_credits = monthly_credits + (v_new_quota - v_old_quota)
    WHERE id = v_sub.user_id;
  END IF;

  UPDATE public.subscriptions
  SET plan_id = p_plan_id, status = p_status, billing_source = 'stripe', stripe_customer_id = p_customer_id,
      stripe_subscription_id = p_subscription_id, current_period_end = p_current_period_end
  WHERE id = v_sub.id;

  PERFORM set_config('app.internal_operation', 'false', true);
  RETURN 'applied';
END;
$function$;

-- Facture d'abonnement payée (création ou renouvellement) : crédits du mois remis au quota.
-- L'edge ne l'appelle que pour un abonnement encore actif chez Stripe.
CREATE FUNCTION public.billing_renew_credits(
  p_event_id text,
  p_customer_id text,
  p_subscription_id text,
  p_plan_id text,
  p_current_period_end timestamptz,
  p_user_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
BEGIN
  IF p_plan_id NOT IN ('solo', 'essential', 'performance', 'expert') THEN
    RAISE EXCEPTION 'billing_renew_credits: formule invalide (%)', p_plan_id;
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions
  WHERE id = public.billing_find_subscription(p_customer_id, p_user_id)
  FOR UPDATE;
  IF v_sub.id IS NULL THEN
    RETURN 'unknown_customer';
  END IF;

  IF NOT public.billing_record_event(p_event_id, 'renewal') THEN
    RETURN 'duplicate';
  END IF;

  -- Facture d'un autre abonnement que celui retenu, qui court encore.
  IF v_sub.billing_source = 'stripe' AND v_sub.status IN ('active', 'past_due')
     AND v_sub.stripe_subscription_id IS NOT NULL AND v_sub.stripe_subscription_id <> p_subscription_id THEN
    RETURN 'ignored';
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);

  IF v_sub.status = 'trialing' THEN
    UPDATE public.practitioners
    SET credits = credits + monthly_credits, monthly_credits = 0
    WHERE id = v_sub.user_id;
  END IF;

  UPDATE public.practitioners SET monthly_credits = public.plan_monthly_credits(p_plan_id) WHERE id = v_sub.user_id;

  UPDATE public.subscriptions
  SET plan_id = p_plan_id, status = 'active', billing_source = 'stripe', stripe_customer_id = p_customer_id,
      stripe_subscription_id = p_subscription_id, current_period_end = p_current_period_end
  WHERE id = v_sub.id;

  PERFORM set_config('app.internal_operation', 'false', true);
  RETURN 'applied';
END;
$function$;

-- Achat à l'unité payé : la quantité s'ajoute aux crédits achetés.
CREATE FUNCTION public.billing_add_credits(p_event_id text, p_customer_id text, p_quantity integer, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'billing_add_credits: quantité invalide (%)', p_quantity;
  END IF;

  SELECT user_id INTO v_user_id FROM public.subscriptions WHERE id = public.billing_find_subscription(p_customer_id, p_user_id);
  IF v_user_id IS NULL THEN
    RETURN 'unknown_customer';
  END IF;

  IF NOT public.billing_record_event(p_event_id, 'credits') THEN
    RETURN 'duplicate';
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners SET credits = credits + p_quantity WHERE id = v_user_id;
  PERFORM set_config('app.internal_operation', 'false', true);
  RETURN 'applied';
END;
$function$;

-- Fin d'une génération. En cas d'échec, le crédit est rendu au solde débité ; un crédit du
-- mois n'est rendu que sous le quota en cours (après un renouvellement ou la fin de l'essai,
-- le solde a déjà été remis à son niveau).
CREATE OR REPLACE FUNCTION public.finalize_generation_internal(p_generation_id uuid, p_user_id uuid, p_success boolean, p_error_code text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_log public.generation_log%ROWTYPE;
  v_is_admin boolean;
  v_plan_id text;
  v_status text;
  v_billing_source text;
  v_source text;
  v_cap integer;
BEGIN
  IF p_user_id IS NULL OR p_generation_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT *
  INTO v_log
  FROM public.generation_log
  WHERE id = p_generation_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_log.status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  IF p_success THEN
    UPDATE public.generation_log
    SET status = 'completed',
        error_code = NULL
    WHERE id = p_generation_id;
    RETURN TRUE;
  END IF;

  UPDATE public.generation_log
  SET status = 'failed',
      refunded_at = now(),
      error_code = p_error_code
  WHERE id = p_generation_id;

  SELECT s.plan_id, s.status, s.billing_source INTO v_plan_id, v_status, v_billing_source
  FROM public.subscriptions s WHERE s.user_id = p_user_id LIMIT 1;

  v_source := v_log.credit_source;
  IF v_source IS NULL THEN
    -- Session ouverte par l'ancienne consume_credit_for_user : seuls l'admin et Expert
    -- actif n'avaient rien débité ; les autres l'avaient été sur credits.
    SELECT p.is_admin INTO v_is_admin FROM public.practitioners p WHERE p.id = p_user_id;
    v_source := CASE
      WHEN COALESCE(v_is_admin, false) OR (v_plan_id = 'expert' AND v_status = 'active') THEN 'none'
      ELSE 'purchased'
    END;
  END IF;

  v_cap := CASE
    WHEN v_status = 'trialing' THEN 3
    WHEN v_status IN ('active', 'past_due') AND v_billing_source IS NOT NULL THEN public.plan_monthly_credits(v_plan_id)
    ELSE 0
  END;

  PERFORM set_config('app.internal_operation', 'true', true);
  IF v_source = 'monthly' THEN
    UPDATE public.practitioners SET monthly_credits = monthly_credits + 1 WHERE id = p_user_id AND monthly_credits < v_cap;
  ELSIF v_source = 'purchased' THEN
    UPDATE public.practitioners SET credits = credits + 1 WHERE id = p_user_id;
  END IF;
  PERFORM set_config('app.internal_operation', 'false', true);

  UPDATE public.generation_log
  SET status = 'refunded'
  WHERE id = p_generation_id;

  RETURN TRUE;
END;
$function$;

-- ─── Droits ──────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.billing_set_customer(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_find_subscription(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_apply_subscription(text, text, text, text, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_renew_credits(text, text, text, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_add_credits(text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_generation_internal(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.billing_set_customer(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription(text, text, text, text, text, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_renew_credits(text, text, text, text, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_add_credits(text, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_generation_internal(uuid, uuid, boolean, text) TO service_role;

NOTIFY pgrst, 'reload schema';
