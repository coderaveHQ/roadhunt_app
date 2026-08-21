\set ON_ERROR_STOP on

-- Only disposable importer-owned data is removed here. Roadhunt catalog,
-- games, players and guesses are deliberately outside this schema.
drop schema if exists osm_import cascade;
create schema osm_import;
revoke all on schema osm_import from public, anon, authenticated;
grant usage, create on schema osm_import to postgres;

comment on schema osm_import is
  'Disposable staging tables produced by the pinned Roadhunt Germany OSM import';
