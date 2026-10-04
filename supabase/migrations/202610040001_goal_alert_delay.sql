-- Globale Einstellung für den Toralarm. Sie ist nur über die Admin-RPCs änderbar.
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  goal_alert_delay_seconds integer not null default 30
    check (goal_alert_delay_seconds between 0 and 60),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, goal_alert_delay_seconds)
values (true, 30)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create table if not exists public.goal_alert_queue (
  id bigint generated always as identity primary key,
  involved_team_ids uuid[] not null check (cardinality(involved_team_ids) = 2),
  title text not null,
  body text not null,
  send_after timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists goal_alert_queue_send_after_idx
  on public.goal_alert_queue(send_after);

alter table public.goal_alert_queue enable row level security;
revoke all on public.goal_alert_queue from anon, authenticated;

create or replace function public.admin_goal_alert_delay_seconds()
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_delay integer;
begin
  perform public.assert_current_user_is_admin();
  select goal_alert_delay_seconds into v_delay from public.app_settings where id = true;
  return coalesce(v_delay, 30);
end;
$$;

create or replace function public.admin_update_goal_alert_delay(p_seconds integer)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_current_user_is_admin();
  if p_seconds not between 0 and 60 then
    raise exception 'Die Verzögerung muss zwischen 0 und 60 Sekunden liegen';
  end if;
  update public.app_settings
  set goal_alert_delay_seconds = p_seconds, updated_at = now()
  where id = true;
  return p_seconds;
end;
$$;

revoke all on function public.admin_goal_alert_delay_seconds() from public;
revoke all on function public.admin_update_goal_alert_delay(integer) from public;
grant execute on function public.admin_goal_alert_delay_seconds() to authenticated;
grant execute on function public.admin_update_goal_alert_delay(integer) to authenticated;
