\set ON_ERROR_STOP on

select set_config('roadhunt_import.snapshot_url', :'snapshot_url', false) as snapshot_url \gset
select set_config('roadhunt_import.snapshot_date', :'snapshot_date', false) as snapshot_date \gset
select set_config('roadhunt_import.snapshot_md5', :'snapshot_md5', false) as snapshot_md5 \gset

do $$
declare
  v_easy bigint;
  v_medium bigint;
  v_hard bigint;
  v_insane bigint;
begin
  if (select count(*) from public.cities) <> 10941
    or (select count(*) from public.cities where enabled) <> 10941
  then
    raise exception 'Production city count differs from 10941';
  end if;
  if (select count(*) from public.city_translations) <> 21882
    or (select count(*) from public.city_admin_area_translations) <> 21882
  then
    raise exception 'Production translation counts differ from 21882 each';
  end if;
  if (select count(*) from private.streets) <> 1324020 then
    raise exception 'Production street count differs from 1324020';
  end if;
  if (select count(*) from private.streets where is_playable) <> 1124492 then
    raise exception 'Production playable street count differs from 1124492';
  end if;
  if exists (
    select 1 from private.streets
    where source->>'dataset' is distinct from current_setting('roadhunt_import.snapshot_url')
      or source->>'checksumMd5' is distinct from current_setting('roadhunt_import.snapshot_md5')
      or source_updated_at is distinct from
        current_setting('roadhunt_import.snapshot_date')::timestamptz
      or source->>'kind' = 'synthetic-demo'
  ) then
    raise exception 'Production contains a street outside the pinned OSM snapshot';
  end if;
  if exists (
    select 1 from public.cities
    where source->>'dataset' is distinct from current_setting('roadhunt_import.snapshot_url')
      or source->>'checksumMd5' is distinct from current_setting('roadhunt_import.snapshot_md5')
  ) then
    raise exception 'Production contains a city outside the pinned OSM snapshot';
  end if;
  if exists (
    select 1 from public.cities
    where not extensions.st_isvalid(bounds) or extensions.st_isempty(bounds)
  ) then
    raise exception 'Production contains an invalid city geometry';
  end if;
  if exists (
    select 1 from private.streets
    where not extensions.st_isvalid(geom) or extensions.st_isempty(geom)
  ) then
    raise exception 'Production contains an invalid street geometry';
  end if;

  with counts as (
    select city_id, difficulty, count(*) as street_count
    from private.streets where is_playable
    group by city_id, difficulty
  )
  select
    count(*) filter (where difficulty = 'easy' and street_count >= 10),
    count(*) filter (where difficulty = 'medium' and street_count >= 10),
    count(*) filter (where difficulty = 'hard' and street_count >= 10),
    count(*) filter (where difficulty = 'insane' and street_count >= 10)
  into v_easy, v_medium, v_hard, v_insane
  from counts;

  if (v_easy, v_medium, v_hard, v_insane) is distinct from (2401::bigint, 2998::bigint, 5215::bigint, 8181::bigint) then
    raise exception 'Production difficulty pools differ: easy %, medium %, hard %, insane %',
      v_easy, v_medium, v_hard, v_insane;
  end if;
  if to_regnamespace('osm_import') is not null then
    raise exception 'Production unexpectedly contains osm_import staging';
  end if;
end
$$;

select jsonb_build_object(
  'ok', true,
  'cities', (select count(*) from public.cities),
  'streets', (select count(*) from private.streets),
  'playableStreets', (select count(*) from private.streets where is_playable),
  'databaseBytes', pg_database_size(current_database()),
  'databaseSize', pg_size_pretty(pg_database_size(current_database()))
);
