-- Dynamic Germany-wide catalog metadata and playability flags. This file is
-- mirrored byte-for-byte by 20260821000000_germany_catalog.sql.

alter table public.cities
  add column official_code text,
  add column osm_relation_id bigint,
  add column wikidata_id text,
  add column admin_level smallint,
  add column settlement_type text,
  add column population bigint,
  add column featured boolean not null default false,
  add column source_updated_at timestamptz,
  add column source jsonb not null default '{}'::jsonb,
  add constraint cities_official_code_format_check check (
    official_code is null or official_code ~ '^(?:[0-9]{8}|osm-r[0-9]+)$'
  ),
  add constraint cities_osm_relation_id_check check (
    osm_relation_id is null or osm_relation_id > 0
  ),
  add constraint cities_wikidata_id_format_check check (
    wikidata_id is null or wikidata_id ~ '^Q[0-9]+$'
  ),
  add constraint cities_admin_level_check check (
    admin_level is null or admin_level between 2 and 12
  ),
  add constraint cities_settlement_type_check check (
    settlement_type is null or char_length(settlement_type) between 1 and 64
  ),
  add constraint cities_population_check check (
    population is null or population >= 0
  ),
  add constraint cities_source_object_check check (jsonb_typeof(source) = 'object');

with launch_city (slug, wikidata_id, settlement_type) as (
  values
    ('berlin', 'Q64', 'city'),
    ('hamburg', 'Q1055', 'city'),
    ('munich', 'Q1726', 'city'),
    ('cologne', 'Q365', 'city'),
    ('frankfurt', 'Q1794', 'city'),
    ('duesseldorf', 'Q1718', 'city'),
    ('stuttgart', 'Q1022', 'city'),
    ('leipzig', 'Q2079', 'city'),
    ('solingen', 'Q2942', 'city'),
    ('duisburg', 'Q2100', 'city'),
    ('moers', 'Q3132', 'town'),
    ('wuppertal', 'Q2107', 'city')
)
update public.cities city
set featured = true,
    wikidata_id = launch_city.wikidata_id,
    settlement_type = launch_city.settlement_type
from launch_city
where city.slug = launch_city.slug;

create unique index cities_official_code_key
  on public.cities (official_code)
  where official_code is not null;
create unique index cities_osm_relation_id_key
  on public.cities (osm_relation_id)
  where osm_relation_id is not null;
create unique index cities_wikidata_id_key
  on public.cities (wikidata_id)
  where wikidata_id is not null;
create index cities_catalog_order_idx
  on public.cities (country_id, featured desc, slug)
  where enabled;

alter table private.streets
  add column is_playable boolean not null default true,
  add column exclusion_reasons text[] not null default '{}',
  add constraint streets_exclusion_reasons_no_null_check check (
    array_position(exclusion_reasons, null) is null
  ),
  add constraint streets_unplayable_has_reason_check check (
    is_playable or cardinality(exclusion_reasons) > 0
  );

drop index private.streets_city_difficulty_idx;
create index streets_playable_pool_idx
  on private.streets (city_id, difficulty)
  where is_playable;

create or replace function public.normalize_street_name(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        replace(
          translate(btrim(p_name), '‐‑‒–—―', '------'),
          'ß',
          'ss'
        ),
        '[[:space:]]*-[[:space:]]*',
        '-',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function private.populate_rounds(p_game_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_city_id uuid;
  v_difficulty public.difficulty;
  v_existing integer;
  v_inserted integer;
begin
  select g.city_id, g.difficulty
  into strict v_city_id, v_difficulty
  from private.games g
  where g.id = p_game_id;

  select count(*)
  into v_existing
  from private.game_rounds gr
  where gr.game_id = p_game_id;

  if v_existing = 10 then
    return;
  elsif v_existing <> 0 then
    raise exception using
      errcode = '55000',
      message = 'The game has an incomplete target set.';
  end if;

  insert into private.game_rounds (game_id, round_number, target_street_id)
  select
    p_game_id,
    row_number() over (order by selected.random_order)::smallint,
    selected.id
  from (
    select s.id, random() as random_order
    from private.streets s
    where s.city_id = v_city_id
      and s.difficulty = v_difficulty
      and s.is_playable
    order by random()
    limit 10
  ) selected;

  get diagnostics v_inserted = row_count;

  if v_inserted <> 10 then
    raise exception using
      errcode = 'P0001',
      message = 'This city and difficulty need at least ten target streets.';
  end if;
end;
$$;

create or replace function public.list_catalog(p_locale public.locale default 'de')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with street_counts as (
    select
      s.city_id,
      count(*) filter (where s.difficulty = 'easy') as easy_count,
      count(*) filter (where s.difficulty = 'medium') as medium_count,
      count(*) filter (where s.difficulty = 'hard') as hard_count,
      count(*) filter (where s.difficulty = 'insane') as insane_count
    from private.streets s
    where s.is_playable
    group by s.city_id
  ), cities_by_country as (
    select
      city.country_id,
      jsonb_agg(
        jsonb_build_object(
          'id', city.id,
          'slug', city.slug,
          'name', coalesce(city_t.name, city.slug),
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
        ) order by city.featured desc, coalesce(city_t.name, city.slug), city.slug
      ) as cities
    from public.cities city
    left join public.city_translations city_t
      on city_t.city_id = city.id and city_t.locale = p_locale
    left join street_counts counts on counts.city_id = city.id
    where city.enabled
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
  left join public.country_translations country_t
    on country_t.country_id = country.id and country_t.locale = p_locale
  left join cities_by_country catalog on catalog.country_id = country.id;
$$;

create or replace function public.create_game(
  p_mode public.game_mode,
  p_city_slug text,
  p_difficulty public.difficulty,
  p_nickname text,
  p_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_city_id uuid;
  v_player_id uuid;
  v_nickname text;
  v_now timestamptz := statement_timestamp();
begin
  perform private.assert_actor(p_user_id);
  v_nickname := private.validate_nickname(p_nickname);

  delete from private.games where expires_at <= v_now;

  select c.id
  into v_city_id
  from public.cities c
  where c.slug = lower(btrim(p_city_slug))
    and c.enabled;

  if v_city_id is null then
    raise exception using errcode = '22023', message = 'Unknown or disabled city.';
  end if;

  if (
    select count(*)
    from private.streets s
    where s.city_id = v_city_id
      and s.difficulty = p_difficulty
      and s.is_playable
  ) < 10 then
    raise exception using
      errcode = 'P0001',
      message = 'This city and difficulty need at least ten target streets.';
  end if;

  insert into private.games (mode, city_id, difficulty, lobby_code, expires_at)
  values (
    p_mode,
    v_city_id,
    p_difficulty,
    case when p_mode = 'lobby' then private.generate_lobby_code() else null end,
    case when p_mode = 'lobby' then v_now + interval '6 hours' else v_now + interval '3 hours' end
  )
  returning id into v_game_id;

  insert into private.game_players (game_id, user_id, nickname, is_host)
  values (v_game_id, p_user_id, v_nickname, true)
  returning id into v_player_id;

  update private.games
  set host_player_id = v_player_id
  where id = v_game_id;

  if p_mode = 'solo' then
    perform private.start_game_internal(v_game_id, v_now);
  end if;

  return private.build_game_state(v_game_id, p_user_id);
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'Could not create a unique lobby. Please try again.';
end;
$$;

revoke execute on function public.normalize_street_name(text)
  from public, anon, authenticated;
grant execute on function public.normalize_street_name(text) to service_role;
