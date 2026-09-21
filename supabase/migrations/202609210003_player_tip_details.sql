drop function if exists public.game_leaderboard(uuid);

create function public.game_leaderboard(p_season_id uuid default null)
returns table(user_id uuid, rank bigint, display_name text, points bigint, exact_tips bigint)
language sql stable security definer set search_path = '' as $$
  select p.id,
    rank() over(order by sum(coalesce(gp.points, 0)) desc, count(*) filter (where gp.points = 3) desc),
    p.display_name, sum(coalesce(gp.points, 0)), count(*) filter (where gp.points = 3)
  from public.profiles p left join public.game_predictions gp on gp.user_id = p.id
    and gp.game_id in (
      select id from public.games
      where season_id = coalesce(p_season_id, (select id from public.seasons order by created_at desc limit 1))
        and not is_preseason
    )
  group by p.id, p.display_name;
$$;

create or replace function public.player_final_game_predictions(p_user_id uuid)
returns table(
  game_id uuid,
  starts_at timestamptz,
  home_team_name text,
  away_team_name text,
  predicted_home integer,
  predicted_away integer,
  home_score integer,
  away_score integer,
  points integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  return query
    select g.id, g.starts_at, home.name, away.name,
      gp.predicted_home::integer, gp.predicted_away::integer,
      g.home_score::integer, g.away_score::integer, gp.points::integer
    from public.game_predictions gp
    join public.games g on g.id = gp.game_id
    join public.teams home on home.id = g.home_team_id
    join public.teams away on away.id = g.away_team_id
    where gp.user_id = p_user_id
      and g.is_final
      and not g.is_preseason
    order by g.starts_at desc;
end;
$$;

revoke all on function public.game_leaderboard(uuid) from public;
revoke all on function public.player_final_game_predictions(uuid) from public;
grant execute on function public.game_leaderboard(uuid) to authenticated;
grant execute on function public.player_final_game_predictions(uuid) to authenticated;
