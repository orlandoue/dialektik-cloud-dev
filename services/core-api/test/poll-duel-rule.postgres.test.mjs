// The poll rule's veto log (migration 097) against a real PostgreSQL server,
// connected as dialektik_core_app. SCIENCE_TEST_DATABASE_URL: owner URL of a
// disposable server; skipped locally without it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { duelPollDecisionsSql } from '../../../packages/database/dist/migration/097_duel_poll_decisions.js';
import { duelPollRetroactiveSql } from '../../../packages/database/dist/migration/098_duel_poll_retroactive.js';

const ownerUrl = process.env.SCIENCE_TEST_DATABASE_URL;
if (!ownerUrl && process.env.CI) throw new Error('CI must provide SCIENCE_TEST_DATABASE_URL.');
const skip = ownerUrl ? false : 'SCIENCE_TEST_DATABASE_URL is not set';
const moderator = '44444444-4444-4444-8444-444444444444';
const password = `core-${randomBytes(8).toString('hex')}`;
const database = `poll_rule_${randomBytes(4).toString('hex')}`;
let admin;
let owner;
let coreUrl;

before(async () => {
  if (skip) return;
  admin = new pg.Client({ connectionString: ownerUrl });
  await admin.connect();
  await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    create role dialektik_core_app login; end if; end $$`);
  await admin.query(`alter role dialektik_core_app login nosuperuser nobypassrls password '${password}'`);
  await admin.query(`create database ${database}`);
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  owner = new pg.Client({ connectionString: url.toString() });
  await owner.connect();
  await owner.query(`create domain dialektik_ulid as text;
    create table public.sources(id dialektik_ulid primary key, name text not null);
    insert into public.sources values ('S1', 'Ex-Ante'), ('S2', 'Cooperativa.cl');
    grant select on public.sources to dialektik_core_app;`);
  await owner.query(duelPollDecisionsSql);
  await owner.query(duelPollDecisionsSql);
  await owner.query(duelPollRetroactiveSql);
  await owner.query(duelPollRetroactiveSql);
  url.username = 'dialektik_core_app';
  url.password = password;
  coreUrl = url.toString();
});

after(async () => {
  if (skip) return;
  await owner?.end();
  await admin?.query(`drop database if exists ${database} with (force)`);
  await admin?.end();
});

const at = new Date('2026-11-16T12:00:00Z');
const side = (articleId, sourceId, title) => ({ articleId, sourceId, text: { title, publishedAt: at } });

test('each veto is logged once with its reason; only moderators read it; old rows expire', { skip }, async () => {
  const { Kysely, PostgresDialect, sql } = await import('kysely');
  const { recordPollDecision } = await import('../dist/semantic/poll-duel-rule.js');
  const { comparePolls } = await import('../dist/semantic/poll-measurement.js');
  const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: coreUrl, max: 2 }) }) });
  try {
    const criteria = side('A1', 'S1', 'Criteria: aprobación de Kast bajo el 20%, llega a 18%');
    const cadem = side('A2', 'S2', 'Cadem: aprobación de Kast cayó al 27%');
    const verdict = comparePolls(criteria.text, cadem.text);
    assert.deepEqual(verdict, { kind: 'different', reason: 'different_pollster' });
    await recordPollDecision(db, 'candidate', criteria, cadem, verdict);
    await recordPollDecision(db, 'candidate', criteria, cadem, verdict);
    // Not a poll pair: nothing to log.
    await recordPollDecision(db, 'candidate', side('A3', 'S1', 'Kast viaja'), side('A4', 'S2', 'Kast llega'), { kind: 'not_poll' });
    const rows = await owner.query(`select stage, outcome, reason, left_outlet, right_outlet, left_pollster, right_pollster
      from public.duel_poll_decisions`);
    assert.deepEqual(rows.rows, [{ stage: 'candidate', outcome: 'veto', reason: 'different_pollster', left_outlet: 'Ex-Ante',
      right_outlet: 'Cooperativa.cl', left_pollster: 'Criteria', right_pollster: 'Cadem' }]);
    // Without the moderator flag Core reads nothing.
    assert.equal((await sql`select count(*)::int as n from public.duel_poll_decisions`.execute(db)).rows[0].n, 0);
    const asModerator = await db.transaction().execute(async (tx) => {
      await sql`select set_config('dialektik.science_moderator', 'on', true)`.execute(tx);
      return (await sql`select count(*)::int as n from public.duel_poll_decisions`.execute(tx)).rows[0].n;
    });
    assert.equal(asModerator, 1);
    // Retention: only rows older than 30 days can be deleted.
    await owner.query(`insert into public.duel_poll_decisions(stage, outcome, reason, left_article_id, right_article_id, left_title,
      right_title, decided_at) values ('promotion', 'veto', 'different_round', 'B1', 'B2', 'x', 'y', now() - interval '31 days')`);
    const { purgePollDecisions } = await import('../dist/semantic/poll-duel-rule.js');
    // Whatever Core asks, only rows older than 30 days are deleted.
    await sql`delete from public.duel_poll_decisions`.execute(db);
    let left = await owner.query('select left_article_id from public.duel_poll_decisions');
    assert.deepEqual(left.rows.map((r) => r.left_article_id), ['A1']);
    await owner.query(`insert into public.duel_poll_decisions(stage, outcome, reason, left_article_id, right_article_id, left_title,
      right_title, decided_at) values ('promotion', 'veto', 'different_round', 'C1', 'C2', 'x', 'y', now() - interval '40 days')`);
    await purgePollDecisions(db);
    left = await owner.query('select left_article_id from public.duel_poll_decisions');
    assert.deepEqual(left.rows.map((r) => r.left_article_id), ['A1']);
    // Core cannot rewrite a reason.
    await assert.rejects(sql`update public.duel_poll_decisions set reason = null`.execute(db), { code: '42501' });

    const { ScienceService } = await import('../dist/science/science.service.js');
    process.env.DIALEKTIK_SCIENCE_MODERATORS = moderator;
    try {
      const service = new ScienceService({ database: db }, {});
      const { decisions } = await service.pollDecisions(moderator);
      assert.equal(decisions.length, 1);
      assert.equal(decisions[0].reason, 'different_pollster');
      await assert.rejects(service.pollDecisions('11111111-1111-4111-8111-111111111111'), (e) => e.getStatus() === 403);
    } finally { delete process.env.DIALEKTIK_SCIENCE_MODERATORS; }
  } finally { await db.destroy(); }
});

test('098: a duel published before the rule is logged as «retroactive» with its duel id', { skip }, async () => {
  await owner.query(`insert into public.duel_poll_decisions(stage, outcome, reason, duel_id, left_article_id, right_article_id,
    left_title, right_title) values ('retroactive', 'veto', 'different_pollster', 'D1', 'R1', 'R2', 'Criteria', 'Cadem')`);
  const row = await owner.query(`select stage, duel_id from public.duel_poll_decisions where left_article_id = 'R1'`);
  assert.deepEqual(row.rows, [{ stage: 'retroactive', duel_id: 'D1' }]);
  await assert.rejects(owner.query(`insert into public.duel_poll_decisions(stage, outcome, reason, left_article_id, right_article_id,
    left_title, right_title) values ('otra', 'veto', 'different_pollster', 'R3', 'R4', 'x', 'y')`), { code: '23514' });
});
