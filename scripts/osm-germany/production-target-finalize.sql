\set ON_ERROR_STOP on

delete from private.streets
where source->>'kind' = 'synthetic-demo';

analyze public.cities;
analyze public.city_translations;
analyze public.city_admin_area_translations;
analyze private.streets;
