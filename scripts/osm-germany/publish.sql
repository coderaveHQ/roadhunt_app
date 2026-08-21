\set ON_ERROR_STOP on
\pset pager off
\timing on

set statement_timeout = 0;
set lock_timeout = '10s';
set idle_in_transaction_session_timeout = '10min';
set work_mem = '128MB';
set maintenance_work_mem = '1GB';
set jit = off;
select set_config('roadhunt_import.snapshot_url', :'snapshot_url', false);

do $$
declare
  v_boundary_count bigint;
  v_complete_boundary_count bigint;
  v_boundary_level_counts text;
  v_road_count bigint;
  v_place_count bigint;
begin
  if to_regclass('osm_import.admin_boundaries') is null
    or to_regclass('osm_import.road_segments') is null
    or to_regclass('osm_import.place_nodes') is null
  then
    raise exception 'OSM staging is incomplete. Run the stage phase first.';
  end if;

  select count(*), count(*) filter (where geom is not null)
  into v_boundary_count, v_complete_boundary_count
  from osm_import.admin_boundaries;

  select string_agg(
    admin_level || '=' || boundary_count::text || '/' || complete_count::text,
    ',' order by admin_level::integer
  ) into v_boundary_level_counts
  from (
    select
      admin_level,
      count(*) as boundary_count,
      count(*) filter (where geom is not null) as complete_count
    from osm_import.admin_boundaries
    group by admin_level
  ) levels;

  select count(*) into v_road_count from osm_import.road_segments;

  select count(*) into v_place_count from osm_import.place_nodes;

  if v_boundary_count <> 11868 or v_complete_boundary_count <> 11331 then
    raise exception 'Pinned boundary counts differ: total %/11868, complete %/11331',
      v_boundary_count, v_complete_boundary_count;
  end if;
  if v_boundary_level_counts is distinct from
    '2=18/1,4=43/16,6=473/400,7=1/1,8=11296/10878,9=30/28,10=1/1,11=6/6'
  then
    raise exception 'Pinned boundary-level coverage differs: %', v_boundary_level_counts;
  end if;
  if exists (
    select 1 from osm_import.admin_boundaries
    where geom is not null
      and (not extensions.st_isvalid(geom) or extensions.st_isempty(geom))
  ) then
    raise exception 'Boundary staging contains invalid or empty geometry';
  end if;
  if (
    select count(*) from osm_import.admin_boundaries
    where relation_id = 51477
      and admin_level = '2'
      and geom is not null
      and (
        iso_country_code = 'DE'
        or tags->>'ISO3166-1:alpha2' = 'DE'
        or tags->>'ISO3166-1' = 'DE'
      )
  ) <> 1 then
    raise exception 'Pinned Germany admin-level-2 relation 51477 is missing';
  end if;
  if v_road_count <> 4088252 then
    raise exception 'Pinned named-road count differs: %/4088252', v_road_count;
  end if;
  if exists (
    select 1 from osm_import.road_segments
    where geom is null
      or name is null
      or length(btrim(name)) = 0
      or not extensions.st_isvalid(geom)
      or extensions.st_isempty(geom)
  ) then
    raise exception 'Named-road staging contains missing, invalid or empty data';
  end if;
  if v_place_count <> 213877 then
    raise exception 'Pinned place-node count differs: %/213877', v_place_count;
  end if;
  if exists (
    select 1 from osm_import.place_nodes
    where geom is null
      or name is null
      or length(btrim(name)) = 0
      or not extensions.st_isvalid(geom)
      or extensions.st_isempty(geom)
  ) then
    raise exception 'Place-node staging contains missing, invalid or empty data';
  end if;
  if (select count(*) from public.countries where code = 'DE') <> 1 then
    raise exception 'Roadhunt needs exactly one public.countries row with code DE';
  end if;
end
$$;

drop table if exists osm_import.municipalities;
create unlogged table osm_import.municipalities as
with germany as (
  select extensions.st_multi(
    extensions.st_collectionextract(extensions.st_makevalid(boundary.geom), 3)
  )::extensions.geometry(MultiPolygon, 4326) as geom
  from osm_import.admin_boundaries boundary
  where boundary.geom is not null
    and boundary.admin_level = '2'
    and (
      boundary.iso_country_code = 'DE'
      or boundary.tags->>'ISO3166-1:alpha2' = 'DE'
      or boundary.tags->>'ISO3166-1' = 'DE'
    )
  order by extensions.st_area(boundary.geom::extensions.geography) desc
  limit 1
), repaired as (
  select
    boundary.relation_id,
    boundary.name,
    boundary.name_en,
    boundary.admin_level,
    case
      when boundary.official_code ~ '^[0-9]{8}$' then boundary.official_code
      else 'osm-r' || boundary.relation_id::text
    end as official_code,
    case
      when boundary.wikidata ~ '^Q[0-9]+$' then boundary.wikidata
      else null
    end as wikidata_id,
    nullif(boundary.place, '') as relation_place,
    nullif(boundary.de_place, '') as de_place,
    case
      when replace(coalesce(boundary.population, ''), ' ', '') ~ '^[0-9]+$'
        then replace(boundary.population, ' ', '')::bigint
      else null
    end as relation_population,
    extensions.st_multi(
      extensions.st_collectionextract(extensions.st_makevalid(boundary.geom), 3)
    )::extensions.geometry(MultiPolygon, 4326) as geom
  from osm_import.admin_boundaries boundary
  where boundary.geom is not null
    and boundary.name is not null
    and length(btrim(boundary.name)) > 0
    and (
      boundary.admin_level = '8'
      or boundary.official_code ~ '^[0-9]{8}$'
    )
), country_candidates as (
  select repaired.*
  from repaired
  cross join germany
  where repaired.geom is not null
    and not extensions.st_isempty(repaired.geom)
    and extensions.st_covers(
      germany.geom,
      extensions.st_pointonsurface(repaired.geom)
    )
), candidates as (
  select candidate.*
  from country_candidates candidate
  where candidate.official_code ~ '^[0-9]{8}$'
    or not exists (
      select 1
      from country_candidates official
      where official.official_code ~ '^[0-9]{8}$'
        and official.relation_id <> candidate.relation_id
        and extensions.st_covers(
          official.geom,
          extensions.st_pointonsurface(candidate.geom)
        )
    )
), ranked as (
  select
    candidates.*,
    row_number() over (
      partition by candidates.official_code
      order by
        (candidates.admin_level = '8') desc,
        extensions.st_area(candidates.geom::extensions.geography) desc,
        candidates.relation_id
    ) as duplicate_rank
  from candidates
)
select
  ranked.official_code as city_key,
  ranked.relation_id,
  btrim(ranked.name) as name_de,
  coalesce(nullif(btrim(ranked.name_en), ''), place.name_en, btrim(ranked.name)) as name_en,
  ranked.official_code,
  ranked.wikidata_id,
    case
      when ranked.admin_level ~ '^[0-9]+$' then ranked.admin_level::smallint
      else null
    end as admin_level,
    coalesce(
      case when ranked.de_place = any(array[
        'city', 'town', 'village', 'municipality', 'borough', 'suburb',
        'quarter', 'neighbourhood', 'hamlet', 'isolated_dwelling', 'locality', 'farm'
      ]) then ranked.de_place end,
      case when ranked.relation_place = any(array[
        'city', 'town', 'village', 'municipality', 'borough', 'suburb',
        'quarter', 'neighbourhood', 'hamlet', 'isolated_dwelling', 'locality', 'farm'
      ]) then ranked.relation_place end,
      case when place.place = any(array[
        'city', 'town', 'village', 'municipality', 'borough', 'suburb',
        'quarter', 'neighbourhood', 'hamlet', 'isolated_dwelling', 'locality', 'farm'
      ]) then place.place end,
      'municipality'
    ) as settlement_type,
  coalesce(ranked.relation_population, place.population) as population,
  ranked.relation_place,
  ranked.de_place,
  extensions.st_pointonsurface(ranked.geom)::extensions.geometry(Point, 4326) as center,
  ranked.geom as bounds,
  extensions.st_area(ranked.geom::extensions.geography) as area_m2,
  coalesce(
    nullif(
      trim(both '-' from regexp_replace(
        translate(lower(replace(ranked.name, 'ß', 'ss')), 'äöü', 'aou'),
        '[^a-z0-9]+',
        '-',
        'g'
      )),
      ''
    ),
    'municipality'
  ) || '-' || ranked.official_code as generated_slug
from ranked
left join lateral (
  select
    nullif(btrim(node.name_en), '') as name_en,
    nullif(node.place, '') as place,
    case
      when replace(coalesce(node.population, ''), ' ', '') ~ '^[0-9]+$'
        then replace(node.population, ' ', '')::bigint
      else null
    end as population
  from osm_import.place_nodes node
  where node.geom is not null
    and extensions.st_covers(ranked.geom, node.geom)
    and (
      (ranked.wikidata_id is not null and node.wikidata = ranked.wikidata_id)
      or lower(btrim(node.name)) = lower(btrim(ranked.name))
    )
  order by
    (ranked.wikidata_id is not null and node.wikidata = ranked.wikidata_id) desc,
    case node.place
      when 'city' then 1
      when 'town' then 2
      when 'village' then 3
      when 'municipality' then 4
      else 5
    end,
    case
      when replace(coalesce(node.population, ''), ' ', '') ~ '^[0-9]+$'
        then replace(node.population, ' ', '')::bigint
      else 0
    end desc,
    node.node_id
  limit 1
) place on true
where ranked.duplicate_rank = 1;

create unique index municipalities_city_key_key
  on osm_import.municipalities (city_key);
create unique index municipalities_relation_id_key
  on osm_import.municipalities (relation_id);
create index municipalities_bounds_gix
  on osm_import.municipalities using gist (bounds);
analyze osm_import.municipalities;

do $$
declare
  v_count bigint;
  v_state_counts text;
begin
  select count(*) into v_count from osm_import.municipalities;
  if v_count <> 10941 then
    raise exception 'Pinned municipality count differs: %/10941', v_count;
  end if;
  if exists (
    select 1 from osm_import.municipalities
    where bounds is null
      or not extensions.st_isvalid(bounds)
      or area_m2 is null
      or area_m2 <= 0
  ) then
    raise exception 'Municipality staging contains missing or invalid bounds/area';
  end if;
  if (
    select count(distinct left(official_code, 2))
    from osm_import.municipalities
    where official_code ~ '^[0-9]{8}$'
  ) <> 16 then
    raise exception 'Municipality staging does not cover all 16 German AGS state prefixes';
  end if;
  if exists (
    select 1 from osm_import.municipalities
    where official_code !~ '^[0-9]{8}$'
  ) then
    raise exception 'Pinned snapshot should have no unmatched no-AGS fallback municipality';
  end if;

  select string_agg(state_code || '=' || municipality_count::text, ',' order by state_code)
  into v_state_counts
  from (
    select left(official_code, 2) as state_code, count(*) as municipality_count
    from osm_import.municipalities
    group by left(official_code, 2)
  ) state_coverage;

  if v_state_counts is distinct from '01=1104,02=1,03=964,04=2,05=396,06=425,07=2300,08=1103,09=2217,10=52,11=1,12=413,13=725,14=418,15=218,16=602' then
    raise exception 'Pinned AGS state coverage differs: %', v_state_counts;
  end if;
  if exists (
    select 1 from osm_import.municipalities
    where settlement_type <> all(array[
      'city', 'town', 'village', 'municipality', 'borough', 'suburb',
      'quarter', 'neighbourhood', 'hamlet', 'isolated_dwelling', 'locality', 'farm'
    ])
  ) then
    raise exception 'Municipality staging contains an unrecognized settlement type';
  end if;
  if exists (
    select 1 from osm_import.municipalities
    where official_code = '01054168'
      and name_en = 'Westerland'
  ) then
    raise exception 'Sylt incorrectly inherited Westerland place-node metadata';
  end if;
end
$$;

drop table if exists osm_import.admin_area_boundaries;
create unlogged table osm_import.admin_area_boundaries as
select
  boundary.relation_id,
  boundary.admin_level,
  boundary.name,
  boundary.name_en,
  coalesce(boundary.tags->>'ISO3166-2', '') like 'DE-%' as is_german_state,
  prepared.geom,
  extensions.st_area(prepared.geom::extensions.geography) as area_m2
from osm_import.admin_boundaries boundary
cross join lateral (
  select extensions.st_multi(
    extensions.st_collectionextract(extensions.st_makevalid(boundary.geom), 3)
  )::extensions.geometry(MultiPolygon, 4326) as geom
) prepared
where boundary.admin_level in ('4', '6')
  and boundary.geom is not null
  and prepared.geom is not null
  and not extensions.st_isempty(prepared.geom);

create index admin_area_boundaries_level_idx
  on osm_import.admin_area_boundaries (admin_level);
create index admin_area_boundaries_geom_gix
  on osm_import.admin_area_boundaries using gist (geom);
analyze osm_import.admin_area_boundaries;

do $$
begin
  if (select count(*) from osm_import.admin_area_boundaries) <> 416
    or (select count(*) from osm_import.admin_area_boundaries where admin_level = '4') <> 16
    or (select count(*) from osm_import.admin_area_boundaries where admin_level = '4' and is_german_state) <> 16
    or (select count(*) from osm_import.admin_area_boundaries where admin_level = '6') <> 400
  then
    raise exception 'Prepared admin-area boundary counts differ from 416 (16 states + 400 districts)';
  end if;
  if exists (
    select 1 from osm_import.admin_area_boundaries
    where not extensions.st_isvalid(geom)
      or extensions.st_isempty(geom)
      or area_m2 is null
      or area_m2 <= 0
  ) then
    raise exception 'Prepared admin-area boundaries contain invalid geometry or area';
  end if;
end
$$;

drop table if exists osm_import.municipality_admin_areas;
create unlogged table osm_import.municipality_admin_areas as
with state_names (state_code, name_de, name_en) as (
  values
    ('01', 'Schleswig-Holstein', 'Schleswig-Holstein'),
    ('02', 'Hamburg', 'Hamburg'),
    ('03', 'Niedersachsen', 'Lower Saxony'),
    ('04', 'Bremen', 'Bremen'),
    ('05', 'Nordrhein-Westfalen', 'North Rhine-Westphalia'),
    ('06', 'Hessen', 'Hesse'),
    ('07', 'Rheinland-Pfalz', 'Rhineland-Palatinate'),
    ('08', 'Baden-Württemberg', 'Baden-Württemberg'),
    ('09', 'Bayern', 'Bavaria'),
    ('10', 'Saarland', 'Saarland'),
    ('11', 'Berlin', 'Berlin'),
    ('12', 'Brandenburg', 'Brandenburg'),
    ('13', 'Mecklenburg-Vorpommern', 'Mecklenburg-Western Pomerania'),
    ('14', 'Sachsen', 'Saxony'),
    ('15', 'Sachsen-Anhalt', 'Saxony-Anhalt'),
    ('16', 'Thüringen', 'Thuringia')
)
select
  municipality.city_key,
  region.relation_id as state_relation_id,
  coalesce(region.name, fallback.name_de) as state_name_de,
  coalesce(nullif(region.name_en, ''), fallback.name_en, region.name, fallback.name_de) as state_name_en,
  district.relation_id as district_relation_id,
  district.name as district_name_de,
  coalesce(nullif(district.name_en, ''), district.name) as district_name_en,
  municipality.area_m2 as municipality_area_m2,
  district.area_m2 as district_area_m2
from osm_import.municipalities municipality
left join state_names fallback
  on fallback.state_code = left(municipality.official_code, 2)
left join lateral (
  select boundary.relation_id, boundary.name, boundary.name_en
  from osm_import.admin_area_boundaries boundary
  where boundary.admin_level = '4'
    and boundary.is_german_state
    and boundary.geom && municipality.center
    and extensions.st_covers(boundary.geom, municipality.center)
    and boundary.area_m2 >= municipality.area_m2 * 0.99
  order by boundary.area_m2, boundary.relation_id
  limit 1
) region on true
left join lateral (
  select
    boundary.relation_id,
    boundary.name,
    boundary.name_en,
    boundary.area_m2
  from osm_import.admin_area_boundaries boundary
  where boundary.admin_level = '6'
    and boundary.relation_id <> municipality.relation_id
    and boundary.geom && municipality.center
    and extensions.st_covers(boundary.geom, municipality.center)
    and boundary.area_m2 >= municipality.area_m2 * 0.99
  order by boundary.area_m2, boundary.relation_id
  limit 1
) district on true;

create unique index municipality_admin_areas_city_key_key
  on osm_import.municipality_admin_areas (city_key);
analyze osm_import.municipality_admin_areas;

do $$
begin
  if (select count(*) from osm_import.municipality_admin_areas) <> 10941 then
    raise exception 'Admin-area mapping is incomplete; expected exactly 10941 rows';
  end if;
  if exists (
    select 1 from osm_import.municipality_admin_areas
    where state_name_de is null
      or state_name_en is null
      or length(btrim(state_name_de)) = 0
      or length(btrim(state_name_en)) = 0
  ) then
    raise exception 'Admin-area mapping is missing a state label';
  end if;
  if exists (
    select 1 from osm_import.municipality_admin_areas
    where (district_name_de is null) <> (district_name_en is null)
       or district_name_de is not null and length(btrim(district_name_de)) = 0
       or district_name_en is not null and length(btrim(district_name_en)) = 0
  ) then
    raise exception 'Admin-area district labels are incomplete';
  end if;
  if exists (
    select 1 from osm_import.municipality_admin_areas
    where district_relation_id is not null
      and district_area_m2 < municipality_area_m2 * 0.99
  ) then
    raise exception 'Admin-area mapping selected a child boundary as a district';
  end if;
  if exists (
    select 1
    from osm_import.municipality_admin_areas admin_area
    where admin_area.city_key = any(array[
      '02000000', '04011000', '04012000', '11000000'
    ])
      and admin_area.district_relation_id is not null
  ) then
    raise exception 'A city-state municipality incorrectly inherited a child district';
  end if;
end
$$;

drop table if exists osm_import.city_parts;
create unlogged table osm_import.city_parts as
select
  municipality.city_key,
  (extensions.st_dump(extensions.st_subdivide(municipality.bounds, 256))).geom::extensions.geometry(Polygon, 4326) as geom
from osm_import.municipalities municipality;

create index city_parts_geom_gix on osm_import.city_parts using gist (geom);
create index city_parts_city_key_idx on osm_import.city_parts (city_key);
analyze osm_import.city_parts;
analyze osm_import.road_segments;

drop table if exists osm_import.road_city_segments;
create unlogged table osm_import.road_city_segments as
select
  part.city_key,
  road.way_id,
  btrim(road.name) as name,
  public.normalize_street_name(road.name) as normalized_name,
  road.highway,
  road.access,
  road.motor_vehicle,
  road.service,
  road.junction,
  (
    road.highway = any(array[
      'trunk', 'trunk_link',
      'primary', 'primary_link',
      'secondary', 'secondary_link',
      'tertiary', 'tertiary_link',
      'unclassified', 'residential', 'living_street', 'pedestrian'
    ])
    and coalesce(road.access, '') <> all(array['private', 'no'])
    and coalesce(road.motor_vehicle, '') <> 'private'
  ) as segment_playable,
  extensions.st_length(clipped.geom::extensions.geography) as length_m,
  clipped.geom
from osm_import.city_parts part
join osm_import.road_segments road
  on road.geom && part.geom
  and road.geom is not null
  and road.name is not null
  and length(btrim(road.name)) > 0
  and extensions.st_intersects(road.geom, part.geom)
cross join lateral (
  select extensions.st_multi(
    extensions.st_collectionextract(
      extensions.st_intersection(road.geom, part.geom),
      2
    )
  )::extensions.geometry(MultiLineString, 4326) as geom
) clipped
where not extensions.st_isempty(clipped.geom)
  and length(public.normalize_street_name(road.name)) > 0
  and extensions.st_length(clipped.geom::extensions.geography) > 0.05;

create index road_city_segments_city_name_idx
  on osm_import.road_city_segments (city_key, normalized_name);
create index road_city_segments_geom_gix
  on osm_import.road_city_segments using gist (geom);
analyze osm_import.road_city_segments;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from osm_import.road_city_segments;
  if v_count <> 4289037 then
    raise exception 'Pinned clipped road-segment count differs: %/4289037', v_count;
  end if;
end
$$;

drop table if exists osm_import.street_rollup;
create unlogged table osm_import.street_rollup as
with grouped as (
  select
    segment.city_key,
    segment.normalized_name,
    min(segment.name collate "C") as name,
    array_agg(distinct segment.way_id order by segment.way_id) as osm_ids,
    array_agg(distinct segment.highway order by segment.highway) as highway_types,
    array_agg(distinct segment.highway order by segment.highway)
      filter (where segment.segment_playable) as playable_highway_types,
    round(sum(segment.length_m::numeric), 6)::double precision as length_m,
    round(
      sum(segment.length_m::numeric) filter (where segment.segment_playable),
      6
    )::double precision as playable_length_m,
    bool_or(segment.segment_playable) as is_playable,
    bool_or(segment.highway <> all(array[
      'trunk', 'trunk_link',
      'primary', 'primary_link',
      'secondary', 'secondary_link',
      'tertiary', 'tertiary_link',
      'unclassified', 'residential', 'living_street', 'pedestrian'
    ])) as has_unsupported_highway,
    bool_or(coalesce(segment.access, '') = any(array['private', 'no'])) as has_restricted_access,
    bool_or(coalesce(segment.motor_vehicle, '') = 'private') as has_private_motor_vehicle,
    extensions.st_multi(
      extensions.st_collectionextract(extensions.st_collect(
        segment.geom
        order by
          segment.way_id,
          segment.length_m,
          extensions.st_asewkb(segment.geom)
      ), 2)
    )::extensions.geometry(MultiLineString, 4326) as all_geom,
    extensions.st_multi(
      extensions.st_collectionextract(
        extensions.st_collect(
          segment.geom
          order by
            segment.way_id,
            segment.length_m,
            extensions.st_asewkb(segment.geom)
        ) filter (where segment.segment_playable),
        2
      )
    )::extensions.geometry(MultiLineString, 4326) as playable_geom
  from osm_import.road_city_segments segment
  group by segment.city_key, segment.normalized_name
)
select
  grouped.city_key,
  grouped.name,
  grouped.normalized_name,
  grouped.osm_ids,
  grouped.highway_types,
  grouped.length_m as source_length_m,
  grouped.playable_length_m,
  greatest(
    case when grouped.is_playable then grouped.playable_length_m else grouped.length_m end,
    0.01
  ) as length_m,
  public.classify_difficulty(
    case
      when grouped.is_playable then grouped.playable_highway_types
      else grouped.highway_types
    end,
    case
      when grouped.is_playable then grouped.playable_length_m
      else grouped.length_m
    end
  ) as difficulty,
  grouped.is_playable,
  case
    when grouped.is_playable then array[]::text[]
    else array['no-playable-segment']::text[]
      || case when grouped.has_unsupported_highway then array['unsupported-highway'] else array[]::text[] end
      || case when grouped.has_restricted_access then array['restricted-access'] else array[]::text[] end
      || case when grouped.has_private_motor_vehicle then array['private-motor-vehicle'] else array[]::text[] end
  end as exclusion_reasons,
  case when grouped.is_playable then grouped.playable_geom else grouped.all_geom end as geom
from grouped
where (case when grouped.is_playable then grouped.playable_geom else grouped.all_geom end) is not null
  and not extensions.st_isempty(
    case when grouped.is_playable then grouped.playable_geom else grouped.all_geom end
  )
  and extensions.st_isvalid(
    case when grouped.is_playable then grouped.playable_geom else grouped.all_geom end
  );

create unique index street_rollup_city_name_key
  on osm_import.street_rollup (city_key, normalized_name);
analyze osm_import.street_rollup;

do $$
declare
  v_grouped bigint;
  v_playable bigint;
  v_target_geometry_mismatches bigint;
begin
  select count(*), count(*) filter (where is_playable)
  into v_grouped, v_playable
  from osm_import.street_rollup;

  if v_grouped <> 1324020 then
    raise exception 'Pinned grouped-street count differs: %/1324020', v_grouped;
  end if;
  if v_playable <> 1124492 then
    raise exception 'Pinned playable-street count differs: %/1124492', v_playable;
  end if;
  if exists (
    select 1 from osm_import.street_rollup
    where length_m is distinct from round(length_m::numeric, 6)::double precision
      or playable_length_m is not null
        and playable_length_m is distinct from
          round(playable_length_m::numeric, 6)::double precision
  ) then
    raise exception 'Street rollup lengths are not normalized to six decimal places';
  end if;

  select count(*) into v_target_geometry_mismatches
  from osm_import.street_rollup street
  where street.is_playable
    and (
      street.playable_length_m is null
      or abs(street.length_m - street.playable_length_m) > 0.01
      or abs(
        extensions.st_length(street.geom::extensions.geography)
          - street.playable_length_m
      ) > 0.1
    );

  if v_target_geometry_mismatches <> 0 then
    raise exception
      'Playable rollups include non-target geometry or omit playable geometry: % mismatches',
      v_target_geometry_mismatches;
  end if;
end
$$;

begin;

with matched as (
  select distinct on (city.id)
    city.id as city_id,
    municipality.*
  from public.cities city
  join osm_import.municipalities municipality
    on city.official_code = municipality.official_code
    or city.osm_relation_id = municipality.relation_id
    or (
      city.wikidata_id is not null
      and city.wikidata_id = municipality.wikidata_id
    )
    or (
      city.featured
      and exists (
        select 1
        from public.city_translations translation
        where translation.city_id = city.id
          and translation.locale = 'de'
          and translation.name = municipality.name_de
      )
    )
  order by city.id,
    (city.official_code = municipality.official_code) desc,
    (city.osm_relation_id = municipality.relation_id) desc,
    (city.wikidata_id = municipality.wikidata_id) desc
)
update public.cities city
set center = matched.center,
    bounds = matched.bounds,
    bounds_bbox = array[
      extensions.st_xmin(extensions.box3d(matched.bounds)),
      extensions.st_ymin(extensions.box3d(matched.bounds)),
      extensions.st_xmax(extensions.box3d(matched.bounds)),
      extensions.st_ymax(extensions.box3d(matched.bounds))
    ]::double precision[],
    official_code = matched.official_code,
    osm_relation_id = matched.relation_id,
    wikidata_id = coalesce(matched.wikidata_id, city.wikidata_id),
    admin_level = matched.admin_level,
    settlement_type = matched.settlement_type,
    population = matched.population,
    enabled = true,
    source_updated_at = :'snapshot_date'::timestamptz,
    source = jsonb_build_object(
      'provider', 'OpenStreetMap',
      'dataset', :'snapshot_url',
      'checksumMd5', :'snapshot_md5',
      'relationId', matched.relation_id,
      'officialCode', matched.official_code,
      'place', matched.relation_place,
      'dePlace', matched.de_place,
      'attribution', '© OpenStreetMap contributors',
      'license', 'ODbL 1.0',
      'copyrightUrl', 'https://www.openstreetmap.org/copyright'
    )
from matched
where city.id = matched.city_id
  and (
    not extensions.st_equals(city.center, matched.center)
    or not extensions.st_equals(city.bounds, matched.bounds)
    or city.bounds_bbox is distinct from array[
      extensions.st_xmin(extensions.box3d(matched.bounds)),
      extensions.st_ymin(extensions.box3d(matched.bounds)),
      extensions.st_xmax(extensions.box3d(matched.bounds)),
      extensions.st_ymax(extensions.box3d(matched.bounds))
    ]::double precision[]
    or city.official_code is distinct from matched.official_code
    or city.osm_relation_id is distinct from matched.relation_id
    or city.wikidata_id is distinct from coalesce(matched.wikidata_id, city.wikidata_id)
    or city.admin_level is distinct from matched.admin_level
    or city.settlement_type is distinct from matched.settlement_type
    or city.population is distinct from matched.population
    or not city.enabled
    or city.source_updated_at is distinct from :'snapshot_date'::timestamptz
    or city.source is distinct from jsonb_build_object(
      'provider', 'OpenStreetMap',
      'dataset', :'snapshot_url',
      'checksumMd5', :'snapshot_md5',
      'relationId', matched.relation_id,
      'officialCode', matched.official_code,
      'place', matched.relation_place,
      'dePlace', matched.de_place,
      'attribution', '© OpenStreetMap contributors',
      'license', 'ODbL 1.0',
      'copyrightUrl', 'https://www.openstreetmap.org/copyright'
    )
  );

insert into public.cities (
  country_id,
  slug,
  center,
  bounds,
  bounds_bbox,
  enabled,
  official_code,
  osm_relation_id,
  wikidata_id,
  admin_level,
  settlement_type,
  population,
  featured,
  source_updated_at,
  source
)
select
  country.id,
  municipality.generated_slug,
  municipality.center,
  municipality.bounds,
  array[
    extensions.st_xmin(extensions.box3d(municipality.bounds)),
    extensions.st_ymin(extensions.box3d(municipality.bounds)),
    extensions.st_xmax(extensions.box3d(municipality.bounds)),
    extensions.st_ymax(extensions.box3d(municipality.bounds))
  ]::double precision[],
  true,
  municipality.official_code,
  municipality.relation_id,
  municipality.wikidata_id,
  municipality.admin_level,
  municipality.settlement_type,
  municipality.population,
  false,
  :'snapshot_date'::timestamptz,
  jsonb_build_object(
    'provider', 'OpenStreetMap',
    'dataset', :'snapshot_url',
    'checksumMd5', :'snapshot_md5',
    'relationId', municipality.relation_id,
    'officialCode', municipality.official_code,
    'place', municipality.relation_place,
    'dePlace', municipality.de_place,
    'attribution', '© OpenStreetMap contributors',
    'license', 'ODbL 1.0',
    'copyrightUrl', 'https://www.openstreetmap.org/copyright'
  )
from osm_import.municipalities municipality
join public.countries country on country.code = 'DE'
where not exists (
  select 1
  from public.cities city
  where city.official_code = municipality.official_code
    or city.osm_relation_id = municipality.relation_id
    or (
      municipality.wikidata_id is not null
      and city.wikidata_id = municipality.wikidata_id
    )
)
on conflict (official_code) where official_code is not null do update
set center = excluded.center,
    bounds = excluded.bounds,
    bounds_bbox = excluded.bounds_bbox,
    osm_relation_id = excluded.osm_relation_id,
    wikidata_id = coalesce(excluded.wikidata_id, public.cities.wikidata_id),
    admin_level = excluded.admin_level,
    settlement_type = excluded.settlement_type,
    population = excluded.population,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    source = excluded.source
where not extensions.st_equals(public.cities.center, excluded.center)
   or not extensions.st_equals(public.cities.bounds, excluded.bounds)
   or public.cities.bounds_bbox is distinct from excluded.bounds_bbox
   or public.cities.osm_relation_id is distinct from excluded.osm_relation_id
   or public.cities.wikidata_id is distinct from coalesce(
     excluded.wikidata_id,
     public.cities.wikidata_id
   )
   or public.cities.admin_level is distinct from excluded.admin_level
   or public.cities.settlement_type is distinct from excluded.settlement_type
   or public.cities.population is distinct from excluded.population
   or not public.cities.enabled
   or public.cities.source_updated_at is distinct from excluded.source_updated_at
   or public.cities.source is distinct from excluded.source;

drop table if exists osm_import.city_map;
create table osm_import.city_map as
select municipality.city_key, city.id as city_id
from osm_import.municipalities municipality
join public.cities city on city.official_code = municipality.official_code;

create unique index city_map_city_key_key on osm_import.city_map (city_key);
create unique index city_map_city_id_key on osm_import.city_map (city_id);

do $$
begin
  if (select count(*) from osm_import.city_map) <> 10941 then
    raise exception 'City mapping is incomplete; expected exactly 10941 rows';
  end if;
end
$$;

update public.cities city
set enabled = false,
    source = city.source || jsonb_build_object('stale', true)
from public.countries country
where city.country_id = country.id
  and country.code = 'DE'
  and city.source->>'provider' = 'OpenStreetMap'
  and not city.featured
  and not exists (
    select 1 from osm_import.city_map city_map where city_map.city_id = city.id
  )
  and (
    city.enabled
    or city.source->>'stale' is distinct from 'true'
  );

insert into public.city_translations (city_id, locale, name)
select city_map.city_id, translation.locale, translation.name
from osm_import.municipalities municipality
join osm_import.city_map city_map using (city_key)
cross join lateral (
  values
    ('de'::public.locale, municipality.name_de),
    ('en'::public.locale, municipality.name_en)
) translation(locale, name)
on conflict (city_id, locale) do update set name = excluded.name
where public.city_translations.name is distinct from excluded.name;

insert into public.city_admin_area_translations (
  city_id,
  locale,
  state_name,
  district_name
)
select
  city_map.city_id,
  localized.locale,
  localized.state_name,
  localized.district_name
from osm_import.city_map city_map
join osm_import.municipality_admin_areas admin_area using (city_key)
cross join lateral (
  values
    ('de'::public.locale, admin_area.state_name_de, admin_area.district_name_de),
    ('en'::public.locale, admin_area.state_name_en, admin_area.district_name_en)
) localized(locale, state_name, district_name)
on conflict (city_id, locale) do update
set state_name = excluded.state_name,
    district_name = excluded.district_name
where public.city_admin_area_translations.state_name is distinct from excluded.state_name
   or public.city_admin_area_translations.district_name is distinct from excluded.district_name;

update private.streets street
set is_playable = false,
    exclusion_reasons = case
      when street.source->>'kind' = 'synthetic-demo'
        then array['synthetic-replaced-by-osm']::text[]
      else array['not-in-current-snapshot']::text[]
    end
from public.cities city
join public.countries country on country.id = city.country_id
where street.city_id = city.id
  and country.code = 'DE'
  and (
    street.source->>'kind' = 'synthetic-demo'
    or not exists (
      select 1
      from osm_import.city_map current_city
      join osm_import.street_rollup current_street
        on current_street.city_key = current_city.city_key
      where current_city.city_id = street.city_id
        and current_street.normalized_name = street.normalized_name
    )
  )
  and (
    street.is_playable
    or street.exclusion_reasons <> case
      when street.source->>'kind' = 'synthetic-demo'
        then array['synthetic-replaced-by-osm']::text[]
      else array['not-in-current-snapshot']::text[]
    end
  );

insert into private.streets (
  city_id,
  name,
  normalized_name,
  osm_ids,
  highway_types,
  length_m,
  difficulty,
  geom,
  imported_at,
  source_updated_at,
  source,
  is_playable,
  exclusion_reasons
)
select
  city_map.city_id,
  street.name,
  street.normalized_name,
  street.osm_ids,
  street.highway_types,
  street.length_m,
  street.difficulty,
  street.geom,
  statement_timestamp(),
  :'snapshot_date'::timestamptz,
  jsonb_build_object(
    'provider', 'OpenStreetMap',
    'dataset', :'snapshot_url',
    'checksumMd5', :'snapshot_md5',
    'attribution', '© OpenStreetMap contributors',
    'license', 'ODbL 1.0',
    'copyrightUrl', 'https://www.openstreetmap.org/copyright',
    'clippedToMunicipality', true,
    'allNamedHighwaysWithinMunicipalityStaged', true,
    'sourceHighwayTypesIncludeExcluded', true,
    'targetGeometryPlayableSegmentsOnly', true,
    'rollupAlgorithm', 'stable-ordered-numeric-v1'
  ),
  street.is_playable,
  street.exclusion_reasons
from osm_import.street_rollup street
join osm_import.city_map city_map using (city_key)
on conflict (city_id, normalized_name) do update
set name = excluded.name,
    osm_ids = excluded.osm_ids,
    highway_types = excluded.highway_types,
    length_m = excluded.length_m,
    difficulty = excluded.difficulty,
    geom = excluded.geom,
    imported_at = excluded.imported_at,
    source_updated_at = excluded.source_updated_at,
    source = excluded.source,
    is_playable = excluded.is_playable,
    exclusion_reasons = excluded.exclusion_reasons
where private.streets.source_updated_at is distinct from excluded.source_updated_at
   or private.streets.name is distinct from excluded.name
   or private.streets.osm_ids is distinct from excluded.osm_ids
   or private.streets.highway_types is distinct from excluded.highway_types
   or private.streets.length_m is distinct from excluded.length_m
   or private.streets.difficulty is distinct from excluded.difficulty
   or not extensions.st_equals(private.streets.geom, excluded.geom)
   or private.streets.source is distinct from excluded.source
   or private.streets.is_playable is distinct from excluded.is_playable
   or private.streets.exclusion_reasons is distinct from excluded.exclusion_reasons;

do $$
declare
  v_osm_cities bigint;
  v_enabled_de_cities bigint;
  v_active_fallback_cities bigint;
  v_osm_streets bigint;
  v_playable_streets bigint;
  v_admin_translations bigint;
begin
  select count(*) into v_osm_cities
  from public.cities
  where source->>'dataset' = current_setting('roadhunt_import.snapshot_url')
    and enabled;

  select
    count(*),
    count(*) filter (where city.official_code like 'osm-r%')
  into v_enabled_de_cities, v_active_fallback_cities
  from public.cities city
  join public.countries country on country.id = city.country_id
  where country.code = 'DE' and city.enabled;

  select count(*), count(*) filter (where is_playable)
  into v_osm_streets, v_playable_streets
  from private.streets street
  join public.cities city on city.id = street.city_id
  where street.source->>'dataset' = current_setting('roadhunt_import.snapshot_url')
    and city.enabled;

  select count(*) into v_admin_translations
  from public.city_admin_area_translations admin_area
  join public.cities city on city.id = admin_area.city_id
  join public.countries country on country.id = city.country_id
  where country.code = 'DE' and city.enabled;

  if v_osm_cities <> 10941 then
    raise exception 'Published OSM city count differs: %/10941', v_osm_cities;
  end if;
  if v_enabled_de_cities <> 10941 or v_active_fallback_cities <> 0 then
    raise exception 'Published DE catalog differs: enabled %/10941, fallback %/0',
      v_enabled_de_cities, v_active_fallback_cities;
  end if;
  if v_osm_streets <> 1324020 or v_playable_streets <> 1124492 then
    raise exception 'Published street counts differ: grouped %/1324020, playable %/1124492',
      v_osm_streets, v_playable_streets;
  end if;
  if v_admin_translations <> 21882 then
    raise exception 'Published admin-area translation count differs: %/21882', v_admin_translations;
  end if;
  if exists (
    select 1
    from public.cities city
    join public.countries country on country.id = city.country_id
    where city.enabled
      and country.code = 'DE'
      and not exists (
        select 1
        from public.city_admin_area_translations admin_area
        where admin_area.city_id = city.id
          and admin_area.locale = 'de'
      )
  ) or exists (
    select 1
    from public.cities city
    join public.countries country on country.id = city.country_id
    where city.enabled
      and country.code = 'DE'
      and not exists (
        select 1
        from public.city_admin_area_translations admin_area
        where admin_area.city_id = city.id
          and admin_area.locale = 'en'
      )
  ) then
    raise exception 'An enabled city is missing a de/en admin-area translation';
  end if;
  if exists (
    select 1 from public.cities
    where source->>'dataset' = current_setting('roadhunt_import.snapshot_url')
      and (
        bounds is null
        or not extensions.st_isvalid(bounds)
        or bounds_bbox is distinct from array[
          extensions.st_xmin(extensions.box3d(bounds)),
          extensions.st_ymin(extensions.box3d(bounds)),
          extensions.st_xmax(extensions.box3d(bounds)),
          extensions.st_ymax(extensions.box3d(bounds))
        ]::double precision[]
      )
  ) or exists (
    select 1 from private.streets
    where source->>'dataset' = current_setting('roadhunt_import.snapshot_url')
      and (geom is null or not extensions.st_isvalid(geom))
  ) then
    raise exception 'Published OSM catalog contains invalid geometry';
  end if;
end
$$;

commit;

analyze public.cities;
analyze public.city_translations;
analyze public.city_admin_area_translations;
analyze private.streets;

\ir verify.sql
