-- organization_members : plus de modification par le client (#91).
--
-- authenticated avait UPDATE sur toute la table, et la policy update_own_member_key
-- n'imposait que user_id = auth.uid() : un praticien pouvait changer son
-- organization_id et devenir membre d'une autre organisation (tests perso,
-- questionnaires). Ce droit servait à encrypted_org_key, supprimée par
-- 20261001100200_nettoyage_vestiges.sql. Aucun code (dev, main, edges) ne fait
-- d'UPDATE sur cette table ; ensure_org_and_subscription (SECURITY DEFINER) n'en
-- a pas besoin. La lecture de sa propre ligne (view_own_membership) est inchangée.
-- Idempotente.

begin;

REVOKE UPDATE ON public.organization_members FROM authenticated;
DROP POLICY IF EXISTS update_own_member_key ON public.organization_members;

commit;
