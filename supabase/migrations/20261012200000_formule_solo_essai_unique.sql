-- Formule unique Solo et essai unique par adresse e-mail (#107, décisions du 2026-10-12).
--
-- 1. Formule Solo (21,99 € / mois) : présentée comme « illimitée* », plafonnée à un usage
--    raisonnable de 30 crédits du mois. Essential, Performance et Expert ne sont plus
--    vendues : leurs valeurs restent admises (main et l'historique les connaissent), et les
--    formules offertes existantes passent en Solo offerte. L'achat à l'unité (9 €) est
--    réservé aux comptes sans formule (edge billing).
--
-- 2. Essai unique : un compte dont l'adresse « réelle » (minuscules, sans +étiquette, sans
--    points chez Gmail) a déjà eu un essai démarre sans crédit d'essai
--    (practitioners.trial_denied). Les adresses vues sont retenues dans trial_claims, y
--    compris après suppression du compte. Les comptes existants y sont inscrits.
--
-- Pas de DROP de fonction : signatures et types de retour inchangés. La contrainte des
-- formules est remplacée (ajout de 'solo').
--
-- CREATE OR REPLACE FUNCTION déclenche enforce_public_acl_on_ddl : les GRANT sont rejoués.

-- ─── Formule Solo ────────────────────────────────────────────────────────────

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_allowed;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_id_allowed CHECK (plan_id IN ('free', 'solo', 'essential', 'performance', 'expert'));

CREATE OR REPLACE FUNCTION public.plan_monthly_credits(p_plan_id text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE p_plan_id
    WHEN 'solo' THEN 30
    -- Anciennes formules (avant le 2026-10-12), plus vendues
    WHEN 'essential' THEN 2
    WHEN 'performance' THEN 6
    WHEN 'expert' THEN 20
    ELSE 0
  END;
$function$;

-- Contrôles de formule des RPC : 'solo' admis (corps inchangés par ailleurs).

CREATE OR REPLACE FUNCTION public.billing_apply_subscription(
  p_event_id text,
  p_customer_id text,
  p_subscription_id text,
  p_plan_id text,
  p_status text,
  p_current_period_end timestamptz
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

  IF NOT public.billing_record_event(p_event_id, 'subscription') THEN
    RETURN 'duplicate';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE stripe_customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unknown_customer';
  END IF;

  -- Fin d'un ancien abonnement alors qu'un autre a pris sa place : rien à faire.
  IF p_status = 'canceled' AND v_sub.stripe_subscription_id IS DISTINCT FROM p_subscription_id THEN
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

  v_old_quota := CASE WHEN v_sub.billing_source = 'stripe' THEN public.plan_monthly_credits(v_sub.plan_id) ELSE 0 END;
  v_new_quota := public.plan_monthly_credits(p_plan_id);
  IF p_status = 'active' AND v_new_quota > v_old_quota THEN
    UPDATE public.practitioners
    SET monthly_credits = monthly_credits + (v_new_quota - v_old_quota)
    WHERE id = v_sub.user_id;
  END IF;

  UPDATE public.subscriptions
  SET plan_id = p_plan_id, status = p_status, billing_source = 'stripe',
      stripe_subscription_id = p_subscription_id, current_period_end = p_current_period_end
  WHERE id = v_sub.id;

  PERFORM set_config('app.internal_operation', 'false', true);
  RETURN 'applied';
END;
$function$;

CREATE OR REPLACE FUNCTION public.billing_renew_credits(
  p_event_id text,
  p_customer_id text,
  p_subscription_id text,
  p_plan_id text,
  p_current_period_end timestamptz
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

  IF NOT public.billing_record_event(p_event_id, 'renewal') THEN
    RETURN 'duplicate';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE stripe_customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unknown_customer';
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);

  IF v_sub.status = 'trialing' THEN
    UPDATE public.practitioners
    SET credits = credits + monthly_credits, monthly_credits = 0
    WHERE id = v_sub.user_id;
  END IF;

  UPDATE public.practitioners SET monthly_credits = public.plan_monthly_credits(p_plan_id) WHERE id = v_sub.user_id;

  UPDATE public.subscriptions
  SET plan_id = p_plan_id, status = 'active', billing_source = 'stripe',
      stripe_subscription_id = p_subscription_id, current_period_end = p_current_period_end
  WHERE id = v_sub.id;

  PERFORM set_config('app.internal_operation', 'false', true);
  RETURN 'applied';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_is_admin boolean DEFAULT NULL,
  p_credits integer DEFAULT NULL,
  p_plan_id text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_trial_ends_at timestamptz DEFAULT NULL,
  p_current_period_end timestamptz DEFAULT NULL,
  p_monthly_extraction_quota integer DEFAULT NULL,
  p_monthly_credits integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_plan text;
  v_status text;
  v_becomes_offered boolean;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.practitioners WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = '42704';
  END IF;

  IF p_credits IS NOT NULL AND p_credits < 0 THEN
    RAISE EXCEPTION 'credits must be >= 0';
  END IF;

  IF p_monthly_credits IS NOT NULL AND p_monthly_credits < 0 THEN
    RAISE EXCEPTION 'monthly_credits must be >= 0';
  END IF;

  IF p_monthly_extraction_quota IS NOT NULL AND p_monthly_extraction_quota < 0 THEN
    RAISE EXCEPTION 'monthly_extraction_quota must be >= 0';
  END IF;

  IF p_plan_id IS NOT NULL AND p_plan_id NOT IN ('free', 'solo', 'essential', 'performance', 'expert') THEN
    RAISE EXCEPTION 'invalid_plan_id';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'trialing', 'canceled', 'past_due', 'inactive') THEN
    RAISE EXCEPTION 'invalid_subscription_status';
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);

  UPDATE public.practitioners
  SET
    is_admin = COALESCE(p_is_admin, is_admin),
    credits = COALESCE(p_credits, credits),
    monthly_credits = COALESCE(p_monthly_credits, monthly_credits)
  WHERE id = p_user_id;

  IF p_plan_id IS NOT NULL
     OR p_status IS NOT NULL
     OR p_trial_ends_at IS NOT NULL
     OR p_current_period_end IS NOT NULL
     OR p_monthly_extraction_quota IS NOT NULL THEN

    SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      -- enforce_subscription_defaults impose un essai à l'insertion : on corrige ensuite.
      INSERT INTO public.subscriptions (user_id) VALUES (p_user_id);
      SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = p_user_id FOR UPDATE;
    END IF;

    v_plan := COALESCE(p_plan_id, v_sub.plan_id);
    v_status := COALESCE(p_status, v_sub.status);
    v_becomes_offered := v_status = 'active' AND v_plan <> 'free'
      AND v_sub.billing_source IS DISTINCT FROM 'stripe'
      AND (v_sub.billing_source IS NULL OR v_sub.plan_id <> v_plan OR v_sub.status <> 'active');

    UPDATE public.subscriptions
    SET
      plan_id = v_plan,
      status = v_status,
      trial_ends_at = COALESCE(p_trial_ends_at, trial_ends_at),
      current_period_end = CASE
        WHEN p_current_period_end IS NOT NULL THEN p_current_period_end
        WHEN v_becomes_offered THEN now() + interval '1 month'
        ELSE current_period_end
      END,
      monthly_extraction_quota = COALESCE(p_monthly_extraction_quota, monthly_extraction_quota),
      billing_source = CASE
        WHEN billing_source = 'stripe' THEN 'stripe'
        WHEN v_status = 'active' AND v_plan <> 'free' THEN 'offerte'
        ELSE NULL
      END
    WHERE id = v_sub.id;

    -- Nouvelle formule offerte : ses crédits du mois tout de suite (sauf valeur explicite).
    IF v_becomes_offered AND p_monthly_credits IS NULL THEN
      UPDATE public.practitioners SET monthly_credits = public.plan_monthly_credits(v_plan) WHERE id = p_user_id;
    END IF;
  END IF;

  PERFORM set_config('app.internal_operation', 'false', true);

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id);
END;
$function$;

-- Formules offertes existantes : Solo, crédits du mois au quota de Solo.
UPDATE public.subscriptions
SET plan_id = 'solo'
WHERE billing_source = 'offerte' AND plan_id IN ('essential', 'performance', 'expert');

DO $$
BEGIN
  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners p
  SET monthly_credits = public.plan_monthly_credits('solo')
  FROM public.subscriptions s
  WHERE s.user_id = p.id AND s.billing_source = 'offerte' AND s.status = 'active' AND s.plan_id = 'solo';
  PERFORM set_config('app.internal_operation', 'false', true);
END $$;

-- ─── Essai unique par adresse e-mail ─────────────────────────────────────────

-- Adresse « réelle » : minuscules, sans +étiquette ; chez Gmail, sans points et en gmail.com.
CREATE OR REPLACE FUNCTION public.email_trial_key(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_local text;
  v_domain text;
BEGIN
  IF position('@' IN v_email) = 0 THEN
    RETURN v_email;
  END IF;
  v_local := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  v_local := split_part(v_local, '+', 1);
  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  END IF;
  RETURN v_local || '@' || v_domain;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.trial_claims (
  email_key text PRIMARY KEY,
  first_user_id uuid,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trial_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_claims FROM PUBLIC, anon, authenticated;

ALTER TABLE public.practitioners ADD COLUMN IF NOT EXISTS trial_denied boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.practitioners.trial_denied IS 'Essai refusé : l''adresse e-mail réelle avait déjà eu un essai (#107).';

-- Comptes existants : leurs adresses ont eu leur essai.
INSERT INTO public.trial_claims (email_key, first_user_id, claimed_at)
SELECT DISTINCT ON (public.email_trial_key(p.email)) public.email_trial_key(p.email), p.id, COALESCE(p.created_at, now())
FROM public.practitioners p
ORDER BY public.email_trial_key(p.email), p.created_at
ON CONFLICT (email_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_practitioner_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Essai : 3 crédits en crédits du mois (perdus à la fin de l'essai), une fois par
    -- adresse e-mail réelle.
    NEW.credits := 0;
    NEW.is_admin := false;
    INSERT INTO public.trial_claims (email_key, first_user_id)
    VALUES (public.email_trial_key(NEW.email), NEW.id)
    ON CONFLICT (email_key) DO NOTHING;
    IF FOUND THEN
      NEW.monthly_credits := 3;
      NEW.trial_denied := false;
    ELSE
      NEW.monthly_credits := 0;
      NEW.trial_denied := true;
    END IF;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- RPC internes (consommation, remboursement, facturation, admin)
    IF current_setting('app.internal_operation', true) = 'true' THEN
      RETURN NEW;
    END IF;
    -- Modifications directes par l'utilisateur : soldes, droits et essai ignorés
    IF auth.role() = 'authenticated' THEN
      NEW.credits := OLD.credits;
      NEW.monthly_credits := OLD.monthly_credits;
      NEW.is_admin := OLD.is_admin;
      NEW.trial_denied := OLD.trial_denied;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Surveillance (écran admin) : essai refusé et nombre de comptes par adresse réelle.
CREATE OR REPLACE FUNCTION public.admin_list_trial_flags()
RETURNS TABLE(user_id uuid, email_key text, trial_denied boolean, accounts_with_same_key integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, k.key, p.trial_denied, (count(*) OVER (PARTITION BY k.key))::integer
  FROM public.practitioners p
  CROSS JOIN LATERAL (SELECT public.email_trial_key(p.email) AS key) k;
END;
$function$;

-- ─── Droits ──────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.plan_monthly_credits(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_trial_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_apply_subscription(text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_renew_credits(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription(text, text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_renew_credits(text, text, text, text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, boolean, integer, text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, boolean, integer, text, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_trial_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_trial_flags() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
