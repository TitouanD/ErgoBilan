begin;

alter function public.admin_catalog_quality_summary()
  set search_path = public;

alter function public.validate_official_norm_row_strict()
  set search_path = public;

commit;
