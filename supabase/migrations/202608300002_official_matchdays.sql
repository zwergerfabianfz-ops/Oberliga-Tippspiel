begin;

alter table public.games
  add column if not exists matchday smallint check (matchday > 0);

create index if not exists games_season_matchday_idx
  on public.games(season_id, phase, matchday);

create or replace view public.games_with_my_predictions with (security_invoker = true) as
select g.id, g.season_id, g.phase, g.starts_at, g.home_team_id, home.name home_team_name,
  home.short_name home_team_short_name, g.away_team_id, away.name away_team_name,
  away.short_name away_team_short_name, g.home_score, g.away_score, g.is_final,
  p.predicted_home, p.predicted_away, p.points prediction_points, g.is_live, g.matchday
from public.games g join public.teams home on home.id = g.home_team_id
join public.teams away on away.id = g.away_team_id
left join public.game_predictions p on p.game_id = g.id and p.user_id = auth.uid();

commit;
