begin;

alter table public.games
  add column if not exists is_preseason boolean not null default false;

alter table public.teams
  add column if not exists is_competitor boolean not null default true;

create index if not exists games_season_preseason_idx
  on public.games(season_id, is_preseason, starts_at);

create or replace function public.rescore_game_predictions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_preseason then
    update public.game_predictions set points = null where game_id = new.id;
  elsif new.is_final and new.home_score is not null and new.away_score is not null then
    update public.game_predictions
      set points = public.game_tip_points(predicted_home, predicted_away, new.home_score, new.away_score)
      where game_id = new.id;
  else
    update public.game_predictions set points = null where game_id = new.id;
  end if;
  return new;
end;
$$;

create or replace view public.games_with_my_predictions with (security_invoker = true) as
select g.id, g.season_id, g.phase, g.starts_at, g.home_team_id, home.name home_team_name,
  home.short_name home_team_short_name, g.away_team_id, away.name away_team_name,
  away.short_name away_team_short_name, g.home_score, g.away_score, g.is_final,
  p.predicted_home, p.predicted_away, p.points prediction_points, g.is_live, g.matchday,
  g.is_preseason
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
      select id from public.games
      where season_id = coalesce(p_season_id, (select id from public.seasons order by created_at desc limit 1))
        and not is_preseason
    )
  group by p.id, p.display_name;
$$;

create or replace function public.save_table_prediction(p_season_id uuid, p_team_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_deadline timestamptz; v_count integer; v_distinct integer;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  select table_prediction_deadline into v_deadline from public.seasons where id = p_season_id for update;
  if v_deadline is null then raise exception 'Saison nicht gefunden'; end if;
  if clock_timestamp() >= v_deadline then raise exception 'Tabellentipp ist geschlossen'; end if;
  select count(*) into v_count from public.teams where season_id = p_season_id and is_competitor;
  select count(distinct x) into v_distinct from unnest(p_team_ids) x
    join public.teams t on t.id = x and t.season_id = p_season_id and t.is_competitor;
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
  select count(*) into v_count from public.teams where season_id = p_season_id and is_competitor;
  if exists (select 1 from public.teams where season_id = p_season_id and is_competitor and actual_position is null) then
    raise exception 'Abschlusstabelle ist noch unvollständig';
  end if;
  update public.table_predictions tp set points = greatest(0, v_count - abs(tp.predicted_position - t.actual_position))
  from public.teams t where tp.team_id = t.id and tp.season_id = p_season_id and t.is_competitor;
end;
$$;

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
    and (
      not g.is_preseason
      or clock_timestamp() < (
        select min(regular.starts_at)
        from public.games regular
        where regular.season_id = g.season_id and not regular.is_preseason
      )
    )
  order by g.starts_at desc, p.display_name;
end;
$$;

commit;
