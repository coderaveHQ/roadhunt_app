create or replace function private.synchronize_game_locked(p_game_id uuid, p_now timestamptz)
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

    if v_round.revealed_at + interval '15 seconds' <= p_now then
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

create or replace function private.build_game_state(p_game_id uuid, p_user_id uuid)
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
          else gr.revealed_at + interval '15 seconds'
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
    'revealDurationSeconds', 15,
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
