create table public.city_admin_area_translations (
  city_id uuid not null references public.cities (id) on delete cascade,
  locale public.locale not null,
  state_name text not null check (length(btrim(state_name)) > 0),
  district_name text check (district_name is null or length(btrim(district_name)) > 0),
  primary key (city_id, locale)
);

alter table public.city_admin_area_translations enable row level security;

create policy "public can read admin areas for enabled cities"
  on public.city_admin_area_translations for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.cities
      where cities.id = city_admin_area_translations.city_id
        and cities.enabled
    )
  );

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
insert into public.city_admin_area_translations (
  city_id,
  locale,
  state_name,
  district_name
)
select
  city.id,
  localized.locale,
  localized.state_name,
  null
from public.cities city
join state_names state on state.state_code = left(city.official_code, 2)
cross join lateral (
  values
    ('de'::public.locale, state.name_de),
    ('en'::public.locale, state.name_en)
) localized(locale, state_name)
where city.enabled
on conflict (city_id, locale) do update
set state_name = excluded.state_name,
    district_name = excluded.district_name
where public.city_admin_area_translations.state_name is distinct from excluded.state_name
   or public.city_admin_area_translations.district_name is distinct from excluded.district_name;

revoke all on public.countries, public.country_translations, public.cities,
  public.city_translations, public.city_admin_area_translations
  from public, anon, authenticated;
grant select on public.countries, public.country_translations, public.cities,
  public.city_translations, public.city_admin_area_translations
  to anon, authenticated;
grant all on public.countries, public.country_translations, public.cities,
  public.city_translations, public.city_admin_area_translations
  to service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;

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
      city.bounds,
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
