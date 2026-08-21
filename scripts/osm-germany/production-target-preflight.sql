\set ON_ERROR_STOP on

do $$
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260821085327'
  ) then
    raise exception 'Production is missing migration 20260821085327';
  end if;
  if (select count(*) from public.countries where code = 'DE') <> 1 then
    raise exception 'Production must contain exactly one DE country row';
  end if;
  if (
    select count(*) from public.country_translations translation
    join public.countries country on country.id = translation.country_id
    where country.code = 'DE'
  ) <> 2 then
    raise exception 'Production must contain both DE country translations';
  end if;
  if (select count(*) from public.cities) <> 0
    or (select count(*) from public.city_translations) <> 0
    or (select count(*) from public.city_admin_area_translations) <> 0
    or (select count(*) from private.streets) <> 0
    or (select count(*) from private.games) <> 0
    or (select count(*) from private.game_players) <> 0
  then
    raise exception 'Production catalog/game tables must be empty before first restore';
  end if;
  if to_regnamespace('osm_import') is not null then
    raise exception 'Production must not contain the heavy osm_import staging schema';
  end if;
end
$$;

select jsonb_build_object(
  'ok', true,
  'serverVersion', current_setting('server_version'),
  'postgisVersion', extensions.postgis_lib_version()
);
