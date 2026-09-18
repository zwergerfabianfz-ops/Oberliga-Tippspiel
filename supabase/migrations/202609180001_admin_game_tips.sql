-- Adminrechte sind an das konkrete Benutzerkonto gebunden, nicht an die App-Oberfläche.
alter table public.profiles add column if not exists is_admin boolean not null default false;

update public.profiles p
set is_admin = true
from auth.users u
where p.id = u.id
  and lower(u.email) = 'fabian.zwerger@web.de';

create or replace function public.prevent_admin_flag_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_admin is distinct from new.is_admin then
    raise exception 'Adminrechte können nicht über die App geändert werden';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_admin_flag_protected on public.profiles;
create trigger profile_admin_flag_protected
before update on public.profiles
for each row execute procedure public.prevent_admin_flag_change();

create or replace function public.assert_current_user_is_admin()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  ) then
    raise exception 'Adminberechtigung erforderlich';
  end if;
end;
$$;

create or replace function public.admin_list_users()
returns table(user_id uuid, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_current_user_is_admin();
  return query select p.id, p.display_name from public.profiles p order by lower(p.display_name);
end;
$$;

create or replace function public.admin_user_game_predictions(p_user_id uuid)
returns table(game_id uuid, predicted_home integer, predicted_away integer, points integer, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_current_user_is_admin();
  return query
    select gp.game_id, gp.predicted_home::integer, gp.predicted_away::integer, gp.points::integer, gp.updated_at
    from public.game_predictions gp
    where gp.user_id = p_user_id;
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

create or replace function public.admin_game_tips_export()
returns table(
  player text,
  game_date timestamptz,
  phase text,
  home_team text,
  away_team text,
  tip_home integer,
  tip_away integer,
  actual_home integer,
  actual_away integer,
  game_finished boolean,
  points integer,
  tip_updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.assert_current_user_is_admin();
  return query
    select p.display_name, g.starts_at, g.phase::text, home.name, away.name,
      gp.predicted_home::integer, gp.predicted_away::integer,
      g.home_score::integer, g.away_score::integer, g.is_final,
      gp.points::integer, gp.updated_at
    from public.game_predictions gp
    join public.profiles p on p.id = gp.user_id
    join public.games g on g.id = gp.game_id
    join public.teams home on home.id = g.home_team_id
    join public.teams away on away.id = g.away_team_id
    order by g.starts_at, lower(p.display_name);
end;
$$;

revoke all on function public.assert_current_user_is_admin() from public;
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_user_game_predictions(uuid) from public;
revoke all on function public.admin_save_game_prediction(uuid, uuid, integer, integer) from public;
revoke all on function public.admin_game_tips_export() from public;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_user_game_predictions(uuid) to authenticated;
grant execute on function public.admin_save_game_prediction(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.admin_game_tips_export() to authenticated;
