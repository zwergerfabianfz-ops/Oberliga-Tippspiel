begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sent_tip_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.push_subscriptions enable row level security;
alter table public.sent_tip_reminders enable row level security;

create policy "own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.sent_tip_reminders from anon, authenticated;

commit;
