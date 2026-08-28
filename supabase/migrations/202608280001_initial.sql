create extension if not exists pgcrypto;

create type public.season_status as enum ('upcoming', 'regular', 'playoffs', 'finished');
create type public.game_phase as enum ('regular', 'playoffs');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 30),
  created_at timestamptz not null default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  external_division_id text not null unique,
  table_prediction_deadline timestamptz not null,
  playoffs_start_at timestamptz,
  status public.season_status not null default 'upcoming',
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  external_id text not null,
  name text not null,
  short_name text not null,
  logo_url text,
  actual_position smallint check (actual_position > 0),
  unique (season_id, external_id),
  unique (season_id, actual_position)
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  external_id text not null,
  phase public.game_phase not null,
  starts_at timestamptz not null,
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  home_score smallint check (home_score between 0 and 30),
  away_score smallint check (away_score between 0 and 30),
  is_final boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (season_id, external_id),
  check (home_team_id <> away_team_id),
  check ((home_score is null) = (away_score is null))
);

create table public.game_predictions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  predicted_home smallint not null check (predicted_home between 0 and 30),
  predicted_away smallint not null check (predicted_away between 0 and 30),
  points smallint check (points between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table public.table_predictions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  predicted_position smallint not null check (predicted_position > 0),
  points smallint,
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id, team_id),
  unique (user_id, season_id, predicted_position)
);

create index games_starts_at_idx on public.games(starts_at);
create index games_season_phase_idx on public.games(season_id, phase);
create index game_predictions_user_idx on public.game_predictions(user_id);
create index table_predictions_user_idx on public.table_predictions(user_id);

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger auth_user_created after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.game_tip_points(ph integer, pa integer, ah integer, aa integer)
returns integer language sql immutable strict as $$
  select case
    when ph = ah and pa = aa then 3
    when ph - pa = ah - aa then 2
    when sign(ph - pa) = sign(ah - aa) then 1
    else 0
  end;
$$;

create or replace function public.rescore_game_predictions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_final and new.home_score is not null and new.away_score is not null then
    update public.game_predictions
      set points = public.game_tip_points(predicted_home, predicted_away, new.home_score, new.away_score)
      where game_id = new.id;
  elsif not new.is_final then
    update public.game_predictions set points = null where game_id = new.id;
  end if;
  return new;
end;
$$;

create trigger game_result_changed after insert or update of home_score, away_score, is_final on public.games
for each row execute procedure public.rescore_game_predictions();

create or replace function public.save_game_prediction(p_game_id uuid, p_home integer, p_away integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  if p_home not between 0 and 30 or p_away not between 0 and 30 then raise exception 'Ungültiges Ergebnis'; end if;
  select starts_at into v_start from public.games where id = p_game_id for update;
  if v_start is null then raise exception 'Spiel nicht gefunden'; end if;
  if clock_timestamp() >= v_start then raise exception 'Tippabgabe ist geschlossen'; end if;
  insert into public.game_predictions (user_id, game_id, predicted_home, predicted_away, updated_at)
  values (auth.uid(), p_game_id, p_home, p_away, now())
  on conflict (user_id, game_id) do update set predicted_home = excluded.predicted_home,
    predicted_away = excluded.predicted_away, updated_at = now(), points = null;
end;
$$;

create or replace function public.save_table_prediction(p_season_id uuid, p_team_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_deadline timestamptz; v_count integer; v_distinct integer;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  select table_prediction_deadline into v_deadline from public.seasons where id = p_season_id for update;
  if v_deadline is null then raise exception 'Saison nicht gefunden'; end if;
  if clock_timestamp() >= v_deadline then raise exception 'Tabellentipp ist geschlossen'; end if;
  select count(*) into v_count from public.teams where season_id = p_season_id;
  select count(distinct x) into v_distinct from unnest(p_team_ids) x
    join public.teams t on t.id = x and t.season_id = p_season_id;
  if cardinality(p_team_ids) <> v_count or v_distinct <> v_count then raise exception 'Alle Teams müssen genau einmal enthalten sein'; end if;
  delete from public.table_predictions where user_id = auth.uid() and season_id = p_season_id;
  insert into public.table_predictions (user_id, season_id, team_id, predicted_position)
    select auth.uid(), p_season_id, team_id, position
    from unnest(p_team_ids) with ordinality as chosen(team_id, position);
end;
$$;

create or replace function public.rescore_table_predictions(p_season_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  select count(*) into v_count from public.teams where season_id = p_season_id;
  if exists (select 1 from public.teams where season_id = p_season_id and actual_position is null) then
    raise exception 'Abschlusstabelle ist noch unvollständig';
  end if;
  update public.table_predictions tp set points = greatest(0, v_count - abs(tp.predicted_position - t.actual_position))
  from public.teams t where tp.team_id = t.id and tp.season_id = p_season_id;
end;
$$;

create or replace view public.games_with_my_predictions with (security_invoker = true) as
select g.id, g.season_id, g.phase, g.starts_at, g.home_team_id, home.name home_team_name,
  home.short_name home_team_short_name, g.away_team_id, away.name away_team_name,
  away.short_name away_team_short_name, g.home_score, g.away_score, g.is_final,
  p.predicted_home, p.predicted_away, p.points prediction_points
from public.games g join public.teams home on home.id = g.home_team_id
join public.teams away on away.id = g.away_team_id
left join public.game_predictions p on p.game_id = g.id and p.user_id = auth.uid();

create or replace function public.game_leaderboard(p_season_id uuid default null)
returns table(rank bigint, display_name text, points bigint, exact_tips bigint)
language sql stable security definer set search_path = '' as $$
  select rank() over(order by sum(coalesce(gp.points, 0)) desc, count(*) filter (where gp.points = 3) desc),
    p.display_name, sum(coalesce(gp.points, 0)), count(*) filter (where gp.points = 3)
  from public.profiles p left join public.game_predictions gp on gp.user_id = p.id
    and gp.game_id in (
      select id from public.games where season_id = coalesce(p_season_id, (select id from public.seasons order by created_at desc limit 1))
    )
  group by p.id, p.display_name;
$$;

create or replace function public.table_leaderboard(p_season_id uuid default null)
returns table(rank bigint, display_name text, points bigint)
language sql stable security definer set search_path = '' as $$
  select rank() over(order by sum(coalesce(tp.points, 0)) desc), p.display_name, sum(coalesce(tp.points, 0))
  from public.profiles p join public.table_predictions tp on tp.user_id = p.id
  join public.seasons s on s.id = tp.season_id and s.status = 'finished'
    and s.id = coalesce(p_season_id, (select id from public.seasons where status = 'finished' order by created_at desc limit 1))
  group by p.id, p.display_name;
$$;

alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.teams enable row level security;
alter table public.games enable row level security;
alter table public.game_predictions enable row level security;
alter table public.table_predictions enable row level security;

create policy "own profile read" on public.profiles for select using (id = auth.uid());
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "authenticated seasons read" on public.seasons for select to authenticated using (true);
create policy "authenticated teams read" on public.teams for select to authenticated using (true);
create policy "authenticated games read" on public.games for select to authenticated using (true);
create policy "own game tips read" on public.game_predictions for select using (user_id = auth.uid());
create policy "own table tips read" on public.table_predictions for select using (user_id = auth.uid());

revoke all on function public.rescore_table_predictions(uuid) from public;
revoke all on function public.save_game_prediction(uuid, integer, integer) from public;
revoke all on function public.save_table_prediction(uuid, uuid[]) from public;
revoke all on function public.game_leaderboard(uuid) from public;
revoke all on function public.table_leaderboard(uuid) from public;
grant execute on function public.rescore_table_predictions(uuid) to service_role;
grant execute on function public.save_game_prediction(uuid, integer, integer) to authenticated;
grant execute on function public.save_table_prediction(uuid, uuid[]) to authenticated;
grant execute on function public.game_leaderboard(uuid) to authenticated;
grant execute on function public.table_leaderboard(uuid) to authenticated;
