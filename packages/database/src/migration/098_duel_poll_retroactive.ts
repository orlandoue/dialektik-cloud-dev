import { sql, type Migration } from 'kysely';

// Duels published before the poll rule existed can be retracted by the owner
// (SQL editor) one by one, and each one is logged in duel_poll_decisions
// with stage «retroactive» and its reason. Idempotent.
export const duelPollRetroactiveSql = String.raw`
alter table public.duel_poll_decisions drop constraint if exists duel_poll_decisions_stage_check;
alter table public.duel_poll_decisions add constraint duel_poll_decisions_stage_check
  check (stage in ('candidate', 'promotion', 'retroactive'));
alter table public.duel_poll_decisions add column if not exists duel_id text;

drop policy if exists duel_poll_decisions_owner_retroactive on public.duel_poll_decisions;
drop policy if exists duel_poll_decisions_owner_read on public.duel_poll_decisions;
do $owner$
begin
  -- Supabase runs the SQL editor as «postgres»; forced row security applies
  -- to it too, so it may only add retroactive rows and read the log.
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    create policy duel_poll_decisions_owner_retroactive on public.duel_poll_decisions for insert to postgres
      with check (stage = 'retroactive');
    create policy duel_poll_decisions_owner_read on public.duel_poll_decisions for select to postgres using (true);
  end if;
end
$owner$;
`;

export const duelPollRetroactiveMigration: Migration = {
  async up(db) { await sql.raw(duelPollRetroactiveSql).execute(db); },
  async down() { throw new Error('Duel poll decisions are forward-only.'); },
};
