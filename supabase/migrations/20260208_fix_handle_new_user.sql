-- Fix handle_new_user trigger:
-- 1. Add trial_ends_at (14 days) to subscriptions insert
-- 2. Wrap in exception block so partial failures don't orphan auth.users

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id uuid;
BEGIN
  -- 1. Créer le profil Praticien
  INSERT INTO public.practitioners (id, email, credits, encryption_salt, encryption_validator)
  VALUES (
    NEW.id, 
    NEW.email, 
    3, 
    'pending', 'pending'
  );

  -- 2. Créer l'Organisation par défaut
  INSERT INTO public.organizations (name)
  VALUES ('Cabinet ' || NEW.email)
  RETURNING id INTO new_org_id;

  -- 3. Ajouter le Praticien comme Owner
  INSERT INTO public.organization_members (organization_id, user_id, role, encrypted_org_key)
  VALUES (new_org_id, NEW.id, 'owner', NULL);

  -- 4. Créer l'abonnement Trial (avec date de fin !)
  INSERT INTO public.subscriptions (user_id, plan_id, status, trial_ends_at)
  VALUES (NEW.id, 'free', 'trialing', now() + interval '14 days');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log l'erreur mais ne bloque pas la création Auth
  RAISE WARNING 'handle_new_user partial failure for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
