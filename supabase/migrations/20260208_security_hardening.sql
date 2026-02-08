-- ============================================================================
-- MIGRATION: Security & Performance Hardening
-- Date: 2026-02-08
-- Summary:
--   Étape 1: Fix credit pipeline (trigger conflict, consume_credit, refund abuse)
--   Étape 2: Protect norms data (server-side compute_score RPC)
--   Étape 3: Block organization escalation (restrict org_members INSERT)
--   Étape 4: Restrict anonymous questionnaire access
--   + official_categories RLS
-- ============================================================================

BEGIN;

-- ============================================================================
-- ÉTAPE 3 (PRIORITÉ 1) : BLOQUER L'ESCALADE DE PRIVILÈGES SUR LES ORGANISATIONS
-- La policy `insert_own_membership` permet à tout user de rejoindre n'importe quelle org.
-- La policy `access_own_membership` (ALL) inclut INSERT+DELETE non contrôlés.
-- ============================================================================

-- Supprimer les policies dangereuses
DROP POLICY IF EXISTS "access_own_membership" ON organization_members;
DROP POLICY IF EXISTS "insert_own_membership" ON organization_members;

-- Conserver uniquement SELECT + UPDATE (pour encrypted_org_key)
-- view_own_membership existe déjà → on la recrée proprement
DROP POLICY IF EXISTS "view_own_membership" ON organization_members;
CREATE POLICY "view_own_membership"
  ON organization_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "update_own_key" ON organization_members;
CREATE POLICY "update_own_key"
  ON organization_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Ajouter une policy DELETE (quitter sa propre org) restreinte aux non-owners
-- afin qu'un owner ne puisse pas orpheliner son org
CREATE POLICY "leave_non_owner_membership"
  ON organization_members FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() AND role != 'owner');


-- ============================================================================
-- ÉTAPE 1c : CORRIGER LE CONFLIT DE TRIGGERS SUR practitioners
-- enforce_practitioner_defaults() annule silencieusement les changements de credits
-- même quand c'est consume_credit()/refund_credit() qui les font.
-- Solution : variable de session 'app.internal_operation' positionnée par les RPC.
-- ============================================================================

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
$function$;


-- ============================================================================
-- ÉTAPE 1d : CORRIGER consume_credit() — variable shadowing + session bypass
-- Le variable `user_plan` recevait d'abord is_admin (boolean) écrasé par plan_id.
-- Le check admin était perdu. On sépare les variables.
-- ============================================================================

-- Drop ancienne signature (boolean) pour pouvoir changer le return type
DROP FUNCTION IF EXISTS public.consume_credit();
-- Drop ancienne refund_credit sans paramètre (sera recréée avec p_generation_id)
DROP FUNCTION IF EXISTS public.refund_credit();

-- Version intermédiaire (boolean) — sera remplacée juste après par la version uuid+log
CREATE OR REPLACE FUNCTION public.consume_credit()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_credits   integer;
  v_is_admin  boolean;
  v_plan_id   text;
  v_status    text;
BEGIN
  -- 1. Récupérer infos praticien
  SELECT credits, is_admin INTO v_credits, v_is_admin
  FROM public.practitioners 
  WHERE id = auth.uid();

  -- 2. Récupérer abonnement
  SELECT plan_id, status INTO v_plan_id, v_status
  FROM public.subscriptions
  WHERE user_id = auth.uid();

  -- CAS 1 : Admin → illimité
  IF v_is_admin = true THEN
    RETURN TRUE;
  END IF;

  -- CAS 2 : Plan Expert actif → illimité
  IF v_plan_id = 'expert' AND v_status = 'active' THEN
    RETURN TRUE;
  END IF;

  -- CAS 3 : Vérifier accès payant ou trial valide
  IF NOT public.check_paid_access() THEN
    RETURN FALSE;
  END IF;

  -- CAS 4 : Crédits classiques
  IF v_credits > 0 THEN
    -- Positionner le flag pour bypass le trigger
    PERFORM set_config('app.internal_operation', 'true', true);
    
    UPDATE public.practitioners 
    SET credits = credits - 1 
    WHERE id = auth.uid();
    
    -- Réinitialiser le flag
    PERFORM set_config('app.internal_operation', 'false', true);
    
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$function$;


-- ============================================================================
-- ÉTAPE 1b : SÉCURISER refund_credit() CONTRE LE FARMING
-- Ajout d'une table generation_log + refund lié à un generation_id documenté
-- ============================================================================

-- Table de log des générations AI
CREATE TABLE IF NOT EXISTS public.generation_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  status      text NOT NULL DEFAULT 'consumed',  -- consumed | completed | refunded
  created_at  timestamptz NOT NULL DEFAULT now(),
  refunded_at timestamptz
);

ALTER TABLE public.generation_log ENABLE ROW LEVEL SECURITY;

-- RLS : chaque user ne voit que ses propres logs
CREATE POLICY "own_generation_logs"
  ON generation_log FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Drop la version boolean intermédiaire pour recréer en uuid
DROP FUNCTION IF EXISTS public.consume_credit();

-- Version finale : retourne un generation_id (uuid) ou NULL
CREATE FUNCTION public.consume_credit()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_credits      integer;
  v_is_admin     boolean;
  v_plan_id      text;
  v_status       text;
  v_gen_id       uuid;
BEGIN
  -- 1. Récupérer infos praticien
  SELECT credits, is_admin INTO v_credits, v_is_admin
  FROM public.practitioners 
  WHERE id = auth.uid();

  -- 2. Récupérer abonnement
  SELECT plan_id, status INTO v_plan_id, v_status
  FROM public.subscriptions
  WHERE user_id = auth.uid();

  -- CAS 1 : Admin → illimité (log quand même)
  IF v_is_admin = true THEN
    INSERT INTO public.generation_log (user_id, status)
    VALUES (auth.uid(), 'consumed')
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  -- CAS 2 : Plan Expert actif → illimité
  IF v_plan_id = 'expert' AND v_status = 'active' THEN
    INSERT INTO public.generation_log (user_id, status)
    VALUES (auth.uid(), 'consumed')
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  -- CAS 3 : Vérifier accès payant ou trial valide
  IF NOT public.check_paid_access() THEN
    RETURN NULL;
  END IF;

  -- CAS 4 : Crédits classiques
  IF v_credits > 0 THEN
    PERFORM set_config('app.internal_operation', 'true', true);
    
    UPDATE public.practitioners 
    SET credits = credits - 1 
    WHERE id = auth.uid();
    
    PERFORM set_config('app.internal_operation', 'false', true);

    INSERT INTO public.generation_log (user_id, status)
    VALUES (auth.uid(), 'consumed')
    RETURNING id INTO v_gen_id;

    RETURN v_gen_id;
  ELSE
    RETURN NULL;  -- Pas assez de crédits
  END IF;
END;
$function$;


-- Nouvelle refund_credit sécurisée : nécessite un generation_id valide
-- (L'ancienne version sans paramètre a été droppée plus haut)
CREATE FUNCTION public.refund_credit(p_generation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_log    record;
  v_plan   text;
  v_status text;
BEGIN
  -- 1. Vérifier que le log existe, appartient au user, et est en statut 'consumed'
  SELECT * INTO v_log
  FROM public.generation_log
  WHERE id = p_generation_id
    AND user_id = auth.uid()
    AND status = 'consumed';

  IF v_log IS NULL THEN
    RETURN FALSE;  -- Log invalide, déjà remboursé, ou pas le bon user
  END IF;

  -- 2. Vérifier que le log date de moins de 5 minutes (protection anti-abus)
  IF v_log.created_at < now() - interval '5 minutes' THEN
    RETURN FALSE;
  END IF;

  -- 3. Marquer comme remboursé
  UPDATE public.generation_log
  SET status = 'refunded', refunded_at = now()
  WHERE id = p_generation_id;

  -- 4. Ne rembourser le crédit que pour les plans non-illimités
  SELECT plan_id, status INTO v_plan, v_status
  FROM public.subscriptions
  WHERE user_id = auth.uid();

  IF (v_plan = 'expert' AND v_status = 'active') THEN
    RETURN TRUE;  -- Expert n'a pas perdu de crédit → rien à rembourser
  END IF;

  -- Vérifier admin
  IF (SELECT is_admin FROM practitioners WHERE id = auth.uid()) = true THEN
    RETURN TRUE;  -- Admin non plus
  END IF;

  -- 5. Rembourser effectivement le crédit
  PERFORM set_config('app.internal_operation', 'true', true);

  UPDATE public.practitioners
  SET credits = credits + 1
  WHERE id = auth.uid();

  PERFORM set_config('app.internal_operation', 'false', true);

  RETURN TRUE;
END;
$function$;


-- ============================================================================
-- ÉTAPE 2 : PROTÉGER LES NORMES — RPC compute_score côté serveur
-- Le client n'a plus besoin d'accéder directement à official_norms.
-- ============================================================================

-- RPC de scoring server-side
CREATE OR REPLACE FUNCTION public.compute_score(
  p_subtest_id   text,
  p_raw_score    real,
  p_age_months   integer,
  p_gender       text DEFAULT 'Mixed',
  p_class_level  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_subtest       record;
  v_norm          record;
  v_lookup        record;
  v_z             real;
  v_standard      real;
  v_percentile    real;
BEGIN
  -- 1. Récupérer la définition du sous-test
  SELECT * INTO v_subtest
  FROM public.official_subtests
  WHERE id = p_subtest_id
  LIMIT 1;

  IF v_subtest IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Chercher la norme applicable (priorité genre spécifique > Mixed)
  SELECT * INTO v_norm
  FROM public.official_norms
  WHERE subtest_id = p_subtest_id
    AND age_min_months <= p_age_months
    AND age_max_months >= p_age_months
    AND (gender = p_gender OR gender = 'Mixed')
  ORDER BY 
    CASE WHEN gender = p_gender THEN 0 ELSE 1 END  -- Priorité genre spécifique
  LIMIT 1;

  IF v_norm IS NULL THEN
    RETURN NULL;
  END IF;

  -- 3. BRANCHE A : MODE PARAMÉTRIQUE
  IF v_norm.mean IS NOT NULL AND v_norm.sd IS NOT NULL AND v_norm.sd > 0 THEN
    v_z := (p_raw_score - v_norm.mean) / v_norm.sd;

    -- Conversion selon score_type du sous-test
    IF v_subtest.score_type = 'standard' THEN
      v_standard := 100 + (v_z * 15);
      v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;
    ELSIF v_subtest.score_type = 'scaled' THEN
      v_standard := 10 + (v_z * 3);
      v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;
    ELSIF v_subtest.score_type = 'sten' THEN
      v_standard := 5.5 + (v_z * 2);
      v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;
    ELSIF v_subtest.score_type = 't_score' THEN
      v_standard := 50 + (v_z * 10);
      v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;
    ELSE
      -- Défaut: note standard (100/15)
      v_standard := 100 + (v_z * 15);
      v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;
    END IF;

    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', round(v_standard::numeric, 1),
      'percentile', round(v_percentile::numeric, 1),
      'zScore', round(v_z::numeric, 2),
      'method', 'PARAMETRIC'
    );
  END IF;

  -- 4. BRANCHE B : MODE LOOKUP
  SELECT * INTO v_lookup
  FROM public.official_norms
  WHERE subtest_id = p_subtest_id
    AND age_min_months <= p_age_months
    AND age_max_months >= p_age_months
    AND raw_min <= p_raw_score
    AND raw_max >= p_raw_score
    AND (gender = p_gender OR gender = 'Mixed')
  ORDER BY 
    CASE WHEN gender = p_gender THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_lookup IS NOT NULL THEN
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', COALESCE(v_lookup.standard_score, 0),
      'percentile', COALESCE(v_lookup.percentile, 0),
      'zScore', 0,
      'method', 'LOOKUP'
    );
  END IF;

  RETURN NULL;
END;
$function$;


-- Révoquer SELECT direct sur official_norms pour les non-admin
-- On supprime les policies de lecture ouverte, on garde admin + org privée
DROP POLICY IF EXISTS "Unified View Norms" ON official_norms;
DROP POLICY IF EXISTS "view_mixed_norms" ON official_norms;

-- Nouvelle policy : les users ne peuvent lire QUE leurs normes privées (org)
CREATE POLICY "view_own_org_norms"
  ON official_norms FOR SELECT
  TO public
  USING (
    organization_id IS NOT NULL 
    AND check_is_member_of(organization_id)
  );

-- Les admins conservent l'accès total
-- (Les policies "Admin Delete Norms", "Admin Update Norms" restent, on ajoute un SELECT admin)
CREATE POLICY "admin_read_all_norms"
  ON official_norms FOR SELECT
  TO public
  USING (check_is_admin());


-- ============================================================================
-- Ajouter RLS sur official_categories (table sans aucune policy)
-- ============================================================================

-- S'assurer que RLS est activé
ALTER TABLE IF EXISTS public.official_categories ENABLE ROW LEVEL SECURITY;

-- Permettre la lecture à tout user authentifié (métadonnées non sensibles)
CREATE POLICY "read_categories"
  ON official_categories FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================================
-- ÉTAPE 4 : RESTREINDRE L'ACCÈS ANONYME AUX QUESTIONNAIRES
-- ============================================================================

-- Ajouter une colonne access_token pour vérifier l'identité du répondant
ALTER TABLE public.pending_questionnaires 
  ADD COLUMN IF NOT EXISTS access_token text;

-- Remplir les lignes existantes avec un token aléatoire
UPDATE public.pending_questionnaires 
SET access_token = encode(gen_random_bytes(32), 'hex')
WHERE access_token IS NULL;

-- Supprimer la policy SELECT anon ouverte à tous
DROP POLICY IF EXISTS "family_read_access" ON pending_questionnaires;

-- Nouvelle policy : les anon ne peuvent lire QUE via l'access_token passé en header
-- Le client enverra le token via un paramètre RPC ou header personnalisé
CREATE POLICY "family_read_by_token"
  ON pending_questionnaires FOR SELECT
  TO anon
  USING (
    access_token = current_setting('request.headers', true)::json->>'x-questionnaire-token'
  );

-- Restreindre l'UPDATE anon : vérifier aussi le token
DROP POLICY IF EXISTS "family_update_access" ON pending_questionnaires;
CREATE POLICY "family_update_by_token"
  ON pending_questionnaires FOR UPDATE
  TO anon
  USING (
    status = 'pending'
    AND access_token = current_setting('request.headers', true)::json->>'x-questionnaire-token'
  )
  WITH CHECK (family_encrypted_data IS NOT NULL);


-- ============================================================================
-- RATE LIMITING : table pour compter les appels AI par user
-- (Utilisé par l'Edge Function pour limiter à N appels/heure)
-- ============================================================================

-- La table generation_log (créée ci-dessus) sert aussi de rate limiter.
-- On ajoute une function utilitaire pour l'Edge Function.

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_max_per_hour integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.generation_log
  WHERE user_id = auth.uid()
    AND created_at > now() - interval '1 hour';
  
  RETURN v_count < p_max_per_hour;
END;
$function$;


-- ============================================================================
-- Mise à jour de protect_practitioner_sensitive_data pour respecter le flag
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_practitioner_sensitive_data()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Bypass pour service_role et opérations internes (RPC)
    IF (auth.role() = 'service_role') THEN
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
END;
$function$;


COMMIT;
