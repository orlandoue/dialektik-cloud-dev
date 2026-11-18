// Sightings against a real PostgreSQL server (migration 099): hourly writes,
// no dead rows from repeated polls, and access only for receipt writers.
// SCIENCE_TEST_DATABASE_URL: owner URL of a disposable server.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { liveItemSightingsSql } from '../../../packages/database/dist/migration/099_live_item_sightings.js';

const ownerUrl = process.env.SCIENCE_TEST_DATABASE_URL;
if (!ownerUrl && process.env.CI) throw new Error('CI must provide SCIENCE_TEST_DATABASE_URL.');
const skip = ownerUrl ? false : 'SCIENCE_TEST_DATABASE_URL is not set';
const database = `sightings_${randomBytes(4).toString('hex')}`;
const writer = `live_writer_${randomBytes(3).toString('hex')}`;
const item = 'a'.repeat(64);
let admin;
let owner;
let db;

before(async () => {
  if (skip) return;
  admin = new pg.Client({ connectionString: ownerUrl });
  await admin.connect();
  for (const role of ['anon', 'authenticated']) {
    await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
  }
  await admin.query(`create role ${writer} nologin`);
  await admin.query(`create database ${database}`);
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  owner = new pg.Client({ connectionString: url.toString() });
  await owner.connect();
  // The two tables of 017 that sightings depend on (columns used here).
  await owner.query(`create table public.live_exposure_exclusions(id text primary key);
    create table public.live_acquisition_receipts(id text primary key, exclusion_id text references public.live_exposure_exclusions(id),
      seen_at timestamptz not null);
    insert into public.live_exposure_exclusions values ('${item}');
    grant insert on public.live_acquisition_receipts to ${writer};
    grant select on public.live_acquisition_receipts to anon;`);
  await owner.query(liveItemSightingsSql);
  await owner.query(liveItemSightingsSql);
  const { Kysely, PostgresDialect } = await import('kysely');
  db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url.toString(), max: 2 }) }) });
});

after(async () => {
  if (skip) return;
  await db?.destroy();
  await owner?.end();
  await admin?.query(`drop database if exists ${database} with (force)`);
  await admin?.query(`drop role if exists ${writer}`);
  await admin?.end();
});

test('a repeat within the hour changes nothing in the row, even after a restart; after an hour it counts', { skip }, async () => {
  const { SightingRecorder } = await import('../dist/live/live-sightings.js');
  const t0 = new Date('2026-11-19T03:00:00Z');
  assert.equal(await new SightingRecorder().record(db, item, t0), 'written');
  const version = async () => (await owner.query(`select xmin::text as v, sightings, last_seen_at from public.live_item_sightings`)).rows[0];
  const first = await version();
  assert.equal(first.sightings, 1);
  // A restarted process (empty throttle) 10 min later: the row is not rewritten.
  assert.equal(await new SightingRecorder().record(db, item, new Date(t0.getTime() + 10 * 60_000)), 'written');
  assert.deepEqual(await version(), first, 'same row version: no dead row');
  // An hour later it moves.
  await new SightingRecorder().record(db, item, new Date(t0.getTime() + 61 * 60_000));
  const later = await version();
  assert.equal(later.sightings, 2);
  assert.equal(later.last_seen_at.toISOString(), '2026-11-19T04:01:00.000Z');
});

test('only roles that write receipts (and Core, to read) reach sightings', { skip }, async () => {
  const can = async (role, privilege) => (await owner.query(
    `select has_table_privilege($1, 'public.live_item_sightings', $2) as ok`, [role, privilege])).rows[0].ok;
  assert.equal(await can(writer, 'UPDATE'), true);
  assert.equal(await can('anon', 'SELECT'), false);
  assert.equal(await can('authenticated', 'SELECT'), false);
  const rls = await owner.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'live_item_sightings'`);
  assert.deepEqual(rls.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
});
