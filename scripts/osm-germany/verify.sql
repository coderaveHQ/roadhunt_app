\set ON_ERROR_STOP on

select jsonb_build_object(
  'stagedBoundaries', (select count(*) from osm_import.admin_boundaries),
  'stagedMunicipalities', (select count(*) from osm_import.municipalities),
  'stagedNamedRoadSegments', (select count(*) from osm_import.road_segments),
  'catalogCities', (select count(*) from public.cities where enabled),
  'osmCities', (
    select count(*) from public.cities
    where source->>'dataset' = :'snapshot_url' and enabled
  ),
  'activeFallbackCityCodes', (
    select count(*) from public.cities
    where enabled and official_code like 'osm-r%'
  ),
  'adminAreaTranslations', (
    select count(*)
    from public.city_admin_area_translations admin_area
    join public.cities city on city.id = admin_area.city_id
    where city.enabled
  ),
  'missingAdminAreaLocales', (
    select count(*)
    from public.cities city
    cross join (values ('de'::public.locale), ('en'::public.locale)) locale(value)
    where city.enabled
      and not exists (
        select 1
        from public.city_admin_area_translations admin_area
        where admin_area.city_id = city.id
          and admin_area.locale = locale.value
      )
  ),
  'citiesWithDistrict', (
    select count(distinct admin_area.city_id)
    from public.city_admin_area_translations admin_area
    join public.cities city on city.id = admin_area.city_id
    where city.enabled and admin_area.district_name is not null
  ),
  'invalidDistrictParents', (
    select count(*)
    from osm_import.municipality_admin_areas admin_area
    where admin_area.district_relation_id is not null
      and admin_area.district_area_m2 < admin_area.municipality_area_m2 * 0.99
  ),
  'cityStateChildDistricts', (
    select count(*)
    from osm_import.municipality_admin_areas admin_area
    where admin_area.city_key = any(array[
      '02000000', '04011000', '04012000', '11000000'
    ])
      and admin_area.district_relation_id is not null
  ),
  'staleCities', (
    select count(*) from public.cities where source->>'stale' = 'true'
  ),
  'osmGroupedStreets', (
    select count(*)
    from private.streets street
    join public.cities city on city.id = street.city_id
    where street.source->>'dataset' = :'snapshot_url' and city.enabled
  ),
  'playableStreets', (
    select count(*)
    from private.streets street
    join public.cities city on city.id = street.city_id
    where street.source->>'dataset' = :'snapshot_url'
      and street.is_playable
      and city.enabled
  ),
  'staleStreets', (
    select count(*) from private.streets
    where exclusion_reasons @> array['not-in-current-snapshot']::text[]
  ),
  'invalidCityBounds', (
    select count(*) from public.cities
    where source->>'dataset' = :'snapshot_url'
      and not extensions.st_isvalid(bounds)
  ),
  'cityBboxMismatches', (
    select count(*) from public.cities
    where enabled
      and bounds_bbox is distinct from array[
        extensions.st_xmin(extensions.box3d(bounds)),
        extensions.st_ymin(extensions.box3d(bounds)),
        extensions.st_xmax(extensions.box3d(bounds)),
        extensions.st_ymax(extensions.box3d(bounds))
      ]::double precision[]
  ),
  'invalidStreetGeometry', (
    select count(*) from private.streets
    where source->>'dataset' = :'snapshot_url'
      and not extensions.st_isvalid(geom)
  ),
  'targetGeometryMismatches', (
    select count(*)
    from osm_import.street_rollup street
    where street.is_playable
      and (
        street.playable_length_m is null
        or abs(street.length_m - street.playable_length_m) > 0.01
        or abs(
          extensions.st_length(street.geom::extensions.geography)
            - street.playable_length_m
        ) > 0.1
      )
  ),
  'playablePools', (
    select coalesce(jsonb_object_agg(difficulty::text, city_count), '{}'::jsonb)
    from (
      select difficulty, count(*) as city_count
      from (
        select city_id, difficulty
        from private.streets
        where is_playable
        group by city_id, difficulty
        having count(*) >= 10
      ) pools
      group by difficulty
    ) counts
  )
) as road_hunt_germany_import;
