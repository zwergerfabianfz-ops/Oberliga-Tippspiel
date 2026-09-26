-- Rankings can change places in one live update. Updating a team by its
-- primary key then briefly collides with a unique rank constraint (for example
-- when rank 2 and rank 3 swap). The HockeyData table rank remains the source
-- of truth, so this secondary uniqueness constraint is not needed.
alter table public.team_standings
  drop constraint if exists team_standings_season_id_position_key;
