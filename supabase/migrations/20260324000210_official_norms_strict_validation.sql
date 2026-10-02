begin;
create or replace function public.validate_official_norm_row_strict()
returns trigger
language plpgsql
as $$
begin
  if new.age_min_months is null
     or new.age_max_months is null
     or new.age_min_months > new.age_max_months then
    raise exception 'VALIDATION_BLOQUANTE: age invalid (%-%)', new.age_min_months, new.age_max_months;
  end if;

  if (new.raw_min is null) <> (new.raw_max is null) then
    raise exception 'VALIDATION_BLOQUANTE: raw range requires both bounds (%-%)', new.raw_min, new.raw_max;
  end if;

  if new.raw_min is not null and new.raw_max is not null and new.raw_min > new.raw_max then
    raise exception 'VALIDATION_BLOQUANTE: raw range invalid (%-%)', new.raw_min, new.raw_max;
  end if;

  if new.percentile is not null and (new.percentile < 0 or new.percentile > 100) then
    raise exception 'VALIDATION_BLOQUANTE: percentile out of bounds (%)', new.percentile;
  end if;

  if (new.mean is null) <> (new.sd is null) then
    raise exception 'VALIDATION_BLOQUANTE: mean/sd must be both null or both set (mean=%, sd=%)', new.mean, new.sd;
  end if;

  if new.sd is not null and new.sd <= 0 then
    raise exception 'VALIDATION_BLOQUANTE: sd must be > 0 (sd=%)', new.sd;
  end if;

  if new.mean is null and new.standard_score is null and new.percentile is null then
    raise exception 'VALIDATION_BLOQUANTE: missing all score metrics';
  end if;

  -- Intentionally do NOT block lookup overlaps/contradictions here.
  -- They are handled by the existing evidence/conflict certainty system
  -- (support_count/conflict_count + admin resolution workflows).

  return new;
end;
$$;
drop trigger if exists trg_validate_official_norm_row_strict on public.official_norms;
create trigger trg_validate_official_norm_row_strict
before insert or update of
  age_min_months,
  age_max_months,
  gender,
  raw_min,
  raw_max,
  mean,
  sd,
  standard_score,
  percentile,
  subtest_id
on public.official_norms
for each row
execute function public.validate_official_norm_row_strict();
commit;
