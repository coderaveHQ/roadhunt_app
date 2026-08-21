-- Reproducible catalog and geometry fixtures for local development and previews.
-- The street rows are intentionally synthetic. Replace them with the OSM import
-- before production while preserving the same city slugs and difficulty pools.

insert into public.countries (id, code, default_locale)
values ('00000000-0000-4000-8000-000000000001', 'DE', 'de')
on conflict (code) do update
set default_locale = excluded.default_locale;

insert into public.country_translations (country_id, locale, name)
values
  ('00000000-0000-4000-8000-000000000001', 'de', 'Deutschland'),
  ('00000000-0000-4000-8000-000000000001', 'en', 'Germany')
on conflict (country_id, locale) do update
set name = excluded.name;

with city_data (
  id,
  slug,
  center_lng,
  center_lat,
  min_lng,
  min_lat,
  max_lng,
  max_lat
) as (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'berlin',       13.4050, 52.5200, 13.0884, 52.3383, 13.7611, 52.6755),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'hamburg',       9.9937, 53.5511,  9.7300, 53.3950, 10.3250, 53.7390),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'munich',       11.5820, 48.1351, 11.3600, 47.9800, 11.7220, 48.2490),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'cologne',       6.9603, 50.9375,  6.7720, 50.8290,  7.1620, 51.0850),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'frankfurt',     8.6821, 50.1109,  8.4720, 50.0150,  8.8000, 50.2280),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'duesseldorf',   6.7735, 51.2277,  6.6880, 51.1240,  6.9390, 51.3530),
    ('10000000-0000-4000-8000-000000000007'::uuid, 'stuttgart',     9.1829, 48.7758,  9.0380, 48.6920,  9.3160, 48.8660),
    ('10000000-0000-4000-8000-000000000008'::uuid, 'leipzig',      12.3731, 51.3397, 12.2360, 51.2350, 12.5420, 51.4490),
    ('10000000-0000-4000-8000-000000000009'::uuid, 'solingen',      7.0830, 51.1652,  6.9850, 51.1010,  7.1780, 51.2240),
    ('10000000-0000-4000-8000-000000000010'::uuid, 'duisburg',      6.7623, 51.4344,  6.6270, 51.3340,  6.8380, 51.5480),
    ('10000000-0000-4000-8000-000000000011'::uuid, 'moers',         6.6263, 51.4516,  6.5460, 51.3780,  6.7240, 51.5240),
    ('10000000-0000-4000-8000-000000000012'::uuid, 'wuppertal',     7.1508, 51.2562,  7.0000, 51.1650,  7.3130, 51.3460)
)
insert into public.cities (
  id,
  country_id,
  slug,
  center,
  bounds,
  bounds_bbox,
  enabled
)
select
  id,
  '00000000-0000-4000-8000-000000000001',
  slug,
  extensions.st_setsrid(extensions.st_makepoint(center_lng, center_lat), 4326),
  extensions.st_multi(extensions.st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)),
  array[min_lng, min_lat, max_lng, max_lat]::double precision[],
  true
from city_data
on conflict (slug) do update
set center = excluded.center,
    bounds = excluded.bounds,
    bounds_bbox = excluded.bounds_bbox,
    enabled = true;

insert into public.city_translations (city_id, locale, name)
values
  ('10000000-0000-4000-8000-000000000001', 'de', 'Berlin'),
  ('10000000-0000-4000-8000-000000000001', 'en', 'Berlin'),
  ('10000000-0000-4000-8000-000000000002', 'de', 'Hamburg'),
  ('10000000-0000-4000-8000-000000000002', 'en', 'Hamburg'),
  ('10000000-0000-4000-8000-000000000003', 'de', 'München'),
  ('10000000-0000-4000-8000-000000000003', 'en', 'Munich'),
  ('10000000-0000-4000-8000-000000000004', 'de', 'Köln'),
  ('10000000-0000-4000-8000-000000000004', 'en', 'Cologne'),
  ('10000000-0000-4000-8000-000000000005', 'de', 'Frankfurt am Main'),
  ('10000000-0000-4000-8000-000000000005', 'en', 'Frankfurt'),
  ('10000000-0000-4000-8000-000000000006', 'de', 'Düsseldorf'),
  ('10000000-0000-4000-8000-000000000006', 'en', 'Düsseldorf'),
  ('10000000-0000-4000-8000-000000000007', 'de', 'Stuttgart'),
  ('10000000-0000-4000-8000-000000000007', 'en', 'Stuttgart'),
  ('10000000-0000-4000-8000-000000000008', 'de', 'Leipzig'),
  ('10000000-0000-4000-8000-000000000008', 'en', 'Leipzig'),
  ('10000000-0000-4000-8000-000000000009', 'de', 'Solingen'),
  ('10000000-0000-4000-8000-000000000009', 'en', 'Solingen'),
  ('10000000-0000-4000-8000-000000000010', 'de', 'Duisburg'),
  ('10000000-0000-4000-8000-000000000010', 'en', 'Duisburg'),
  ('10000000-0000-4000-8000-000000000011', 'de', 'Moers'),
  ('10000000-0000-4000-8000-000000000011', 'en', 'Moers'),
  ('10000000-0000-4000-8000-000000000012', 'de', 'Wuppertal'),
  ('10000000-0000-4000-8000-000000000012', 'en', 'Wuppertal')
on conflict (city_id, locale) do update
set name = excluded.name;

with featured_city_data (slug, official_code, wikidata_id, settlement_type, featured_order) as (
  values
    ('berlin', '11000000', 'Q64', 'city', 1),
    ('hamburg', '02000000', 'Q1055', 'city', 2),
    ('munich', '09162000', 'Q1726', 'city', 3),
    ('cologne', '05315000', 'Q365', 'city', 4),
    ('frankfurt', '06412000', 'Q1794', 'city', 5),
    ('duesseldorf', '05111000', 'Q1718', 'city', 6),
    ('stuttgart', '08111000', 'Q1022', 'city', 7),
    ('leipzig', '14713000', 'Q2079', 'city', 8),
    ('solingen', '05122000', 'Q2942', 'city', 9),
    ('duisburg', '05112000', 'Q2100', 'city', 10),
    ('moers', '05170024', 'Q3132', 'town', 11),
    ('wuppertal', '05124000', 'Q2107', 'city', 12)
)
update public.cities city
set official_code = featured.official_code,
    wikidata_id = featured.wikidata_id,
    settlement_type = featured.settlement_type,
    featured = true,
    featured_order = featured.featured_order,
    source_updated_at = '2026-08-20 00:00:00+00'::timestamptz,
    source = jsonb_build_object(
      'kind', 'catalog-seed',
      'wikidataId', featured.wikidata_id
    )
from featured_city_data featured
where city.slug = featured.slug;

with admin_area_data (slug, locale, state_name, district_name) as (
  values
    ('berlin', 'de'::public.locale, 'Berlin', null),
    ('berlin', 'en'::public.locale, 'Berlin', null),
    ('hamburg', 'de'::public.locale, 'Hamburg', null),
    ('hamburg', 'en'::public.locale, 'Hamburg', null),
    ('munich', 'de'::public.locale, 'Bayern', null),
    ('munich', 'en'::public.locale, 'Bavaria', null),
    ('cologne', 'de'::public.locale, 'Nordrhein-Westfalen', null),
    ('cologne', 'en'::public.locale, 'North Rhine-Westphalia', null),
    ('frankfurt', 'de'::public.locale, 'Hessen', null),
    ('frankfurt', 'en'::public.locale, 'Hesse', null),
    ('duesseldorf', 'de'::public.locale, 'Nordrhein-Westfalen', null),
    ('duesseldorf', 'en'::public.locale, 'North Rhine-Westphalia', null),
    ('stuttgart', 'de'::public.locale, 'Baden-Württemberg', null),
    ('stuttgart', 'en'::public.locale, 'Baden-Württemberg', null),
    ('leipzig', 'de'::public.locale, 'Sachsen', null),
    ('leipzig', 'en'::public.locale, 'Saxony', null),
    ('solingen', 'de'::public.locale, 'Nordrhein-Westfalen', null),
    ('solingen', 'en'::public.locale, 'North Rhine-Westphalia', null),
    ('duisburg', 'de'::public.locale, 'Nordrhein-Westfalen', null),
    ('duisburg', 'en'::public.locale, 'North Rhine-Westphalia', null),
    ('moers', 'de'::public.locale, 'Nordrhein-Westfalen', 'Kreis Wesel'),
    ('moers', 'en'::public.locale, 'North Rhine-Westphalia', 'Wesel District'),
    ('wuppertal', 'de'::public.locale, 'Nordrhein-Westfalen', null),
    ('wuppertal', 'en'::public.locale, 'North Rhine-Westphalia', null)
)
insert into public.city_admin_area_translations (
  city_id,
  locale,
  state_name,
  district_name
)
select city.id, admin.locale, admin.state_name, admin.district_name
from admin_area_data admin
join public.cities city on city.slug = admin.slug
on conflict (city_id, locale) do update
set state_name = excluded.state_name,
    district_name = excluded.district_name;

with city_order as (
  select
    c.id,
    c.slug,
    c.center,
    ct.name as city_name,
    row_number() over (order by c.id)::integer as city_number
  from public.cities c
  join public.city_translations ct on ct.city_id = c.id and ct.locale = 'de'
  where c.country_id = '00000000-0000-4000-8000-000000000001'
), difficulty_data (difficulty, difficulty_number, label, highway_type, length_m, longitude_span) as (
  values
    ('easy'::public.difficulty,   1, 'Easy',   'primary',       2800.0, 0.0400),
    ('medium'::public.difficulty, 2, 'Medium', 'tertiary',      1400.0, 0.0190),
    ('hard'::public.difficulty,   3, 'Hard',   'residential',    650.0, 0.0085),
    ('insane'::public.difficulty, 4, 'Insane', 'living_street',  220.0, 0.0030)
), generated as (
  select
    city.id as city_id,
    city.slug,
    city.city_name,
    city.city_number,
    city.center,
    difficulty.difficulty,
    difficulty.difficulty_number,
    difficulty.label,
    difficulty.highway_type,
    difficulty.length_m,
    difficulty.longitude_span,
    street_number
  from city_order city
  cross join difficulty_data difficulty
  cross join generate_series(1, 10) street_number
)
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
  source
)
select
  generated.city_id,
  format('%s Demo %s %s', generated.city_name, generated.label, lpad(generated.street_number::text, 2, '0')),
  public.normalize_street_name(
    format('%s Demo %s %s', generated.city_name, generated.label, lpad(generated.street_number::text, 2, '0'))
  ),
  array[(9000000000000 + generated.city_number * 1000 + generated.difficulty_number * 100 + generated.street_number)::bigint],
  array[generated.highway_type],
  generated.length_m,
  generated.difficulty,
  extensions.st_multi(
    extensions.st_makeline(
      extensions.st_setsrid(
        extensions.st_makepoint(
          extensions.st_x(generated.center) - generated.longitude_span / 2,
          extensions.st_y(generated.center)
            + (generated.street_number - 5.5) * 0.0035
            + (generated.difficulty_number - 2.5) * 0.0004
        ),
        4326
      ),
      extensions.st_setsrid(
        extensions.st_makepoint(
          extensions.st_x(generated.center) + generated.longitude_span / 2,
          extensions.st_y(generated.center)
            + (generated.street_number - 5.5) * 0.0035
            + (generated.difficulty_number - 2.5) * 0.0004
        ),
        4326
      )
    )
  ),
  '2026-08-20 00:00:00+00'::timestamptz,
  '2026-08-20 00:00:00+00'::timestamptz,
  jsonb_build_object(
    'kind', 'synthetic-demo',
    'citySlug', generated.slug,
    'attribution', '© OpenStreetMap contributors',
    'license', 'ODbL 1.0'
  )
from generated
on conflict (city_id, normalized_name) do update
set osm_ids = excluded.osm_ids,
    highway_types = excluded.highway_types,
    length_m = excluded.length_m,
    difficulty = excluded.difficulty,
    geom = excluded.geom,
    imported_at = excluded.imported_at,
    source_updated_at = excluded.source_updated_at,
    source = excluded.source;
