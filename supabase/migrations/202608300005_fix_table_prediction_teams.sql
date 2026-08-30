begin;

update public.teams team
set is_competitor = exists (
  select 1
  from public.games game
  where game.season_id = team.season_id
    and game.phase = 'regular'
    and not game.is_preseason
    and (game.home_team_id = team.id or game.away_team_id = team.id)
)
where exists (
  select 1 from public.games season_game
  where season_game.season_id = team.season_id and not season_game.is_preseason
);

create or replace function public.save_table_prediction(p_season_id uuid, p_team_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_deadline timestamptz; v_count integer; v_distinct integer;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  select table_prediction_deadline into v_deadline from public.seasons where id = p_season_id for update;
  if v_deadline is null then raise exception 'Saison nicht gefunden'; end if;
  if clock_timestamp() >= v_deadline then raise exception 'Tabellentipp ist geschlossen'; end if;

  with competitor_teams as (
    select home_team_id as team_id from public.games
      where season_id = p_season_id and phase = 'regular' and not is_preseason
    union
    select away_team_id as team_id from public.games
      where season_id = p_season_id and phase = 'regular' and not is_preseason
  )
  select count(*) into v_count from competitor_teams;

  with competitor_teams as (
    select home_team_id as team_id from public.games
      where season_id = p_season_id and phase = 'regular' and not is_preseason
    union
    select away_team_id as team_id from public.games
      where season_id = p_season_id and phase = 'regular' and not is_preseason
  )
  select count(distinct submitted.team_id) into v_distinct
  from unnest(p_team_ids) as submitted(team_id)
  join competitor_teams valid on valid.team_id = submitted.team_id;

  if v_count = 0 then raise exception 'Keine Hauptrunden-Teams gefunden'; end if;
  if cardinality(p_team_ids) <> v_count or v_distinct <> v_count then
    raise exception 'Alle % Hauptrunden-Teams müssen genau einmal enthalten sein', v_count;
  end if;

  delete from public.table_predictions where user_id = auth.uid() and season_id = p_season_id;
  insert into public.table_predictions (user_id, season_id, team_id, predicted_position)
    select auth.uid(), p_season_id, submitted.team_id, submitted.position
    from unnest(p_team_ids) with ordinality as submitted(team_id, position);
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

commit;
