alter table public.cities
  add column bounds_bbox double precision[];

update public.cities
set bounds_bbox = array[
  extensions.st_xmin(extensions.box3d(bounds)),
  extensions.st_ymin(extensions.box3d(bounds)),
  extensions.st_xmax(extensions.box3d(bounds)),
  extensions.st_ymax(extensions.box3d(bounds))
]::double precision[];

alter table public.cities
  alter column bounds_bbox set not null,
  add constraint cities_bounds_bbox_check check (
    cardinality(bounds_bbox) = 4
    and bounds_bbox[1] between -180 and 180
    and bounds_bbox[2] between -90 and 90
    and bounds_bbox[3] between -180 and 180
    and bounds_bbox[4] between -90 and 90
    and bounds_bbox[1] <= bounds_bbox[3]
    and bounds_bbox[2] <= bounds_bbox[4]
  );

create or replace function private.build_catalog(
  p_locale public.locale,
  p_query text,
  p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with search_parameters as (
    select
      coalesce(private.normalize_catalog_search(nullif(btrim(p_query), '')), '') as normalized_query,
      greatest(1, least(coalesce(p_limit, 12), 50)) as result_limit
  ), translation_matches as materialized (
    select distinct translation.city_id
    from public.city_translations translation
    cross join search_parameters parameters
    where parameters.normalized_query <> ''
      and private.normalize_catalog_search(translation.name)
        like '%' || parameters.normalized_query || '%'
  ), matched_city_ids as materialized (
    select
      city.id,
      coalesce(city_t.name, city.slug) as display_name,
      case when parameters.normalized_query = '' then city.featured_order end as featured_sort,
      case when parameters.normalized_query <> ''
        then lower(coalesce(city_t.name, city.slug)) collate "und-x-icu"
      end as name_sort,
      city.slug
    from public.cities city
    left join public.city_translations city_t
      on city_t.city_id = city.id and city_t.locale = p_locale
    left join translation_matches translation_match on translation_match.city_id = city.id
    cross join search_parameters parameters
    where city.enabled
      and (
        (parameters.normalized_query = '' and city.featured)
        or (
          parameters.normalized_query <> ''
          and (
            private.normalize_catalog_search(city.slug)
              like '%' || parameters.normalized_query || '%'
            or private.normalize_catalog_search(coalesce(city.official_code, ''))
              like '%' || parameters.normalized_query || '%'
            or translation_match.city_id is not null
          )
        )
      )
    order by featured_sort, name_sort, city.slug
    limit (select result_limit from search_parameters)
  ), ordered_city_ids as (
    select
      matched.*,
      row_number() over (
        order by matched.featured_sort, matched.name_sort, matched.slug
      ) as result_order
    from matched_city_ids matched
  ), candidates as (
    select
      city.id,
      city.country_id,
      city.slug,
      city.center,
      city.bounds_bbox,
      city.settlement_type,
      city.population,
      city.featured,
      city.official_code,
      ordered.display_name,
      ordered.result_order
    from ordered_city_ids ordered
    join public.cities city on city.id = ordered.id
  ), street_counts as (
    select
      street.city_id,
      count(*) filter (where street.difficulty = 'easy') as easy_count,
      count(*) filter (where street.difficulty = 'medium') as medium_count,
      count(*) filter (where street.difficulty = 'hard') as hard_count,
      count(*) filter (where street.difficulty = 'insane') as insane_count
    from private.streets street
    join candidates candidate on candidate.id = street.city_id
    where street.is_playable
    group by street.city_id
  ), cities_by_country as (
    select
      city.country_id,
      jsonb_agg(
        jsonb_build_object(
          'id', city.id,
          'slug', city.slug,
          'name', city.display_name,
          'center', jsonb_build_array(
            extensions.st_x(city.center),
            extensions.st_y(city.center)
          ),
          'bounds', city.bounds_bbox,
          'difficultyCounts', jsonb_build_object(
            'easy', coalesce(counts.easy_count, 0),
            'medium', coalesce(counts.medium_count, 0),
            'hard', coalesce(counts.hard_count, 0),
            'insane', coalesce(counts.insane_count, 0)
          ),
          'settlementType', city.settlement_type,
          'population', city.population,
          'featured', city.featured,
          'adminArea', jsonb_build_object(
            'stateName', admin_area.state_name,
            'districtName', admin_area.district_name,
            'code', city.official_code
          )
        ) order by city.result_order
      ) as cities
    from candidates city
    left join street_counts counts on counts.city_id = city.id
    left join public.city_admin_area_translations admin_area
      on admin_area.city_id = city.id and admin_area.locale = p_locale
    group by city.country_id
  )
  select jsonb_build_object(
    'countries', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'code', country.code,
          'name', coalesce(country_t.name, country.code),
          'cities', coalesce(catalog.cities, '[]'::jsonb)
        ) order by coalesce(country_t.name, country.code), country.code
      ),
      '[]'::jsonb
    )
  )
  from public.countries country
  join cities_by_country catalog on catalog.country_id = country.id
  left join public.country_translations country_t
    on country_t.country_id = country.id and country_t.locale = p_locale;
$$;

revoke execute on function private.build_catalog(public.locale, text, integer)
  from public, anon, authenticated;
