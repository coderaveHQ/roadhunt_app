begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(69);

select extensions.has_schema('private', 'private schema exists');
select extensions.has_table('public', 'cities', 'public city catalog exists');
select extensions.has_table(
  'public',
  'city_admin_area_translations',
  'localized city administration areas exist in the public catalog'
);
select extensions.has_table('private', 'streets', 'street geometries are private');
select extensions.has_table('private', 'games', 'game state is private');
select extensions.has_column('public', 'cities', 'official_code', 'cities retain an official municipality key');
select extensions.has_column('private', 'streets', 'is_playable', 'all named highways can be stored separately from target eligibility');

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cities'
      and column_name = 'bounds_bbox'
      and data_type = 'ARRAY'
      and udt_name = '_float8'
      and is_nullable = 'NO'
  )
  and not exists (
    select 1
    from public.cities city
    where cardinality(city.bounds_bbox) <> 4
      or city.bounds_bbox is distinct from array[
        extensions.st_xmin(extensions.box3d(city.bounds)),
        extensions.st_ymin(extensions.box3d(city.bounds)),
        extensions.st_xmax(extensions.box3d(city.bounds)),
        extensions.st_ymax(extensions.box3d(city.bounds))
      ]::double precision[]
  ),
  'cached catalog bounds are required four-number envelopes matching the city geometry'
);
select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'city_translations'
      and column_name = 'search_name'
      and data_type = 'text'
      and is_generated = 'ALWAYS'
      and generation_expression = 'private.normalize_catalog_search(name)'
  )
  and not exists (
    select 1
    from public.city_translations translation
    where translation.search_name is distinct from private.normalize_catalog_search(translation.name)
  ),
  'catalog search names are stored generated normalized values'
);
select extensions.ok(
  exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.city_admin_area_translations'::regclass
      and constraint_row.confrelid = 'public.cities'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'c'
  ),
  'admin-area translations cascade when their city is deleted'
);
select extensions.ok(
  (select relation.relrowsecurity
   from pg_class relation
   where relation.oid = 'public.city_admin_area_translations'::regclass),
  'admin-area translations have RLS enabled'
);
select extensions.ok(
  (
    select count(*) = 1
      and bool_and(policy.cmd = 'SELECT')
      and bool_and(policy.roles @> array['anon', 'authenticated']::name[])
      and bool_and(policy.roles <@ array['anon', 'authenticated']::name[])
      and bool_and(policy.qual like '%cities.enabled%')
      and bool_and(policy.with_check is null)
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'city_admin_area_translations'
  ),
  'admin-area RLS exposes only enabled cities to the two browser roles'
);
select extensions.ok(
  (
    select count(*) = 24
      and count(*) filter (where admin.locale = 'de') = 12
      and count(*) filter (where admin.locale = 'en') = 12
    from public.city_admin_area_translations admin
    join public.cities city on city.id = admin.city_id
    where city.featured
  ),
  'the twelve featured cities seed one German and one English admin-area row'
);
select extensions.ok(
  (
    select count(*) = 4 and bool_and(admin.district_name is null)
    from public.city_admin_area_translations admin
    join public.cities city on city.id = admin.city_id
    where city.slug in ('berlin', 'hamburg')
      and admin.locale in ('de', 'en')
  ),
  'city-states Berlin and Hamburg never expose a borough as their district'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'games'
      and column_name = 'rematch_of_game_id'
      and data_type = 'uuid'
      and is_nullable = 'YES'
  ),
  'games can reference the finished game they replay'
);
select extensions.ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'private.games'::regclass
      and c.conname = 'games_rematch_of_game_id_fkey'
      and c.confrelid = 'private.games'::regclass
      and c.confdeltype = 'n'
  ),
  'rematch lineage uses a self-reference with on-delete set null'
);
select extensions.ok(
  exists (
    select 1
    from pg_index i
    join pg_class index_relation on index_relation.oid = i.indexrelid
    where i.indrelid = 'private.games'::regclass
      and index_relation.relname = 'games_rematch_of_game_id_key'
      and i.indisunique
      and i.indpred is not null
  ),
  'one finished game can create at most one live rematch'
);
select extensions.ok(
  (
    select p.prosecdef
      and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_rematch'
      and p.proargtypes = '2950 2950'::oidvector
  ),
  'rematch RPC is security-definer with an empty fixed search path'
);

select extensions.is(public.calculate_score(0, 60), 1000, 'perfect instant guess earns 1000');
select extensions.is(public.calculate_score(0, 0), 850, 'perfect last-second guess keeps 85 percent');
select extensions.is(public.calculate_score(250, 60), 250, 'half-distance accuracy is squared');
select extensions.is(public.calculate_score(500, 60), 0, '500 metres earns zero');
select extensions.is(
  public.normalize_street_name('  Große  Straße – Nord  '),
  'grosse strasse-nord',
  'database street normalization matches the importer contract'
);

select extensions.is(
  public.classify_difficulty(array['primary'], 100),
  'easy'::public.difficulty,
  'primary roads are easy'
);
select extensions.is(
  public.classify_difficulty(array['trunk'], 100),
  'easy'::public.difficulty,
  'trunk roads are easy'
);
select extensions.is(
  public.classify_difficulty(array['trunk_link'], 100),
  'easy'::public.difficulty,
  'trunk links are easy'
);
select extensions.is(
  public.classify_difficulty(array['residential'], 2000),
  'easy'::public.difficulty,
  'roads at least two kilometres are easy'
);
select extensions.is(
  public.classify_difficulty(array['tertiary'], 500),
  'medium'::public.difficulty,
  'tertiary roads are medium'
);
select extensions.is(
  public.classify_difficulty(array['residential'], 400),
  'hard'::public.difficulty,
  'remaining roads at least 400 metres are hard'
);
select extensions.is(
  public.classify_difficulty(array['living_street'], 399),
  'insane'::public.difficulty,
  'short remaining roads are insane'
);

select extensions.is(
  (
    select count(*)
    from public.cities
    where slug = any(array[
      'berlin', 'hamburg', 'munich', 'cologne', 'frankfurt', 'duesseldorf',
      'stuttgart', 'leipzig', 'solingen', 'duisburg', 'moers', 'wuppertal'
    ])
  ),
  12::bigint,
  'all twelve launch cities are present'
);
select extensions.is((select count(*) from public.cities where featured), 12::bigint, 'all launch cities remain featured after dynamic catalog migration');
select extensions.cmp_ok(
  (select count(*) from private.streets),
  '>=',
  480::bigint,
  'the clean seed baseline or a larger imported street catalog is present'
);
select extensions.cmp_ok(
  (
    select min(pool_size)
    from (
      select count(street.id) as pool_size
      from public.cities city
      cross join unnest(enum_range(null::public.difficulty)) as expected(difficulty)
      left join private.streets street
        on street.city_id = city.id
       and street.difficulty = expected.difficulty
       and street.is_playable
      where city.featured
      group by city.id, expected.difficulty
    ) pools
  ),
  '>=',
  10::bigint,
  'every featured city/difficulty pool has at least ten playable streets'
);
select extensions.is(
  (
    select count(*)
    from public.cities city
    cross join unnest(enum_range(null::public.difficulty)) as expected(difficulty)
    where city.featured
  ),
  48::bigint,
  'all four difficulty pools exist for all twelve featured cities'
);
select extensions.ok(
  (select bool_and(extensions.geometrytype(geom) = 'MULTILINESTRING') from private.streets),
  'all target geometries are MultiLineStrings'
);

select extensions.is(
  (
    select jsonb_typeof(city->'center')
    from jsonb_array_elements(public.list_catalog('de')->'countries'->0->'cities') city
    where city->>'slug' = 'berlin'
  ),
  'array',
  'catalog centers are compact coordinate arrays'
);
select extensions.is(
  (
    select jsonb_array_length(city->'bounds')
    from jsonb_array_elements(public.list_catalog('de')->'countries'->0->'cities') city
    where city->>'slug' = 'berlin'
  ),
  4,
  'catalog bounds are compact west/south/east/north arrays'
);

select extensions.is(
  (
    select jsonb_agg(city->>'slug' order by city_order)
    from jsonb_array_elements(
      public.search_catalog('de')->'countries'->0->'cities'
    ) with ordinality as catalog_city(city, city_order)
  ),
  '["berlin", "hamburg", "munich", "cologne", "frankfurt", "duesseldorf", "stuttgart", "leipzig", "solingen", "duisburg", "moers", "wuppertal"]'::jsonb,
  'the default search returns exactly the twelve featured cities in launch order'
);
select extensions.ok(
  (
    with catalog as (
      select public.search_catalog('de') as value
    ), country as (
      select catalog.value->'countries'->0 as value
      from catalog
    ), city as (
      select city_row as value
      from country,
        lateral jsonb_array_elements(country.value->'cities') city_row
      where city_row->>'slug' = 'berlin'
    )
    select
      (select jsonb_agg(key order by key) from jsonb_object_keys(catalog.value) key)
        = '["countries"]'::jsonb
      and (select jsonb_agg(key order by key) from country, jsonb_object_keys(country.value) key)
        = '["cities", "code", "name"]'::jsonb
      and (select jsonb_agg(key order by key) from city, jsonb_object_keys(city.value) key)
        = '["adminArea", "bounds", "center", "difficultyCounts", "featured", "id", "name", "population", "settlementType", "slug"]'::jsonb
      and (select jsonb_agg(key order by key) from city, jsonb_object_keys(city.value->'difficultyCounts') key)
        = '["easy", "hard", "insane", "medium"]'::jsonb
      and (select jsonb_agg(key order by key) from city, jsonb_object_keys(city.value->'adminArea') key)
        = '["code", "districtName", "stateName"]'::jsonb
      and (select city.value->'adminArea' from city)
        = '{"code":"11000000","districtName":null,"stateName":"Berlin"}'::jsonb
    from catalog
  ),
  'catalog RPC keeps the exact nested country, city, difficulty and admin-area DTO'
);

with accent_fixture (slug, display_name, fixture_number) as (
  values
    ('pgtap-accent-aachen', 'Aachen PgTapAccent', 1),
    ('pgtap-accent-aehren', 'Ähren PgTapAccent', 2),
    ('pgtap-accent-oel', 'Öl PgTapAccent', 3)
), inserted_city as (
  insert into public.cities (
    country_id,
    slug,
    center,
    bounds,
    bounds_bbox,
    enabled
  )
  select
    country.id,
    fixture.slug,
    extensions.st_setsrid(
      extensions.st_makepoint(8 + fixture.fixture_number * 0.001, 50),
      4326
    ),
    extensions.st_multi(
      extensions.st_makeenvelope(
        8 + fixture.fixture_number * 0.001,
        50,
        8.0005 + fixture.fixture_number * 0.001,
        50.0005,
        4326
      )
    ),
    array[
      8 + fixture.fixture_number * 0.001,
      50,
      8.0005 + fixture.fixture_number * 0.001,
      50.0005
    ]::double precision[],
    true
  from accent_fixture fixture
  cross join lateral (
    select id from public.countries where code = 'DE'
  ) country
  returning id, slug
)
insert into public.city_translations (city_id, locale, name)
select inserted.id, localized.locale, fixture.display_name
from inserted_city inserted
join accent_fixture fixture using (slug)
cross join (values ('de'::public.locale), ('en'::public.locale)) localized(locale);

select extensions.is(
  (
    select jsonb_agg(city->>'name' order by city_order)
    from jsonb_array_elements(
      public.search_catalog('de', 'pgtapaccent', 12)->'countries'->0->'cities'
    ) with ordinality as catalog_city(city, city_order)
  ),
  '["Aachen PgTapAccent", "Ähren PgTapAccent", "Öl PgTapAccent"]'::jsonb,
  'localized search results use accent-aware alphabetical ordering'
);
select extensions.ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.search_catalog('de', 'dusseldorf', 12)->'countries'->0->'cities'
    ) city
    where city->>'slug' = 'duesseldorf' and city->>'name' = 'Düsseldorf'
  ),
  'ASCII dusseldorf finds localized Düsseldorf'
);
select extensions.ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.search_catalog('de', 'Düsseldorf', 12)->'countries'->0->'cities'
    ) city
    where city->>'slug' = 'duesseldorf' and city->>'name' = 'Düsseldorf'
  ),
  'accented Düsseldorf finds the same localized city'
);
select extensions.ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.search_catalog('de', 'munchen', 12)->'countries'->0->'cities'
    ) city
    where city->>'slug' = 'munich' and city->>'name' = 'München'
  ),
  'ASCII munchen finds localized München'
);
select extensions.is(
  jsonb_array_length(
    public.search_catalog('de', 'pgtapaccent', 2)->'countries'->0->'cities'
  ),
  2,
  'catalog search honors a caller-supplied result limit'
);
select extensions.is(
  public.search_catalog('de', 'pgtap-no-such-municipality', 12),
  '{"countries":[]}'::jsonb,
  'a catalog search with no match returns an empty country list'
);

with cap_fixture as (
  select
    format('pgtap-fixture-%s', lpad(fixture_number::text, 3, '0')) as slug,
    format('PgTap Fixture %s', lpad(fixture_number::text, 3, '0')) as display_name,
    fixture_number
  from generate_series(1, 51) fixture_number
), inserted_city as (
  insert into public.cities (
    country_id,
    slug,
    center,
    bounds,
    bounds_bbox,
    enabled
  )
  select
    country.id,
    fixture.slug,
    extensions.st_setsrid(
      extensions.st_makepoint(9 + fixture.fixture_number * 0.001, 50),
      4326
    ),
    extensions.st_multi(
      extensions.st_makeenvelope(
        9 + fixture.fixture_number * 0.001,
        50,
        9.0005 + fixture.fixture_number * 0.001,
        50.0005,
        4326
      )
    ),
    array[
      9 + fixture.fixture_number * 0.001,
      50,
      9.0005 + fixture.fixture_number * 0.001,
      50.0005
    ]::double precision[],
    true
  from cap_fixture fixture
  cross join lateral (
    select id from public.countries where code = 'DE'
  ) country
  returning id, slug
)
insert into public.city_translations (city_id, locale, name)
select inserted.id, localized.locale, fixture.display_name
from inserted_city inserted
join cap_fixture fixture using (slug)
cross join (values ('de'::public.locale), ('en'::public.locale)) localized(locale);

select extensions.is(
  jsonb_array_length(
    public.search_catalog('de', 'pgtapfixture%', 999)->'countries'->0->'cities'
  ),
  50,
  'wildcard characters are normalized and the server cap remains fifty results'
);

update private.streets
set is_playable = false,
    exclusion_reasons = array['test-only']
where city_id = (select id from public.cities where slug = 'berlin')
  and difficulty = 'easy'
  and id not in (
    select street.id
    from private.streets street
    join public.cities city on city.id = street.city_id
    where city.slug = 'berlin'
      and street.difficulty = 'easy'
      and street.is_playable
    order by street.id
    limit 9
  );

select extensions.is(
  (
    select (city->'difficultyCounts'->>'easy')::integer
    from jsonb_array_elements(public.list_catalog('de')->'countries'->0->'cities') city
    where city->>'slug' = 'berlin'
  ),
  9,
  'catalog difficulty counts exclude stored but unplayable named highways'
);

insert into auth.users (
  id,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  is_anonymous,
  created_at,
  updated_at
)
values (
  'b0000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  '{}'::jsonb,
  '{}'::jsonb,
  true,
  now(),
  now()
)
on conflict (id) do nothing;

select extensions.throws_ok(
  $$
    select public.create_game(
      'solo',
      'berlin',
      'easy',
      'Pool Hunter',
      'b0000000-0000-4000-8000-000000000001'
    )
  $$,
  'P0001',
  'This city and difficulty need at least ten target streets.',
  'game creation counts only playable targets when enforcing the ten-street minimum'
);

with replacement as (
  select
    street.city_id,
    'Roadhunt pgTAP replacement ' || extensions.gen_random_uuid()::text as name,
    street.geom
  from private.streets street
  join public.cities city on city.id = street.city_id
  where city.slug = 'berlin' and street.difficulty = 'easy'
  order by street.id
  limit 1
)
insert into private.streets (
  city_id,
  name,
  normalized_name,
  highway_types,
  length_m,
  difficulty,
  geom,
  is_playable
)
select
  replacement.city_id,
  replacement.name,
  public.normalize_street_name(replacement.name),
  array['primary'],
  100,
  'easy',
  replacement.geom,
  true
from replacement;

create temporary table road_catalog_test_state (
  state jsonb not null
) on commit drop;

insert into road_catalog_test_state (state)
values (
  public.create_game(
    'solo',
    'berlin',
    'easy',
    'Pool Hunter',
    'b0000000-0000-4000-8000-000000000001'
  )
);

select extensions.ok(
  (
    select count(*) = 10 and bool_and(street.is_playable)
    from road_catalog_test_state test_state
    join private.game_rounds round_row
      on round_row.game_id = (test_state.state->>'id')::uuid
    join private.streets street on street.id = round_row.target_street_id
  ),
  'round population selects ten targets exclusively from the playable pool'
);

select extensions.ok(
  not has_function_privilege(
    'public',
    'public.search_catalog(public.locale,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.search_catalog(public.locale,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.search_catalog(public.locale,text,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.search_catalog(public.locale,text,integer)',
    'EXECUTE'
  ),
  'catalog search RPC is executable only by the service role'
);

select extensions.ok(
  (
    select bool_and(
      coalesce(
        (
          select array_agg(acl.privilege_type order by acl.privilege_type)
          from aclexplode(relation.relacl) acl
          where acl.grantee = 'anon'::regrole::oid
        ),
        '{}'::text[]
      ) = array['SELECT']::text[]
    )
    from (values
      ('public.countries'::regclass),
      ('public.country_translations'::regclass),
      ('public.cities'::regclass),
      ('public.city_translations'::regclass),
      ('public.city_admin_area_translations'::regclass)
    ) catalog_table(relation_id)
    join pg_class relation on relation.oid = catalog_table.relation_id
  ),
  'anon has exactly SELECT on every catalog table'
);
select extensions.ok(
  (
    select bool_and(
      coalesce(
        (
          select array_agg(acl.privilege_type order by acl.privilege_type)
          from aclexplode(relation.relacl) acl
          where acl.grantee = 'authenticated'::regrole::oid
        ),
        '{}'::text[]
      ) = array['SELECT']::text[]
    )
    from (values
      ('public.countries'::regclass),
      ('public.country_translations'::regclass),
      ('public.cities'::regclass),
      ('public.city_translations'::regclass),
      ('public.city_admin_area_translations'::regclass)
    ) catalog_table(relation_id)
    join pg_class relation on relation.oid = catalog_table.relation_id
  ),
  'authenticated has exactly SELECT on every catalog table'
);
select extensions.ok(
  not exists (
    select 1
    from (values
      ('public.countries'::regclass),
      ('public.country_translations'::regclass),
      ('public.cities'::regclass),
      ('public.city_translations'::regclass),
      ('public.city_admin_area_translations'::regclass)
    ) catalog_table(relation_id)
    join pg_class relation on relation.oid = catalog_table.relation_id
    cross join lateral aclexplode(relation.relacl) acl
    where acl.grantee = 0
  ),
  'PUBLIC has no direct privilege on any catalog table'
);
select extensions.ok(
  (
    select bool_and(
      coalesce(
        (
          select array_agg(acl.privilege_type order by acl.privilege_type)
          from aclexplode(relation.relacl) acl
          where acl.grantee = 'service_role'::regrole::oid
        ),
        '{}'::text[]
      ) = array[
        'DELETE',
        'INSERT',
        'MAINTAIN',
        'REFERENCES',
        'SELECT',
        'TRIGGER',
        'TRUNCATE',
        'UPDATE'
      ]::text[]
    )
    from (values
      ('public.countries'::regclass),
      ('public.country_translations'::regclass),
      ('public.cities'::regclass),
      ('public.city_translations'::regclass),
      ('public.city_admin_area_translations'::regclass)
    ) catalog_table(relation_id)
    join pg_class relation on relation.oid = catalog_table.relation_id
  ),
  'service_role has an explicit complete grant on every catalog table'
);
select extensions.ok(
  (
    with hardened_defaults as (
      select defaults.defaclobjtype, defaults.defaclacl
      from pg_default_acl defaults
      where defaults.defaclrole = 'postgres'::regrole
        and defaults.defaclnamespace = 'public'::regnamespace
        and defaults.defaclobjtype in ('r', 'S', 'f')
    )
    select count(*) = 3
      and not exists (
        select 1
        from hardened_defaults defaults
        cross join lateral aclexplode(defaults.defaclacl) acl
        where acl.grantee in (
          0,
          'anon'::regrole::oid,
          'authenticated'::regrole::oid
        )
      )
    from hardened_defaults
  ),
  'postgres default table, sequence and function ACLs grant nothing to PUBLIC or browser roles'
);

select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.create_game(public.game_mode,text,public.difficulty,text,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute game RPCs'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.create_game(public.game_mode,text,public.difficulty,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass server actions'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.normalize_street_name(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.normalize_street_name(text)', 'EXECUTE'),
  'street normalization is not executable by browser roles'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.create_game(public.game_mode,text,public.difficulty,text,uuid)',
    'EXECUTE'
  ),
  'service role can execute game RPCs'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.build_game_state(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute internal security-definer helpers'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'private.is_game_member(text)',
    'EXECUTE'
  ),
  'Realtime can execute only the scoped membership helper'
);
select extensions.ok(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated Realtime policy evaluation can resolve the membership helper'
);
select extensions.ok(
  (
    select bool_and(
      not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'list_catalog',
        'search_catalog',
        'create_game',
        'create_rematch',
        'join_game',
        'leave_game',
        'start_game',
        'submit_guess',
        'synchronize_game',
        'get_game_state',
        'cleanup_expired_data'
      ])
  ),
  'all Roadhunt server RPCs are denied to browser roles'
);
select extensions.ok(
  (
    select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'list_catalog',
        'search_catalog',
        'create_game',
        'create_rematch',
        'join_game',
        'leave_game',
        'start_game',
        'submit_guess',
        'synchronize_game',
        'get_game_state',
        'cleanup_expired_data'
      ])
  ),
  'service role can execute every Roadhunt server RPC'
);
select extensions.is(
  (
    select count(*)
    from information_schema.table_privileges
    where table_schema = 'private'
      and grantee in ('anon', 'authenticated')
  ),
  0::bigint,
  'client roles have no private table privileges'
);
select extensions.ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relkind = 'r'
  ),
  'RLS is enabled on every private table'
);
select extensions.is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname like 'game members can % broadcast and presence'
  ),
  2::bigint,
  'Realtime has only the two membership policies Roadhunt needs'
);
select extensions.is(
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'streets'),
  0::bigint,
  'target street table is not exposed in public'
);

select * from extensions.finish();

rollback;
