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
  with base as (
    select n.*, s.name as subtest_name, s.test_id, s.computation_mode
    from official_norms n
    join official_subtests s on s.id = n.subtest_id
    where (p_test_id is null or s.test_id = p_test_id)
      and (p_subtest_id is null or n.subtest_id = p_subtest_id)
  ),
  age_ordered as (
    select
      b.id as norm_id,
      b.subtest_id,
      b.subtest_name,
      b.gender,
      b.age_min_months,
      b.age_max_months,
      lag(b.age_min_months) over (partition by b.subtest_id, b.gender order by b.age_min_months, b.age_max_months) as prev_age_min,
      lag(b.age_max_months) over (partition by b.subtest_id, b.gender order by b.age_min_months, b.age_max_months) as prev_age_max
    from base b
    where b.computation_mode = 'PARAMETRIC'
      and b.age_min_months is not null and b.age_max_months is not null
  )
  select * from (

    -- 1) Inverted age range
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'AGE_INVERTED'::text as flag_code,
           'Tranche d''âge inversée'::text as flag_label,
           format('min=%s > max=%s', b.age_min_months, b.age_max_months)::text as details
    from base b
    where b.age_min_months is not null and b.age_max_months is not null
      and b.age_min_months > b.age_max_months

    union all

    -- 2) Inverted raw score range
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'RAW_INVERTED'::text as flag_code,
           'Scores bruts inversés'::text as flag_label,
           format('raw_min=%s > raw_max=%s', b.raw_min, b.raw_max)::text as details
    from base b
    where b.raw_min is not null and b.raw_max is not null
      and b.raw_min > b.raw_max

    union all

    -- 3) Standard score out of plausible range
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'SCORE_IMPLAUSIBLE'::text as flag_code,
           'Score standard hors limites'::text as flag_label,
           format('standard_score=%s', b.standard_score)::text as details
    from base b
    where b.standard_score is not null
      and (b.standard_score < 1 or b.standard_score > 200)

    union all

    -- 4) Negative SD
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'NEGATIVE_SD'::text as flag_code,
           'Écart-type négatif'::text as flag_label,
           format('sd=%s', b.sd)::text as details
    from base b
    where b.sd is not null and b.sd < 0

    union all

    -- 4b) Zero SD
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'ZERO_SD'::text as flag_code,
           'Écart-type nul'::text as flag_label,
           format('sd=%s', b.sd)::text as details
    from base b
    where b.sd is not null and b.sd = 0

    union all

    -- 5) Percentile out of range
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'PERCENTILE_OOB'::text as flag_code,
           'Percentile hors [0-100]'::text as flag_label,
           format('percentile=%s', b.percentile)::text as details
    from base b
    where b.percentile is not null
      and (b.percentile < 0 or b.percentile > 100)

    union all

    -- 6) LOOKUP subtest with no standard_score
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'LOOKUP_NO_SCORE'::text as flag_code,
           'Norme LOOKUP sans score standard'::text as flag_label,
           'standard_score is NULL'::text as details
    from base b
    where b.computation_mode = 'LOOKUP'
      and b.standard_score is null

    union all

    -- 6b) LOOKUP subtest missing raw range
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'LOOKUP_MISSING_RAW'::text as flag_code,
           'Norme LOOKUP sans raw_min/raw_max'::text as flag_label,
           format('raw_min=%s, raw_max=%s', b.raw_min, b.raw_max)::text as details
    from base b
    where b.computation_mode = 'LOOKUP'
      and (b.raw_min is null or b.raw_max is null)

    union all

    -- 7) PARAMETRIC subtest missing mean or sd
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'PARAM_INCOMPLETE'::text as flag_code,
           'Norme PARAMETRIC sans mean ou sd'::text as flag_label,
           format('mean=%s, sd=%s', b.mean, b.sd)::text as details
    from base b
    where b.computation_mode = 'PARAMETRIC'
      and (b.mean is null or b.sd is null)

    union all

    -- 8) Very wide age range (> 120 months)
    select b.id as norm_id,
           b.subtest_id as subtest_id,
           b.subtest_name as subtest_name,
           'AGE_TOO_WIDE'::text as flag_code,
           'Tranche d''âge très large (>10 ans)'::text as flag_label,
           format('%s-%s mois (delta=%s)', b.age_min_months, b.age_max_months, b.age_max_months - b.age_min_months)::text as details
    from base b
    where b.age_min_months is not null and b.age_max_months is not null
      and (b.age_max_months - b.age_min_months) > 120

    union all

    -- 9) Overlapping age ranges (PARAMETRIC only)
    select a.norm_id as norm_id,
           a.subtest_id as subtest_id,
           a.subtest_name as subtest_name,
           'AGE_OVERLAP'::text as flag_code,
           'Tranches d''âge qui se chevauchent'::text as flag_label,
           format('prev=%s-%s, curr=%s-%s', a.prev_age_min, a.prev_age_max, a.age_min_months, a.age_max_months)::text as details
    from age_ordered a
    where a.prev_age_max is not null
      and a.age_min_months < a.prev_age_max

    union all

    -- 10) Gaps in age ranges (PARAMETRIC only)
    select a.norm_id as norm_id,
           a.subtest_id as subtest_id,
           a.subtest_name as subtest_name,
           'AGE_GAP'::text as flag_code,
           'Trou d''âge entre deux tranches'::text as flag_label,
           format('prev=%s-%s, curr=%s-%s', a.prev_age_min, a.prev_age_max, a.age_min_months, a.age_max_months)::text as details
    from age_ordered a
    where a.prev_age_max is not null
      and a.age_min_months > a.prev_age_max + 1

  ) as all_flags(norm_id, subtest_id, subtest_name, flag_code, flag_label, details)
  order by all_flags.subtest_id, all_flags.flag_code;
end;
$function$;;
