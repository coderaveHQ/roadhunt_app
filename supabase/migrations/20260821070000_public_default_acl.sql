alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- Supabase owns its platform defaults as the superuser-only supabase_admin
-- role. The project migration role cannot and should not mutate those defaults.
-- Every Roadhunt application object is migration-owned by postgres, whose
-- public defaults are locked down above and whose object ACLs are explicit.
