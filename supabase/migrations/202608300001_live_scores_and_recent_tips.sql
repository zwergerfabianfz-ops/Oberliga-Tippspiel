begin;

alter table public.games
  add column if not exists is_live boolean not null default false;

create or replace view public.games_with_my_predictions with (security_invoker = true) as
select g.id, g.season_id, g.phase, g.starts_at, g.home_team_id, home.name home_team_name,
  home.short_name home_team_short_name, g.away_team_id, away.name away_team_name,
  away.short_name away_team_short_name, g.home_score, g.away_score, g.is_final,
  p.predicted_home, p.predicted_away, p.points prediction_points, g.is_live
from public.games g join public.teams home on home.id = g.home_team_id
join public.teams away on away.id = g.away_team_id
left join public.game_predictions p on p.game_id = g.id and p.user_id = auth.uid();

create or replace function public.recent_game_predictions()
returns table(
  game_id uuid,
  starts_at timestamptz,
  home_team_id uuid,
  home_team_name text,
  home_team_short_name text,
  home_team_logo_url text,
  away_team_id uuid,
  away_team_name text,
  away_team_short_name text,
  away_team_logo_url text,
  home_score smallint,
  away_score smallint,
  is_live boolean,
  is_final boolean,
  display_name text,
  predicted_home smallint,
  predicted_away smallint,
  points smallint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;

  return query
  select g.id, g.starts_at,
    home.id, home.name, home.short_name, home.logo_url,
    away.id, away.name, away.short_name, away.logo_url,
    g.home_score, g.away_score, g.is_live, g.is_final,
    p.display_name, gp.predicted_home, gp.predicted_away, gp.points
  from public.games g
  join public.teams home on home.id = g.home_team_id
  join public.teams away on away.id = g.away_team_id
  join public.game_predictions gp on gp.game_id = g.id
  join public.profiles p on p.id = gp.user_id
  where g.season_id = (select s.id from public.seasons s order by s.created_at desc limit 1)
    and g.starts_at <= clock_timestamp()
    and g.starts_at >= clock_timestamp() - interval '14 days'
  order by g.starts_at desc, p.display_name;
end;
$$;

revoke all on function public.recent_game_predictions() from public;
grant execute on function public.recent_game_predictions() to authenticated;

commit;
