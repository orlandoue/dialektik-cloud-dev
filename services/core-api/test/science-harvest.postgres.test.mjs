// The daily harvest against a real PostgreSQL server, connected as the
// dialektik_science_harvester login the GitHub Actions job uses.
//
// SCIENCE_TEST_DATABASE_URL: owner URL of a disposable server. CI provides
// it; locally the test is skipped without it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { scienceCommentsSql } from '../../../packages/database/dist/migration/091_science_and_story_comments.js';
import { scienceModerationSql } from '../../../packages/database/dist/migration/092_science_moderation.js';
import { scienceHarvestSql } from '../../../packages/database/dist/migration/093_science_harvest.js';

const ownerUrl = process.env.SCIENCE_TEST_DATABASE_URL;
if (!ownerUrl && process.env.CI) throw new Error('CI must provide SCIENCE_TEST_DATABASE_URL.');
const skip = ownerUrl ? false : 'SCIENCE_TEST_DATABASE_URL is not set';

const reader = '11111111-1111-4111-8111-111111111111';
const password = `harvest-${randomBytes(8).toString('hex')}`;
const database = `science_harvest_${randomBytes(4).toString('hex')}`;
let admin;
let owner;
let harvester;
let db;

const work = (doi, abstract = 'Resumen de los autores.') => ({
  doi, display_name: `Estudio ${doi}`, type: 'article', publication_date: '2026-11-10',
  authorships: [{ author: { display_name: 'Ana Pérez' }, institutions: [{ display_name: 'Universidad de Chile', country_code: 'CL' }] }],
  abstract_inverted_index: abstract === null ? null : Object.fromEntries(abstract.split(' ').map((w, i) => [w, [i]])),
});

function openAlexOnly(works) {
  return async (url) => ({
    ok: true, status: 200,
    async text() {
      if (url.includes('openalex')) return JSON.stringify({ results: works, meta: { next_cursor: null } });
      if (url.includes('europepmc')) return JSON.stringify({ resultList: { result: [] }, nextCursorMark: '*' });
      if (url.includes('arxiv')) return '<feed xmlns="http://www.w3.org/2005/Atom"></feed>';
      return JSON.stringify({ message: { items: [] } }); // Crossref, SciELO Chile prefix
    },
    async json() { return {}; },
  });
}

const options = (works) => ({ fetcher: openAlexOnly(works), now: new Date(), days: 30, limit: 100, arxivCategories: ['astro-ph.GA'] });

before(async () => {
  if (skip) return;
  admin = new pg.Client({ connectionString: ownerUrl });
  await admin.connect();
  for (const role of ['anon', 'authenticated', 'service_role', 'dialektik_core_app']) {
    await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
  }
  await admin.query(`create database ${database}`);
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  owner = new pg.Client({ connectionString: url.toString() });
  await owner.connect();
  await owner.query(`create schema auth;
    create table auth.users(id uuid primary key, created_at timestamptz not null default now(), email text, raw_user_meta_data jsonb);
    create domain dialektik_ulid as text;
    create table public.events(id dialektik_ulid primary key);
    insert into auth.users(id) values ('${reader}'); insert into public.events values ('event1');`);
  for (const migration of [scienceCommentsSql, scienceModerationSql, scienceHarvestSql, scienceHarvestSql]) await owner.query(migration);
  // What the owner does once in the SQL editor.
  await admin.query(`alter role dialektik_science_harvester login password '${password}'`);
  url.username = 'dialektik_science_harvester';
  url.password = password;
  harvester = new pg.Client({ connectionString: url.toString() });
  await harvester.connect();
  const { Kysely, PostgresDialect } = await import('kysely');
  db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url.toString(), max: 2 }) }) });
});

after(async () => {
  if (skip) return;
  await db?.destroy();
  await harvester?.end();
  await owner?.end();
  await admin?.query(`drop database if exists ${database} with (force)`);
  await admin?.query('alter role dialektik_science_harvester nologin');
  await admin?.end();
});

test('the harvester role cannot get around its limits', { skip }, async () => {
  const role = await harvester.query(`select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
  assert.deepEqual(role.rows[0], { name: 'dialektik_science_harvester', rolsuper: false, rolbypassrls: false });
  await owner.query(`insert into public.science_studies(doi, title, review) values ('10.1000/core', 'Resuelto por Core', 'peer_reviewed')`);
  // Moderator fields are out of reach.
  await assert.rejects(harvester.query(`update public.science_studies set design = 'Cohorte'`), { code: '42501' });
  await assert.rejects(harvester.query(`update public.science_studies set abstract_by_moderator = false`), { code: '42501' });
  // Comments, reactions, reports and accounts are out of reach.
  for (const table of ['story_comments', 'story_comment_studies', 'story_comment_reactions', 'story_comment_reports', 'auth.users']) {
    await assert.rejects(harvester.query(`select 1 from ${table.includes('.') ? table : `public.${table}`} limit 1`), { code: '42501' }, table);
  }
  // Every row it adds says it was harvested.
  await assert.rejects(harvester.query(`insert into public.science_studies(doi, title, review) values ('10.1000/stray', 'x', 'preprint')`), { code: '42501' });
});

test('a run adds, updates without losing an abstract, and leaves a moderator\'s abstract alone', { skip }, async () => {
  const { runHarvest } = await import('../dist/science/harvest/harvest.js');
  await owner.query(`insert into public.science_studies(doi, title, review, abstract, abstract_source, abstract_by_moderator)
    values ('10.1000/moderated', 'Cargado por moderador', 'peer_reviewed', 'Resumen del editor.', 'Revista', true)`);
  const first = await runHarvest(db, options([work('10.1000/a'), work('10.1000/b'), work('10.1000/moderated', 'Otro resumen')]));
  assert.equal(first.status, 'ok');
  assert.equal(first.added, 2);
  assert.equal(first.updated, 0);
  const second = await runHarvest(db, options([work('10.1000/a', null)]));
  assert.equal(second.updated, 1);
  const rows = await owner.query(`select doi, abstract, abstract_source, harvest_source, harvested_at is not null as harvested, made_in_chile
    from public.science_studies where doi in ('10.1000/a', '10.1000/moderated') order by doi`);
  assert.deepEqual(rows.rows, [
    { doi: '10.1000/a', abstract: 'Resumen de los autores.', abstract_source: 'OpenAlex', harvest_source: 'openalex_cl', harvested: true, made_in_chile: true },
    { doi: '10.1000/moderated', abstract: 'Resumen del editor.', abstract_source: 'Revista', harvest_source: null, harvested: false, made_in_chile: false },
  ]);
  const run = await owner.query(`select status, added, details from public.science_harvest_runs order by id desc limit 1`);
  assert.equal(run.rows[0].status, 'ok');
  assert.ok(run.rows[0].details.table_bytes.science_studies > 0);
  const usage = await owner.query(`select source, calls from public.science_api_usage order by source`);
  assert.ok(usage.rows.some((r) => r.source === 'openalex' && r.calls >= 2));
});

test('retention removes only old harvested studies that nothing connects or moderated', { skip }, async () => {
  const { runHarvest } = await import('../dist/science/harvest/harvest.js');
  await owner.query(`insert into public.science_studies(doi, title, review, harvested_at, harvest_source, moderated_at) values
    ('10.1000/old', 'Viejo', 'preprint', now() - interval '91 days', 'arxiv', null),
    ('10.1000/old-connected', 'Viejo conectado', 'preprint', now() - interval '91 days', 'arxiv', null),
    ('10.1000/old-moderated', 'Viejo moderado', 'preprint', now() - interval '91 days', 'arxiv', now()),
    ('10.1000/young', 'Reciente', 'preprint', now() - interval '10 days', 'arxiv', null)`);
  await owner.query(`insert into public.story_comments(id, event_id, user_id, kind, status, author_alias, body)
    values ('5f0c2b1e-7a3d-4c8e-9b21-0d6e4f3a2c10', 'event1', '${reader}', 'study', 'in_review', 'Lectora', 'x');
    insert into public.story_comment_studies(comment_id, event_id, doi, claim_quote_id, claim_text, claim_outlet, relation, abstract_fragment)
    values ('5f0c2b1e-7a3d-4c8e-9b21-0d6e4f3a2c10', 'event1', '10.1000/old-connected', 'q1', 'Cita', 'Medio', 'respalda', 'fragmento')`);
  // Row security lets the harvester delete nothing else, even when asked.
  const direct = await harvester.query(`delete from public.science_studies where doi <> '10.1000/old' returning doi`);
  assert.deepEqual(direct.rows, []);
  const report = await runHarvest(db, options([]));
  assert.equal(report.deleted, 1);
  const left = await owner.query(`select doi from public.science_studies where doi like '10.1000/old%' or doi = '10.1000/young' order by doi`);
  assert.deepEqual(left.rows.map((r) => r.doi), ['10.1000/old-connected', '10.1000/old-moderated', '10.1000/young']);
});

test('Core reads the run log to warn when the harvest is late', { skip }, async () => {
  await owner.query(`update public.science_harvest_runs set finished_at = now() - interval '49 hours'`);
  const { ScienceService } = await import('../dist/science/science.service.js');
  const { Kysely, PostgresDialect } = await import('kysely');
  await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'dialektik_core_app') then create role dialektik_core_app; end if; end $$`);
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  const coreDb = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url.toString(), max: 1 }) }) });
  process.env.DIALEKTIK_SCIENCE_MODERATORS = reader;
  try {
    const service = new ScienceService({ database: coreDb }, {});
    const { harvest } = await service.usage(reader);
    assert.equal(harvest.stale, true);
    assert.equal(harvest.last_status, 'ok');
    await owner.query(`update public.science_harvest_runs set finished_at = now()`);
    assert.equal((await service.usage(reader)).harvest.stale, false);
  } finally {
    delete process.env.DIALEKTIK_SCIENCE_MODERATORS;
    await coreDb.destroy();
  }
});
