import { sql, type Migration } from 'kysely';

// Repeated, unchanged sightings of a feed item (migration 099). A receipt is
// the evidence of what was seen and is written only when that evidence
// changes; each further poll of the same item only moves last_seen_at here,
// at most once per hour, instead of adding a receipt (the receipts table had
// reached 301 MB of a 500 MB free database). Readable and writable by the
// roles that write receipts; no access for public, anon or authenticated.
// Idempotent.
export const liveItemSightingsSql = String.raw`
create table if not exists public.live_item_sightings (
  exclusion_id text primary key references public.live_exposure_exclusions(id),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  sightings integer not null default 1 check (sightings > 0),
  constraint live_item_sightings_order check (last_seen_at >= first_seen_at)
);
alter table public.live_item_sightings enable row level security;
alter table public.live_item_sightings force row level security;
revoke all on public.live_item_sightings from public;
do $grants$
declare
  r record;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.live_item_sightings from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.live_item_sightings from authenticated';
  end if;
  -- Whoever may write receipts may count sightings.
  for r in
    select rolname from pg_roles
    where not rolsuper and rolname not in ('anon', 'authenticated', 'service_role', 'public')
      and has_table_privilege(rolname, 'public.live_acquisition_receipts', 'INSERT')
  loop
    execute format('grant select, insert, update on public.live_item_sightings to %I', r.rolname);
    execute format('drop policy if exists %I on public.live_item_sightings', 'live_item_sightings_' || r.rolname);
    execute format('create policy %I on public.live_item_sightings for all to %I using (true) with check (true)',
      'live_item_sightings_' || r.rolname, r.rolname);
  end loop;
  -- Core reads last_seen_at for the news API.
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant select on public.live_item_sightings to dialektik_core_app;
    drop policy if exists live_item_sightings_core_read on public.live_item_sightings;
    create policy live_item_sightings_core_read on public.live_item_sightings for select to dialektik_core_app using (true);
  end if;
end
$grants$;
`;

export const liveItemSightingsMigration: Migration = {
  async up(db) { await sql.raw(liveItemSightingsSql).execute(db); },
  async down() { throw new Error('Live item sightings are forward-only.'); },
};
