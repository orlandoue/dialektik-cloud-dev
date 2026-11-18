import { sql, type Migration } from 'kysely';

// The poll rule for duels (DIALEKTIK_POLL_DUEL_RULE) logs every pair it
// vetoes, with its reason, and every «Distinta cifra» duel, so moderators can
// check whether it separates too much. Only moderators read it (the
// dialektik.science_moderator flag Core sets for them). Kept 30 days.
// Idempotent.
export const duelPollDecisionsSql = String.raw`
create table if not exists public.duel_poll_decisions (
  id bigint generated always as identity primary key,
  decided_at timestamptz not null default now(),
  stage text not null check (stage in ('candidate', 'promotion')),
  outcome text not null check (outcome in ('veto', 'distinta_cifra')),
  reason text check (reason is null or reason in ('poll_and_non_poll', 'pollster_missing', 'different_pollster',
    'different_subject', 'different_round')),
  left_article_id text not null,
  right_article_id text not null,
  left_outlet text,
  right_outlet text,
  left_title text not null,
  right_title text not null,
  left_pollster text,
  right_pollster text,
  constraint duel_poll_decisions_pair unique (stage, left_article_id, right_article_id),
  constraint duel_poll_decisions_reason check ((outcome = 'veto') = (reason is not null))
);
create index if not exists duel_poll_decisions_recent_idx on public.duel_poll_decisions (decided_at desc);
alter table public.duel_poll_decisions enable row level security;
alter table public.duel_poll_decisions force row level security;

drop policy if exists duel_poll_decisions_write on public.duel_poll_decisions;
drop policy if exists duel_poll_decisions_read on public.duel_poll_decisions;
drop policy if exists duel_poll_decisions_retention on public.duel_poll_decisions;
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    grant select, insert, delete on public.duel_poll_decisions to dialektik_core_app;
    create policy duel_poll_decisions_write on public.duel_poll_decisions for insert to dialektik_core_app with check (true);
    create policy duel_poll_decisions_read on public.duel_poll_decisions for select to dialektik_core_app
      using (current_setting('dialektik.science_moderator', true) = 'on');
    create policy duel_poll_decisions_retention on public.duel_poll_decisions for delete to dialektik_core_app
      using (decided_at < now() - interval '30 days');
  end if;
end
$grants$;
`;

export const duelPollDecisionsMigration: Migration = {
  async up(db) { await sql.raw(duelPollDecisionsSql).execute(db); },
  async down() { throw new Error('Duel poll decisions are forward-only.'); },
};
