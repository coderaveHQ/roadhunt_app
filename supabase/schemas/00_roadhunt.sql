create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role, authenticated;

create type public.locale as enum ('de', 'en');
create type public.game_mode as enum ('solo', 'lobby');
create type public.difficulty as enum ('easy', 'medium', 'hard', 'insane');
create type public.game_status as enum ('waiting', 'playing', 'revealing', 'finished');
create type public.round_status as enum ('pending', 'playing', 'revealing', 'complete');

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

create table public.countries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{2}$'),
  default_locale public.locale not null default 'de',
  created_at timestamptz not null default now()
);

create table public.country_translations (
  country_id uuid not null references public.countries (id) on delete cascade,
  locale public.locale not null,
  name text not null check (length(btrim(name)) > 0),
  primary key (country_id, locale)
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references public.countries (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  center extensions.geometry(Point, 4326) not null,
  bounds extensions.geometry(MultiPolygon, 4326) not null,
  bounds_bbox double precision[] not null,
  enabled boolean not null default true,
  official_code text,
  osm_relation_id bigint,
  wikidata_id text,
  admin_level smallint,
  settlement_type text,
  population bigint,
  featured boolean not null default false,
  featured_order smallint,
  source_updated_at timestamptz,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cities_official_code_format_check check (
    official_code is null or official_code ~ '^(?:[0-9]{8}|osm-r[0-9]+)$'
  ),
  constraint cities_osm_relation_id_check check (
    osm_relation_id is null or osm_relation_id > 0
  ),
  constraint cities_wikidata_id_format_check check (
    wikidata_id is null or wikidata_id ~ '^Q[0-9]+$'
  ),
  constraint cities_admin_level_check check (
    admin_level is null or admin_level between 2 and 12
  ),
  constraint cities_settlement_type_check check (
    settlement_type is null or char_length(settlement_type) between 1 and 64
  ),
  constraint cities_population_check check (
    population is null or population >= 0
  ),
  constraint cities_featured_order_check check (
    (featured and featured_order is not null and featured_order > 0)
    or (not featured and featured_order is null)
  ),
  constraint cities_source_object_check check (jsonb_typeof(source) = 'object'),
  constraint cities_center_srid_check check (extensions.st_srid(center) = 4326),
  constraint cities_bounds_srid_check check (extensions.st_srid(bounds) = 4326),
  constraint cities_bounds_valid_check check (extensions.st_isvalid(bounds)),
  constraint cities_bounds_bbox_check check (
    cardinality(bounds_bbox) = 4
    and bounds_bbox[1] between -180 and 180
    and bounds_bbox[2] between -90 and 90
    and bounds_bbox[3] between -180 and 180
    and bounds_bbox[4] between -90 and 90
    and bounds_bbox[1] <= bounds_bbox[3]
    and bounds_bbox[2] <= bounds_bbox[4]
  )
);

create index cities_country_id_idx on public.cities (country_id);
create index cities_bounds_gix on public.cities using gist (bounds);
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
  on public.cities (country_id, featured_order, slug)
  where enabled;
create unique index cities_featured_order_key
  on public.cities (country_id, featured_order)
  where featured_order is not null;

create table public.city_translations (
  city_id uuid not null references public.cities (id) on delete cascade,
  locale public.locale not null,
  name text not null check (length(btrim(name)) > 0),
  search_name text generated always as (
    private.normalize_catalog_search(name)
  ) stored,
  primary key (city_id, locale)
);

create table public.city_admin_area_translations (
  city_id uuid not null references public.cities (id) on delete cascade,
  locale public.locale not null,
  state_name text not null check (length(btrim(state_name)) > 0),
  district_name text check (district_name is null or length(btrim(district_name)) > 0),
  primary key (city_id, locale)
);

create table private.streets (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  normalized_name text not null check (length(btrim(normalized_name)) > 0),
  osm_ids bigint[] not null default '{}',
  highway_types text[] not null default '{}',
  length_m double precision not null check (length_m > 0),
  difficulty public.difficulty not null,
  geom extensions.geometry(MultiLineString, 4326) not null,
  imported_at timestamptz not null default now(),
  source_updated_at timestamptz,
  source jsonb not null default '{}'::jsonb,
  is_playable boolean not null default true,
  exclusion_reasons text[] not null default '{}',
  constraint streets_city_normalized_name_key unique (city_id, normalized_name),
  constraint streets_exclusion_reasons_no_null_check check (
    array_position(exclusion_reasons, null) is null
  ),
  constraint streets_unplayable_has_reason_check check (
    is_playable or cardinality(exclusion_reasons) > 0
  ),
  constraint streets_geom_srid_check check (extensions.st_srid(geom) = 4326),
  constraint streets_geom_valid_check check (extensions.st_isvalid(geom))
);

create index streets_playable_pool_idx
  on private.streets (city_id, difficulty)
  where is_playable;
create index streets_geom_gix on private.streets using gist (geom);

create table private.games (
  id uuid primary key default gen_random_uuid(),
  mode public.game_mode not null,
  status public.game_status not null default 'waiting',
  city_id uuid not null references public.cities (id) on delete restrict,
  difficulty public.difficulty not null,
  lobby_code text,
  host_player_id uuid,
  rematch_of_game_id uuid references private.games (id) on delete set null,
  current_round_number smallint not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '6 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_lobby_code_format_check check (
    lobby_code is null or lobby_code ~ '^[2-9A-HJKMNP-Z]{6}$'
  ),
  constraint games_mode_lobby_code_check check (
    (mode = 'solo' and lobby_code is null)
    or (mode = 'lobby' and lobby_code is not null)
  ),
  constraint games_current_round_number_check check (current_round_number between 0 and 10),
  constraint games_timestamps_check check (
    (started_at is null or started_at >= created_at)
    and (finished_at is null or started_at is not null)
  )
);

create unique index games_lobby_code_key on private.games (lobby_code) where lobby_code is not null;
create unique index games_rematch_of_game_id_key
  on private.games (rematch_of_game_id)
  where rematch_of_game_id is not null;
create index games_expires_at_idx on private.games (expires_at);
create index games_city_difficulty_idx on private.games (city_id, difficulty);

create table private.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references private.games (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  nickname text not null check (
    char_length(btrim(nickname)) between 2 and 20
    and nickname !~ '[[:cntrl:]]'
  ),
  is_host boolean not null default false,
  total_score integer not null default 0 check (total_score between 0 and 10000),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  constraint game_players_left_after_join_check check (left_at is null or left_at >= joined_at)
);

create unique index game_players_active_user_key
  on private.game_players (game_id, user_id)
  where left_at is null;

create unique index game_players_active_nickname_key
  on private.game_players (game_id, lower(btrim(nickname)))
  where left_at is null;

create index game_players_user_id_idx on private.game_players (user_id);
create index game_players_game_joined_idx on private.game_players (game_id, joined_at);

alter table private.games
  add constraint games_host_player_id_fkey
  foreign key (host_player_id)
  references private.game_players (id)
  on delete set null
  deferrable initially deferred;

create index games_host_player_id_idx on private.games (host_player_id);

create table private.game_rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references private.games (id) on delete cascade,
  round_number smallint not null check (round_number between 1 and 10),
  target_street_id uuid not null references private.streets (id) on delete restrict,
  status public.round_status not null default 'pending',
  started_at timestamptz,
  ends_at timestamptz,
  revealed_at timestamptz,
  completed_at timestamptz,
  constraint game_rounds_game_number_key unique (game_id, round_number),
  constraint game_rounds_game_target_key unique (game_id, target_street_id),
  constraint game_rounds_timer_check check (
    (started_at is null and ends_at is null)
    or (started_at is not null and ends_at = started_at + interval '60 seconds')
  ),
  constraint game_rounds_reveal_check check (revealed_at is null or started_at is not null),
  constraint game_rounds_complete_check check (completed_at is null or revealed_at is not null)
);

create index game_rounds_game_status_idx on private.game_rounds (game_id, status);
create index game_rounds_target_street_id_idx on private.game_rounds (target_street_id);

create table private.guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references private.game_rounds (id) on delete cascade,
  player_id uuid not null references private.game_players (id) on delete cascade,
  location extensions.geometry(Point, 4326) not null,
  submitted_at timestamptz not null default now(),
  distance_m double precision not null check (distance_m >= 0),
  seconds_remaining double precision not null check (seconds_remaining between 0 and 60),
  score integer not null check (score between 0 and 1000),
  constraint guesses_round_player_key unique (round_id, player_id),
  constraint guesses_location_srid_check check (extensions.st_srid(location) = 4326)
);

create index guesses_player_id_idx on private.guesses (player_id);
create index guesses_location_gix on private.guesses using gist (location);

alter table public.countries enable row level security;
alter table public.country_translations enable row level security;
alter table public.cities enable row level security;
alter table public.city_translations enable row level security;
alter table public.city_admin_area_translations enable row level security;
alter table private.streets enable row level security;
alter table private.games enable row level security;
alter table private.game_players enable row level security;
alter table private.game_rounds enable row level security;
alter table private.guesses enable row level security;

create policy "deny direct client access"
  on private.streets as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny direct client access"
  on private.games as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny direct client access"
  on private.game_players as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny direct client access"
  on private.game_rounds as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "deny direct client access"
  on private.guesses as restrictive for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "public can read countries"
  on public.countries for select
  to anon, authenticated
  using (true);

create policy "public can read country translations"
  on public.country_translations for select
  to anon, authenticated
  using (true);

create policy "public can read enabled cities"
  on public.cities for select
  to anon, authenticated
  using (enabled);

create policy "public can read translations for enabled cities"
  on public.city_translations for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.cities
      where cities.id = city_translations.city_id
        and cities.enabled
    )
  );

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
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

grant all on all tables in schema private to service_role;
grant all on all sequences in schema private to service_role;
alter default privileges in schema private grant all on tables to service_role;
alter default privileges in schema private grant all on sequences to service_role;

create function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger cities_touch_updated_at
before update on public.cities
for each row execute function private.touch_updated_at();

create trigger games_touch_updated_at
before update on private.games
for each row execute function private.touch_updated_at();

create function private.broadcast_game_state_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid;
begin
  if tg_table_name = 'games' then
    v_game_id := new.id;
  elsif tg_table_name = 'game_players' then
    v_game_id := new.game_id;
  elsif tg_table_name = 'guesses' then
    select gr.game_id
    into v_game_id
    from private.game_rounds gr
    where gr.id = new.round_id;
  end if;

  if v_game_id is not null then
    perform realtime.send(
      jsonb_build_object(
        'gameId', v_game_id,
        'reason', tg_table_name,
        'at', statement_timestamp()
      ),
      'state_changed',
      'game:' || v_game_id::text,
      true
    );
  end if;

  return new;
end;
$$;

create trigger games_broadcast_state_changed
after update of status, current_round_number, host_player_id on private.games
for each row execute function private.broadcast_game_state_changed();

create trigger game_players_insert_broadcast_state_changed
after insert on private.game_players
for each row execute function private.broadcast_game_state_changed();

create trigger game_players_membership_broadcast_state_changed
after update of left_at, is_host on private.game_players
for each row execute function private.broadcast_game_state_changed();

create trigger guesses_broadcast_state_changed
after insert on private.guesses
for each row execute function private.broadcast_game_state_changed();

create function public.normalize_street_name(p_name text)
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

create function public.classify_difficulty(
  p_highway_types text[],
  p_length_m double precision
)
returns public.difficulty
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_highway_types, '{}') && array[
      'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'
    ] or coalesce(p_length_m, 0) >= 2000 then 'easy'::public.difficulty
    when coalesce(p_highway_types, '{}') && array[
      'tertiary', 'tertiary_link'
    ] or coalesce(p_length_m, 0) >= 1000 then 'medium'::public.difficulty
    when coalesce(p_length_m, 0) >= 400 then 'hard'::public.difficulty
    else 'insane'::public.difficulty
  end;
$$;

create function public.calculate_score(
  p_distance_m double precision,
  p_seconds_remaining double precision
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_distance_m is null or p_distance_m >= 500 then 0
    else round(
      1000
      * power(greatest(0, 1 - greatest(0, p_distance_m) / 500), 2)
      * (
        0.85
        + 0.15 * greatest(0, least(60, coalesce(p_seconds_remaining, 0))) / 60
      )
    )::integer
  end;
$$;

create function private.assert_actor(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id
  ) then
    raise exception using
      errcode = '28000',
      message = 'A valid Supabase user is required.';
  end if;
end;
$$;

create function private.validate_nickname(p_nickname text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_nickname text := btrim(p_nickname);
begin
  if v_nickname is null
    or char_length(v_nickname) not between 2 and 20
    or v_nickname ~ '[[:cntrl:]]'
  then
    raise exception using
      errcode = '22023',
      message = 'Nickname must contain 2 to 20 visible characters.';
  end if;

  return v_nickname;
end;
$$;

create function private.generate_lobby_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
begin
  for v_attempt in 1..32 loop
    v_code := '';
    for v_index in 1..6 loop
      v_code := v_code || substr(
        v_alphabet,
        1 + floor(random() * length(v_alphabet))::integer,
        1
      );
    end loop;

    if not exists (
      select 1 from private.games where lobby_code = v_code
    ) then
      return v_code;
    end if;
  end loop;

  raise exception using
    errcode = 'P0001',
    message = 'Could not allocate a lobby code.';
end;
$$;

create function private.is_game_member(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.game_players gp
    join private.games g on g.id = gp.game_id
    where gp.user_id = (select auth.uid())
      and gp.left_at is null
      and g.expires_at > statement_timestamp()
      and p_topic = 'game:' || g.id::text
  );
$$;

create function private.assert_game_member(p_game_id uuid, p_user_id uuid)
returns private.game_players
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player private.game_players;
begin
  select gp.*
  into v_player
  from private.game_players gp
  join private.games g on g.id = gp.game_id
  where gp.game_id = p_game_id
    and gp.user_id = p_user_id
    and gp.left_at is null
    and g.expires_at > statement_timestamp();

  if not found then
    raise exception using
      errcode = '42501',
      message = 'You are not an active member of this game.';
  end if;

  return v_player;
end;
$$;

create function private.populate_rounds(p_game_id uuid)
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

create function public.create_rematch(p_game_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source private.games;
  v_existing_game_id uuid;
  v_new_game_id uuid;
  v_host_user_id uuid;
  v_host_player_id uuid;
  v_active_players integer;
  v_now timestamptz := statement_timestamp();
begin
  perform private.assert_actor(p_user_id);

  select g.*
  into v_source
  from private.games g
  where g.id = p_game_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Game not found.';
  end if;

  perform private.assert_game_member(p_game_id, p_user_id);
  perform private.synchronize_game_locked(p_game_id, v_now);

  select g.*
  into strict v_source
  from private.games g
  where g.id = p_game_id;

  if v_source.status <> 'finished' then
    raise exception using
      errcode = '55000',
      message = 'Only a finished game can have a rematch.';
  end if;

  select count(*)
  into v_active_players
  from private.game_players gp
  where gp.game_id = p_game_id
    and gp.left_at is null;

  if (v_source.mode = 'solo' and v_active_players <> 1)
    or (v_source.mode = 'lobby' and v_active_players not between 2 and 8)
  then
    raise exception using
      errcode = '22023',
      message = 'A rematch needs the original active player group.';
  end if;

  select g.id
  into v_existing_game_id
  from private.games g
  where g.rematch_of_game_id = p_game_id;

  if found then
    return private.build_game_state(v_existing_game_id, p_user_id);
  end if;

  select gp.user_id
  into v_host_user_id
  from private.game_players gp
  where gp.game_id = p_game_id
    and gp.left_at is null
  order by
    case when gp.id = v_source.host_player_id then 0 else 1 end,
    gp.joined_at,
    gp.id
  limit 1;

  for v_attempt in 1..32 loop
    begin
      insert into private.games (
        mode,
        city_id,
        difficulty,
        lobby_code,
        rematch_of_game_id,
        expires_at
      )
      values (
        v_source.mode,
        v_source.city_id,
        v_source.difficulty,
        case when v_source.mode = 'lobby' then private.generate_lobby_code() else null end,
        p_game_id,
        case when v_source.mode = 'lobby' then v_now + interval '6 hours' else v_now + interval '3 hours' end
      )
      returning id into v_new_game_id;

      exit;
    exception
      when unique_violation then
        select g.id
        into v_existing_game_id
        from private.games g
        where g.rematch_of_game_id = p_game_id;

        if found then
          return private.build_game_state(v_existing_game_id, p_user_id);
        end if;
    end;
  end loop;

  if v_new_game_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Could not allocate a unique rematch lobby.';
  end if;

  insert into private.game_players (game_id, user_id, nickname, is_host)
  select
    v_new_game_id,
    gp.user_id,
    gp.nickname,
    gp.user_id = v_host_user_id
  from private.game_players gp
  where gp.game_id = p_game_id
    and gp.left_at is null
  order by gp.joined_at, gp.id;

  select gp.id
  into strict v_host_player_id
  from private.game_players gp
  where gp.game_id = v_new_game_id
    and gp.user_id = v_host_user_id;

  update private.games
  set host_player_id = v_host_player_id
  where id = v_new_game_id;

  if v_source.mode = 'solo' then
    perform private.start_game_internal(v_new_game_id, v_now);
  else
    perform private.populate_rounds(v_new_game_id);
  end if;

  return private.build_game_state(v_new_game_id, p_user_id);
end;
$$;

create function private.start_game_internal(p_game_id uuid, p_now timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.populate_rounds(p_game_id);

  update private.game_rounds
  set status = 'playing',
      started_at = p_now,
      ends_at = p_now + interval '60 seconds'
  where game_id = p_game_id
    and round_number = 1;

  update private.games
  set status = 'playing',
      current_round_number = 1,
      started_at = p_now,
      expires_at = p_now + interval '3 hours'
  where id = p_game_id;
end;
$$;

create function private.synchronize_game_locked(p_game_id uuid, p_now timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_game private.games;
  v_round private.game_rounds;
begin
  select g.*
  into strict v_game
  from private.games g
  where g.id = p_game_id
  for update;

  if v_game.status = 'playing' then
    select gr.*
    into strict v_round
    from private.game_rounds gr
    where gr.game_id = p_game_id
      and gr.round_number = v_game.current_round_number
    for update;

    if v_round.ends_at <= p_now then
      update private.game_rounds
      set status = 'revealing',
          revealed_at = p_now
      where id = v_round.id
        and status = 'playing';

      update private.games
      set status = 'revealing'
      where id = p_game_id;
    end if;
  elsif v_game.status = 'revealing' then
    select gr.*
    into strict v_round
    from private.game_rounds gr
    where gr.game_id = p_game_id
      and gr.round_number = v_game.current_round_number
    for update;

    if v_round.revealed_at + interval '5 seconds' <= p_now then
      update private.game_rounds
      set status = 'complete',
          completed_at = p_now
      where id = v_round.id
        and status = 'revealing';

      if v_game.current_round_number = 10 then
        update private.games
        set status = 'finished',
            finished_at = p_now,
            expires_at = p_now + interval '24 hours'
        where id = p_game_id;
      else
        update private.game_rounds
        set status = 'playing',
            started_at = p_now,
            ends_at = p_now + interval '60 seconds'
        where game_id = p_game_id
          and round_number = v_game.current_round_number + 1
          and status = 'pending';

        update private.games
        set status = 'playing',
            current_round_number = current_round_number + 1,
            expires_at = greatest(expires_at, p_now + interval '3 hours')
        where id = p_game_id;
      end if;
    end if;
  end if;
end;
$$;

create function private.build_game_state(p_game_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_game private.games;
  v_player private.game_players;
  v_city jsonb;
  v_current_round jsonb;
  v_players jsonb;
  v_revealed_rounds jsonb;
begin
  v_player := private.assert_game_member(p_game_id, p_user_id);

  select g.*
  into strict v_game
  from private.games g
  where g.id = p_game_id;

  select jsonb_build_object(
    'slug', c.slug,
    'countryCode', country.code,
    'name', jsonb_build_object(
      'de', coalesce((
        select ct.name
        from public.city_translations ct
        where ct.city_id = c.id and ct.locale = 'de'
      ), c.slug),
      'en', coalesce((
        select ct.name
        from public.city_translations ct
        where ct.city_id = c.id and ct.locale = 'en'
      ), c.slug)
    ),
    'center', jsonb_build_array(
      extensions.st_x(c.center),
      extensions.st_y(c.center)
    ),
    'bounds', jsonb_build_array(
      extensions.st_xmin(extensions.box3d(c.bounds)),
      extensions.st_ymin(extensions.box3d(c.bounds)),
      extensions.st_xmax(extensions.box3d(c.bounds)),
      extensions.st_ymax(extensions.box3d(c.bounds))
    )
  )
  into v_city
  from public.cities c
  join public.countries country on country.id = c.country_id
  where c.id = v_game.city_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ranked.id,
      'nickname', ranked.nickname,
      'isHost', ranked.is_host,
      'isConnected', true,
      'hasSubmitted', ranked.has_submitted,
      'score', ranked.total_score,
      'rank', ranked.rank
    ) order by ranked.rank nulls last, ranked.joined_at
  ), '[]'::jsonb)
  into v_players
  from (
    select
      gp.id,
      gp.user_id,
      gp.nickname,
      gp.is_host,
      gp.total_score,
      gp.joined_at,
      case
        when v_game.status = 'waiting' then null
        else dense_rank() over (order by gp.total_score desc)
      end as rank,
      exists (
        select 1
        from private.guesses q
        join private.game_rounds gr on gr.id = q.round_id
        where q.player_id = gp.id
          and gr.game_id = p_game_id
          and gr.round_number = v_game.current_round_number
      ) as has_submitted
    from private.game_players gp
    where gp.game_id = p_game_id
      and gp.left_at is null
  ) ranked;

  if v_game.current_round_number > 0 then
    select jsonb_build_object(
      'id', gr.id,
      'number', gr.round_number,
      'targetStreetName', s.name,
      'startsAt', gr.started_at,
      'endsAt', gr.ends_at
    ) || case
      when gr.status in ('revealing', 'complete') then jsonb_build_object(
        'revealEndsAt', case
          when gr.revealed_at is null then null
          else gr.revealed_at + interval '5 seconds'
        end,
        'targetGeometry', extensions.st_asgeojson(s.geom, 6)::jsonb,
        'guesses', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'playerId', gp.id,
              'position', case
                when q.id is null then null
                else jsonb_build_array(
                  extensions.st_x(q.location),
                  extensions.st_y(q.location)
                )
              end,
              'distanceMeters', q.distance_m,
              'points', coalesce(q.score, 0),
              'submittedAt', q.submitted_at
            ) order by gp.joined_at, gp.id
          )
          from private.game_players gp
          left join private.guesses q
            on q.player_id = gp.id and q.round_id = gr.id
          where gp.game_id = p_game_id and gp.left_at is null
        ), '[]'::jsonb)
      )
      else '{}'::jsonb
    end
    into v_current_round
    from private.game_rounds gr
    join private.streets s on s.id = gr.target_street_id
    where gr.game_id = p_game_id
      and gr.round_number = v_game.current_round_number;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', revealed.id,
      'number', revealed.round_number,
      'targetStreetName', revealed.target_name,
      'targetGeometry', revealed.target_geojson,
      'guesses', revealed.guesses
    ) order by revealed.round_number
  ), '[]'::jsonb)
  into v_revealed_rounds
  from (
    select
      gr.id,
      gr.round_number,
      s.name as target_name,
      extensions.st_asgeojson(s.geom, 6)::jsonb as target_geojson,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'playerId', gp.id,
            'position', jsonb_build_array(
              extensions.st_x(q.location),
              extensions.st_y(q.location)
            ),
            'distanceMeters', q.distance_m,
            'points', q.score,
            'submittedAt', q.submitted_at
          ) order by q.score desc, q.submitted_at
        )
        from private.guesses q
        join private.game_players gp on gp.id = q.player_id
        where q.round_id = gr.id
      ), '[]'::jsonb) as guesses
    from private.game_rounds gr
    join private.streets s on s.id = gr.target_street_id
    where gr.game_id = p_game_id
      and gr.status in ('revealing', 'complete')
  ) revealed;

  return jsonb_build_object(
    'id', v_game.id,
    'mode', v_game.mode,
    'status', v_game.status,
    'difficulty', v_game.difficulty,
    'lobbyCode', v_game.lobby_code,
    'city', v_city,
    'viewerPlayerId', v_player.id,
    'viewerIsHost', v_player.is_host,
    'canStart', (
      v_game.status = 'waiting'
      and v_player.is_host
      and (
        select count(*) between 2 and 8
        from private.game_players gp
        where gp.game_id = p_game_id and gp.left_at is null
      )
    ),
    'roundNumber', v_game.current_round_number,
    'totalRounds', 10,
    'roundDurationSeconds', 60,
    'revealDurationSeconds', 5,
    'serverNow', statement_timestamp(),
    'players', v_players,
    'currentRound', v_current_round,
    'revealedRounds', v_revealed_rounds,
    'startedAt', v_game.started_at,
    'finishedAt', v_game.finished_at,
    'expiresAt', v_game.expires_at
  );
end;
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
  ), translation_matches as materialized (
    select distinct translation.city_id
    from public.city_translations translation
    cross join search_parameters parameters
    where parameters.normalized_query <> ''
      and translation.search_name like '%' || parameters.normalized_query || '%'
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
            replace(city.slug, '-', '')
              like '%' || parameters.normalized_query || '%'
            or replace(coalesce(city.official_code, ''), '-', '')
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

create function public.list_catalog(p_locale public.locale default 'de')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.build_catalog(p_locale, null, 12);
$$;

create function public.create_game(
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

create function public.join_game(
  p_code text,
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
  v_game private.games;
  v_nickname text;
begin
  perform private.assert_actor(p_user_id);
  v_nickname := private.validate_nickname(p_nickname);

  select g.*
  into v_game
  from private.games g
  where g.lobby_code = upper(regexp_replace(btrim(p_code), '[^A-Za-z0-9]', '', 'g'))
  for update;

  if not found or v_game.expires_at <= statement_timestamp() then
    raise exception using errcode = 'P0002', message = 'Lobby not found.';
  end if;

  if v_game.mode <> 'lobby' or v_game.status <> 'waiting' then
    raise exception using errcode = '55000', message = 'This lobby has already started.';
  end if;

  perform 1
  from private.game_players gp
  where gp.game_id = v_game.id
    and gp.user_id = p_user_id
    and gp.left_at is null;

  if found then
    return private.build_game_state(v_game.id, p_user_id);
  end if;

  if (
    select count(*) from private.game_players gp
    where gp.game_id = v_game.id and gp.left_at is null
  ) >= 8 then
    raise exception using errcode = '54000', message = 'This lobby is full.';
  end if;

  if exists (
    select 1
    from private.game_players gp
    where gp.game_id = v_game.id
      and gp.left_at is null
      and lower(btrim(gp.nickname)) = lower(v_nickname)
  ) then
    raise exception using errcode = '23505', message = 'Nickname is already taken in this lobby.';
  end if;

  insert into private.game_players (game_id, user_id, nickname)
  values (v_game.id, p_user_id, v_nickname);

  return private.build_game_state(v_game.id, p_user_id);
end;
$$;

create function public.leave_game(p_game_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_game private.games;
  v_player private.game_players;
  v_next_host_id uuid;
begin
  perform private.assert_actor(p_user_id);

  select g.*
  into strict v_game
  from private.games g
  where g.id = p_game_id
  for update;

  v_player := private.assert_game_member(p_game_id, p_user_id);

  update private.game_players
  set left_at = statement_timestamp(), is_host = false
  where id = v_player.id;

  if v_game.status = 'waiting' and v_player.is_host then
    select gp.id
    into v_next_host_id
    from private.game_players gp
    where gp.game_id = p_game_id and gp.left_at is null
    order by gp.joined_at, gp.id
    limit 1;

    if v_next_host_id is null then
      delete from private.games where id = p_game_id;
      return jsonb_build_object('id', p_game_id, 'left', true, 'deleted', true);
    end if;

    update private.game_players set is_host = true where id = v_next_host_id;
    update private.games set host_player_id = v_next_host_id where id = p_game_id;
  end if;

  return jsonb_build_object('id', p_game_id, 'left', true, 'deleted', false);
end;
$$;

create function public.start_game(p_game_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_game private.games;
  v_player private.game_players;
  v_player_count integer;
begin
  perform private.assert_actor(p_user_id);

  select g.*
  into strict v_game
  from private.games g
  where g.id = p_game_id
  for update;

  v_player := private.assert_game_member(p_game_id, p_user_id);

  if not v_player.is_host or v_game.host_player_id <> v_player.id then
    raise exception using errcode = '42501', message = 'Only the lobby host can start the game.';
  end if;

  if v_game.mode <> 'lobby' or v_game.status <> 'waiting' then
    raise exception using errcode = '55000', message = 'This lobby cannot be started.';
  end if;

  select count(*)
  into v_player_count
  from private.game_players gp
  where gp.game_id = p_game_id and gp.left_at is null;

  if v_player_count not between 2 and 8 then
    raise exception using errcode = '22023', message = 'A lobby needs 2 to 8 active players.';
  end if;

  perform private.start_game_internal(p_game_id, statement_timestamp());
  return private.build_game_state(p_game_id, p_user_id);
end;
$$;

create function public.submit_guess(
  p_game_id uuid,
  p_round_id uuid,
  p_user_id uuid,
  p_lng double precision,
  p_lat double precision
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_game private.games;
  v_round private.game_rounds;
  v_player private.game_players;
  v_point extensions.geometry(Point, 4326);
  v_distance_m double precision;
  v_seconds_remaining double precision;
  v_score integer;
  v_inserted integer;
  v_active_players integer;
  v_guess_count integer;
  v_now timestamptz := statement_timestamp();
begin
  perform private.assert_actor(p_user_id);

  if p_lng is null or p_lng not between -180 and 180
    or p_lat is null or p_lat not between -90 and 90
  then
    raise exception using errcode = '22023', message = 'Guess coordinates are outside valid longitude/latitude bounds.';
  end if;

  select g.*
  into strict v_game
  from private.games g
  where g.id = p_game_id
  for update;

  perform private.synchronize_game_locked(p_game_id, v_now);

  select g.* into strict v_game from private.games g where g.id = p_game_id;
  v_player := private.assert_game_member(p_game_id, p_user_id);

  if v_game.status <> 'playing' then
    return private.build_game_state(p_game_id, p_user_id);
  end if;

  select gr.*
  into strict v_round
  from private.game_rounds gr
  where gr.id = p_round_id
    and gr.game_id = p_game_id
    and gr.round_number = v_game.current_round_number
  for update;

  if v_round.status <> 'playing' or v_round.ends_at <= v_now then
    perform private.synchronize_game_locked(p_game_id, v_now);
    return private.build_game_state(p_game_id, p_user_id);
  end if;

  v_point := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geometry(Point, 4326);

  select extensions.st_distance(s.geom::extensions.geography, v_point::extensions.geography)
  into v_distance_m
  from private.streets s
  where s.id = v_round.target_street_id;

  v_seconds_remaining := greatest(0, least(60, extract(epoch from (v_round.ends_at - v_now))));
  v_score := public.calculate_score(v_distance_m, v_seconds_remaining);

  insert into private.guesses (
    round_id,
    player_id,
    location,
    submitted_at,
    distance_m,
    seconds_remaining,
    score
  )
  values (
    v_round.id,
    v_player.id,
    v_point,
    v_now,
    v_distance_m,
    v_seconds_remaining,
    v_score
  )
  on conflict (round_id, player_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update private.game_players
    set total_score = total_score + v_score
    where id = v_player.id;
  end if;

  select count(*)
  into v_active_players
  from private.game_players gp
  where gp.game_id = p_game_id and gp.left_at is null;

  select count(*)
  into v_guess_count
  from private.guesses q
  join private.game_players gp on gp.id = q.player_id
  where q.round_id = v_round.id and gp.left_at is null;

  if v_guess_count >= v_active_players then
    update private.game_rounds
    set status = 'revealing', revealed_at = v_now
    where id = v_round.id and status = 'playing';

    update private.games
    set status = 'revealing'
    where id = p_game_id and status = 'playing';
  end if;

  return private.build_game_state(p_game_id, p_user_id);
end;
$$;

create function public.synchronize_game(p_game_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_actor(p_user_id);
  perform private.assert_game_member(p_game_id, p_user_id);
  perform private.synchronize_game_locked(p_game_id, statement_timestamp());
  return private.build_game_state(p_game_id, p_user_id);
end;
$$;

create function public.get_game_state(p_game_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_actor(p_user_id);
  perform private.assert_game_member(p_game_id, p_user_id);
  perform private.synchronize_game_locked(p_game_id, statement_timestamp());
  return private.build_game_state(p_game_id, p_user_id);
end;
$$;

create function public.cleanup_expired_data(p_delete_anonymous_users boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_games_deleted integer;
  v_users_deleted integer := 0;
begin
  delete from private.games
  where expires_at <= statement_timestamp();
  get diagnostics v_games_deleted = row_count;

  if p_delete_anonymous_users then
    delete from auth.users au
    where au.is_anonymous is true
      and au.created_at < statement_timestamp() - interval '30 days'
      and not exists (
        select 1
        from private.game_players gp
        join private.games g on g.id = gp.game_id
        where gp.user_id = au.id
          and g.expires_at > statement_timestamp()
      );
    get diagnostics v_users_deleted = row_count;
  end if;

  return jsonb_build_object(
    'gamesDeleted', v_games_deleted,
    'anonymousUsersDeleted', v_users_deleted
  );
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_game_member(text) to authenticated;

revoke execute on function public.normalize_street_name(text) from public, anon, authenticated;
revoke execute on function public.classify_difficulty(text[], double precision) from public, anon, authenticated;
revoke execute on function public.calculate_score(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.list_catalog(public.locale) from public, anon, authenticated;
revoke execute on function public.search_catalog(public.locale, text, integer) from public, anon, authenticated;
revoke execute on function public.create_game(public.game_mode, text, public.difficulty, text, uuid) from public, anon, authenticated;
revoke execute on function public.create_rematch(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.join_game(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.leave_game(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.start_game(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.submit_guess(uuid, uuid, uuid, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.synchronize_game(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_game_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_data(boolean) from public, anon, authenticated;

grant execute on function public.normalize_street_name(text) to service_role;
grant execute on function public.classify_difficulty(text[], double precision) to service_role;
grant execute on function public.calculate_score(double precision, double precision) to service_role;
grant execute on function public.list_catalog(public.locale) to service_role;
grant execute on function public.search_catalog(public.locale, text, integer) to service_role;
grant execute on function public.create_game(public.game_mode, text, public.difficulty, text, uuid) to service_role;
grant execute on function public.create_rematch(uuid, uuid) to service_role;
grant execute on function public.join_game(text, text, uuid) to service_role;
grant execute on function public.leave_game(uuid, uuid) to service_role;
grant execute on function public.start_game(uuid, uuid) to service_role;
grant execute on function public.submit_guess(uuid, uuid, uuid, double precision, double precision) to service_role;
grant execute on function public.synchronize_game(uuid, uuid) to service_role;
grant execute on function public.get_game_state(uuid, uuid) to service_role;
grant execute on function public.cleanup_expired_data(boolean) to service_role;

-- Supabase Realtime v2.112.7+ locks the realtime schema. Policies on
-- realtime.messages remain the one supported customization point; do not alter
-- the table, helper functions, triggers, or any other realtime-owned object.
create policy "game members can receive broadcast and presence"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.is_game_member((select realtime.topic()))
  );

create policy "game members can send broadcast and presence"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and private.is_game_member((select realtime.topic()))
  );
