-- Harden signup anti-abuse controls:
-- - throttle burst attempts per IP
-- - enforce hourly and daily ceilings per IP
-- - enforce daily ceiling per email hash
-- - enforce global hourly ceiling
-- - keep existing function signature compatible

create index if not exists signup_rate_limit_created_at_idx
  on public.signup_rate_limit_log (created_at desc);

create or replace function public.check_signup_rate_limit(
  p_ip_hash text,
  p_email_hash text default null::text,
  p_max_per_hour integer default 3
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
set row_security to 'off'
as $function$
declare
  v_ip_hour_count integer;
  v_ip_day_count integer;
  v_email_day_count integer;
  v_global_hour_count integer;
  v_last_ip_attempt timestamptz;
  v_last_email_attempt timestamptz;
  v_ip_daily_limit integer := greatest(p_max_per_hour * 4, 12);
  v_email_daily_limit integer := 6;
  v_global_hour_limit integer := 250;
begin
  if p_ip_hash is null or length(p_ip_hash) < 8 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('signup_rl:' || p_ip_hash));

  select max(created_at) into v_last_ip_attempt
  from public.signup_rate_limit_log
  where ip_hash = p_ip_hash;

  if v_last_ip_attempt is not null and v_last_ip_attempt > now() - interval '15 seconds' then
    return false;
  end if;

  if p_email_hash is not null then
    select max(created_at) into v_last_email_attempt
    from public.signup_rate_limit_log
    where email_hash = p_email_hash;

    if v_last_email_attempt is not null and v_last_email_attempt > now() - interval '45 seconds' then
      return false;
    end if;
  end if;

  select count(*) into v_ip_hour_count
  from public.signup_rate_limit_log
  where ip_hash = p_ip_hash
    and created_at > now() - interval '1 hour';

  if v_ip_hour_count >= p_max_per_hour then
    return false;
  end if;

  select count(*) into v_ip_day_count
  from public.signup_rate_limit_log
  where ip_hash = p_ip_hash
    and created_at > now() - interval '24 hours';

  if v_ip_day_count >= v_ip_daily_limit then
    return false;
  end if;

  if p_email_hash is not null then
    select count(*) into v_email_day_count
    from public.signup_rate_limit_log
    where email_hash = p_email_hash
      and created_at > now() - interval '24 hours';

    if v_email_day_count >= v_email_daily_limit then
      return false;
    end if;
  end if;

  select count(*) into v_global_hour_count
  from public.signup_rate_limit_log
  where created_at > now() - interval '1 hour';

  if v_global_hour_count >= v_global_hour_limit then
    return false;
  end if;

  insert into public.signup_rate_limit_log (ip_hash, email_hash)
  values (p_ip_hash, p_email_hash);

  return true;
end;
$function$;;
