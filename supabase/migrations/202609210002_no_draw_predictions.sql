do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'game_predictions_no_draw'
  ) then
    alter table public.game_predictions
      add constraint game_predictions_no_draw check (predicted_home <> predicted_away) not valid;
  end if;
end;
$$;

create or replace function public.save_game_prediction(p_game_id uuid, p_home integer, p_away integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz;
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  if p_home not between 0 and 30 or p_away not between 0 and 30 then raise exception 'Ungültiges Ergebnis'; end if;
  if p_home = p_away then raise exception 'Unentschieden sind im Eishockey nicht möglich'; end if;
  select starts_at into v_start from public.games where id = p_game_id for update;
  if v_start is null then raise exception 'Spiel nicht gefunden'; end if;
  if clock_timestamp() >= v_start then raise exception 'Tippabgabe ist geschlossen'; end if;
  insert into public.game_predictions (user_id, game_id, predicted_home, predicted_away, updated_at)
  values (auth.uid(), p_game_id, p_home, p_away, now())
  on conflict (user_id, game_id) do update set predicted_home = excluded.predicted_home,
    predicted_away = excluded.predicted_away, updated_at = now(), points = null;
end;
$$;

create or replace function public.admin_save_game_prediction(
  p_user_id uuid,
  p_game_id uuid,
  p_home integer,
  p_away integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_home_score integer;
  v_away_score integer;
  v_is_final boolean;
begin
  perform public.assert_current_user_is_admin();
  if p_home not between 0 and 30 or p_away not between 0 and 30 then
    raise exception 'Ungültiges Ergebnis';
  end if;
  if p_home = p_away then raise exception 'Unentschieden sind im Eishockey nicht möglich'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Spieler nicht gefunden';
  end if;
  select home_score, away_score, is_final into v_home_score, v_away_score, v_is_final
  from public.games where id = p_game_id for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;

  insert into public.game_predictions (user_id, game_id, predicted_home, predicted_away, points, updated_at)
  values (
    p_user_id,
    p_game_id,
    p_home,
    p_away,
    case when v_is_final and v_home_score is not null and v_away_score is not null
      then public.game_tip_points(p_home, p_away, v_home_score, v_away_score)
      else null end,
    now()
  )
  on conflict (user_id, game_id) do update set
    predicted_home = excluded.predicted_home,
    predicted_away = excluded.predicted_away,
    points = excluded.points,
    updated_at = now();
end;
$$;
