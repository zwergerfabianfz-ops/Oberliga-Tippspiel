-- Anzeigenamen werden ohne führende/abschließende Leerzeichen gespeichert und
-- unabhängig von Groß-/Kleinschreibung eindeutig behandelt.
update public.profiles
set display_name = regexp_replace(trim(display_name), '\s+', ' ', 'g');

-- Falls vor dieser Migration bereits gleiche Namen existieren, bleibt der
-- älteste unverändert und die weiteren erhalten einen kurzen eindeutigen Zusatz.
with duplicate_names as (
  select id, row_number() over (
    partition by lower(display_name)
    order by created_at, id
  ) as duplicate_number
  from public.profiles
)
update public.profiles as profile
set display_name = left(profile.display_name, 17) || ' #' || left(replace(profile.id::text, '-', ''), 10)
from duplicate_names
where profile.id = duplicate_names.id
  and duplicate_names.duplicate_number > 1;

create unique index if not exists profiles_display_name_unique_idx
  on public.profiles (lower(display_name));

create or replace function public.is_display_name_available(p_display_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select char_length(regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g')) between 2 and 30
    and not exists (
      select 1
      from public.profiles
      where lower(display_name) = lower(regexp_replace(trim(p_display_name), '\s+', ' ', 'g'))
    );
$$;

create or replace function public.update_my_display_name(p_display_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if char_length(normalized_name) not between 2 and 30 then
    raise exception 'Der Anzeigename muss zwischen 2 und 30 Zeichen lang sein.';
  end if;

  update public.profiles
  set display_name = normalized_name
  where id = auth.uid();

  return normalized_name;
exception
  when unique_violation then
    raise exception 'Dieser Anzeigename ist bereits vergeben.' using errcode = '23505';
end;
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := regexp_replace(
    trim(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))),
    '\s+',
    ' ',
    'g'
  );
begin
  insert into public.profiles (id, display_name)
  values (new.id, normalized_name);
  return new;
end;
$$;

revoke all on function public.is_display_name_available(text) from public;
revoke all on function public.update_my_display_name(text) from public;
grant execute on function public.is_display_name_available(text) to anon, authenticated;
grant execute on function public.update_my_display_name(text) to authenticated;
