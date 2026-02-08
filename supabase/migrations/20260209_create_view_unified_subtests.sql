-- Migration: Create view_unified_subtests
-- Rationale: official_subtests has organization_id which should NOT be exposed
-- to the client (blind backend). Subtests inherit visibility from their parent
-- test via test_id → official_tests.organization_id.
-- This mirrors the pattern already used by view_unified_catalog.

CREATE OR REPLACE VIEW public.view_unified_subtests AS
SELECT
    s.id,
    s.test_id,
    s.name,
    s.unit,
    s.score_type
FROM public.official_subtests s
INNER JOIN public.official_tests t ON t.id = s.test_id
WHERE t.organization_id IS NULL
   OR public.check_is_member_of(t.organization_id);

-- Grant read access to authenticated users (avoids GRANT-level 403)
GRANT SELECT ON public.view_unified_subtests TO authenticated;

COMMENT ON VIEW public.view_unified_subtests IS
  'Unified subtests view — exposes only technical fields (id, test_id, name, unit, score_type). '
  'Visibility inherited from parent test via official_tests.organization_id. '
  'No organization_id leaked to client.';
