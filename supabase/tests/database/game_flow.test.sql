begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(48);

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
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    '{}'::jsonb,
    '{}'::jsonb,
    true,
    now(),
    now()
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    '{}'::jsonb,
    '{}'::jsonb,
    true,
    now(),
    now()
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    '{}'::jsonb,
    '{}'::jsonb,
    true,
    now(),
    now()
  );

create temporary table road_test_state (
  step text primary key,
  state jsonb not null
) on commit drop;

insert into road_test_state (step, state)
values (
  'created',
  public.create_game(
    'lobby',
    'berlin',
    'easy',
    'Hunter One',
    'a0000000-0000-4000-8000-000000000001'
  )
);

select extensions.is(
  (select state->>'status' from road_test_state where step = 'created'),
  'waiting',
  'new lobby waits for players'
);
select extensions.matches(
  (select state->>'lobbyCode' from road_test_state where step = 'created'),
  '^[2-9A-HJKMNP-Z]{6}$',
  'lobby code contains no ambiguous characters'
);
select extensions.is(
  (select (state->>'viewerIsHost')::boolean from road_test_state where step = 'created'),
  true,
  'creator is the viewer and host'
);

insert into road_test_state (step, state)
select
  'joined',
  public.join_game(
    created.state->>'lobbyCode',
    'Hunter Two',
    'a0000000-0000-4000-8000-000000000002'
  )
from road_test_state created
where created.step = 'created';

select extensions.is(
  (select jsonb_array_length(state->'players') from road_test_state where step = 'joined'),
  2,
  'second player joins the lobby'
);
select extensions.is(
  (select (state->>'viewerIsHost')::boolean from road_test_state where step = 'joined'),
  false,
  'joining viewer is not host'
);

select set_config(
  'road_test.topic',
  'game:' || (select state->>'id' from road_test_state where step = 'joined'),
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

set local role authenticated;
select set_config(
  'road_test.member_allowed',
  private.is_game_member(current_setting('road_test.topic'))::text,
  true
);
select set_config(
  'road_test.other_topic_denied',
  private.is_game_member('game:ffffffff-ffff-4fff-8fff-ffffffffffff')::text,
  true
);
reset role;

select extensions.is(
  current_setting('road_test.member_allowed'),
  'true',
  'authenticated lobby member can authorize the private Realtime topic'
);
select extensions.is(
  current_setting('road_test.other_topic_denied'),
  'false',
  'membership helper denies every other game topic'
);

insert into road_test_state (step, state)
select
  'started',
  public.start_game(
    (created.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000001'
  )
from road_test_state created
where created.step = 'created';

select extensions.is(
  (select state->>'status' from road_test_state where step = 'started'),
  'playing',
  'host starts the lobby'
);
select extensions.ok(
  (select state->'currentRound' ? 'targetStreetName' from road_test_state where step = 'started'),
  'active round exposes only the street name'
);
select extensions.ok(
  not (select state->'currentRound' ? 'targetGeometry' from road_test_state where step = 'started'),
  'active round does not expose target geometry'
);
select extensions.ok(
  not (select state->'currentRound' ? 'guesses' from road_test_state where step = 'started'),
  'active round does not expose guesses'
);

insert into road_test_state (step, state)
select
  'first_guess',
  public.submit_guess(
    (started.state->>'id')::uuid,
    (started.state->'currentRound'->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000001',
    13.4050,
    52.5200
  )
from road_test_state started
where started.step = 'started';

select extensions.is(
  (select state->>'status' from road_test_state where step = 'first_guess'),
  'playing',
  'round stays active until all active players submit'
);

insert into road_test_state (step, state)
select
  'revealed',
  public.submit_guess(
    (started.state->>'id')::uuid,
    (started.state->'currentRound'->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000002',
    13.4050,
    52.5200
  )
from road_test_state started
where started.step = 'started';

select extensions.is(
  (select state->>'status' from road_test_state where step = 'revealed'),
  'revealing',
  'last submission reveals the round'
);
select extensions.is(
  (select (state->>'revealDurationSeconds')::integer from road_test_state where step = 'revealed'),
  15,
  'game state exposes the fifteen-second reveal duration'
);
select extensions.is(
  (select state->'currentRound'->'targetGeometry'->>'type' from road_test_state where step = 'revealed'),
  'MultiLineString',
  'revealed target has canonical MultiLineString geometry'
);
select extensions.is(
  (select jsonb_array_length(state->'currentRound'->'guesses') from road_test_state where step = 'revealed'),
  2,
  'reveal contains one result per active player'
);

insert into road_test_state (step, state)
select
  'duplicate_guess',
  public.submit_guess(
    (started.state->>'id')::uuid,
    (started.state->'currentRound'->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000002',
    13.5000,
    52.6000
  )
from road_test_state started
where started.step = 'started';

select extensions.is(
  (
    select sum((player->>'score')::integer)
    from road_test_state state_row,
      lateral jsonb_array_elements(state_row.state->'players') player
    where state_row.step = 'duplicate_guess'
  ),
  (
    select sum((player->>'score')::integer)
    from road_test_state state_row,
      lateral jsonb_array_elements(state_row.state->'players') player
    where state_row.step = 'revealed'
  ),
  'duplicate submission is idempotent'
);

update private.game_rounds
set revealed_at = statement_timestamp() - interval '6 seconds'
where id = (
  select (state->'currentRound'->>'id')::uuid
  from road_test_state
  where step = 'revealed'
);

select extensions.is(
  (
    select public.synchronize_game(
      (started.state->>'id')::uuid,
      'a0000000-0000-4000-8000-000000000001'
    )->>'status'
    from road_test_state started
    where started.step = 'started'
  ),
  'revealing',
  'synchronization keeps the reveal visible for fifteen seconds'
);

update private.game_rounds
set revealed_at = statement_timestamp() - interval '16 seconds'
where id = (
  select (state->'currentRound'->>'id')::uuid
  from road_test_state
  where step = 'revealed'
);

insert into road_test_state (step, state)
select
  'round_two',
  public.synchronize_game(
    (started.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000001'
  )
from road_test_state started
where started.step = 'started';

select extensions.is(
  (select state->>'status' from road_test_state where step = 'round_two'),
  'playing',
  'synchronization advances after the fifteen-second reveal'
);
select extensions.is(
  (select (state->>'roundNumber')::integer from road_test_state where step = 'round_two'),
  2,
  'next round number is canonical'
);
select extensions.ok(
  not (select state->'currentRound' ? 'targetGeometry' from road_test_state where step = 'round_two'),
  'next target remains hidden'
);

update private.game_rounds
set started_at = statement_timestamp() - interval '61 seconds',
    ends_at = statement_timestamp() - interval '1 second'
where id = (
  select (state->'currentRound'->>'id')::uuid
  from road_test_state
  where step = 'round_two'
);

insert into road_test_state (step, state)
select
  'timed_out',
  public.synchronize_game(
    (started.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000001'
  )
from road_test_state started
where started.step = 'started';

select extensions.is(
  (select state->>'status' from road_test_state where step = 'timed_out'),
  'revealing',
  'server time reveals an expired round'
);
select extensions.is(
  (select jsonb_array_length(state->'currentRound'->'guesses') from road_test_state where step = 'timed_out'),
  2,
  'timeout reveal includes zero-point entries for missing guesses'
);
select extensions.ok(
  (
    select bool_and(guess->'position' = 'null'::jsonb and (guess->>'points')::integer = 0)
    from road_test_state state_row,
      lateral jsonb_array_elements(state_row.state->'currentRound'->'guesses') guess
    where state_row.step = 'timed_out'
  ),
  'missing timeout guesses have null positions and zero points'
);

insert into road_test_state (step, state)
values (
  'transfer_created',
  public.create_game(
    'lobby',
    'hamburg',
    'medium',
    'First Host',
    'a0000000-0000-4000-8000-000000000001'
  )
);

insert into road_test_state (step, state)
select
  'transfer_joined',
  public.join_game(
    created.state->>'lobbyCode',
    'Next Host',
    'a0000000-0000-4000-8000-000000000002'
  )
from road_test_state created
where created.step = 'transfer_created';

select public.leave_game(
  (state->>'id')::uuid,
  'a0000000-0000-4000-8000-000000000001'
)
from road_test_state
where step = 'transfer_created';

insert into road_test_state (step, state)
select
  'transferred',
  public.get_game_state(
    (created.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000002'
  )
from road_test_state created
where created.step = 'transfer_created';

select extensions.is(
  (select (state->>'viewerIsHost')::boolean from road_test_state where step = 'transferred'),
  true,
  'earliest remaining player becomes host'
);
select extensions.is(
  (select jsonb_array_length(state->'players') from road_test_state where step = 'transferred'),
  1,
  'departed host is removed from the active roster'
);

select extensions.throws_ok(
  $$
    select public.create_rematch(
      (select (state->>'id')::uuid from road_test_state where step = 'transfer_created'),
      'a0000000-0000-4000-8000-000000000002'
    )
  $$,
  '55000',
  'Only a finished game can have a rematch.',
  'unfinished games cannot create a rematch'
);

update private.games
set status = 'finished',
    current_round_number = 10,
    finished_at = statement_timestamp(),
    expires_at = statement_timestamp() + interval '24 hours'
where id = (
  select (state->>'id')::uuid
  from road_test_state
  where step = 'created'
);

insert into road_test_state (step, state)
select
  'lobby_rematch',
  public.create_rematch(
    (created.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000002'
  )
from road_test_state created
where created.step = 'created';

select extensions.is(
  (select state->>'status' from road_test_state where step = 'lobby_rematch'),
  'waiting',
  'lobby rematch waits for the copied group'
);
select extensions.is(
  (select state->>'mode' from road_test_state where step = 'lobby_rematch'),
  'lobby',
  'lobby rematch keeps the original mode'
);
select extensions.isnt(
  (select state->>'id' from road_test_state where step = 'lobby_rematch'),
  (select state->>'id' from road_test_state where step = 'created'),
  'rematch gets a new game id'
);
select extensions.ok(
  (
    select
      rematch.state->>'lobbyCode' ~ '^[2-9A-HJKMNP-Z]{6}$'
      and rematch.state->>'lobbyCode' <> source.state->>'lobbyCode'
    from road_test_state rematch
    join road_test_state source on source.step = 'created'
    where rematch.step = 'lobby_rematch'
  ),
  'lobby rematch gets a fresh unambiguous code'
);
select extensions.ok(
  exists (
    select 1
    from private.games rematch
    join private.games source on source.id = rematch.rematch_of_game_id
    where rematch.id = (
      select (state->>'id')::uuid
      from road_test_state
      where step = 'lobby_rematch'
    )
      and rematch.city_id = source.city_id
      and rematch.difficulty = source.difficulty
  ),
  'lobby rematch keeps city and difficulty'
);
select extensions.is(
  (select jsonb_array_length(state->'players') from road_test_state where step = 'lobby_rematch'),
  2,
  'lobby rematch copies every active player'
);
select extensions.ok(
  not exists (
    (
      select gp.user_id, gp.nickname
      from private.game_players gp
      where gp.game_id = (
        select (state->>'id')::uuid from road_test_state where step = 'created'
      )
        and gp.left_at is null
      except
      select gp.user_id, gp.nickname
      from private.game_players gp
      where gp.game_id = (
        select (state->>'id')::uuid from road_test_state where step = 'lobby_rematch'
      )
        and gp.left_at is null
    )
  ),
  'lobby rematch preserves authenticated users and nicknames'
);
select extensions.ok(
  (
    select (player->>'isHost')::boolean
    from road_test_state state_row,
      lateral jsonb_array_elements(state_row.state->'players') player
    where state_row.step = 'lobby_rematch'
      and player->>'nickname' = 'Hunter One'
  ),
  'the original active host remains host'
);
select extensions.ok(
  (
    select count(*) = 10
      and count(distinct gr.target_street_id) = 10
      and bool_and(gr.status = 'pending')
    from private.game_rounds gr
    where gr.game_id = (
      select (state->>'id')::uuid from road_test_state where step = 'lobby_rematch'
    )
  ),
  'lobby rematch reserves ten distinct pending targets'
);
select extensions.is(
  (
    select rematch.rematch_of_game_id::text
    from private.games rematch
    where rematch.id = (
      select (state->>'id')::uuid from road_test_state where step = 'lobby_rematch'
    )
  ),
  (select state->>'id' from road_test_state where step = 'created'),
  'lobby rematch records its source game'
);

insert into road_test_state (step, state)
select
  'lobby_rematch_repeat',
  public.create_rematch(
    (created.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000001'
  )
from road_test_state created
where created.step = 'created';

select extensions.is(
  (select state->>'id' from road_test_state where step = 'lobby_rematch_repeat'),
  (select state->>'id' from road_test_state where step = 'lobby_rematch'),
  'repeated rematch calls return the same lobby'
);

insert into road_test_state (step, state)
select
  'lobby_rematch_started',
  public.start_game(
    (rematch.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000001'
  )
from road_test_state rematch
where rematch.step = 'lobby_rematch';

select extensions.is(
  (select state->>'status' from road_test_state where step = 'lobby_rematch_started'),
  'playing',
  'host can start a rematch with preallocated rounds'
);
select extensions.is(
  (
    select count(*)
    from private.game_rounds gr
    where gr.game_id = (
      select (state->>'id')::uuid from road_test_state where step = 'lobby_rematch'
    )
  ),
  10::bigint,
  'starting a rematch does not duplicate its target set'
);
select extensions.throws_ok(
  $$
    select public.create_rematch(
      (select (state->>'id')::uuid from road_test_state where step = 'created'),
      'a0000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'You are not an active member of this game.',
  'non-members cannot access an existing rematch'
);

insert into road_test_state (step, state)
values (
  'solo_source',
  public.create_game(
    'solo',
    'leipzig',
    'hard',
    'Solo Hunter',
    'a0000000-0000-4000-8000-000000000003'
  )
);

update private.games
set status = 'finished',
    current_round_number = 10,
    finished_at = statement_timestamp(),
    expires_at = statement_timestamp() + interval '24 hours'
where id = (
  select (state->>'id')::uuid
  from road_test_state
  where step = 'solo_source'
);

insert into road_test_state (step, state)
select
  'solo_rematch',
  public.create_rematch(
    (source.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000003'
  )
from road_test_state source
where source.step = 'solo_source';

select extensions.is(
  (select state->>'mode' from road_test_state where step = 'solo_rematch'),
  'solo',
  'solo rematch keeps solo mode'
);
select extensions.ok(
  (
    select state->>'status' = 'playing'
      and (state->>'roundNumber')::integer = 1
      and state->'currentRound' is not null
    from road_test_state
    where step = 'solo_rematch'
  ),
  'solo rematch starts its first 60-second round immediately'
);
select extensions.is(
  (select state->>'lobbyCode' from road_test_state where step = 'solo_rematch'),
  null,
  'solo rematch has no lobby code'
);
select extensions.ok(
  (
    select jsonb_array_length(state->'players') = 1
      and (state->>'viewerIsHost')::boolean
      and state->'players'->0->>'nickname' = 'Solo Hunter'
    from road_test_state
    where step = 'solo_rematch'
  ),
  'solo rematch preserves its player and host'
);
select extensions.ok(
  (
    select count(*) = 10
      and count(distinct gr.target_street_id) = 10
      and count(*) filter (where gr.status = 'playing') = 1
    from private.game_rounds gr
    where gr.game_id = (
      select (state->>'id')::uuid from road_test_state where step = 'solo_rematch'
    )
  ),
  'solo rematch creates ten targets and starts exactly one'
);
select extensions.is(
  (
    select rematch.rematch_of_game_id::text
    from private.games rematch
    where rematch.id = (
      select (state->>'id')::uuid from road_test_state where step = 'solo_rematch'
    )
  ),
  (select state->>'id' from road_test_state where step = 'solo_source'),
  'solo rematch records its source game'
);

insert into road_test_state (step, state)
select
  'solo_rematch_repeat',
  public.create_rematch(
    (source.state->>'id')::uuid,
    'a0000000-0000-4000-8000-000000000003'
  )
from road_test_state source
where source.step = 'solo_source';

select extensions.is(
  (select state->>'id' from road_test_state where step = 'solo_rematch_repeat'),
  (select state->>'id' from road_test_state where step = 'solo_rematch'),
  'repeated solo rematch calls return the same game'
);

select * from extensions.finish();

rollback;
