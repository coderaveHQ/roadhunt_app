create or replace function public.calculate_score(
  p_distance_m double precision,
  p_seconds_remaining double precision
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_distance_m is null or p_distance_m >= 500 then 0
    -- Keep aligned with STREET_HIT_RADIUS_METERS in src/lib/game/scoring.ts.
    when greatest(0, p_distance_m) <= 15 then 1000
    else round(
      1000
      * power(greatest(0, 1 - greatest(0, p_distance_m) / 500), 2)
      * (
        0.85
        + 0.15 * greatest(0, least(60, coalesce(p_seconds_remaining, 0))) / 60
      )
    )::integer
  end;
$$;
