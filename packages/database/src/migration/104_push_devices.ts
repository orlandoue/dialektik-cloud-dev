import { sql, type Migration } from 'kysely';

// Push notices (Firebase Cloud Messaging), migration 104. One row per phone:
// its FCM token, the reader it belongs to, whether they want the «Duelo del
// día» and at what hour (Chile time), and the last duel sent, so a reader is
// never sent the same duel twice nor more than one notice a day.
// The table has no direct grants: Core reaches it only through the
// functions below, which check the reader or the sender flag. A token that
// moves to another account (a shared phone) changes owner on registration.
// Idempotent.
export const pushDevicesSql = String.raw`
create table if not exists public.push_devices (
  token text primary key check (char_length(token) between 20 and 4096),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android' check (platform in ('android')),
  daily_enabled boolean not null default true,
  daily_hour smallint not null default 9 check (daily_hour between 0 and 23),
  country text not null default 'CL' check (country ~ '^[A-Z]{2}$'),
  last_daily_sent_on date,
  last_daily_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on public.push_devices (user_id);
create index if not exists push_devices_daily_idx on public.push_devices (daily_hour) where daily_enabled;
alter table public.push_devices enable row level security;
alter table public.push_devices force row level security;
revoke all on public.push_devices from public, anon, authenticated, service_role;

create or replace function public.dialektik_register_push_device(
  p_user uuid, p_token text, p_daily_enabled boolean, p_daily_hour integer, p_country text
) returns void
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  if p_user is null or p_user::text <> coalesce(current_setting('dialektik.social_user', true), '') then
    raise exception 'PUSH_DEVICE_USER_MISMATCH';
  end if;
  insert into public.push_devices (token, user_id, daily_enabled, daily_hour, country)
  values (p_token, p_user, coalesce(p_daily_enabled, true), coalesce(p_daily_hour, 9), coalesce(p_country, 'CL'))
  on conflict (token) do update set
    user_id = excluded.user_id,
    daily_enabled = excluded.daily_enabled,
    daily_hour = excluded.daily_hour,
    country = excluded.country,
    updated_at = now();
end
$fn$;

create or replace function public.dialektik_unregister_push_device(p_user uuid, p_token text)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  if p_user is null or p_user::text <> coalesce(current_setting('dialektik.social_user', true), '') then
    raise exception 'PUSH_DEVICE_USER_MISMATCH';
  end if;
  delete from public.push_devices where token = p_token and user_id = p_user;
end
$fn$;

-- Sender side: only with the flag Core sets in its own transaction.
create or replace function public.dialektik_push_daily_due(p_hour integer, p_day date)
returns table (token text, country text, last_event_id text)
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  if coalesce(current_setting('dialektik.push_sender', true), '') <> 'on' then
    raise exception 'PUSH_SENDER_REQUIRED';
  end if;
  return query select d.token, d.country, d.last_daily_event_id from public.push_devices d
    where d.daily_enabled and d.daily_hour = p_hour
      and (d.last_daily_sent_on is null or d.last_daily_sent_on < p_day)
    order by d.token limit 5000;
end
$fn$;

create or replace function public.dialektik_push_daily_mark(p_tokens text[], p_day date, p_event_id text)
returns integer
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare n integer;
begin
  if coalesce(current_setting('dialektik.push_sender', true), '') <> 'on' then
    raise exception 'PUSH_SENDER_REQUIRED';
  end if;
  update public.push_devices set last_daily_sent_on = p_day, last_daily_event_id = coalesce(p_event_id, last_daily_event_id)
    where token = any(p_tokens);
  get diagnostics n = row_count;
  return n;
end
$fn$;

-- Tokens FCM reports as no longer registered (app removed, data cleared).
create or replace function public.dialektik_push_forget(p_tokens text[])
returns integer
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare n integer;
begin
  if coalesce(current_setting('dialektik.push_sender', true), '') <> 'on' then
    raise exception 'PUSH_SENDER_REQUIRED';
  end if;
  delete from public.push_devices where token = any(p_tokens);
  get diagnostics n = row_count;
  return n;
end
$fn$;

revoke all on function public.dialektik_register_push_device(uuid, text, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.dialektik_unregister_push_device(uuid, text) from public, anon, authenticated;
revoke all on function public.dialektik_push_daily_due(integer, date) from public, anon, authenticated;
revoke all on function public.dialektik_push_daily_mark(text[], date, text) from public, anon, authenticated;
revoke all on function public.dialektik_push_forget(text[]) from public, anon, authenticated;
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant execute on function public.dialektik_register_push_device(uuid, text, boolean, integer, text) to dialektik_core_app;
    grant execute on function public.dialektik_unregister_push_device(uuid, text) to dialektik_core_app;
    grant execute on function public.dialektik_push_daily_due(integer, date) to dialektik_core_app;
    grant execute on function public.dialektik_push_daily_mark(text[], date, text) to dialektik_core_app;
    grant execute on function public.dialektik_push_forget(text[]) to dialektik_core_app;
  end if;
end
$grants$;
`;

export const pushDevicesMigration: Migration = {
  async up(db) { await sql.raw(pushDevicesSql).execute(db); },
  async down() { throw new Error('Push devices are forward-only.'); },
};
