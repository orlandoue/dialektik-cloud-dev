// Row security of Science mode against a real PostgreSQL server.
//
// PGlite runs every statement as a superuser in one session, so it cannot
// prove row security. Here the owner connection only builds the schema; every
// check runs on a separate login as dialektik_core_app (no superuser, no
// BYPASSRLS), the way Core connects in production.
//
// SCIENCE_TEST_DATABASE_URL: an owner URL of a disposable server. CI starts a
// postgres service; locally the test is skipped without it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { scienceCommentsSql } from '../../../packages/database/dist/migration/091_science_and_story_comments.js';
import { scienceModerationSql } from '../../../packages/database/dist/migration/092_science_moderation.js';
import { scienceReportPrivacySql } from '../../../packages/database/dist/migration/094_science_report_privacy.js';
import { scienceStudyReviewSql } from '../../../packages/database/dist/migration/095_science_study_review.js';
import { scienceTopicsSql } from '../../../packages/database/dist/migration/096_science_topics.js';

const ownerUrl = process.env.SCIENCE_TEST_DATABASE_URL;
if (!ownerUrl && process.env.CI) throw new Error('CI must provide SCIENCE_TEST_DATABASE_URL: row security is not checked otherwise.');
const skip = ownerUrl ? false : 'SCIENCE_TEST_DATABASE_URL is not set';

const reader = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const moderator = '44444444-4444-4444-8444-444444444444';
const corePassword = `core-${randomBytes(8).toString('hex')}`;
const database = `science_rls_${randomBytes(4).toString('hex')}`;

let admin; // owner, on the server's default database
let owner; // owner, on the test database
let core;  // dialektik_core_app, on the test database

const schema = `create schema auth;
  create table auth.users(id uuid primary key, created_at timestamptz not null, email text, raw_user_meta_data jsonb);
  create domain dialektik_ulid as text;
  create table public.events(id dialektik_ulid primary key);
  create table public.public_events(id dialektik_ulid primary key, analysis_state text, detected_at timestamptz default now());
  insert into auth.users values ('${reader}', now() - interval '30 days', 'lectora@example.cl', '{"alias":"Lectora"}'),
    ('${stranger}', now() - interval '30 days', 'otra@example.cl', '{}'),
    ('${moderator}', now() - interval '90 days', null, null);
  insert into public.events values ('event1');
  insert into public.public_events values ('event1', 'PUBLISHED');
  grant select on public.public_events to dialektik_core_app;`;

/** One transaction as dialektik_core_app, with the reader set like Core does. */
async function asCore(user, work, { moderatorFlag = false } = {}) {
  await core.query('begin');
  try {
    if (user !== null) await core.query("select set_config('dialektik.social_user', $1, true)", [user]);
    if (moderatorFlag) await core.query("select set_config('dialektik.science_moderator', 'on', true)");
    return await work();
  } finally {
    await core.query('rollback');
  }
}

/** A refused statement, isolated in a savepoint so the transaction goes on. */
async function refused(statement, code) {
  await core.query('savepoint refused');
  await assert.rejects(statement(), { code });
  await core.query('rollback to savepoint refused');
}

const insertComment = (userId, kind = 'normal', status = 'published') => core.query(
  `insert into public.story_comments(event_id,user_id,kind,status,author_alias,body)
   values ('event1', $1, $2, $3, 'Alias', 'Texto') returning id`, [userId, kind, status]);

before(async () => {
  if (skip) return;
  admin = new pg.Client({ connectionString: ownerUrl });
  await admin.connect();
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
  }
  await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then
    create role dialektik_core_app login; end if; end $$`);
  await admin.query(`alter role dialektik_core_app login nosuperuser nobypassrls password '${corePassword}'`);
  await admin.query(`create database ${database}`);
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  owner = new pg.Client({ connectionString: url.toString() });
  await owner.connect();
  await owner.query(schema);
  await owner.query(scienceCommentsSql);
  await owner.query(scienceModerationSql);
  await owner.query(scienceReportPrivacySql);
  await owner.query(scienceStudyReviewSql);
  await owner.query(scienceTopicsSql);
  await owner.query(scienceTopicsSql);
  // Applying them twice must change nothing (the owner may re-run them).
  await owner.query(scienceCommentsSql);
  await owner.query(scienceModerationSql);
  await owner.query(scienceReportPrivacySql);
  url.username = 'dialektik_core_app';
  url.password = corePassword;
  core = new pg.Client({ connectionString: url.toString() });
  await core.connect();
});

after(async () => {
  if (skip) return;
  await core?.end();
  await owner?.end();
  await admin?.query(`drop database if exists ${database} with (force)`);
  await admin?.end();
});

test('Core connects without any way around row security', { skip }, async () => {
  const role = await core.query(`select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
  assert.deepEqual(role.rows[0], { name: 'dialektik_core_app', rolsuper: false, rolbypassrls: false });
  const tables = await core.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relname in ('science_studies','story_comments','story_comment_studies','story_comment_reactions','science_api_usage',
      'story_comment_reports')
    order by relname`);
  assert.equal(tables.rows.length, 6);
  for (const t of tables.rows) assert.ok(t.relrowsecurity && t.relforcerowsecurity, `${t.relname} must force row security`);
});

test('a comment cannot be written in the name of another account', { skip }, async () => {
  await asCore(reader, async () => {
    await assert.rejects(insertComment(stranger), { code: '42501' });
  });
  // Without a verified reader nothing can be written.
  await asCore(null, async () => {
    await assert.rejects(insertComment(reader), { code: '42501' });
  });
  await asCore(reader, async () => {
    assert.equal((await insertComment(reader)).rows.length, 1);
  });
});

test('a comment with a study cannot skip review, and only a moderator publishes it', { skip }, async () => {
  await asCore(reader, async () => {
    await assert.rejects(insertComment(reader, 'study', 'published'), { code: '42501' });
  });
  await asCore(reader, async () => {
    const { id } = (await insertComment(reader, 'study', 'in_review')).rows[0];
    // The author cannot publish it; the update matches no row.
    const own = await core.query(`update public.story_comments set status = 'published', reviewed_at = now() where id = $1 returning id`, [id]);
    assert.equal(own.rows.length, 0);
    await core.query("select set_config('dialektik.science_moderator', 'on', true)");
    const moderated = await core.query(`update public.story_comments set status = 'published', reviewed_at = now() where id = $1 returning id`, [id]);
    assert.equal(moderated.rows.length, 1);
  });
  // Even a moderator cannot publish a study comment without a review time.
  await asCore(reader, async () => {
    const { id } = (await insertComment(reader, 'study', 'in_review')).rows[0];
    await core.query("select set_config('dialektik.science_moderator', 'on', true)");
    await assert.rejects(core.query(`update public.story_comments set status = 'published' where id = $1`, [id]), { code: '23514' });
  });
});

test('comments are append-only for Core', { skip }, async () => {
  await asCore(reader, async () => {
    await insertComment(reader);
    await assert.rejects(core.query('delete from public.story_comments'), { code: '42501' });
  });
});

test('a study cannot be attached to another reader\'s comment', { skip }, async () => {
  await asCore(reader, async () => {
    await core.query(`insert into public.science_studies(doi, title, review) values ('10.1000/x', 'T', 'peer_reviewed')`);
    const { id } = (await insertComment(reader, 'study', 'in_review')).rows[0];
    await core.query("select set_config('dialektik.social_user', $1, true)", [stranger]);
    await assert.rejects(core.query(`insert into public.story_comment_studies(comment_id,event_id,doi,claim_quote_id,claim_text,claim_outlet,relation,abstract_fragment)
      values ($1,'event1','10.1000/x','q1','Cita','Medio','respalda','fragmento')`, [id]), { code: '42501' });
  });
});

test('reactions belong to the reader who gives them', { skip }, async () => {
  await asCore(reader, async () => {
    const { id } = (await insertComment(reader)).rows[0];
    await refused(() => core.query('insert into public.story_comment_reactions(comment_id,user_id) values ($1,$2)', [id, stranger]), '42501');
    await core.query('insert into public.story_comment_reactions(comment_id,user_id) values ($1,$2)', [id, reader]);
    await core.query("select set_config('dialektik.social_user', $1, true)", [stranger]);
    const removed = await core.query('delete from public.story_comment_reactions where comment_id = $1 returning user_id', [id]);
    assert.equal(removed.rows.length, 0);
  });
});

test('Core reads only the public name of an account, never auth.users', { skip }, async () => {
  await assert.rejects(core.query('select email from auth.users'), { code: '42501' });
  const profile = await core.query('select * from public.dialektik_reader_profile($1)', [reader]);
  assert.deepEqual(Object.keys(profile.rows[0]).sort(), ['alias', 'display_name', 'reader_number']);
  assert.equal(profile.rows[0].alias, 'Lectora');
  const grants = await owner.query(`select has_function_privilege('anon', 'public.dialektik_reader_profile(uuid)', 'execute') as anon,
    has_function_privilege('authenticated', 'public.dialektik_reader_profile(uuid)', 'execute') as authenticated,
    has_table_privilege('anon', 'public.story_comments', 'select') as anon_read`);
  assert.deepEqual(grants.rows[0], { anon: false, authenticated: false, anon_read: false });
});

test('the service, on real connections, refuses one of two simultaneous duplicates', { skip }, async () => {
  const { Kysely, PostgresDialect } = await import('kysely');
  const { ScienceService } = await import('../dist/science/science.service.js');
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  url.username = 'dialektik_core_app';
  url.password = corePassword;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
  const abstract = 'MMR vaccination does not increase the risk for autism in children.';
  await owner.query(`insert into public.science_studies(doi,title,review,abstract,resolved_at)
    values ('10.7326/m18-2101','MMR and autism','peer_reviewed',$1,now()) on conflict do nothing`, [abstract]);
  const publicApi = { async event() { return { body: { positions: [{ assertions: [
    { id: 'quote1', quoted_text: 'La vacuna causa autismo', source_name: 'Radio X', article_id: 'a1' }] }] } }; } };
  const service = new ScienceService({ database: db }, publicApi);
  const input = { doi: '10.7326/m18-2101', claimQuoteId: 'quote1', relation: 'contradice',
    abstractFragment: 'does not increase the risk for autism', body: 'Lo contradice.' };
  try {
    const results = await Promise.allSettled([
      service.addStudyComment(reader, 'event1', input),
      service.addStudyComment(moderator, 'event1', input),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const refused = results.find((r) => r.status === 'rejected').reason;
    assert.equal(refused.getStatus(), 409);
    assert.equal(refused.getResponse().code, 'PUBLIC_SCIENCE_DUPLICATE_IN_REVIEW');
    // The winner's name comes from its profile: «Lectora», or «Lector» for
    // the moderator account, which has neither alias nor e-mail.
    const created = results.find((r) => r.status === 'fulfilled').value;
    assert.ok(['Lectora', 'Lector'].includes(created.author));
    assert.equal(created.status, 'in_review');
  } finally {
    await db.destroy();
  }
});

test('a report is filed in the reader\'s own name, never on their own comment, and only a moderator resolves it', { skip }, async () => {
  await asCore(reader, async () => {
    const { id } = (await insertComment(reader)).rows[0];
    // Own comment.
    await refused(() => core.query(`insert into public.story_comment_reports(comment_id,user_id,reason) values ($1,$2,'spam')`, [id, reader]), '42501');
    await core.query("select set_config('dialektik.social_user', $1, true)", [stranger]);
    // In someone else's name.
    await refused(() => core.query(`insert into public.story_comment_reports(comment_id,user_id,reason) values ($1,$2,'spam')`, [id, moderator]), '42501');
    // Already resolved on arrival.
    await refused(() => core.query(`insert into public.story_comment_reports(comment_id,user_id,reason,resolved_at,resolution)
      values ($1,$2,'spam',now(),'dismissed')`, [id, stranger]), '42501');
    await core.query(`insert into public.story_comment_reports(comment_id,user_id,reason) values ($1,$2,'ofensivo')`, [id, stranger]);
    const unflagged = await core.query(`update public.story_comment_reports set resolved_at = now(), resolution = 'dismissed' returning comment_id`);
    assert.equal(unflagged.rows.length, 0);
    await refused(() => core.query('delete from public.story_comment_reports'), '42501');
    await core.query("select set_config('dialektik.science_moderator', 'on', true)");
    const flagged = await core.query(`update public.story_comment_reports set resolved_at = now(), resolution = 'dismissed' returning comment_id`);
    assert.equal(flagged.rows.length, 1);
  });
});

test('who reported whom is readable only by moderators and by the reporter', { skip }, async () => {
  let commentId;
  await core.query('begin');
  await core.query("select set_config('dialektik.social_user', $1, true)", [reader]);
  commentId = (await insertComment(reader)).rows[0].id;
  await core.query("select set_config('dialektik.social_user', $1, true)", [stranger]);
  await core.query(`insert into public.story_comment_reports(comment_id,user_id,reason,note) values ($1,$2,'ofensivo','nota privada')`, [commentId, stranger]);
  await core.query('commit');
  try {
    // Another reader (the comment's author included) sees no report.
    await asCore(reader, async () => {
      assert.equal((await core.query('select * from public.story_comment_reports')).rows.length, 0);
    });
    // A Core session without a reader sees none either.
    await asCore(null, async () => {
      assert.equal((await core.query('select * from public.story_comment_reports')).rows.length, 0);
    });
    // The reporter sees their own report.
    await asCore(stranger, async () => {
      assert.equal((await core.query('select reason from public.story_comment_reports')).rows[0].reason, 'ofensivo');
    });
    // A moderator sees it.
    await asCore(moderator, async () => {
      const rows = await core.query('select user_id::text as user_id from public.story_comment_reports');
      assert.deepEqual(rows.rows.map((r) => r.user_id), [stranger]);
    }, { moderatorFlag: true });
  } finally {
    await owner.query('delete from public.story_comment_reports');
    await owner.query('delete from public.story_comments where id = $1', [commentId]);
  }
});

test('a moderator only resolves a report: reporter, comment and reason cannot change', { skip }, async () => {
  let commentId;
  await core.query('begin');
  await core.query("select set_config('dialektik.social_user', $1, true)", [reader]);
  commentId = (await insertComment(reader)).rows[0].id;
  await core.query("select set_config('dialektik.social_user', $1, true)", [stranger]);
  await core.query(`insert into public.story_comment_reports(comment_id,user_id,reason) values ($1,$2,'spam')`, [commentId, stranger]);
  await core.query('commit');
  try {
    await asCore(moderator, async () => {
      for (const change of [`user_id = '${moderator}'`, `reason = 'otro'`, `note = 'cambiada'`, `comment_id = comment_id`, `created_at = now()`]) {
        await refused(() => core.query(`update public.story_comment_reports set ${change}`), '42501');
      }
      const resolved = await core.query(`update public.story_comment_reports set resolved_at = now(), resolution = 'hidden' returning reason`);
      assert.equal(resolved.rows[0].reason, 'spam');
      // «Ocultar comentario» leaves the comment as rejected, which the check allows.
      const hidden = await core.query(`update public.story_comments set status = 'rejected', reviewed_at = now(),
        review_reason = 'Insulto personal' where id = $1 returning status`, [commentId]);
      assert.equal(hidden.rows[0].status, 'rejected');
    }, { moderatorFlag: true });
  } finally {
    await owner.query('delete from public.story_comment_reports');
    await owner.query('delete from public.story_comments where id = $1', [commentId]);
  }
});
