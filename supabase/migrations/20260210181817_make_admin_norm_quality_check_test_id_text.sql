drop function if exists public.admin_norm_quality_check(uuid, text);

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_norm_quality_check'
      and pg_get_function_identity_arguments(p.oid) = 'p_test_id text, p_subtest_id text'
  ) then
    -- no-op, will be replaced below
    null;
  end if;
end $$;

create or replace function public.admin_norm_quality_check(
  p_test_id text default null::text,
  p_subtest_id text default null::text
)
returns table(
  norm_id uuid,
  subtest_id text,
  subtest_name text,
  flag_code text,
  flag_label text,
  details text
)
language plpgsql
security definer
as $function$
begin
  if not check_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select * from (

    -- 1) Inverted age range
    select n.id as norm_id,
           n.subtest_id as subtest_id,
           s.name as subtest_name,
           'AGE_INVERTED'::text as flag_code,
           'Tranche d''âge inversée'::text as flag_label,
           format('min=%s > max=%s', n.age_min_months, n.age_max_months)::text as details
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
      and n.age_min_months is not null and n.age_max_months is not null
      and n.age_min_months > n.age_max_months

    union all

    -- 2) Inverted raw score range
    select n.id as norm_id,
           n.subtest_id as subtest_id,
           s.name as subtest_name,
           'RAW_INVERTED'::text as flag_code,
           'Scores bruts inversés'::text as flag_label,
           format('raw_min=%s > raw_max=%s', n.raw_min, n.raw_max)::text as details
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
      and n.raw_min is not null and n.raw_max is not null
      and n.raw_min > n.raw_max

    union all

    -- 3) Standard score out of plausible range
    select n.id as norm_id,
           n.subtest_id as subtest_id,
           s.name as subtest_name,
           'SCORE_IMPLAUSIBLE'::text as flag_code,
           'Score standard hors limites'::text as flag_label,
           format('standard_score=%s', n.standard_score)::text as details
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
      and n.standard_score is not null
      and (n.standard_score < 1 or n.standard_score > 200)

    union all

    -- 4) Negative SD
    select n.id as norm_id,
           n.subtest_id as subtest_id,
           s.name as subtest_name,
           'NEGATIVE_SD'::text as flag_code,
           'Écart-type négatif'::text as flag_label,
           format('sd=%s', n.sd)::text as details
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
      and n.sd is not null and n.sd < 0

    union all

    -- 5) Percentile out of range
    select n.id as norm_id,
           n.subtest_id as subtest_id,
           s.name as subtest_name,
           'PERCENTILE_OOB'::text as flag_code,
           'Percentile hors [0-100]'::text as flag_label,
           format('percentile=%s', n.percentile)::text as details
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
      and n.percentile is not null
      and (n.percentile < 0 or n.percentile > 100)

    union all

    -- 6) LOOKUP subtest with no standard_score
    select n.id as norm_id,
           n.subtest_id as subtest_id,
           s.name as subtest_name,
           'LOOKUP_NO_SCORE'::text as flag_code,
           'Norme LOOKUP sans score standard'::text as flag_label,
           'standard_score is NULL'::text as details
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
      and s.computation_mode = 'LOOKUP'
      and n.standard_score is null

    union all

    -- 7) PARAMETRIC subtest missing mean or sd
    select n.id as norm_id,
           n.subtest_id as subtest_id,
           s.name as subtest_name,
           'PARAM_INCOMPLETE'::text as flag_code,
           'Norme PARAMETRIC sans mean ou sd'::text as flag_label,
           format('mean=%s, sd=%s', n.mean, n.sd)::text as details
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
      and s.computation_mode = 'PARAMETRIC'
      and (n.mean is null or n.sd is null)

    union all

    -- 8) Very wide age range (> 120 months)
    select n.id as norm_id,
           n.subtest_id as subtest_id,
           s.name as subtest_name,
           'AGE_TOO_WIDE'::text as flag_code,
           'Tranche d''âge très large (>10 ans)'::text as flag_label,
           format('%s-%s mois (delta=%s)', n.age_min_months, n.age_max_months, n.age_max_months - n.age_min_months)::text as details
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
      and n.age_min_months is not null and n.age_max_months is not null
      and (n.age_max_months - n.age_min_months) > 120

  ) as all_flags(norm_id, subtest_id, subtest_name, flag_code, flag_label, details)
  order by all_flags.subtest_id, all_flags.flag_code;
end;
$function$;;
