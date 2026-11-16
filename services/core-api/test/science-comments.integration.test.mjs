import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { scienceCommentsSql } from '../../../packages/database/dist/migration/091_science_and_story_comments.js';

const veteran = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const newcomer = '33333333-3333-4333-8333-333333333333';
const moderator = '44444444-4444-4444-8444-444444444444';

const baseSchema = `create schema auth; create table auth.users(id uuid primary key, created_at timestamptz not null, email text, raw_user_meta_data jsonb);
  create domain dialektik_ulid as text;
  create role anon; create role authenticated; create role service_role; create role dialektik_core_app;
  create table public.events(id dialektik_ulid primary key);
  create table public.public_events(id dialektik_ulid primary key, analysis_state text, detected_at timestamptz default now());
  insert into auth.users values('${veteran}', now() - interval '30 days', 'Veterano@Example.cl', '{}'),
    ('${other}', now() - interval '10 days', 'ana@example.cl', '{"alias":"Ana <b>","full_name":"Ana Pérez"}'),
    ('${newcomer}', now() - interval '1 day', 'nuevo@example.cl', '{"full_name":"Nuevo Lector"}'),
    ('${moderator}', now() - interval '90 days', null, null);
  insert into public.events values('event1'),('draft');
  insert into public.public_events values('event1','PUBLISHED'),('draft','ANALYSIS_PENDING');
  grant select on public.public_events to dialektik_core_app;`;

const ABSTRACT = 'The study strongly supports that MMR vaccination does not increase the risk for autism, does not trigger autism in susceptible children, and is not associated with clustering of autism cases after vaccination.';

function fetcher(retracted = false) {
  return async (url) => {
    if (url.includes('api.crossref.org')) {
      return { ok: true, status: 200, async json() { return { message: {
        title: ['Measles, Mumps, Rubella Vaccination and Autism: A Nationwide Cohort Study'],
        type: 'journal-article', author: [{ family: 'Hviid', given: 'Anders' }],
        'container-title': ['Annals of Internal Medicine'], published: { 'date-parts': [[2019, 4, 16]] },
        abstract: `<jats:p>${ABSTRACT}</jats:p>`,
        ...(retracted ? { 'updated-by': [{ type: 'retraction', updated: { 'date-parts': [[2010, 2, 2]] } }] } : {}),
      } }; } };
    }
    return { ok: true, status: 200, async json() { return { language: 'en', open_access: { is_oa: false },
      authorships: [{ institutions: [{ display_name: 'Statens Serum Institut', country_code: 'DK' }] }] }; } };
  };
}

const publicApi = { async event(id) {
  return { body: { positions: id === 'event1' ? [{ assertions: [
    { id: 'quote1', quoted_text: 'La vacuna triple viral causa autismo', source_name: 'Radio X (YouTube)', article_id: 'a1' },
    { id: 'quote2', quoted_text: 'No hay evidencia de riesgo', source_name: 'Diario Y', article_id: 'a2' },
  ] }] : [] } };
} };

/** The app's «Lector-NNNN» (Dart, 64-bit ints). */
function readerAlias(email) {
  let hash = 0x811c9dc5n;
  for (const unit of email.trim().toLowerCase()) hash = ((hash ^ BigInt(unit.charCodeAt(0))) * 0x01000193n) & 0xffffffffn;
  return `Lector-${1000n + hash % 9000n}`;
}

async function setup({ retracted = false } = {}) {
  const pg = new PGlite();
  await pg.exec(baseSchema);
  await pg.exec(scienceCommentsSql);
  await pg.exec('set role dialektik_core_app');
  const { Kysely, PostgresDialect } = await import('kysely');
  const { ScienceService } = await import('../dist/science/science.service.js');
  const run = async (query, values) => {
    const text = typeof query === 'string' ? query : query.text; const params = values ?? query.values ?? [];
    if (params.length) return pg.query(text, params);
    const results = await pg.exec(text); return results.at(-1) ?? { rows: [] };
  };
  const pool = { async connect() { return { query: run, release() {} }; }, async end() {} };
  const database = new Kysely({ dialect: new PostgresDialect({ pool }) });
  const service = new ScienceService({ database }, publicApi);
  service.fetcher = fetcher(retracted);
  return { pg, database, service };
}

const DOI = '10.7326/m18-2101';
const studyInput = (over = {}) => ({ doi: DOI, claimQuoteId: 'quote1', relation: 'contradice',
  abstractFragment: 'MMR vaccination does not increase the risk for autism', body: 'Un estudio de cohorte danés lo contradice.', ...over });

async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.getStatus(), status);
    if (code) assert.equal(error.getResponse().code, code);
    return true;
  });
}

test('a study is resolved once, cached and shown with «No informado» fields as null', async () => {
  const { pg, database, service } = await setup();
  try {
    const study = await service.study(DOI);
    assert.equal(study.title, 'Measles, Mumps, Rubella Vaccination and Autism: A Nationwide Cohort Study');
    assert.equal(study.review, 'peer_reviewed');
    assert.equal(study.published_at, '2019-04-16');
    assert.equal(study.access, 'Pago');
    assert.equal(study.design, null);
    assert.equal(study.sample_size, null);
    assert.equal(study.made_in_chile, false);
    service.fetcher = async () => { throw new Error('should use the cache'); };
    assert.equal((await service.study(DOI)).doi, DOI);
  } finally { await database.destroy(); await pg.close(); }
});

test('comments: normal ones publish at once, study ones go through review', async () => {
  const { pg, database, service } = await setup();
  try {
    // The name comes from the profile, sanitised like the app does.
    const normal = await service.addComment(other, 'event1', { body: 'Interesante', parentId: null });
    assert.equal(normal.status, 'published');
    assert.equal(normal.author, 'Ana b');
    const reply = await service.addComment(veteran, 'event1', { body: 'Coincido', parentId: normal.id });
    assert.equal(reply.parent_id, normal.id);
    assert.equal(reply.author, readerAlias('Veterano@Example.cl'));
    // Only one level of replies.
    await rejectsWith(service.addComment(other, 'event1', { body: 'x', parentId: reply.id }), 400, 'PUBLIC_SCIENCE_INVALID_PARENT');
    await rejectsWith(service.addComment(other, 'draft', { body: 'x', parentId: null }), 404);

    const withStudy = await service.addStudyComment(veteran, 'event1', studyInput());
    assert.equal(withStudy.status, 'in_review');
    assert.equal(withStudy.attachment.claim_text, 'La vacuna triple viral causa autismo');
    assert.equal(withStudy.attachment.claim_outlet, 'Radio X');
    assert.equal(withStudy.attachment.relation, 'contradice');

    // The author sees it in review; others do not until it is approved.
    assert.equal((await service.storyComments(veteran, 'event1')).comments.length, 3);
    assert.equal((await service.storyComments(other, 'event1')).comments.length, 2);
    assert.equal((await service.study(DOI)).citing_comments, 0);

    await rejectsWith(service.decide(other, withStudy.id, true), 403);
    process.env.DIALEKTIK_SCIENCE_MODERATORS = moderator;
    try {
      const queue = await service.moderationQueue(moderator);
      assert.deepEqual(queue.comments.map((c) => [c.id, c.event_id]), [[withStudy.id, 'event1']]);
      assert.equal((await service.decide(moderator, withStudy.id, true)).status, 'published');
      const study = await service.moderateStudy(moderator, DOI, { design: 'Cohorte', sample_size: 657461 });
      assert.equal(study.design, 'Cohorte');
      assert.equal(study.sample_size, 657461);
      assert.equal(study.population, null);
    } finally { delete process.env.DIALEKTIK_SCIENCE_MODERATORS; }

    assert.equal((await service.storyComments(other, 'event1')).comments.length, 3);
    const study = await service.study(DOI);
    assert.equal(study.citing_comments, 1);
    assert.equal(study.connected_stories, 1);
    assert.deepEqual((await service.listStudies('conectados')).studies.map((s) => s.doi), [DOI]);
    assert.deepEqual((await service.listStudies('chile')).studies, []);
    assert.equal((await service.commentsCitingStudy(other, DOI)).comments.length, 1);

    // Reactions toggle, one per reader.
    assert.equal((await service.react(other, withStudy.id, true)).reactions, 1);
    assert.equal((await service.react(other, withStudy.id, true)).reactions, 1);
    const reacted = await service.react(veteran, withStudy.id, true);
    assert.equal(reacted.reactions, 2);
    assert.equal(reacted.reacted, true);
    assert.equal((await service.react(other, withStudy.id, false)).reactions, 1);
  } finally { await database.destroy(); await pg.close(); }
});

test('study comments are refused for duplicates, paraphrases, unknown claims and new accounts', async () => {
  const { pg, database, service } = await setup();
  try {
    await service.addStudyComment(veteran, 'event1', studyInput());
    await rejectsWith(service.addStudyComment(other, 'event1', studyInput()), 409, 'PUBLIC_SCIENCE_DUPLICATE');
    // The same study on another claim is fine.
    assert.equal((await service.addStudyComment(other, 'event1', studyInput({ claimQuoteId: 'quote2', relation: 'respalda' }))).status, 'in_review');
    await rejectsWith(service.addStudyComment(other, 'event1', studyInput({ claimQuoteId: 'quote2', abstractFragment: 'vaccines are safe' })), 422, 'PUBLIC_SCIENCE_NOT_LITERAL');
    await rejectsWith(service.addStudyComment(other, 'event1', studyInput({ claimQuoteId: 'nope' })), 400, 'PUBLIC_SCIENCE_INVALID_CLAIM');
    await rejectsWith(service.addStudyComment(newcomer, 'event1', studyInput({ claimQuoteId: 'quote2' })), 403, 'PUBLIC_SCIENCE_ACCOUNT_TOO_NEW');
    // Literal match tolerates curly quotes and extra spaces.
    await assert.doesNotReject(service.addStudyComment(moderator, 'event1', studyInput({ claimQuoteId: 'quote2',
      relation: 'matiza', abstractFragment: '  does not   trigger autism  ' })).catch((e) => {
      if (e.getResponse?.().code === 'PUBLIC_SCIENCE_DUPLICATE') return; throw e; }));
  } finally { await database.destroy(); await pg.close(); }
});

test('a retracted study cannot be attached', async () => {
  const { pg, database, service } = await setup({ retracted: true });
  try {
    const study = await service.study(DOI);
    assert.equal(study.retracted, true);
    assert.equal(study.retracted_at, '2010-02-02');
    await rejectsWith(service.addStudyComment(veteran, 'event1', studyInput()), 410, 'PUBLIC_SCIENCE_RETRACTED');
  } finally { await database.destroy(); await pg.close(); }
});

test('row security binds comments and reactions to the reader and review to moderators', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(baseSchema); await pg.exec(scienceCommentsSql);
    await pg.exec('set role dialektik_core_app');
    await pg.exec(`begin; select set_config('dialektik.social_user','${veteran}',true);`);
    await assert.rejects(pg.exec(`insert into public.story_comments(event_id,user_id,kind,status,author_alias,body) values('event1','${other}','normal','published','Spoof','x')`));
    await pg.exec('rollback; begin;');
    await pg.exec(`select set_config('dialektik.social_user','${veteran}',true)`);
    // A study comment cannot skip review.
    await assert.rejects(pg.exec(`insert into public.story_comments(event_id,user_id,kind,status,author_alias,body) values('event1','${veteran}','study','published','Ana','x')`));
    await pg.exec('rollback; begin;');
    await pg.exec(`select set_config('dialektik.social_user','${veteran}',true);
      insert into public.story_comments(event_id,user_id,kind,status,author_alias,body) values('event1','${veteran}','study','in_review','Ana','x'); commit;`);
    await pg.exec('set role dialektik_core_app');
    assert.equal((await pg.query('select current_user as u')).rows[0].u, 'dialektik_core_app');
    // Without the moderator flag, an update touches nothing.
    assert.equal((await pg.query(`update public.story_comments set status='published', reviewed_at=now() returning id`)).rows.length, 0);
    await assert.rejects(pg.exec(`delete from public.story_comments`));
    await pg.exec('reset role');
  } finally { await pg.close(); }
});

test('OpenAlex gets the key, Crossref the contact, and each call is counted per day', async () => {
  const { pg, database, service } = await setup();
  const { METADATA_HOSTS } = await import('../dist/science/study-resolver.js');
  const seen = [];
  const inner = service.fetcher;
  service.fetcher = async (url, init) => { seen.push({ url: new URL(url), agent: init.headers['user-agent'] }); return inner(url, init); };
  process.env.OPENALEX_API_KEY = 'test-key';
  process.env.SCIENCE_CONTACT_EMAIL = 'contacto@example.org';
  try {
    await service.study(DOI);
    const openalex = seen.find((s) => s.url.hostname === 'api.openalex.org');
    const crossref = seen.find((s) => s.url.hostname === 'api.crossref.org');
    assert.equal(openalex.url.searchParams.get('api_key'), 'test-key');
    assert.equal(crossref.url.searchParams.get('mailto'), 'contacto@example.org');
    assert.match(crossref.agent, /mailto:contacto@example\.org/);
    // Only metadata APIs: never an article page, a PDF or full text.
    assert.ok(seen.every((s) => s.url.protocol === 'https:' && Object.hasOwn(METADATA_HOSTS, s.url.hostname)));

    service.fetcher = async (url) => (url.includes('openalex') ? { ok: false, status: 429, async json() { return {}; } } : inner(url));
    // A stale cache entry is resolved again.
    await pg.exec(`update public.science_studies set resolved_at = now() - interval '8 days'`);
    await service.study(DOI);
    process.env.DIALEKTIK_SCIENCE_MODERATORS = moderator;
    const { days } = await service.usage(moderator);
    const by = Object.fromEntries(days.map((d) => [d.source, d]));
    assert.equal(by.openalex.calls, 2);
    assert.equal(by.openalex.errors, 1);
    assert.equal(by.crossref.calls, 2);
    assert.equal(by.crossref.errors, 0);
    await rejectsWith(service.usage(other), 403);
  } finally {
    delete process.env.OPENALEX_API_KEY; delete process.env.SCIENCE_CONTACT_EMAIL; delete process.env.DIALEKTIK_SCIENCE_MODERATORS;
    await database.destroy(); await pg.close();
  }
});
