-- Abonnement payant par Stripe (#107, ADR 0002, CONTEXT.md § Abonnement).
--
-- Deux soldes de crédits :
--   - practitioners.credits         = crédits achetés (n'expirent jamais). La colonne
--     garde son nom : main la lit et l'affiche, elle reste juste.
--   - practitioners.monthly_credits = crédits du mois, remis au quota de la formule à
--     chaque renouvellement, sans report. Les crédits d'essai y sont rangés.
-- Une génération consomme d'abord les crédits du mois ; generation_log.credit_source
-- retient le solde débité pour rendre le crédit au bon endroit en cas d'échec.
--
-- Plus aucune formule illimitée : Expert actif ne contourne plus le décompte. Seul
-- l'administrateur génère sans crédit. Le statut de l'abonnement n'autorise plus rien :
-- sans formule, les crédits restants restent utilisables.
--
-- État Stripe dans subscriptions : stripe_customer_id, stripe_subscription_id et
-- billing_source ('stripe' = formule payée, 'offerte' = attribuée par l'admin, NULL =
-- essai ou sans formule). Le webhook (edge stripe-webhook) écrit par les RPC billing_*,
-- réservées à service_role et idempotentes par identifiant d'événement Stripe
-- (table billing_events).
--
-- Cron horaire billing_renew_and_expire : fin des essais expirés (crédits d'essai
-- perdus) et renouvellement mensuel des formules offertes.
--
-- Comptes existants : les soldes actuels restent en crédits achetés ; les formules
-- actives non payées deviennent des formules offertes, renouvelées aussitôt.
--
-- Compatibilité main : main lit credits (crédits achetés seulement) et vérifie
-- credits > 0 avant de générer. Une inscription faite entre l'application de cette
-- migration et la fusion dans main a ses 3 crédits d'essai en crédits du mois : main
-- lui affiche 0 crédit et ouvre le paywall. Appliquer juste avant la fusion dans main.
--
-- CREATE OR REPLACE FUNCTION déclenche l'event trigger enforce_public_acl_on_ddl, qui
-- retire les droits à anon et authenticated : les GRANT sont rejoués à la fin.

-- ─── Colonnes ────────────────────────────────────────────────────────────────

ALTER TABLE public.practitioners ADD COLUMN IF NOT EXISTS monthly_credits integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  ALTER TABLE public.practitioners
    ADD CONSTRAINT practitioners_monthly_credits_non_negative CHECK (monthly_credits >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE public.practitioners ALTER COLUMN credits SET DEFAULT 0;
COMMENT ON COLUMN public.practitioners.credits IS 'Crédits achetés : n''expirent jamais (ADR 0002).';
COMMENT ON COLUMN public.practitioners.monthly_credits IS 'Crédits du mois : remis au quota de la formule à chaque renouvellement, sans report (ADR 0002).';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_source text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
DO $$
BEGIN
  ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_billing_source_allowed CHECK (billing_source IN ('stripe', 'offerte'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_key
  ON public.subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.generation_log ADD COLUMN IF NOT EXISTS credit_source text;
DO $$
BEGIN
  ALTER TABLE public.generation_log
    ADD CONSTRAINT generation_log_credit_source_allowed CHECK (credit_source IN ('monthly', 'purchased', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON COLUMN public.generation_log.credit_source IS 'Solde débité : monthly, purchased, none (admin). NULL = session ouverte avant le 2026-10-12.';

-- Événements Stripe déjà traités : un événement renvoyé par Stripe n'est appliqué qu'une fois.
CREATE TABLE IF NOT EXISTS public.billing_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_events FROM PUBLIC, anon, authenticated;

-- ─── Quota des formules ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.plan_monthly_credits(p_plan_id text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE p_plan_id
    WHEN 'essential' THEN 2
    WHEN 'performance' THEN 6
    WHEN 'expert' THEN 20
    ELSE 0
  END;
$function$;

-- ─── Protection des soldes ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_practitioner_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Essai : 3 crédits, rangés en crédits du mois (perdus à la fin de l'essai).
    NEW.credits := 0;
    NEW.monthly_credits := 3;
    NEW.is_admin := false;
  ELSIF (TG_OP = 'UPDATE') THEN
    -- RPC internes (consommation, remboursement, facturation, admin)
    IF current_setting('app.internal_operation', true) = 'true' THEN
      RETURN NEW;
    END IF;
    -- Modifications directes par l'utilisateur : soldes et droits ignorés
    IF auth.role() = 'authenticated' THEN
      NEW.credits := OLD.credits;
      NEW.monthly_credits := OLD.monthly_credits;
      NEW.is_admin := OLD.is_admin;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_practitioner_sensitive_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Bypass pour service_role et opérations internes (RPC)
  IF (session_user = 'postgres' OR auth.role() = 'service_role') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.internal_operation', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF (NEW.credits IS DISTINCT FROM OLD.credits) OR (NEW.monthly_credits IS DISTINCT FROM OLD.monthly_credits) THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Vous ne pouvez pas modifier vos crédits manuellement.';
  END IF;

  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin) THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Tentative de modification de privilèges bloquée.';
  END IF;

  IF (OLD.encryption_validator IS NOT NULL AND OLD.encryption_validator != 'pending') AND
     (NEW.encryption_validator IS DISTINCT FROM OLD.encryption_validator) THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: Impossible de modifier les clés de chiffrement existantes.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  BEGIN
    -- Soldes d'essai imposés par enforce_practitioner_defaults.
    INSERT INTO public.practitioners (id, email, encryption_salt, encryption_validator)
    VALUES (NEW.id, NEW.email, 'pending', 'pending')
    ON CONFLICT (id) DO NOTHING;

    PERFORM public.ensure_org_and_subscription(NEW.id, 'Mon Cabinet');
  EXCEPTION WHEN OTHERS THEN
    -- Tout le bloc est annulé (rien de partiel). L'inscription Auth continue :
    -- bootstrap_practitioner_for_user et bootstrap_org_for_user réparent à l'onboarding.
    RAISE WARNING 'handle_new_user: compte % non initialisé (SQLSTATE %) : %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

-- ─── Consommation et remboursement ───────────────────────────────────────────

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
  v_monthly integer;
  v_is_admin boolean;
  v_source text;
  v_gen_id uuid;
  v_rows integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT public.is_practitioner_pin_configured(v_user_id) THEN
    RETURN NULL;
  END IF;

  SELECT p.credits, p.monthly_credits, p.is_admin
  INTO v_credits, v_monthly, v_is_admin
  FROM public.practitioners p
  WHERE p.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_is_admin, false) THEN
    INSERT INTO public.generation_log (user_id, status, kind, credit_source)
    VALUES (v_user_id, 'pending', v_kind, 'none')
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  -- Crédits du mois d'abord, puis crédits achetés.
  PERFORM set_config('app.internal_operation', 'true', true);
  IF COALESCE(v_monthly, 0) > 0 THEN
    v_source := 'monthly';
    UPDATE public.practitioners
    SET monthly_credits = monthly_credits - 1
    WHERE id = v_user_id
      AND monthly_credits > 0;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSIF COALESCE(v_credits, 0) > 0 THEN
    v_source := 'purchased';
    UPDATE public.practitioners
    SET credits = credits - 1
    WHERE id = v_user_id
      AND credits > 0;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  ELSE
    v_rows := 0;
  END IF;
  PERFORM set_config('app.internal_operation', 'false', true);

  IF v_rows = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.generation_log (user_id, status, kind, credit_source)
  VALUES (v_user_id, 'pending', v_kind, v_source)
  RETURNING id INTO v_gen_id;

  RETURN v_gen_id;
END;
$function$;

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
  v_source text;
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

  v_source := v_log.credit_source;
  IF v_source IS NULL THEN
    -- Session ouverte par l'ancienne consume_credit_for_user : seuls l'admin et Expert
    -- actif n'avaient rien débité ; les autres l'avaient été sur credits.
    SELECT p.is_admin INTO v_is_admin FROM public.practitioners p WHERE p.id = p_user_id;
    SELECT s.plan_id, s.status INTO v_plan_id, v_status FROM public.subscriptions s WHERE s.user_id = p_user_id LIMIT 1;
    v_source := CASE
      WHEN COALESCE(v_is_admin, false) OR (v_plan_id = 'expert' AND v_status = 'active') THEN 'none'
      ELSE 'purchased'
    END;
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  IF v_source = 'monthly' THEN
    UPDATE public.practitioners SET monthly_credits = monthly_credits + 1 WHERE id = p_user_id;
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

-- ─── Facturation Stripe (appelées par l'edge stripe-webhook / billing) ──────

-- Rattache le client Stripe créé par l'edge billing avant le premier paiement.
CREATE OR REPLACE FUNCTION public.billing_set_customer(p_user_id uuid, p_customer_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_user_id IS NULL OR nullif(btrim(p_customer_id), '') IS NULL THEN
    RETURN FALSE;
  END IF;
  UPDATE public.subscriptions SET stripe_customer_id = p_customer_id WHERE user_id = p_user_id;
  RETURN FOUND;
END;
$function$;

-- Retient un événement Stripe ; false s'il a déjà été traité.
CREATE OR REPLACE FUNCTION public.billing_record_event(p_event_id text, p_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.billing_events (event_id, type) VALUES (p_event_id, p_type)
  ON CONFLICT (event_id) DO NOTHING;
  RETURN FOUND;
END;
$function$;

-- État courant d'un abonnement Stripe (lu par l'edge dans Stripe, pas dans l'événement :
-- les événements peuvent arriver dans le désordre).
--   p_status : 'active' | 'past_due' | 'canceled'.
-- Passage à une formule supérieure : la différence de crédits du mois est donnée aussitôt.
-- Première formule payée pendant l'essai : les crédits d'essai deviennent des crédits achetés.
-- Retour : 'applied' | 'duplicate' | 'unknown_customer' | 'ignored'.
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
  IF p_status NOT IN ('active', 'past_due', 'canceled') OR p_plan_id NOT IN ('essential', 'performance', 'expert') THEN
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

-- Facture d'abonnement payée (création ou renouvellement) : crédits du mois remis au quota.
-- Retour : 'applied' | 'duplicate' | 'unknown_customer'.
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
  IF p_plan_id NOT IN ('essential', 'performance', 'expert') THEN
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

-- Achat à l'unité payé : crédits achetés ajoutés.
-- Retour : 'applied' | 'duplicate' | 'unknown_customer'.
CREATE OR REPLACE FUNCTION public.billing_add_credits(p_event_id text, p_customer_id text, p_quantity integer)
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

  IF NOT public.billing_record_event(p_event_id, 'credits') THEN
    RETURN 'duplicate';
  END IF;

  SELECT user_id INTO v_user_id FROM public.subscriptions WHERE stripe_customer_id = p_customer_id;
  IF v_user_id IS NULL THEN
    RETURN 'unknown_customer';
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners SET credits = credits + p_quantity WHERE id = v_user_id;
  PERFORM set_config('app.internal_operation', 'false', true);
  RETURN 'applied';
END;
$function$;

-- ─── Fin d'essai et formules offertes (cron horaire) ─────────────────────────

CREATE OR REPLACE FUNCTION public.billing_renew_and_expire()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_row record;
  v_next timestamptz;
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.internal_operation', 'true', true);

  -- Essai terminé sans formule : crédits d'essai perdus, plus de formule.
  FOR v_row IN
    SELECT id, user_id FROM public.subscriptions
    WHERE status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
    FOR UPDATE
  LOOP
    UPDATE public.subscriptions SET status = 'inactive', plan_id = 'free' WHERE id = v_row.id;
    UPDATE public.practitioners SET monthly_credits = 0 WHERE id = v_row.user_id;
    v_count := v_count + 1;
  END LOOP;

  -- Formule offerte arrivée à échéance : crédits du mois remis au quota, mois suivant.
  FOR v_row IN
    SELECT id, user_id, plan_id, current_period_end FROM public.subscriptions
    WHERE billing_source = 'offerte' AND status = 'active'
      AND (current_period_end IS NULL OR current_period_end <= now())
    FOR UPDATE
  LOOP
    v_next := COALESCE(v_row.current_period_end, now());
    WHILE v_next <= now() LOOP
      v_next := v_next + interval '1 month';
    END LOOP;
    UPDATE public.subscriptions SET current_period_end = v_next WHERE id = v_row.id;
    UPDATE public.practitioners SET monthly_credits = public.plan_monthly_credits(v_row.plan_id) WHERE id = v_row.user_id;
    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('app.internal_operation', 'false', true);
  RETURN v_count;
END;
$function$;

-- ─── Administration ──────────────────────────────────────────────────────────

-- Nouveau paramètre p_monthly_credits : l'ancienne signature est retirée (deux
-- surcharges rendraient l'appel par PostgREST ambigu). Les appels de main n'utilisent
-- que des paramètres nommés qui existent toujours.
DROP FUNCTION IF EXISTS public.admin_update_user(uuid, boolean, integer, text, text, timestamptz, timestamptz, integer);

-- Une formule active non payée devient une formule offerte : renouvelée chaque mois par
-- billing_renew_and_expire, à partir de current_period_end (dans un mois par défaut).
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

  IF p_plan_id IS NOT NULL AND p_plan_id NOT IN ('free', 'essential', 'performance', 'expert') THEN
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

-- Colonnes ajoutées (monthly_credits, billing_source) : le type de retour change.
DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(
  user_id uuid, email text, first_name text, last_name text, is_admin boolean, credits integer,
  organization_id uuid, organization_name text, organization_role text, subscription_plan text,
  subscription_status text, trial_ends_at timestamptz, current_period_end timestamptz,
  monthly_extraction_quota integer, created_at timestamptz, monthly_credits integer, billing_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.email,
    p.first_name,
    p.last_name,
    COALESCE(p.is_admin, false) AS is_admin,
    COALESCE(p.credits, 0) AS credits,
    om.organization_id,
    org.name AS organization_name,
    om.role AS organization_role,
    COALESCE(sub.plan_id, 'free') AS subscription_plan,
    COALESCE(sub.status, 'inactive') AS subscription_status,
    sub.trial_ends_at,
    sub.current_period_end,
    COALESCE(sub.monthly_extraction_quota, 100) AS monthly_extraction_quota,
    p.created_at,
    COALESCE(p.monthly_credits, 0) AS monthly_credits,
    sub.billing_source
  FROM public.practitioners p
  LEFT JOIN public.organization_members om ON om.user_id = p.id
  LEFT JOIN public.organizations org ON org.id = om.organization_id
  LEFT JOIN LATERAL (
    SELECT s.plan_id, s.status, s.trial_ends_at, s.current_period_end, s.monthly_extraction_quota, s.billing_source
    FROM public.subscriptions s
    WHERE s.user_id = p.id
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT 1
  ) sub ON TRUE
  ORDER BY p.created_at DESC, p.email ASC;
END;
$function$;

-- ─── Comptes existants ───────────────────────────────────────────────────────

-- Formules actives attribuées à la main : formules offertes, renouvelées tout de suite
-- par billing_renew_and_expire (crédits du mois = quota, échéance dans un mois). Les
-- essais expirés passent sans formule. Les soldes actuels restent des crédits achetés.
UPDATE public.subscriptions
SET billing_source = 'offerte', current_period_end = now()
WHERE status = 'active' AND plan_id <> 'free' AND billing_source IS NULL;

SELECT public.billing_renew_and_expire();

-- ─── Droits et planification ─────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.plan_monthly_credits(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_set_customer(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_record_event(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_apply_subscription(text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_renew_credits(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_add_credits(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_renew_and_expire() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_credit_for_user(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_generation_internal(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.billing_set_customer(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription(text, text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_renew_credits(text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_add_credits(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credit_for_user(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_generation_internal(uuid, uuid, boolean, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, boolean, integer, text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, boolean, integer, text, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated, service_role;

SELECT cron.schedule('billing_renew_and_expire', '5 * * * *', $$SELECT public.billing_renew_and_expire();$$);

NOTIFY pgrst, 'reload schema';
