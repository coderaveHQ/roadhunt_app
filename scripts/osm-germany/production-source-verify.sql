\set ON_ERROR_STOP on

select set_config('roadhunt_import.snapshot_url', :'snapshot_url', false) as snapshot_url \gset
select set_config('roadhunt_import.snapshot_md5', :'snapshot_md5', false) as snapshot_md5 \gset

do $$
declare
  v_cities bigint;
  v_city_translations bigint;
  v_admin_translations bigint;
  v_streets bigint;
  v_synthetic bigint;
  v_osm bigint;
  v_playable bigint;
begin
  select count(*) into v_cities from public.cities where enabled;
  select count(*) into v_city_translations from public.city_translations;
  select count(*) into v_admin_translations from public.city_admin_area_translations;
  select count(*) into v_streets from private.streets;
  select count(*) into v_synthetic
  from private.streets where source->>'kind' = 'synthetic-demo';
  select count(*) into v_osm
  from private.streets
  where source->>'dataset' = current_setting('roadhunt_import.snapshot_url');
  select count(*) into v_playable
  from private.streets
  where source->>'dataset' = current_setting('roadhunt_import.snapshot_url') and is_playable;

  if v_cities <> 10941 or (select count(*) from public.cities) <> 10941 then
    raise exception 'Expected exactly 10941 enabled source cities, got %', v_cities;
  end if;
  if v_city_translations <> 21882 or v_admin_translations <> 21882 then
    raise exception 'Source translation counts differ: city %, admin %',
      v_city_translations, v_admin_translations;
  end if;
  if v_streets <> 1324500 or v_synthetic <> 480 or v_osm <> 1324020 then
    raise exception 'Source street counts differ: all %, synthetic %, OSM %',
      v_streets, v_synthetic, v_osm;
  end if;
  if v_playable <> 1124492 then
    raise exception 'Expected 1124492 playable OSM streets, got %', v_playable;
  end if;
  if exists (
    select 1 from public.cities
    where source->>'dataset' is distinct from current_setting('roadhunt_import.snapshot_url')
      or source->>'checksumMd5' is distinct from current_setting('roadhunt_import.snapshot_md5')
  ) then
    raise exception 'Source cities do not all match the pinned OSM snapshot';
  end if;
  if exists (
    select 1 from private.streets
    where source->>'dataset' = current_setting('roadhunt_import.snapshot_url')
      and source->>'checksumMd5' is distinct from current_setting('roadhunt_import.snapshot_md5')
  ) then
    raise exception 'Source streets do not all match the pinned OSM checksum';
  end if;
end
$$;

select jsonb_build_object(
  'ok', true,
  'cities', (select count(*) from public.cities),
  'cityTranslations', (select count(*) from public.city_translations),
  'adminTranslations', (select count(*) from public.city_admin_area_translations),
  'streets', (select count(*) from private.streets)
);
