create table if not exists public.team_standings (
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  position smallint not null check (position > 0),
  games_played smallint not null default 0 check (games_played >= 0),
  wins smallint not null default 0 check (wins >= 0),
  losses smallint not null default 0 check (losses >= 0),
  goals_for smallint not null default 0 check (goals_for >= 0),
  goals_against smallint not null default 0 check (goals_against >= 0),
  goal_difference smallint not null default 0,
  points smallint not null default 0 check (points >= 0),
  updated_at timestamptz not null default now(),
  primary key (season_id, team_id),
  unique (season_id, position)
);

alter table public.team_standings enable row level security;
create policy "authenticated standings read" on public.team_standings for select to authenticated using (true);
