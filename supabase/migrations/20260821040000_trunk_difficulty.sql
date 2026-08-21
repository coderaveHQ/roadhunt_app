create or replace function public.classify_difficulty(
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

revoke execute on function public.classify_difficulty(text[], double precision)
  from public, anon, authenticated;
grant execute on function public.classify_difficulty(text[], double precision)
  to service_role;
