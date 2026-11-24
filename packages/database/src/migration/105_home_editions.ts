import { sql, type Migration } from 'kysely';

// The hourly edition of Inicio (migration 105).
// - home_editions: each edition Core composes (every hour, and at once when a
//   story breaks or a moderator changes a pin), with the rules version and
//   the ordered items with their reasons. Public data; only the last two
//   days are kept.
// - home_edition_pins: a moderator fixes a case or story at the top, hides
//   it, or chooses the «Duelo del día», always with an expiry and a reason.
//   Only Core, with the moderator flag it sets for moderators, writes them.
// Idempotent.
export const homeEditionsSql = String.raw`
create table if not exists public.home_editions (
  id bigint generated always as identity primary key,
  country text not null check (country ~ '^[A-Z]{2}$'),
  generated_at timestamptz not null default now(),
  trigger text not null check (trigger in ('hourly', 'breaking', 'moderation', 'startup')),
  rules_version text not null check (char_length(rules_version) between 1 and 40),
  duel_event_id text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
create index if not exists home_editions_latest_idx on public.home_editions (country, generated_at desc);

create table if not exists public.home_edition_pins (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country ~ '^[A-Z]{2}$'),
  target_kind text not null check (target_kind in ('event', 'story')),
  target_id text not null check (char_length(target_id) between 1 and 64),
  action text not null check (action in ('pin', 'hide', 'duel')),
  reason text not null check (char_length(btrim(reason)) between 3 and 200),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  removed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check (action <> 'duel' or target_kind = 'event')
);
create index if not exists home_edition_pins_active_idx on public.home_edition_pins (country, expires_at)
  where removed_at is null;

alter table public.home_editions enable row level security;
alter table public.home_editions force row level security;
alter table public.home_edition_pins enable row level security;
alter table public.home_edition_pins force row level security;
revoke all on public.home_editions, public.home_edition_pins from public, anon, authenticated, service_role;

do $grants$
declare moderator text := $m$coalesce(current_setting('dialektik.science_moderator', true), '') = 'on'$m$;
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant select, insert, delete on public.home_editions to dialektik_core_app;
    grant select, insert on public.home_edition_pins to dialektik_core_app;
    grant update (removed_at) on public.home_edition_pins to dialektik_core_app;
    drop policy if exists home_editions_read on public.home_editions;
    drop policy if exists home_editions_write on public.home_editions;
    drop policy if exists home_editions_expire on public.home_editions;
    drop policy if exists home_edition_pins_read on public.home_edition_pins;
    drop policy if exists home_edition_pins_create on public.home_edition_pins;
    drop policy if exists home_edition_pins_remove on public.home_edition_pins;
    create policy home_editions_read on public.home_editions for select to dialektik_core_app using (true);
    create policy home_editions_write on public.home_editions for insert to dialektik_core_app with check (true);
    -- Only editions older than two days are ever deleted.
    create policy home_editions_expire on public.home_editions for delete to dialektik_core_app
      using (generated_at < now() - interval '2 days');
    create policy home_edition_pins_read on public.home_edition_pins for select to dialektik_core_app using (true);
    execute format('create policy home_edition_pins_create on public.home_edition_pins for insert to dialektik_core_app with check (%s and created_by::text = coalesce(current_setting(''dialektik.social_user'', true), ''''))', moderator);
    execute format('create policy home_edition_pins_remove on public.home_edition_pins for update to dialektik_core_app using (%s) with check (%s)', moderator, moderator);
  end if;
end
$grants$;
`;

export const homeEditionsMigration: Migration = {
  async up(db) { await sql.raw(homeEditionsSql).execute(db); },
  async down() { throw new Error('Home editions are forward-only.'); },
};
