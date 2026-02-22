-- Re-grant view select access after CREATE OR REPLACE VIEW.
GRANT SELECT ON TABLE public.view_unified_catalog TO authenticated;
GRANT SELECT ON TABLE public.view_unified_subtests TO authenticated;
