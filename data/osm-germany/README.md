# Roadhunt Germany OpenStreetMap import

Roadhunt uses a pinned full-Germany extract instead of issuing one Overpass
request per city. The generated PBF and PostgreSQL staging data are deliberately
not committed.

## Pinned source and license

- Provider: [Geofabrik Germany extracts](https://download.geofabrik.de/europe/germany.html)
- Snapshot: `germany-260819.osm.pbf`
- OSM data timestamp: `2026-08-19T20:20:48Z`
- Size: `4,821,837,039` bytes
- MD5: `14a4f4ce1ab3ace8e858efa73b43c78f`
- Data: © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright)

The cache path is
`data/osm-germany/cache/germany-260819.osm.pbf`. Both `cache/` and `work/` are
gitignored. Keep the attribution visible in every Roadhunt map.

## Requirements

- Node.js 24+, `psql`, Docker/Supabase and a running local Roadhunt database
- Prefer native `osm2pgsql 2.3.1`; on macOS:
  `brew install osm2pgsql`
- Allow at least 100 GiB of free disk space for raw staging, clipped
  intermediates and grouped geometries. Germany imports also benefit from 10+
  GiB RAM.
- Docker fallback: digest-pinned image
  `iboates/osm2pgsql@sha256:25ad3e2c316f4c582f188c88d50bdae4b7d67671ade99c9a7539d2c2a2c0a670`.
  It is currently `linux/amd64`, so Apple Silicon runs it under emulation and
  is substantially slower than the native binary.

The versioned Flex style follows the current
[osm2pgsql 2.x Flex output](https://osm2pgsql.org/doc/manual.html#the-flex-output).

## Run

Start from a database whose migrations are current. The default URL is limited
to local Supabase on port `55322`:

```sh
npm run db:start
npm run db:reset
npm run osm:import -- all --runtime native
```

Individual, restartable phases are available:

```sh
npm run osm:import -- download
npm run osm:import -- stage --runtime native
npm run osm:import -- publish
npm run osm:import -- verify
```

`stage` recreates only the disposable `osm_import` schema. It uses
`osm2pgsql --slim --drop`, so temporary middle tables are removed after the PBF
load. `publish` validates minimum Germany-scale boundary and road counts before
building clipped intermediates. Only after those validations pass does a
transaction upsert `public.cities`, translations and `private.streets`.

The raw stage retains every named `highway` way from the extract. Published
Roadhunt streets cover exactly the named way portions with positive line overlap
inside an imported German municipality boundary. PBF edge fragments, offshore
ways and point-only boundary contacts are therefore not municipality streets.
For mixed same-name groups, source OSM IDs and road classes remain documented,
but playable target geometry and length contain only eligible segments.
`trunk`/`trunk_link`, `primary` and `secondary` classes are Easy; motorway and
other excluded classes never become target geometry.

Existing games, players, rounds and guesses are never deleted. Previous OSM or
synthetic street rows that are absent from the new snapshot are retained but
marked unplayable, which preserves historical foreign keys. Imported roads are
cut at municipal borders; a road crossing a boundary can therefore be a target
in both municipalities with municipality-specific geometry.

Each enabled municipality also receives German and English administrative-area
metadata for catalog disambiguation. `adminArea.stateName` comes from the
covering German `admin_level=4` boundary with an AGS-prefix fallback;
`districtName` comes from the smallest distinct covering `admin_level=6`
boundary and can be `null` for independent cities. `adminArea.code` is the
municipality key: normally the eight-digit AGS, otherwise the deterministic
`osm-r<relation-id>` fallback. The pinned snapshot gate currently requires all
10,941 enabled municipalities to have an AGS, so it permits zero active
fallbacks.

A non-local database is rejected unless `--allow-remote` is explicit. Treat a
remote publish as a production data migration: take a backup, review the pinned
snapshot and run `verify` afterwards.

## Micro production transfer

Do not run the full spatial transformation against a Micro production project.
Export only the already-published local catalog into a compressed, checksummed
archive and restore that archive into a fresh production database:

```sh
npm run osm:export:production
export ROADHUNT_PRODUCTION_DATABASE_URL='<direct-or-session-pooler-url>'
npm run osm:restore:production -- --allow-remote
unset ROADHUNT_PRODUCTION_DATABASE_URL
```

The target must already contain every migration, including the production DE
reference-data migration, and must have empty catalog and game tables. The
restore uses one transaction and one worker, includes no `osm_import` staging,
removes the 480 disabled synthetic fixtures, analyzes the restored tables, and
checks the exact pinned city, street, geometry and difficulty-pool contracts.
The database URL is read only from the process environment so its password does
not appear in command arguments or repository files.

If the machine running Codex cannot open outbound PostgreSQL ports, the same
final dataset can be streamed over Supabase HTTPS instead. Install
`scripts/osm-germany/production-http-import-install.sql` temporarily through
the SQL Editor, then run:

```sh
export ROADHUNT_PRODUCTION_SECRET_KEY='<existing-sb_secret-key>'
npm run osm:restore:production:https
unset ROADHUNT_PRODUCTION_SECRET_KEY
```

The HTTPS path sends bounded, retryable batches and is safe to resume because
every insert is idempotent. It excludes synthetic fixtures before transfer and
checks the same pinned counts, snapshot metadata and difficulty pools. After a
successful final verification, run
`scripts/osm-germany/production-http-import-uninstall.sql` so the temporary
service-role-only RPC does not remain in production.

## Legacy twelve-city snapshot

The older Overpass transformer and its small SQL artifacts remain under
`scripts/import-osm.ts` and `data/osm/` for focused fixtures and regression
tests. Invoke it with `npm run osm:import:legacy`; it is not the source for the
Germany-wide catalog.
