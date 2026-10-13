-- Liefert für die Spieltipps-Rangliste, ob alle Spiele des nächsten
-- Hauptrunden-Spieltags bereits getippt wurden.
create or replace function public.next_matchday_tip_status()
returns table(
  user_id uuid,
  is_complete boolean,
  tipped_games integer,
  total_games integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_season_id uuid;
  v_matchday smallint;
  v_total_games integer;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;

  select id into v_season_id from public.seasons order by created_at desc limit 1;
  if v_season_id is null then return; end if;

  -- Auch ein bereits beendetes, vorgezogenes Spiel gehört noch zum laufenden
  -- Spieltag. Entscheidend ist daher das nächste noch offene Spiel.
  select matchday into v_matchday
  from public.games
  where season_id = v_season_id
    and phase = 'regular'
    and not is_preseason
    and not is_final
    and starts_at >= clock_timestamp() - interval '5 hours'
    and matchday is not null
  order by starts_at
  limit 1;

  if v_matchday is null then return; end if;

  select count(*)::integer into v_total_games
  from public.games
  where season_id = v_season_id
    and phase = 'regular'
    and not is_preseason
    and matchday = v_matchday;

  return query
  select
    p.id,
    count(gp.game_id)::integer = v_total_games,
    count(gp.game_id)::integer,
    v_total_games
  from public.profiles p
  left join public.game_predictions gp on gp.user_id = p.id and gp.game_id in (
    select id from public.games
    where season_id = v_season_id
      and phase = 'regular'
      and not is_preseason
      and matchday = v_matchday
  )
  group by p.id;
end;
$$;

revoke all on function public.next_matchday_tip_status() from public;
grant execute on function public.next_matchday_tip_status() to authenticated;
