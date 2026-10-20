-- Schéma de référence de la base de production (schéma public), #63.
-- Généré le 2026-10-02 depuis le catalogue Postgres (requête en lecture seule dans
-- l'éditeur SQL), faute de `supabase db dump` (Docker). Ce n'est PAS une migration :
-- il ne s'applique jamais tel quel en production. Il sert à relire l'état réel et à
-- comparer après une migration. Prérequis pour le rejouer : un projet Supabase vierge
-- (schémas auth, extensions, vault, cron présents).
-- À régénérer après chaque migration (docs/DATA_MODEL.md, « Schéma et migrations »).

SELECT pg_catalog.set_config('search_path', 'public, extensions', false);

-- ======================================================================
-- 0. Extensions
-- ======================================================================

SET check_function_bodies = false;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ======================================================================
-- 1. Types et séquences
-- ======================================================================

CREATE SEQUENCE IF NOT EXISTS public.ai_request_log_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.signup_rate_limit_log_id_seq;

-- ======================================================================
-- 2. Tables
-- ======================================================================

CREATE TABLE public.ai_request_log (
  id bigint DEFAULT nextval('ai_request_log_id_seq'::regclass) NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.generation_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  refunded_at timestamp with time zone,
  error_code text,
  kind text
);

CREATE TABLE public.official_categories (
  id text NOT NULL,
  label text NOT NULL,
  icon_key text DEFAULT 'Box'::text NOT NULL,
  sort_order integer DEFAULT 99,
  description text
);

CREATE TABLE public.official_subtests (
  id text NOT NULL,
  test_id text NOT NULL,
  name text NOT NULL,
  unit text,
  score_type text DEFAULT 'none'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid,
  input_model text DEFAULT 'numeric_4mode'::text NOT NULL,
  input_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  display_group_order integer,
  display_order integer
);

CREATE TABLE public.official_tests (
  id text NOT NULL,
  name text NOT NULL,
  category_id text NOT NULL,
  author text,
  version text,
  created_at timestamp with time zone DEFAULT now(),
  organization_id uuid
);

CREATE TABLE public.organization_members (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'owner'::text,
  joined_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.organizations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text DEFAULT 'Mon Cabinet'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pending_questionnaires (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  practitioner_id uuid NOT NULL,
  label text,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  practitioner_encrypted_key text NOT NULL,
  family_encrypted_data text,
  organization_id uuid,
  access_token text
);

CREATE TABLE public.practitioners (
  id uuid NOT NULL,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone_pro text,
  siret text,
  address_pro text,
  encryption_salt text DEFAULT 'pending'::text NOT NULL,
  encryption_validator text DEFAULT 'pending'::text NOT NULL,
  credits integer DEFAULT 3 NOT NULL,
  is_admin boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  ai_style_preferences text,
  branding_config jsonb
);

CREATE TABLE public.signup_rate_limit_log (
  id bigint DEFAULT nextval('signup_rate_limit_log_id_seq'::regclass) NOT NULL,
  ip_hash text NOT NULL,
  email_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  plan_id text DEFAULT 'free'::text NOT NULL,
  status text DEFAULT 'trialing'::text NOT NULL,
  trial_ends_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
  created_at timestamp with time zone DEFAULT now(),
  current_period_end timestamp with time zone,
  monthly_extraction_quota integer DEFAULT 100 NOT NULL
);

-- ======================================================================
-- 3. Contraintes (hors clés étrangères)
-- ======================================================================

ALTER TABLE ONLY public.ai_request_log ADD CONSTRAINT ai_request_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.generation_log ADD CONSTRAINT generation_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.generation_log ADD CONSTRAINT generation_log_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'refunded'::text])));
ALTER TABLE ONLY public.official_categories ADD CONSTRAINT official_categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.official_subtests ADD CONSTRAINT official_subtests_input_model_check CHECK ((input_model = ANY (ARRAY['numeric_4mode'::text, 'qualitative_category'::text, 'custom_text'::text])));
ALTER TABLE ONLY public.official_subtests ADD CONSTRAINT official_subtests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.official_subtests ADD CONSTRAINT official_subtests_score_type_domain_chk CHECK ((score_type = ANY (ARRAY['standard'::text, 'scaled'::text, 't-score'::text, 'v-scale'::text, 'scaled-15'::text, 'percentile'::text, 'sten'::text, 'stanine'::text, 'none'::text])));
ALTER TABLE ONLY public.official_tests ADD CONSTRAINT official_tests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.organization_members ADD CONSTRAINT org_members_pkey PRIMARY KEY (organization_id, user_id);
ALTER TABLE ONLY public.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pending_questionnaires ADD CONSTRAINT pending_q_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.practitioners ADD CONSTRAINT ai_style_preferences_max_length CHECK ((char_length(ai_style_preferences) <= 2000));
ALTER TABLE ONLY public.practitioners ADD CONSTRAINT practitioners_credits_non_negative CHECK ((credits >= 0));
ALTER TABLE ONLY public.practitioners ADD CONSTRAINT practitioners_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.signup_rate_limit_log ADD CONSTRAINT signup_rate_limit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_monthly_extraction_quota_non_negative CHECK (((monthly_extraction_quota >= 0) AND (monthly_extraction_quota <= 100000)));
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_plan_id_allowed CHECK ((plan_id = ANY (ARRAY['free'::text, 'essential'::text, 'performance'::text, 'expert'::text])));
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_status_allowed CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'canceled'::text, 'past_due'::text, 'inactive'::text])));
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);

-- ======================================================================
-- 4. Fonctions
-- ======================================================================

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.practitioners (id, email, credits, encryption_salt, encryption_validator)
    VALUES (NEW.id, NEW.email, 3, 'pending', 'pending')
    ON CONFLICT (id) DO NOTHING;

    PERFORM public.ensure_org_and_subscription(NEW.id, 'Mon Cabinet');
  EXCEPTION WHEN OTHERS THEN
    -- Tout le bloc est annulé (rien de partiel). L'inscription Auth continue :
    -- bootstrap_practitioner_for_user et bootstrap_org_for_user réparent à l'onboarding.
    RAISE WARNING 'handle_new_user: compte % non initialisé (SQLSTATE %) : %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_practitioner_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        NEW.credits := 3; 
        NEW.is_admin := false; 
    ELSIF (TG_OP = 'UPDATE') THEN
        -- Autoriser les RPC internes (consume_credit, refund_credit)
        IF current_setting('app.internal_operation', true) = 'true' THEN
            RETURN NEW;
        END IF;
        -- Bloquer les modifications directes par les users authentifiés
        IF auth.role() = 'authenticated' THEN
            IF NEW.credits <> OLD.credits THEN
                NEW.credits := OLD.credits;
            END IF;
            IF NEW.is_admin <> OLD.is_admin THEN
                NEW.is_admin := OLD.is_admin;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_subscription_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.plan_id := 'free';
  NEW.status := 'trialing';
  NEW.trial_ends_at := (now() + interval '30 days');
  NEW.current_period_end := (now() + interval '30 days');
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_practitioner_sensitive_data()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$BEGIN
    -- Bypass pour service_role et opérations internes (RPC)
    IF (session_user = 'postgres' OR auth.role() = 'service_role') THEN
        RETURN NEW;
    END IF;
    
    IF current_setting('app.internal_operation', true) = 'true' THEN
        RETURN NEW;
    END IF;

    IF (NEW.credits IS DISTINCT FROM OLD.credits) THEN
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
END;$function$
;

CREATE OR REPLACE FUNCTION public.check_is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_onboarded() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.practitioners
    WHERE id = auth.uid()
      AND is_admin = true
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_is_member_of(org_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF org_id IS NULL OR auth.uid() IS NULL OR NOT public.is_current_user_onboarded() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND organization_id = org_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_credit()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_is_admin boolean;
  v_plan_id text;
  v_status text;
  v_gen_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
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
  LIMIT 1;

  -- Admin bypass: no credit decrement, but still create an auditable generation session.
  IF COALESCE(v_is_admin, false) THEN
    INSERT INTO public.generation_log (user_id, status)
    VALUES (v_user_id, 'pending')
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  -- Server-side access gate: only active/trialing subscriptions may generate.
  IF COALESCE(v_status, 'inactive') NOT IN ('active', 'trialing') THEN
    RETURN NULL;
  END IF;

  -- Active expert plan: unlimited generations, still tracked in generation_log.
  IF v_plan_id = 'expert' AND v_status = 'active' THEN
    INSERT INTO public.generation_log (user_id, status)
    VALUES (v_user_id, 'pending')
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

  INSERT INTO public.generation_log (user_id, status)
  VALUES (v_user_id, 'pending')
  RETURNING id INTO v_gen_id;

  RETURN v_gen_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_max_per_hour integer DEFAULT 10)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ai_rate_limit:' || v_user_id::text));

  SELECT count(*)
  INTO v_count
  FROM public.ai_request_log
  WHERE user_id = v_user_id
    AND created_at > now() - interval '1 hour';

  IF v_count >= p_max_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_request_log (user_id)
  VALUES (v_user_id);

  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.bootstrap_org_for_user(p_user_id uuid, p_org_name text DEFAULT 'Mon Cabinet'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Forbidden: you can only bootstrap your own organisation';
  END IF;

  IF NOT public.is_current_user_onboarded() THEN
    RAISE EXCEPTION 'Forbidden: complete PIN setup before bootstrapping organisation';
  END IF;

  RETURN public.ensure_org_and_subscription(p_user_id, p_org_name);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_signup_rate_limit(p_ip_hash text, p_email_hash text DEFAULT NULL::text, p_max_per_hour integer DEFAULT 3)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_ip_hour_count integer;
  v_ip_day_count integer;
  v_email_day_count integer;
  v_global_hour_count integer;
  v_last_ip_attempt timestamptz;
  v_last_email_attempt timestamptz;
  v_ip_daily_limit integer := greatest(p_max_per_hour * 4, 12);
  v_email_daily_limit integer := 6;
  v_global_hour_limit integer := 250;
begin
  if p_ip_hash is null or length(p_ip_hash) < 8 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('signup_rl:' || p_ip_hash));

  select max(created_at) into v_last_ip_attempt
  from public.signup_rate_limit_log
  where ip_hash = p_ip_hash;

  if v_last_ip_attempt is not null and v_last_ip_attempt > now() - interval '15 seconds' then
    return false;
  end if;

  if p_email_hash is not null then
    select max(created_at) into v_last_email_attempt
    from public.signup_rate_limit_log
    where email_hash = p_email_hash;

    if v_last_email_attempt is not null and v_last_email_attempt > now() - interval '45 seconds' then
      return false;
    end if;
  end if;

  select count(*) into v_ip_hour_count
  from public.signup_rate_limit_log
  where ip_hash = p_ip_hash
    and created_at > now() - interval '1 hour';

  if v_ip_hour_count >= p_max_per_hour then
    return false;
  end if;

  select count(*) into v_ip_day_count
  from public.signup_rate_limit_log
  where ip_hash = p_ip_hash
    and created_at > now() - interval '24 hours';

  if v_ip_day_count >= v_ip_daily_limit then
    return false;
  end if;

  if p_email_hash is not null then
    select count(*) into v_email_day_count
    from public.signup_rate_limit_log
    where email_hash = p_email_hash
      and created_at > now() - interval '24 hours';

    if v_email_day_count >= v_email_daily_limit then
      return false;
    end if;
  end if;

  select count(*) into v_global_hour_count
  from public.signup_rate_limit_log
  where created_at > now() - interval '1 hour';

  if v_global_hour_count >= v_global_hour_limit then
    return false;
  end if;

  insert into public.signup_rate_limit_log (ip_hash, email_hash)
  values (p_ip_hash, p_email_hash);

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_signup_rate_limit_log(p_retention_hours integer DEFAULT 24)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.signup_rate_limit_log
  WHERE created_at < now() - make_interval(hours => p_retention_hours);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_check()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(check_is_admin(), false);
$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_test(p_test_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM official_tests WHERE id = p_test_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_subtest(p_subtest_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM official_subtests WHERE id = p_subtest_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.bootstrap_practitioner_for_user(p_user_id uuid, p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_list_tests(p_scope text DEFAULT 'public'::text)
 RETURNS TABLE(id text, name text, category_id text, organization_id uuid, created_at timestamp with time zone, subtest_count bigint, pending_norms_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      t.id,
      t.name,
      t.category_id,
      t.organization_id,
      t.created_at,
      (SELECT count(*) FROM official_subtests s WHERE s.test_id = t.id) AS subtest_count,
      0::bigint AS pending_norms_count
    FROM official_tests t
    WHERE (
      CASE
        WHEN p_scope = 'public' THEN t.organization_id IS NULL
        WHEN p_scope = 'private' THEN t.organization_id IS NOT NULL
        ELSE TRUE
      END
    )
    ORDER BY t.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_subtest_abbreviation_tag(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT NULLIF(
    trim(
      substring(
        regexp_replace(
          regexp_replace(
            upper(public.unaccent(COALESCE(p_value, ''))),
            '[^A-Z0-9&/ -]',
            ' ',
            'g'
          ),
          '^[^A-Z0-9]+',
          ''
        ),
        1, 20
      )
    ),
    ''
  );
$function$
;

CREATE OR REPLACE FUNCTION public.extract_trailing_tag(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(
    trim((regexp_match(COALESCE(p_name, ''), '\(([^()]{1,80})\)\s*$'))[1]),
    ''
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_list_users()
 RETURNS TABLE(user_id uuid, email text, first_name text, last_name text, is_admin boolean, credits integer, organization_id uuid, organization_name text, organization_role text, subscription_plan text, subscription_status text, trial_ends_at timestamp with time zone, current_period_end timestamp with time zone, monthly_extraction_quota integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    p.created_at
  FROM public.practitioners p
  LEFT JOIN public.organization_members om ON om.user_id = p.id
  LEFT JOIN public.organizations org ON org.id = om.organization_id
  LEFT JOIN LATERAL (
    SELECT
      s.plan_id,
      s.status,
      s.trial_ends_at,
      s.current_period_end,
      s.monthly_extraction_quota
    FROM public.subscriptions s
    WHERE s.user_id = p.id
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT 1
  ) sub ON TRUE
  ORDER BY p.created_at DESC, p.email ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_update_user(p_user_id uuid, p_is_admin boolean DEFAULT NULL::boolean, p_credits integer DEFAULT NULL::integer, p_plan_id text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_trial_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_current_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_monthly_extraction_quota integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_subscription_id uuid;
  v_existing_trial_ends_at timestamptz;
  v_existing_current_period_end timestamptz;
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

  IF p_monthly_extraction_quota IS NOT NULL AND p_monthly_extraction_quota < 0 THEN
    RAISE EXCEPTION 'monthly_extraction_quota must be >= 0';
  END IF;

  IF p_plan_id IS NOT NULL AND p_plan_id NOT IN ('free', 'essential', 'performance', 'expert') THEN
    RAISE EXCEPTION 'invalid_plan_id';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'trialing', 'canceled', 'past_due', 'inactive') THEN
    RAISE EXCEPTION 'invalid_subscription_status';
  END IF;

  -- Bypass trigger protection for admin operations (same pattern as consume_credit_for_user)
  PERFORM set_config('app.internal_operation', 'true', true);

  UPDATE public.practitioners
  SET
    is_admin = COALESCE(p_is_admin, is_admin),
    credits  = COALESCE(p_credits, credits)
  WHERE id = p_user_id;

  PERFORM set_config('app.internal_operation', 'false', true);

  IF p_plan_id IS NOT NULL
     OR p_status IS NOT NULL
     OR p_trial_ends_at IS NOT NULL
     OR p_current_period_end IS NOT NULL
     OR p_monthly_extraction_quota IS NOT NULL THEN

    SELECT
      s.id,
      s.trial_ends_at,
      s.current_period_end
    INTO
      v_subscription_id,
      v_existing_trial_ends_at,
      v_existing_current_period_end
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT 1;

    IF v_subscription_id IS NULL THEN
      INSERT INTO public.subscriptions (
        user_id,
        plan_id,
        status,
        trial_ends_at,
        current_period_end,
        monthly_extraction_quota
      ) VALUES (
        p_user_id,
        COALESCE(p_plan_id, 'free'),
        COALESCE(p_status, 'inactive'),
        p_trial_ends_at,
        p_current_period_end,
        COALESCE(p_monthly_extraction_quota, 100)
      );
    ELSE
      UPDATE public.subscriptions
      SET
        plan_id              = COALESCE(p_plan_id, plan_id),
        status               = COALESCE(p_status, status),
        trial_ends_at        = COALESCE(p_trial_ends_at, v_existing_trial_ends_at),
        current_period_end   = COALESCE(p_current_period_end, v_existing_current_period_end),
        monthly_extraction_quota = COALESCE(p_monthly_extraction_quota, monthly_extraction_quota)
      WHERE id = v_subscription_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_organization_member_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() = OLD.user_id
     AND NOT public.check_is_admin() THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: role updates are not allowed for self-service membership updates.';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_generation(p_generation_id uuid, p_success boolean, p_error_code text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_log public.generation_log%ROWTYPE;
  v_is_admin boolean;
  v_plan_id text;
  v_status text;
BEGIN
  IF v_user_id IS NULL OR p_generation_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT *
  INTO v_log
  FROM public.generation_log
  WHERE id = p_generation_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_log.status <> 'pending' THEN
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

  SELECT p.is_admin
  INTO v_is_admin
  FROM public.practitioners p
  WHERE p.id = v_user_id;

  SELECT s.plan_id, s.status
  INTO v_plan_id, v_status
  FROM public.subscriptions s
  WHERE s.user_id = v_user_id
  LIMIT 1;

  IF COALESCE(v_is_admin, false)
     OR (v_plan_id = 'expert' AND v_status = 'active') THEN
    UPDATE public.generation_log
    SET status = 'refunded'
    WHERE id = p_generation_id;
    RETURN TRUE;
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners
  SET credits = credits + 1
  WHERE id = v_user_id;
  PERFORM set_config('app.internal_operation', 'false', true);

  UPDATE public.generation_log
  SET status = 'refunded'
  WHERE id = p_generation_id;

  RETURN TRUE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.unaccent(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'extensions'
AS $function$
  SELECT extensions.unaccent($1);
$function$
;

CREATE OR REPLACE FUNCTION public.unaccent(regdictionary, text)
 RETURNS text
 LANGUAGE sql
 STABLE PARALLEL SAFE STRICT
 SET search_path TO 'extensions'
AS $function$
  SELECT extensions.unaccent($1, $2);
$function$
;

CREATE OR REPLACE FUNCTION public.similarity(text, text)
 RETURNS real
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'extensions'
AS $function$
  SELECT extensions.similarity($1, $2);
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_generation_internal(p_generation_id uuid, p_user_id uuid, p_success boolean, p_error_code text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_log public.generation_log%ROWTYPE;
  v_is_admin boolean;
  v_plan_id text;
  v_status text;
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

  SELECT p.is_admin
  INTO v_is_admin
  FROM public.practitioners p
  WHERE p.id = p_user_id;

  SELECT s.plan_id, s.status
  INTO v_plan_id, v_status
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
  LIMIT 1;

  IF COALESCE(v_is_admin, false)
     OR (v_plan_id = 'expert' AND v_status = 'active') THEN
    UPDATE public.generation_log
    SET status = 'refunded'
    WHERE id = p_generation_id;
    RETURN TRUE;
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners
  SET credits = credits + 1
  WHERE id = p_user_id;
  PERFORM set_config('app.internal_operation', 'false', true);

  UPDATE public.generation_log
  SET status = 'refunded'
  WHERE id = p_generation_id;

  RETURN TRUE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_generation_session(p_generation_id uuid, p_user_id uuid, p_lock_ttl_seconds integer DEFAULT 300)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_current_error text;
  v_lock_epoch bigint;
  v_lock_ts timestamptz;
  v_lock_token text;
  v_updated integer := 0;
BEGIN
  IF p_generation_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_lock_ttl_seconds IS NULL OR p_lock_ttl_seconds < 30 THEN
    p_lock_ttl_seconds := 300;
  END IF;

  SELECT gl.error_code
  INTO v_current_error
  FROM public.generation_log gl
  WHERE gl.id = p_generation_id
    AND gl.user_id = p_user_id
    AND gl.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_current_error IS NOT NULL AND v_current_error LIKE 'LOCK:%' THEN
    BEGIN
      v_lock_epoch := split_part(v_current_error, ':', 2)::bigint;
      v_lock_ts := to_timestamp(v_lock_epoch);
    EXCEPTION
      WHEN others THEN
        v_lock_ts := NULL;
    END;

    IF v_lock_ts IS NOT NULL
       AND v_lock_ts > (v_now - make_interval(secs => p_lock_ttl_seconds)) THEN
      RETURN false;
    END IF;
  END IF;

  v_lock_token := format(
    'LOCK:%s:%s',
    extract(epoch from v_now)::bigint,
    replace(gen_random_uuid()::text, '-', '')
  );

  UPDATE public.generation_log gl
  SET error_code = v_lock_token
  WHERE gl.id = p_generation_id
    AND gl.user_id = p_user_id
    AND gl.status = 'pending'
    AND (
      (v_current_error IS NULL AND gl.error_code IS NULL)
      OR gl.error_code = v_current_error
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_rate_limit_for_user(p_user_id uuid, p_max_per_hour integer DEFAULT 10)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_max_per_hour IS NULL OR p_max_per_hour < 1 THEN
    p_max_per_hour := 10;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ai_rate_limit:' || p_user_id::text));

  SELECT count(*)
  INTO v_count
  FROM public.ai_request_log
  WHERE user_id = p_user_id
    AND created_at > now() - interval '1 hour';

  IF v_count >= p_max_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_request_log (user_id)
  VALUES (p_user_id);

  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_practitioner_pin_configured(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.practitioners p
    WHERE p.id = p_user_id
      AND p.encryption_salt IS NOT NULL
      AND p.encryption_validator IS NOT NULL
      AND p.encryption_salt <> 'pending'
      AND p.encryption_validator <> 'pending'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_current_user_onboarded()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.practitioners p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = auth.uid()
      AND p.encryption_salt IS NOT NULL
      AND p.encryption_validator IS NOT NULL
      AND p.encryption_salt <> 'pending'
      AND p.encryption_validator <> 'pending'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_ai_health_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_daily      jsonb;
  v_total_req  bigint;
  v_total_err  bigint;
BEGIN
  IF NOT public.check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT
    jsonb_agg(
      jsonb_build_object(
        'date',     to_char(day_bucket, 'DD/MM'),
        'requests', COALESCE(req_count, 0),
        'errors',   COALESCE(err_count, 0)
      )
      ORDER BY day_bucket ASC
    )
  INTO v_daily
  FROM (
    SELECT
      date_trunc('day', created_at AT TIME ZONE 'UTC') AS day_bucket,
      COUNT(*)                                          AS req_count,
      COUNT(*) FILTER (WHERE error_code IS NOT NULL)   AS err_count
    FROM public.generation_log
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY date_trunc('day', created_at AT TIME ZONE 'UTC')
  ) agg;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE error_code IS NOT NULL)
  INTO v_total_req, v_total_err
  FROM public.generation_log
  WHERE created_at >= NOW() - INTERVAL '30 days';

  RETURN jsonb_build_object(
    'daily',          COALESCE(v_daily, '[]'::jsonb),
    'total_requests', COALESCE(v_total_req, 0),
    'total_errors',   COALESCE(v_total_err, 0),
    'error_rate_pct', CASE
                        WHEN COALESCE(v_total_req, 0) = 0 THEN 0
                        ELSE ROUND((v_total_err::numeric / v_total_req::numeric) * 100, 1)
                      END
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.practitioner_save_custom_test(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_org_id     uuid;
    v_test_id    text;
    v_test       jsonb;
    v_subtests   jsonb;
    v_sub        jsonb;
    v_sub_idx    integer := 0;
    v_category   text;
BEGIN
    SELECT organization_id INTO v_org_id
    FROM public.organization_members
    WHERE user_id = auth.uid()
    LIMIT 1;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Aucune organisation trouvee pour cet utilisateur';
    END IF;

    v_test    := COALESCE(payload->'test', '{}'::jsonb);
    v_test_id := gen_random_uuid()::text;

    SELECT id INTO v_category
    FROM public.official_categories
    WHERE id = NULLIF(TRIM(v_test->>'category_id'), '')
    LIMIT 1;
    v_category := COALESCE(v_category, 'autre');

    INSERT INTO public.official_tests (id, name, category_id, organization_id, version, author)
    VALUES (
        v_test_id,
        COALESCE(NULLIF(TRIM(v_test->>'name'), ''), 'Test personnalise'),
        v_category,
        v_org_id,
        '1.0',
        'practitioner'
    );

    v_subtests := COALESCE(payload->'subtests', '[]'::jsonb);
    FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
    LOOP
        INSERT INTO public.official_subtests (
            id, test_id, name, score_type,
            input_model, organization_id, display_order, unit
        )
        VALUES (
            gen_random_uuid()::text,
            v_test_id,
            COALESCE(NULLIF(TRIM(v_sub->>'name'), ''), 'Epreuve'),
            COALESCE(NULLIF(v_sub->>'score_type', ''), 'none'),
            COALESCE(NULLIF(v_sub->>'input_model', ''), 'numeric_4mode'),
            v_org_id,
            v_sub_idx,
            'pts'
        );
        v_sub_idx := v_sub_idx + 1;
    END LOOP;

    RETURN jsonb_build_object('test_id', v_test_id, 'org_id', v_org_id::text);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_test_detail(p_test_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_test jsonb;
  v_subtests jsonb;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(t) INTO v_test
  FROM official_tests t
  WHERE t.id = p_test_id;

  IF v_test IS NULL THEN
    RAISE EXCEPTION 'test not found' USING ERRCODE = '02000';
  END IF;

  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.display_order, s.name) INTO v_subtests
  FROM official_subtests s
  WHERE s.test_id = p_test_id;

  RETURN jsonb_build_object(
    'test', v_test,
    'subtests', COALESCE(v_subtests, '[]'::jsonb)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_save_test_detail(p_test_id text, p_test_data jsonb, p_subtests jsonb, p_deleted_subtest_ids text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub jsonb;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE official_tests
  SET
    name        = p_test_data->>'name',
    category_id = p_test_data->>'category_id',
    author      = p_test_data->>'author',
    version     = p_test_data->>'version'
  WHERE id = p_test_id;

  IF array_length(p_deleted_subtest_ids, 1) > 0 THEN
    DELETE FROM official_subtests WHERE id = ANY(p_deleted_subtest_ids);
  END IF;

  IF p_subtests IS NOT NULL AND jsonb_array_length(p_subtests) > 0 THEN
    FOR v_sub IN SELECT * FROM jsonb_array_elements(p_subtests) LOOP
      INSERT INTO official_subtests (
        id, test_id, name, unit, score_type,
        input_model, input_config, display_order, display_group_order, organization_id
      ) VALUES (
        v_sub->>'id',
        v_sub->>'test_id',
        v_sub->>'name',
        v_sub->>'unit',
        COALESCE(NULLIF(v_sub->>'score_type', ''), 'none'),
        COALESCE(NULLIF(v_sub->>'input_model', ''), 'numeric_4mode'),
        COALESCE(NULLIF(v_sub->'input_config', 'null'::jsonb), '{}'::jsonb),
        (v_sub->>'display_order')::integer,
        (v_sub->>'display_group_order')::integer,
        (v_sub->>'organization_id')::uuid
      )
      ON CONFLICT (id) DO UPDATE SET
        name                = EXCLUDED.name,
        unit                = EXCLUDED.unit,
        score_type          = EXCLUDED.score_type,
        input_model         = EXCLUDED.input_model,
        input_config        = EXCLUDED.input_config,
        display_order       = EXCLUDED.display_order,
        display_group_order = EXCLUDED.display_group_order;
    END LOOP;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_pending_questionnaires(p_pending_retention interval DEFAULT '14 days'::interval, p_completed_retention interval DEFAULT '30 days'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.pending_questionnaires
  WHERE (coalesce(status, 'pending') = 'pending' AND created_at < now() - p_pending_retention)
     OR (status = 'completed' AND created_at < now() - p_completed_retention);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sweep_stale_generations(p_older_than interval DEFAULT '00:30:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT id, user_id FROM public.generation_log
    WHERE status = 'pending' AND created_at < now() - p_older_than
  LOOP
    IF public.finalize_generation_internal(v_row.id, v_row.user_id, false, 'ABANDONED_SESSION') THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_ai_request_log(p_retention interval DEFAULT '2 days'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.ai_request_log WHERE created_at < now() - p_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_credit_for_user(p_user_id uuid, p_kind text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
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
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_org_and_subscription(p_user_id uuid, p_org_name text DEFAULT 'Mon Cabinet'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ensure_org_and_subscription: missing user id';
  END IF;

  -- Sérialise les appels concurrents pour un même utilisateur.
  PERFORM pg_advisory_xact_lock(hashtext('ensure_org:' || p_user_id::text));

  SELECT organization_id
  INTO v_org_id
  FROM public.organization_members
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name)
    VALUES (COALESCE(NULLIF(btrim(p_org_name), ''), 'Mon Cabinet'))
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (v_org_id, p_user_id, 'owner');
  END IF;

  -- Valeurs réimposées par enforce_subscription_defaults (essai de 30 jours).
  INSERT INTO public.subscriptions (user_id, plan_id, status, trial_ends_at)
  VALUES (p_user_id, 'free', 'trialing', now() + interval '30 days')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN v_org_id;
END;
$function$
;

-- ======================================================================
-- 5. Clés étrangères
-- ======================================================================

ALTER TABLE ONLY public.ai_request_log ADD CONSTRAINT ai_request_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.generation_log ADD CONSTRAINT generation_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.official_subtests ADD CONSTRAINT official_subtests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.official_subtests ADD CONSTRAINT official_subtests_test_id_fkey FOREIGN KEY (test_id) REFERENCES official_tests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.official_tests ADD CONSTRAINT fk_official_tests_category FOREIGN KEY (category_id) REFERENCES official_categories(id) ON DELETE SET DEFAULT;
ALTER TABLE ONLY public.official_tests ADD CONSTRAINT official_tests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.organization_members ADD CONSTRAINT members_org_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.organization_members ADD CONSTRAINT members_user_fkey FOREIGN KEY (user_id) REFERENCES practitioners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pending_questionnaires ADD CONSTRAINT pending_q_prac_fkey FOREIGN KEY (practitioner_id) REFERENCES practitioners(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pending_questionnaires ADD CONSTRAINT pending_questionnaires_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.practitioners ADD CONSTRAINT practitioners_auth_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_user_fkey FOREIGN KEY (user_id) REFERENCES practitioners(id) ON DELETE CASCADE;

-- ======================================================================
-- 6. Vues
-- ======================================================================

CREATE VIEW public.view_unified_catalog WITH (security_invoker=on) AS
 SELECT t.id,
    t.name AS label,
    t.category_id,
    c.label AS category_label,
    c.icon_key,
    c.sort_order,
    ( WITH caller AS (
                 SELECT om.organization_id AS caller_org_id
                   FROM organization_members om
                  WHERE (om.user_id = auth.uid())
                 LIMIT 1
                )
         SELECT count(*) AS count
           FROM official_subtests s
          WHERE (is_current_user_onboarded() AND (s.test_id = t.id) AND ((s.organization_id IS NULL) OR check_is_member_of(s.organization_id)) AND ((s.organization_id = ( SELECT caller.caller_org_id
                   FROM caller)) OR (s.organization_id IS NULL)))) AS subtests_count
   FROM (official_tests t
     JOIN official_categories c ON ((c.id = t.category_id)))
  WHERE (is_current_user_onboarded() AND ((t.organization_id IS NULL) OR check_is_member_of(t.organization_id)));

CREATE VIEW public.view_unified_subtests WITH (security_invoker=on) AS
 WITH caller AS (
         SELECT om.organization_id AS caller_org_id
           FROM organization_members om
          WHERE (om.user_id = auth.uid())
         LIMIT 1
        ), visible_subtests AS (
         SELECT s.id,
            s.test_id,
            s.name,
            s.unit,
            s.score_type,
            s.organization_id,
            s.input_model,
            s.input_config,
            s.display_group_order,
            s.display_order,
            ( SELECT caller.caller_org_id
                   FROM caller) AS caller_org_id
           FROM (official_subtests s
             JOIN official_tests t ON ((t.id = s.test_id)))
          WHERE (is_current_user_onboarded() AND ((t.organization_id IS NULL) OR check_is_member_of(t.organization_id)) AND ((s.organization_id IS NULL) OR check_is_member_of(s.organization_id)))
        )
 SELECT id,
    test_id,
    name,
    unit,
    score_type,
    input_model,
    input_config,
    display_group_order,
    display_order
   FROM visible_subtests
  WHERE ((organization_id = caller_org_id) OR (organization_id IS NULL));

-- ======================================================================
-- 7. Index
-- ======================================================================

CREATE INDEX ai_request_log_user_idx ON public.ai_request_log USING btree (user_id, created_at DESC);
CREATE INDEX generation_log_user_created_at_idx ON public.generation_log USING btree (user_id, created_at DESC);
CREATE INDEX idx_official_subtests_org ON public.official_subtests USING btree (organization_id);
CREATE INDEX idx_official_subtests_test_display_order ON public.official_subtests USING btree (test_id, display_group_order, display_order, name);
CREATE INDEX idx_official_subtests_test_id ON public.official_subtests USING btree (test_id);
CREATE INDEX idx_official_subtests_test_score_type ON public.official_subtests USING btree (test_id, score_type);
CREATE INDEX idx_official_tests_category ON public.official_tests USING btree (category_id);
CREATE UNIQUE INDEX idx_official_tests_name_scope ON public.official_tests USING btree (lower(regexp_replace(lower(TRIM(BOTH FROM name)), '[^a-z0-9]'::text, ''::text, 'g'::text)), COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX idx_official_tests_org_id ON public.official_tests USING btree (organization_id);
CREATE INDEX idx_org_members_user ON public.organization_members USING btree (user_id);
CREATE INDEX idx_pending_questionnaires_org ON public.pending_questionnaires USING btree (organization_id);
CREATE INDEX idx_pending_questionnaires_practitioner_created_at ON public.pending_questionnaires USING btree (practitioner_id, created_at DESC);
CREATE INDEX signup_rate_limit_email_idx ON public.signup_rate_limit_log USING btree (email_hash, created_at DESC);
CREATE INDEX signup_rate_limit_ip_idx ON public.signup_rate_limit_log USING btree (ip_hash, created_at DESC);

-- ======================================================================
-- 8. Triggers
-- ======================================================================

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER on_practitioner_save BEFORE INSERT OR UPDATE ON public.practitioners FOR EACH ROW EXECUTE FUNCTION enforce_practitioner_defaults();
CREATE TRIGGER on_subscription_insert BEFORE INSERT ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION enforce_subscription_defaults();
CREATE TRIGGER tr_protect_organization_member_role BEFORE UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION protect_organization_member_role();
CREATE TRIGGER tr_protect_practitioner_data BEFORE UPDATE ON public.practitioners FOR EACH ROW EXECUTE FUNCTION protect_practitioner_sensitive_data();

-- ======================================================================
-- 9. RLS et policies
-- ======================================================================

ALTER TABLE public.ai_request_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_subtests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_questionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practitioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_rate_limit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY authenticated_requires_onboarded_profile ON public.generation_log AS RESTRICTIVE FOR ALL TO authenticated USING (is_current_user_onboarded()) WITH CHECK (is_current_user_onboarded());
CREATE POLICY generation_log_select_own ON public.generation_log AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY read_categories ON public.official_categories AS PERMISSIVE FOR SELECT TO authenticated USING (is_current_user_onboarded());
CREATE POLICY "Admin Delete Subtests" ON public.official_subtests AS PERMISSIVE FOR DELETE TO public USING (check_is_admin());
CREATE POLICY "Admin Insert Subtests" ON public.official_subtests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (check_is_admin());
CREATE POLICY "Admin Update Subtests" ON public.official_subtests AS PERMISSIVE FOR UPDATE TO public USING (check_is_admin());
CREATE POLICY "Unified subtest read" ON public.official_subtests AS PERMISSIVE FOR SELECT TO public USING (((organization_id IS NULL) OR check_is_member_of(organization_id)));
CREATE POLICY catalog_read_requires_onboarded ON public.official_subtests AS RESTRICTIVE FOR SELECT TO authenticated USING (is_current_user_onboarded());
CREATE POLICY catalog_read_requires_onboarded ON public.official_tests AS RESTRICTIVE FOR SELECT TO authenticated USING (is_current_user_onboarded());
CREATE POLICY official_tests_delete_access ON public.official_tests AS PERMISSIVE FOR DELETE TO authenticated USING ((check_is_admin() OR (organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY official_tests_insert_private ON public.official_tests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((organization_id IS NOT NULL) AND (organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY official_tests_select_access ON public.official_tests AS PERMISSIVE FOR SELECT TO authenticated USING ((check_is_admin() OR (organization_id IS NULL) OR (organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY official_tests_update_access ON public.official_tests AS PERMISSIVE FOR UPDATE TO authenticated USING ((check_is_admin() OR (organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((check_is_admin() OR (organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY authenticated_requires_onboarded_profile ON public.organization_members AS RESTRICTIVE FOR ALL TO authenticated USING (is_current_user_onboarded()) WITH CHECK (is_current_user_onboarded());
CREATE POLICY leave_non_owner_membership ON public.organization_members AS PERMISSIVE FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (role <> 'owner'::text)));
CREATE POLICY view_own_membership ON public.organization_members AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY access_own_orgs ON public.organizations AS PERMISSIVE FOR ALL TO authenticated USING ((id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY authenticated_requires_onboarded_profile ON public.organizations AS RESTRICTIVE FOR ALL TO authenticated USING (is_current_user_onboarded()) WITH CHECK (is_current_user_onboarded());
CREATE POLICY authenticated_requires_onboarded_profile ON public.pending_questionnaires AS RESTRICTIVE FOR ALL TO authenticated USING (is_current_user_onboarded()) WITH CHECK (is_current_user_onboarded());
CREATE POLICY family_read_by_token ON public.pending_questionnaires AS PERMISSIVE FOR SELECT TO anon USING ((access_token = ((( SELECT current_setting('request.headers'::text, true) AS current_setting))::json ->> 'x-questionnaire-token'::text)));
CREATE POLICY family_update_by_token ON public.pending_questionnaires AS PERMISSIVE FOR UPDATE TO anon USING (((status = 'pending'::text) AND (access_token = ((( SELECT current_setting('request.headers'::text, true) AS current_setting))::json ->> 'x-questionnaire-token'::text)))) WITH CHECK (((family_encrypted_data IS NOT NULL) AND (status = 'completed'::text)));
CREATE POLICY practitioner_delete_pending ON public.pending_questionnaires AS PERMISSIVE FOR DELETE TO authenticated USING ((organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY practitioner_insert_pending ON public.pending_questionnaires AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((practitioner_id = ( SELECT auth.uid() AS uid)) AND (organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY practitioner_select_pending ON public.pending_questionnaires AS PERMISSIVE FOR SELECT TO authenticated USING ((organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY practitioner_update_pending ON public.pending_questionnaires AS PERMISSIVE FOR UPDATE TO authenticated USING ((organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((organization_id IN ( SELECT om.organization_id
   FROM organization_members om
  WHERE (om.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY practitioners_select_own ON public.practitioners AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY practitioners_update_own ON public.practitioners AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY "Users can read own subscription" ON public.subscriptions AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY authenticated_requires_onboarded_profile ON public.subscriptions AS RESTRICTIVE FOR SELECT TO authenticated USING (is_current_user_onboarded());

-- ======================================================================
-- 10. Droits : tables, vues, séquences
-- ======================================================================

REVOKE ALL ON TABLE public.ai_request_log FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ai_request_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.generation_log FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.official_categories FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.official_subtests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.official_tests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.organization_members FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.organizations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.pending_questionnaires FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.practitioners FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.signup_rate_limit_log FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.signup_rate_limit_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.view_unified_catalog FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.view_unified_subtests FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_request_log TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.ai_request_log_id_seq TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.generation_log TO service_role;
GRANT SELECT ON TABLE public.official_categories TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.official_categories TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.official_subtests TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.official_tests TO service_role;
GRANT SELECT ON TABLE public.organization_members TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.organization_members TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.organizations TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.pending_questionnaires TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pending_questionnaires TO service_role;
GRANT SELECT, UPDATE ON TABLE public.practitioners TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.practitioners TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.signup_rate_limit_log TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.signup_rate_limit_log_id_seq TO service_role;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.subscriptions TO service_role;
GRANT SELECT ON TABLE public.view_unified_catalog TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.view_unified_catalog TO service_role;
GRANT SELECT ON TABLE public.view_unified_subtests TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.view_unified_subtests TO service_role;
GRANT SELECT (id, test_id, name, unit, score_type, organization_id, input_model, input_config, display_group_order, display_order) ON TABLE public.official_subtests TO authenticated;
GRANT SELECT (id, name, category_id, organization_id) ON TABLE public.official_tests TO authenticated;
GRANT SELECT (id, status, family_encrypted_data, access_token) ON TABLE public.pending_questionnaires TO anon;
GRANT UPDATE (status, family_encrypted_data) ON TABLE public.pending_questionnaires TO anon;

-- ======================================================================
-- 11. Droits : fonctions
-- ======================================================================

REVOKE ALL ON FUNCTION public.admin_check() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_subtest(p_subtest_id text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_test(p_test_id text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_ai_health_stats() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_test_detail(p_test_id text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_tests(p_scope text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_save_test_detail(p_test_id text, p_test_data jsonb, p_subtests jsonb, p_deleted_subtest_ids text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_update_user(p_user_id uuid, p_is_admin boolean, p_credits integer, p_plan_id text, p_status text, p_trial_ends_at timestamp with time zone, p_current_period_end timestamp with time zone, p_monthly_extraction_quota integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bootstrap_org_for_user(p_user_id uuid, p_org_name text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bootstrap_practitioner_for_user(p_user_id uuid, p_email text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_is_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_is_member_of(org_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_rate_limit(p_max_per_hour integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_rate_limit_for_user(p_user_id uuid, p_max_per_hour integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_signup_rate_limit(p_ip_hash text, p_email_hash text, p_max_per_hour integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_generation_session(p_generation_id uuid, p_user_id uuid, p_lock_ttl_seconds integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_credit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_credit_for_user(p_user_id uuid, p_kind text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_practitioner_defaults() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_public_acl_on_ddl() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_subscription_defaults() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ensure_org_and_subscription(p_user_id uuid, p_org_name text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.extract_trailing_tag(p_name text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_generation(p_generation_id uuid, p_success boolean, p_error_code text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_generation_internal(p_generation_id uuid, p_user_id uuid, p_success boolean, p_error_code text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_current_user_onboarded() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_practitioner_pin_configured(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.normalize_subtest_abbreviation_tag(p_value text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.practitioner_save_custom_test(payload jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_organization_member_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_practitioner_sensitive_data() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_ai_request_log(p_retention interval) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_pending_questionnaires(p_pending_retention interval, p_completed_retention interval) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_signup_rate_limit_log(p_retention_hours integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.similarity(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sweep_stale_generations(p_older_than interval) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.unaccent(regdictionary, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.unaccent(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_check() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_subtest(p_subtest_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_subtest(p_subtest_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_test(p_test_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_test(p_test_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_ai_health_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_ai_health_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_test_detail(p_test_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_test_detail(p_test_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_tests(p_scope text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_tests(p_scope text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_test_detail(p_test_id text, p_test_data jsonb, p_subtests jsonb, p_deleted_subtest_ids text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_user(p_user_id uuid, p_is_admin boolean, p_credits integer, p_plan_id text, p_status text, p_trial_ends_at timestamp with time zone, p_current_period_end timestamp with time zone, p_monthly_extraction_quota integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_user(p_user_id uuid, p_is_admin boolean, p_credits integer, p_plan_id text, p_status text, p_trial_ends_at timestamp with time zone, p_current_period_end timestamp with time zone, p_monthly_extraction_quota integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_for_user(p_user_id uuid, p_org_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_for_user(p_user_id uuid, p_org_name text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_practitioner_for_user(p_user_id uuid, p_email text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_practitioner_for_user(p_user_id uuid, p_email text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_is_member_of(org_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_member_of(org_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(p_max_per_hour integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_for_user(p_user_id uuid, p_max_per_hour integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_signup_rate_limit(p_ip_hash text, p_email_hash text, p_max_per_hour integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_generation_session(p_generation_id uuid, p_user_id uuid, p_lock_ttl_seconds integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credit() TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credit_for_user(p_user_id uuid, p_kind text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_practitioner_defaults() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_public_acl_on_ddl() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_subscription_defaults() TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_org_and_subscription(p_user_id uuid, p_org_name text) TO service_role;
GRANT EXECUTE ON FUNCTION public.extract_trailing_tag(p_name text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_generation(p_generation_id uuid, p_success boolean, p_error_code text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_generation_internal(p_generation_id uuid, p_user_id uuid, p_success boolean, p_error_code text) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_current_user_onboarded() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_user_onboarded() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_practitioner_pin_configured(p_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_subtest_abbreviation_tag(p_value text) TO service_role;
GRANT EXECUTE ON FUNCTION public.practitioner_save_custom_test(payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.practitioner_save_custom_test(payload jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_organization_member_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_practitioner_sensitive_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_ai_request_log(p_retention interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_pending_questionnaires(p_pending_retention interval, p_completed_retention interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_signup_rate_limit_log(p_retention_hours integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
GRANT EXECUTE ON FUNCTION public.similarity(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_stale_generations(p_older_than interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.unaccent(regdictionary, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.unaccent(text) TO service_role;

-- ======================================================================
-- 12. Event triggers et jobs pg_cron
-- ======================================================================

CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') EXECUTE FUNCTION rls_auto_enable();
CREATE EVENT TRIGGER trg_enforce_public_acl_on_ddl ON ddl_command_end EXECUTE FUNCTION enforce_public_acl_on_ddl();
SELECT cron.schedule('purge_ai_request_log', '30 3 * * *', 'SELECT public.purge_ai_request_log();');
SELECT cron.schedule('purge_pending_questionnaires', '15 3 * * *', 'SELECT public.purge_pending_questionnaires();');
SELECT cron.schedule('purge_signup_rl', '0 * * * *', 'SELECT public.purge_signup_rate_limit_log();');
SELECT cron.schedule('sweep_stale_generations', '*/15 * * * *', 'SELECT public.sweep_stale_generations();');

-- ======================================================================
-- 13. Commentaires
-- ======================================================================

COMMENT ON FUNCTION public.ensure_org_and_subscription(p_user_id uuid, p_org_name text) IS 'Interne (#64) : seule implémentation de la création organisation + owner + essai 30 j. Appelée par handle_new_user et bootstrap_org_for_user. Aucun droit client.';
COMMENT ON COLUMN public.generation_log.kind IS 'Tâche qui a ouvert la session (report_bio : bilan initial, bio + diagnostic ; report_reevaluation). NULL avant 2026-10.';
COMMENT ON INDEX public.idx_official_subtests_test_id IS 'Optimizes subtest lookups in scoring and admin dedup workflows.';
COMMENT ON INDEX public.idx_official_subtests_test_score_type IS 'Composite: test + score_type for filtering by parametric vs lookup.';
COMMENT ON INDEX public.idx_official_tests_org_id IS 'Optimizes admin catalog filtering by organization. Helps admin_find_duplicates, admin_list_tests queries.';
COMMENT ON COLUMN public.practitioners.ai_style_preferences IS 'Abstract AI writing style preferences learned from report corrections. No PII allowed.';
