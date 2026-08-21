-- Germany is production reference data, not a local development fixture.
-- Keep this migration idempotent so existing projects retain their country ID.
insert into public.countries (id, code, default_locale)
values ('00000000-0000-4000-8000-000000000001', 'DE', 'de')
on conflict (code) do update
set default_locale = excluded.default_locale;

insert into public.country_translations (country_id, locale, name)
select country.id, translation.locale, translation.name
from public.countries country
cross join (
  values
    ('de'::public.locale, 'Deutschland'::text),
    ('en'::public.locale, 'Germany'::text)
) as translation (locale, name)
where country.code = 'DE'
on conflict (country_id, locale) do update
set name = excluded.name;
