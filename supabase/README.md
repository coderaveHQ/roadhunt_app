# Roadhunt database

`schemas/00_roadhunt.sql` is the declarative source of truth. The matching
initial migration is committed so `supabase db reset` can recreate the project,
then `seed.sql` loads the twelve-city catalog and deterministic demo geometry.

## Local workflow

```sh
npm run db:start
npm run db:reset
npx supabase test db
```

Make later changes in `schemas/` first, generate a migration with
`supabase db diff -f <name>`, review it, and verify another full reset.

The seed contains 480 synthetic `MultiLineString` targets: ten for every
city/difficulty pair. They make the entire game testable without depending on
Overpass. Before production, replace those rows with the OSM importer output;
the `private.streets` unique key is `(city_id, normalized_name)`.

## Server-only RPC contract

Every RPC below returns a JSON object, uses a fixed empty `search_path`, and is
executable only by `service_role`. A Next.js server action must authenticate the
request and pass the verified Supabase Auth user ID; never accept a client-
supplied user ID without that check.

- `list_catalog(p_locale public.locale = 'de')`
- `search_catalog(p_locale public.locale = 'de', p_query = null, p_limit = 12)`
- `create_game(p_mode, p_city_slug, p_difficulty, p_nickname, p_user_id)`
- `create_rematch(p_game_id, p_user_id)`
- `join_game(p_code, p_nickname, p_user_id)`
- `leave_game(p_game_id, p_user_id)`
- `start_game(p_game_id, p_user_id)`
- `submit_guess(p_game_id, p_round_id, p_user_id, p_lng, p_lat)`
- `synchronize_game(p_game_id, p_user_id)`
- `get_game_state(p_game_id, p_user_id)`
- `cleanup_expired_data(p_delete_anonymous_users = false)`

State DTOs include `viewerPlayerId` and `viewerIsHost`. The current target name
is visible while playing, but target GeoJSON and guess coordinates exist only in
`revealedRounds` or on a current round whose status is `revealing`/`complete`.

The five public catalog tables grant browser roles `SELECT` only and rely on
RLS for enabled-city visibility; all mutations and catalog RPCs remain server
only. Roadhunt migrations create application objects as the `postgres` project
role, revoke that role's default public grants for tables, sequences and
functions, and grant each required privilege explicitly. The broader defaults
owned by Supabase's separate `supabase_admin` superuser are platform-managed:
the project migration role cannot alter them, and Roadhunt must not create
application objects under that owner.

## Realtime and cleanup

Subscribe to `game:<uuid>` with `{ private: true }`, listen for
`state_changed`, and reload `get_game_state`; the broadcast payload deliberately
contains no canonical game state. Presence and Broadcast are authorized through
membership checks on `realtime.messages`. The migration creates only policies
there, which is compatible with the Realtime schema lockdown introduced in
Realtime v2.112.7.

Call `cleanup_expired_data(false)` from Supabase Cron or a Vercel Cron route.
Passing `true` also removes anonymous Auth users older than 30 days who have no
unexpired Roadhunt game; keep it `false` if the Supabase project is shared with
another application. Production should also enable private-only Realtime
channels and Turnstile/hCaptcha for anonymous sign-in in the Supabase Dashboard.
