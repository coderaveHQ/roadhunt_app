alter table public.cities
  add column featured_order smallint;

with launch_city (slug, featured_order) as (
  values
    ('berlin', 1),
    ('hamburg', 2),
    ('munich', 3),
    ('cologne', 4),
    ('frankfurt', 5),
    ('duesseldorf', 6),
    ('stuttgart', 7),
    ('leipzig', 8),
    ('solingen', 9),
    ('duisburg', 10),
    ('moers', 11),
    ('wuppertal', 12)
)
update public.cities city
set featured_order = launch_city.featured_order
from launch_city
where city.slug = launch_city.slug
  and city.featured;

alter table public.cities
  add constraint cities_featured_order_check check (
    (featured and featured_order is not null and featured_order > 0)
    or (not featured and featured_order is null)
  );

drop index public.cities_catalog_order_idx;
create index cities_catalog_order_idx
  on public.cities (country_id, featured_order, slug)
  where enabled;
create unique index cities_featured_order_key
  on public.cities (country_id, featured_order)
  where featured_order is not null;

create function private.normalize_catalog_search(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(
    translate(
      replace(lower(btrim(p_value)), 'ß', 'ss'),
      'äöü',
      'aou'
    ),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

create function private.build_catalog(
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
  ), ranked_candidates as (
    select
      city.*,
      coalesce(city_t.name, city.slug) as display_name,
      row_number() over (
        order by
          case when parameters.normalized_query = '' then city.featured_order end,
          case when parameters.normalized_query <> ''
            then lower(coalesce(city_t.name, city.slug)) collate "und-x-icu"
          end,
          city.slug
      ) as result_order
    from public.cities city
    left join public.city_translations city_t
      on city_t.city_id = city.id and city_t.locale = p_locale
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
            or exists (
              select 1
              from public.city_translations search_translation
              where search_translation.city_id = city.id
                and private.normalize_catalog_search(search_translation.name)
                  like '%' || parameters.normalized_query || '%'
            )
          )
        )
      )
  ), candidates as (
    select ranked.*
    from ranked_candidates ranked
    cross join search_parameters parameters
    where ranked.result_order <= parameters.result_limit
  ), street_counts as (
    select
      s.city_id,
      count(*) filter (where s.difficulty = 'easy') as easy_count,
      count(*) filter (where s.difficulty = 'medium') as medium_count,
      count(*) filter (where s.difficulty = 'hard') as hard_count,
      count(*) filter (where s.difficulty = 'insane') as insane_count
    from private.streets s
    join candidates candidate on candidate.id = s.city_id
    where s.is_playable
    group by s.city_id
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
          'bounds', jsonb_build_array(
            extensions.st_xmin(extensions.box3d(city.bounds)),
            extensions.st_ymin(extensions.box3d(city.bounds)),
            extensions.st_xmax(extensions.box3d(city.bounds)),
            extensions.st_ymax(extensions.box3d(city.bounds))
          ),
          'difficultyCounts', jsonb_build_object(
            'easy', coalesce(counts.easy_count, 0),
            'medium', coalesce(counts.medium_count, 0),
            'hard', coalesce(counts.hard_count, 0),
            'insane', coalesce(counts.insane_count, 0)
          ),
          'settlementType', city.settlement_type,
          'population', city.population,
          'featured', city.featured
        ) order by city.result_order
      ) as cities
    from candidates city
    left join street_counts counts on counts.city_id = city.id
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

create function public.search_catalog(
  p_locale public.locale default 'de',
  p_query text default null,
  p_limit integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.build_catalog(p_locale, p_query, p_limit);
$$;

create or replace function public.list_catalog(p_locale public.locale default 'de')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.build_catalog(p_locale, null, 12);
$$;

revoke execute on function private.normalize_catalog_search(text)
  from public, anon, authenticated;
revoke execute on function private.build_catalog(public.locale, text, integer)
  from public, anon, authenticated;
revoke execute on function public.list_catalog(public.locale)
  from public, anon, authenticated;
revoke execute on function public.search_catalog(public.locale, text, integer)
  from public, anon, authenticated;

grant execute on function public.list_catalog(public.locale) to service_role;
grant execute on function public.search_catalog(public.locale, text, integer) to service_role;
