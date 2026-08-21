\set ON_ERROR_STOP on

create or replace function public.import_production_batch(
  p_table text,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_received integer := 0;
  v_inserted integer := 0;
  v_easy bigint;
  v_medium bigint;
  v_hard bigint;
  v_insane bigint;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  v_received := jsonb_array_length(p_rows);
  if v_received > 2000 or pg_column_size(p_rows) > 3145728 then
    raise exception 'Import batch exceeds the row or byte limit';
  end if;

  if p_table = 'status' then
    if v_received <> 0 then raise exception 'status does not accept rows'; end if;
    return jsonb_build_object(
      'ok', true,
      'cities', (select count(*) from public.cities),
      'cityTranslations', (select count(*) from public.city_translations),
      'cityAdminAreaTranslations', (select count(*) from public.city_admin_area_translations),
      'streets', (select count(*) from private.streets),
      'playableStreets', (select count(*) from private.streets where is_playable),
      'databaseBytes', pg_database_size(current_database())
    );
  elsif p_table = 'cities' then
    with inserted as (
      insert into public.cities (
        id, country_id, slug, center, bounds, enabled, created_at, updated_at,
        official_code, osm_relation_id, wikidata_id, admin_level,
        settlement_type, population, featured, source_updated_at, source,
        featured_order, bounds_bbox
      )
      select
        row.id,
        row."countryId",
        row.slug,
        extensions.st_geomfromewkb(decode(row."centerEwkb", 'base64')),
        extensions.st_geomfromewkb(decode(row."boundsEwkb", 'base64')),
        row.enabled,
        row."createdAt",
        row."updatedAt",
        row."officialCode",
        row."osmRelationId",
        row."wikidataId",
        row."adminLevel",
        row."settlementType",
        row.population,
        row.featured,
        row."sourceUpdatedAt",
        row.source,
        row."featuredOrder",
        row."boundsBbox"
      from jsonb_to_recordset(p_rows) as row(
        id uuid,
        "countryId" uuid,
        slug text,
        "centerEwkb" text,
        "boundsEwkb" text,
        enabled boolean,
        "createdAt" timestamptz,
        "updatedAt" timestamptz,
        "officialCode" text,
        "osmRelationId" bigint,
        "wikidataId" text,
        "adminLevel" smallint,
        "settlementType" text,
        population bigint,
        featured boolean,
        "sourceUpdatedAt" timestamptz,
        source jsonb,
        "featuredOrder" smallint,
        "boundsBbox" double precision[]
      )
      on conflict (id) do nothing
      returning 1
    )
    select count(*) into v_inserted from inserted;
  elsif p_table = 'city_translations' then
    with inserted as (
      insert into public.city_translations (city_id, locale, name)
      select row."cityId", row.locale, row.name
      from jsonb_to_recordset(p_rows) as row(
        "cityId" uuid,
        locale public.locale,
        name text
      )
      on conflict (city_id, locale) do nothing
      returning 1
    )
    select count(*) into v_inserted from inserted;
  elsif p_table = 'city_admin_area_translations' then
    with inserted as (
      insert into public.city_admin_area_translations (
        city_id, locale, state_name, district_name
      )
      select row."cityId", row.locale, row."stateName", row."districtName"
      from jsonb_to_recordset(p_rows) as row(
        "cityId" uuid,
        locale public.locale,
        "stateName" text,
        "districtName" text
      )
      on conflict (city_id, locale) do nothing
      returning 1
    )
    select count(*) into v_inserted from inserted;
  elsif p_table = 'streets' then
    with inserted as (
      insert into private.streets (
        id, city_id, name, normalized_name, osm_ids, highway_types,
        length_m, difficulty, geom, imported_at, source_updated_at, source,
        is_playable, exclusion_reasons
      )
      select
        row.id,
        row."cityId",
        row.name,
        row."normalizedName",
        row."osmIds",
        row."highwayTypes",
        row."lengthM",
        row.difficulty,
        extensions.st_geomfromewkb(decode(row."geomEwkb", 'base64')),
        row."importedAt",
        row."sourceUpdatedAt",
        row.source,
        row."isPlayable",
        row."exclusionReasons"
      from jsonb_to_recordset(p_rows) as row(
        id uuid,
        "cityId" uuid,
        name text,
        "normalizedName" text,
        "osmIds" bigint[],
        "highwayTypes" text[],
        "lengthM" double precision,
        difficulty public.difficulty,
        "geomEwkb" text,
        "importedAt" timestamptz,
        "sourceUpdatedAt" timestamptz,
        source jsonb,
        "isPlayable" boolean,
        "exclusionReasons" text[]
      )
      on conflict (id) do nothing
      returning 1
    )
    select count(*) into v_inserted from inserted;
  elsif p_table = 'finalize' then
    if v_received <> 0 then raise exception 'finalize does not accept rows'; end if;
    if (select count(*) from public.cities) <> 10941
      or (select count(*) from public.city_translations) <> 21882
      or (select count(*) from public.city_admin_area_translations) <> 21882
      or (select count(*) from private.streets) <> 1324020
      or (select count(*) from private.streets where is_playable) <> 1124492
    then
      raise exception 'Production import counts do not match the pinned catalog';
    end if;

    if exists (
      select 1 from private.streets
      where source->>'dataset' is distinct from
        'https://download.geofabrik.de/europe/germany-260819.osm.pbf'
        or source->>'checksumMd5' is distinct from '14a4f4ce1ab3ace8e858efa73b43c78f'
        or source_updated_at is distinct from '2026-08-19T20:20:48Z'::timestamptz
        or source->>'kind' = 'synthetic-demo'
    ) then
      raise exception 'Production contains streets outside the pinned OSM snapshot';
    end if;

    with counts as (
      select city_id, difficulty, count(*) as street_count
      from private.streets
      where is_playable
      group by city_id, difficulty
    )
    select
      count(*) filter (where difficulty = 'easy' and street_count >= 10),
      count(*) filter (where difficulty = 'medium' and street_count >= 10),
      count(*) filter (where difficulty = 'hard' and street_count >= 10),
      count(*) filter (where difficulty = 'insane' and street_count >= 10)
    into v_easy, v_medium, v_hard, v_insane
    from counts;

    if (v_easy, v_medium, v_hard, v_insane) is distinct from
      (2401::bigint, 2998::bigint, 5215::bigint, 8181::bigint)
    then
      raise exception 'Production difficulty pools differ';
    end if;

    analyze public.cities;
    analyze public.city_translations;
    analyze public.city_admin_area_translations;
    analyze private.streets;

    return jsonb_build_object(
      'ok', true,
      'cities', 10941,
      'streets', 1324020,
      'playableStreets', 1124492,
      'databaseBytes', pg_database_size(current_database())
    );
  else
    raise exception 'Unsupported production import table: %', p_table;
  end if;

  return jsonb_build_object(
    'ok', true,
    'table', p_table,
    'received', v_received,
    'inserted', v_inserted
  );
end
$$;

revoke all on function public.import_production_batch(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_production_batch(text, jsonb) to service_role;
