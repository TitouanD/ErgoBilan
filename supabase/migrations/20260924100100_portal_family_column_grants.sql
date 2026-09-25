-- Family portal (anon + x-questionnaire-token header): restrict what the family
-- can read and write (docs/TECH_DEBT.md P0-7).
--
-- Before: anon had SELECT/UPDATE on every column, so a token holder could rewrite
-- status, access_token, practitioner_encrypted_key, organization_id...
-- After: the family only reads its row status + encrypted answers, and can only
-- submit its encrypted answers once (status pending → completed).

REVOKE SELECT, UPDATE ON public.pending_questionnaires FROM anon;
-- access_token and id are referenced by the RLS policies / filters.
GRANT SELECT (id, status, family_encrypted_data, access_token) ON public.pending_questionnaires TO anon;
GRANT UPDATE (family_encrypted_data, status) ON public.pending_questionnaires TO anon;

DROP POLICY IF EXISTS family_update_by_token ON public.pending_questionnaires;
CREATE POLICY family_update_by_token ON public.pending_questionnaires
  FOR UPDATE TO anon
  USING (
    status = 'pending'
    AND access_token = ((SELECT current_setting('request.headers', true))::json ->> 'x-questionnaire-token')
  )
  WITH CHECK (family_encrypted_data IS NOT NULL AND status = 'completed');
