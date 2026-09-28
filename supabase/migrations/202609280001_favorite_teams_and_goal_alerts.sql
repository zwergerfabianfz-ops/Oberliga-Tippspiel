begin;

alter table public.profiles
  add column if not exists favorite_team_id uuid references public.teams(id) on delete set null;

create index if not exists profiles_favorite_team_id_idx on public.profiles(favorite_team_id)
  where favorite_team_id is not null;

create or replace function public.update_my_favorite_team(p_team_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Anmeldung erforderlich'; end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'Dieses Team existiert nicht.';
  end if;
  update public.profiles set favorite_team_id = p_team_id where id = auth.uid();
  return p_team_id;
end;
$$;

revoke all on function public.update_my_favorite_team(uuid) from public;
grant execute on function public.update_my_favorite_team(uuid) to authenticated;

-- Stores the score seen by the goal-alert job. A first observation establishes
-- the baseline; only a later score increase triggers a notification.
create table if not exists public.goal_alert_states (
  game_id uuid primary key references public.games(id) on delete cascade,
  home_score smallint not null check (home_score >= 0),
  away_score smallint not null check (away_score >= 0),
  updated_at timestamptz not null default now()
);

alter table public.goal_alert_states enable row level security;
revoke all on public.goal_alert_states from anon, authenticated;

commit;
