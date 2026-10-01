-- Création de compte (#64, docs/TECH_DEBT.md P2-2).
--
-- Constaté en base le 2026-10-01 :
--   - durée d'essai : 14 jours demandés par handle_new_user et bootstrap_org_for_user,
--     30 jours imposés par le trigger BEFORE INSERT enforce_subscription_defaults
--     (c'est lui qui s'applique). Titouan a choisi 30 jours.
--   - deux implémentations de la création d'organisation : le trigger auth
--     handle_new_user (org nommée « Cabinet <e-mail> ») et la RPC bootstrap_org_for_user
--     (appelée par l'edge `signup`, par AuthContext.hydrateProfile à chaque
--     déverrouillage et par useLinkManager, sur main comme sur dev).
--   - enforce_edge_signup_channel : BEFORE INSERT sur auth.users, corps `RETURN NEW`.
--
-- Choix :
--   1. Une seule implémentation : public.ensure_org_and_subscription (interne, aucun
--      droit client). Le trigger et la RPC l'appellent. La RPC ne peut pas disparaître
--      (main l'appelle pour obtenir l'id d'organisation) ; le trigger reste le chemin
--      normal (le compte est complet dès auth.signUp, même sans confirmation d'e-mail),
--      la RPC devient une réparation idempotente. Verrou consultatif par utilisateur :
--      deux appels simultanés (edge + hydrateProfile) ne créent plus deux organisations
--      (la PK de organization_members est (organization_id, user_id), elle ne l'empêche
--      pas). L'organisation s'appelle « Mon Cabinet » (plus d'e-mail dans son nom).
--   2. Essai de 30 jours partout ; enforce_subscription_defaults reste la règle finale.
--   3. enforce_edge_signup_channel est supprimé : le client (main et dev) crée le compte
--      par supabase.auth.signUp, l'edge `signup` n'intervient qu'APRÈS, avec la session.
--      Aucune vérification « passé par l'edge » n'est possible en base sans casser
--      l'inscription. La protection de l'inscription est celle d'Auth (CAPTCHA
--      Turnstile, limites de débit) : réglage à vérifier à la main, ne PAS désactiver
--      l'inscription directe (cela bloquerait toute inscription).
--      DROP TRIGGER exige d'être propriétaire d'auth.users (supabase_auth_admin) :
--      on supprime la fonction (propriétaire postgres) avec CASCADE, après avoir
--      vérifié que ce trigger est son seul dépendant.
--   4. handle_new_user n'échoue toujours pas l'inscription (sinon auth.signUp renvoie
--      « Database error saving new user » et la personne ne peut pas créer de compte,
--      alors que bootstrap_practitioner_for_user / bootstrap_org_for_user réparent à
--      l'onboarding, et que l'edge remonte leurs échecs à Sentry). Le bloc est tout ou
--      rien (sous-transaction) et l'erreur est journalisée par RAISE WARNING avec son
--      SQLSTATE (journaux Postgres de Supabase).
--
-- CREATE OR REPLACE FUNCTION déclenche l'event trigger enforce_public_acl_on_ddl, qui
-- retire tous les droits à anon et authenticated : les GRANT sont donc rejoués après.
-- Idempotente. Les comptes orphelins ne sont pas touchés ici :
-- supabase/checks/20261001100100_orphelins.sql.

begin;

-- 1. Implémentation unique : organisation + membre owner + abonnement d'essai.
CREATE OR REPLACE FUNCTION public.ensure_org_and_subscription(p_user_id uuid, p_org_name text DEFAULT 'Mon Cabinet')
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
$function$;

COMMENT ON FUNCTION public.ensure_org_and_subscription(uuid, text) IS
  'Interne (#64) : seule implémentation de la création organisation + owner + essai 30 j. Appelée par handle_new_user et bootstrap_org_for_user. Aucun droit client.';

REVOKE ALL ON FUNCTION public.ensure_org_and_subscription(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_org_and_subscription(uuid, text) TO service_role;

-- 2. Trigger auth : praticien + organisation, sans bloquer l'inscription.
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
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- 3. RPC client : mêmes gardes qu'avant, même signature et même retour (uuid).
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
$function$;

REVOKE ALL ON FUNCTION public.bootstrap_org_for_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_for_user(uuid, text) TO authenticated, service_role;

-- 4. Règle finale de l'abonnement d'essai (inchangée : 30 jours).
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
$function$;

REVOKE ALL ON FUNCTION public.enforce_subscription_defaults() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_subscription_defaults() TO service_role;

-- 5. enforce_edge_signup_channel : supprimé avec son trigger sur auth.users.
DO $$
DECLARE
  v_fn oid := to_regprocedure('public.enforce_edge_signup_channel()');
  v_other int;
BEGIN
  IF v_fn IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_other
  FROM pg_depend d
  WHERE d.refclassid = 'pg_proc'::regclass
    AND d.refobjid = v_fn
    AND d.deptype = 'n'
    AND NOT (
      d.classid = 'pg_trigger'::regclass
      AND EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.oid = d.objid
          AND t.tgname = 'tr_enforce_edge_signup_channel'
          AND t.tgrelid = 'auth.users'::regclass
      )
    );

  IF v_other > 0 THEN
    RAISE EXCEPTION 'enforce_edge_signup_channel a % dépendant(s) inattendu(s) : migration interrompue', v_other;
  END IF;

  DROP FUNCTION public.enforce_edge_signup_channel() CASCADE;
END;
$$;

commit;
