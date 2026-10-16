import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const connectionString = process.env.DIALEKTIK_GOVUK_RLS_TEST_DATABASE_URL;
assert.ok(connectionString, 'DIALEKTIK_GOVUK_RLS_TEST_DATABASE_URL is required');

const target = new URL(connectionString);
assert.equal(target.protocol, 'postgresql:');
assert.equal(target.hostname, '127.0.0.1');
assert.equal(target.port, '55442');
assert.equal(target.pathname, '/postgres');
assert.equal(target.username, 'postgres');
assert.equal(target.password, '');

const sourceId = '01M4YDQK00WS344WW8RCPCEQHE';
const outsideSourceId = '01M4YDQK00WS344WW8RCPCEQHF';
const articleId = '01J00000000000000000000001';
const receiptId = '01J00000000000000000000002';
const versionId = '01J00000000000000000000003';
const outsideArticleId = '01J00000000000000000000004';
const policyId = 'a'.repeat(64);
const acquisitionExclusionId = 'b'.repeat(64);
const titleExclusionId = 'c'.repeat(64);
const sourceIdentityExclusionId = 'f'.repeat(64);
const metadataHash = '1'.repeat(64);
const contentHash = '2'.repeat(64);
const signature = 'metadata-token-set-v1:' + '3'.repeat(64);
const canonicalUrl = 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh';
const discoveryUrl = 'https://www.gov.uk/api/content/government/news/social-housing-landlord-downgraded-by-rsh';
const registryKey = 'product-govuk-rsh-content-api-v1';
const sourceItemId = '86f4abba-9eaa-412f-b048-5ed30aa74201';
const title = 'Social housing landlord downgraded by RSH';
const publishedAt = '2026-10-15T12:00:00.000Z';
const recordedAt = '2026-10-16T12:00:00.000Z';
const rightsEvidenceUrl = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';

const policy = {
  sourceId,
  registryKey,
  publisherName: 'Regulator of Social Housing',
  canonicalDomain: 'gov.uk',
  sourceType: 'other',
  publisherFamily: 'Regulator of Social Housing',
  category: null,
  discoveryChannel: 'official_api',
  endpoint: discoveryUrl,
  rightsClass: 'LIVE_READY',
  storagePolicy: 'METADATA_ONLY',
  active: true,
  rightsEvidenceUrl,
  rightsVerifiedAt: '2026-10-15T00:00:00.000Z',
  attribution: '© Regulator of Social Housing. Contains public sector information licensed under the Open Government Licence v3.0.',
  language: 'en',
  allowedArticleDomains: ['www.gov.uk'],
  metadataStorageGranted: true,
  externalSourceLinkGranted: true,
  fulltextAcquisition: false,
  fulltextMachineProcessing: false,
  fulltextPersistence: false,
  derivedSemanticPersistence: false,
  thirdPartyContent: 'excluded',
  attachments: 'excluded',
  images: 'excluded',
  polling: 'disabled',
};

const statements = [
  {
    sql: `INSERT INTO public.sources
      (id,name,source_type,is_issuing_entity,canonical_domain,created_at,origin)
      VALUES ($1,$2,'other',false,'gov.uk',$3,'LIVE_REAL')
      ON CONFLICT (id) DO NOTHING`,
    values: [sourceId, 'Regulator of Social Housing', recordedAt],
  },
  {
    sql: `INSERT INTO public.live_source_policies
      (id,source_id,registry_key,rights_class,storage_policy,active,rights_evidence_url,rights_verified_at,policy,recorded_at)
      VALUES ($1,$2,$3,'LIVE_READY','METADATA_ONLY',true,$4,'2026-10-15T00:00:00.000Z',$5::jsonb,$6)
      ON CONFLICT (id) DO NOTHING`,
    values: [policyId, sourceId, registryKey, rightsEvidenceUrl, JSON.stringify(policy), recordedAt],
  },
  {
    sql: `INSERT INTO public.live_exposure_exclusions
      (id,registry_key,publisher_name,canonical_url,source_item_id,published_at,first_seen_at,discovery_url,reason,content_hash,near_duplicate_signature)
      VALUES ($1,$2,'Regulator of Social Housing',$3,$4,$5,$6,$7,'govuk_rsh_metadata_acquisition',NULL,NULL)
      ON CONFLICT (id) DO NOTHING`,
    values: [acquisitionExclusionId, registryKey, canonicalUrl, sourceItemId, publishedAt, recordedAt, discoveryUrl],
  },
  {
    sql: `INSERT INTO public.live_exposure_exclusions
      (id,registry_key,publisher_name,canonical_url,source_item_id,published_at,first_seen_at,discovery_url,reason,content_hash,near_duplicate_signature)
      VALUES ($1,$2,'Regulator of Social Housing',$3,$4,$5,$6,$7,'govuk_rsh_metadata_title_hash',$8,$9)
      ON CONFLICT (id) DO NOTHING`,
    values: [titleExclusionId, registryKey, canonicalUrl, sourceItemId, publishedAt, recordedAt, discoveryUrl, contentHash, signature],
  },
  {
    sql: `INSERT INTO public.live_exposure_exclusions
      (id,registry_key,publisher_name,canonical_url,source_item_id,published_at,first_seen_at,discovery_url,reason,content_hash,near_duplicate_signature)
      VALUES ($1,$2,'Regulator of Social Housing',NULL,$3,$4,$5,$6,'govuk_rsh_metadata_source_identity',NULL,NULL)
      ON CONFLICT (id) DO NOTHING`,
    values: [sourceIdentityExclusionId, registryKey, sourceItemId, publishedAt, recordedAt, discoveryUrl],
  },
  {
    sql: `INSERT INTO public.live_acquisition_receipts
      (id,source_id,policy_id,exclusion_id,discovery_channel,discovery_url,discovered_url,canonical_url,source_item_id,
       published_at,modified_at,original_published_at,original_modified_at,seen_at,raw_payload_hash,adapter_version,disposition,error_code)
      VALUES ($1,$2,$3,$4,'official_api',$5,$6,$6,$7,$8,NULL,$9,NULL,$10,$11,
       'govuk-rsh-content-api-metadata-v1','PERSISTED',NULL)
      ON CONFLICT (id) DO NOTHING`,
    values: [receiptId, sourceId, policyId, acquisitionExclusionId, discoveryUrl, canonicalUrl, sourceItemId, publishedAt, publishedAt, recordedAt, metadataHash],
  },
  {
    sql: `INSERT INTO public.articles
      (id,source_id,event_id,url_canonical,text_original,text_normalized,lang,published_at,captured_at,
       updated_at_source,origin,live_exposure_id)
      VALUES ($1,$2,NULL,$3,$4,$4,'en',$5,$6,NULL,'LIVE_REAL',$7)
      ON CONFLICT (id) DO NOTHING`,
    values: [articleId, sourceId, canonicalUrl, title, publishedAt, recordedAt, acquisitionExclusionId],
  },
  {
    sql: `INSERT INTO public.live_article_versions
      (id,article_id,receipt_id,version_number,metadata_hash,headline,published_at,modified_at,
       content_hash,near_duplicate_signature,recorded_at)
      VALUES ($1,$2,$3,1,$4,$5,$6,NULL,$7,$8,$9)`,
    values: [versionId, articleId, receiptId, metadataHash, title, publishedAt, contentHash, signature, recordedAt],
  },
];

async function expectDenied(client, name, query, values = []) {
  await client.query('SAVEPOINT expected_denial');
  await assert.rejects(
    client.query(query, values),
    (error) => ['42501', '23514'].includes(error.code),
    name,
  );
  await client.query('ROLLBACK TO SAVEPOINT expected_denial');
  await client.query('RELEASE SAVEPOINT expected_denial');
}

test('PostgreSQL 17 row scope, integration, rollback, idempotence and access boundaries', async () => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const identity = (await client.query(`SELECT current_user AS user,
      current_setting('server_version_num')::integer AS version,
      host(inet_server_addr()) AS address, inet_server_port() AS port`)).rows[0];
    assert.deepEqual(identity, { user: 'postgres', version: 170011, address: '127.0.0.1', port: 55442 });

    const migration = await client.query(`SELECT 1 FROM public.kysely_migration
      WHERE name = '042_govuk_product_writer_row_scope'`);
    assert.equal(migration.rowCount, 1, 'migration 042 is applied only to this disposable local cluster');

    const baseline = await client.query(`SELECT
      (SELECT count(id)::integer FROM public.sources) AS sources,
      (SELECT count(id)::integer FROM public.articles) AS articles,
      (SELECT count(id)::integer FROM public.live_acquisition_receipts) AS receipts,
      (SELECT count(article_id)::integer FROM public.live_article_versions) AS versions`);
    assert.deepEqual(baseline.rows[0], { sources: 0, articles: 0, receipts: 0, versions: 0 }, 'test database must be empty');

    const roleState = await client.query(`SELECT r.rolcanlogin, r.rolsuper, r.rolcreatedb,
      r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit,
      EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid) AS has_memberships
      FROM pg_catalog.pg_roles r WHERE r.rolname='dialektik_govuk_metadata_writer'`);
    assert.deepEqual(roleState.rows[0], {
      rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      rolreplication: false, rolbypassrls: false, rolinherit: false, has_memberships: false,
    });

    await client.query('BEGIN');
    try {
      // An unrelated gov.uk source/article proves SELECT policies are row-scoped.
      await client.query(`INSERT INTO public.sources
        (id,name,source_type,is_issuing_entity,canonical_domain,created_at,origin)
        VALUES ($1,'TEST ONLY unrelated GOV.UK source','other',false,'gov.uk',$2,'FIXTURE')`,
        [outsideSourceId, recordedAt]);
      await client.query(`INSERT INTO public.articles
        (id,source_id,event_id,url_canonical,text_original,text_normalized,lang,published_at,captured_at,origin)
        VALUES ($1,$2,NULL,'https://example.test/outside','TEST ONLY unrelated article',
          'TEST ONLY unrelated article','en',$3,$4,'FIXTURE')`,
        [outsideArticleId, outsideSourceId, publishedAt, recordedAt]);

      await client.query('SET LOCAL ROLE dialektik_govuk_metadata_writer');
      for (let index = 0; index < statements.length; index += 1) {
        try {
          const statement = statements[index];
          await client.query(statement.sql, statement.values);
        } catch (error) {
          console.error(JSON.stringify({ event: 'govuk_rls_write_step_failed', index, sqlstate: error.code ?? 'unknown' }));
          throw error;
        }
      }

      const guardRows = await client.query(`SELECT source_id FROM public.prospective_content_rights_write_guards`);
      assert.deepEqual(guardRows.rows, [{ source_id: sourceId }], 'source trigger may seed only the approved source guard');

      const writerReads = await client.query(`SELECT
        (SELECT count(id)::integer FROM public.sources) AS sources,
        (SELECT count(id)::integer FROM public.articles) AS articles,
        (SELECT count(id)::integer FROM public.live_source_policies) AS policies,
        (SELECT count(id)::integer FROM public.live_exposure_exclusions) AS exclusions,
        (SELECT count(id)::integer FROM public.live_acquisition_receipts) AS receipts,
        (SELECT count(article_id)::integer FROM public.live_article_versions) AS versions`);
      assert.deepEqual(writerReads.rows[0], { sources: 1, articles: 1, policies: 1, exclusions: 3, receipts: 1, versions: 1 });

      await expectDenied(client, 'source row outside approved id', `INSERT INTO public.sources
        (id,name,source_type,is_issuing_entity,canonical_domain,created_at,origin)
        VALUES ($1,'TEST ONLY wrong source','other',false,'gov.uk',$2,'LIVE_REAL')`,
        ['01M4YDQK00WS344WW8RCPCEQHG', recordedAt]);
      await expectDenied(client, 'source row with altered identity', `INSERT INTO public.sources
        (id,name,source_type,is_issuing_entity,canonical_domain,created_at,origin)
        VALUES ($1,'TEST ONLY wrong publisher','other',false,'gov.uk',$2,'LIVE_REAL')`,
        [sourceId, recordedAt]);
      await expectDenied(client, 'direct guard insert for another source', `INSERT INTO public.prospective_content_rights_write_guards(source_id) VALUES ($1)`,
        ['01M4YDQK00WS344WW8RCPCEQHG']);
      await expectDenied(client, 'direct guard insert rejected outside source trigger', `INSERT INTO public.prospective_content_rights_write_guards(source_id) VALUES ($1)`,
        [sourceId]);
      assert.equal((await client.query(`SELECT id FROM public.sources WHERE id=$1`, [outsideSourceId])).rowCount, 0, 'other gov.uk source is hidden by writer SELECT RLS');
      assert.equal((await client.query(`SELECT id FROM public.articles WHERE id=$1`, [outsideArticleId])).rowCount, 0, 'other Article is hidden by writer SELECT RLS');
      await expectDenied(client, 'writer cannot read article title column', `SELECT text_original FROM public.articles WHERE id=$1`, [articleId]);
      await expectDenied(client, 'writer cannot read version surrogate id', `SELECT id FROM public.live_article_versions WHERE article_id=$1`, [articleId]);
      await expectDenied(client, 'policy beyond metadata-only scope', `INSERT INTO public.live_source_policies
        (id,source_id,registry_key,rights_class,storage_policy,active,rights_evidence_url,rights_verified_at,policy,recorded_at)
        VALUES ($1,$2,$3,'LIVE_READY','METADATA_AND_FEED_EXCERPT',true,$4,'2026-10-15T00:00:00Z',$5::jsonb,$6)`,
        ['4'.repeat(64), sourceId, registryKey, rightsEvidenceUrl, JSON.stringify(policy), recordedAt]);
      await expectDenied(client, 'exclusion outside authorized content id', `INSERT INTO public.live_exposure_exclusions
        (id,registry_key,publisher_name,canonical_url,source_item_id,published_at,first_seen_at,discovery_url,reason,content_hash,near_duplicate_signature)
        VALUES ($1,$2,'Regulator of Social Housing',$3,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$4,$5,$6,'govuk_rsh_metadata_acquisition',NULL,NULL)`,
        ['5'.repeat(64), registryKey, canonicalUrl, publishedAt, recordedAt, discoveryUrl]);
      await expectDenied(client, 'receipt outside authorized item', `INSERT INTO public.live_acquisition_receipts
        (id,source_id,policy_id,exclusion_id,discovery_channel,discovery_url,discovered_url,canonical_url,source_item_id,
         published_at,seen_at,raw_payload_hash,adapter_version,disposition)
        VALUES ($1,$2,$3,$4,'official_api',$5,$6,$6,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$7,$8,$9,
          'govuk-rsh-content-api-metadata-v1','PERSISTED')`,
        ['01J00000000000000000000005', sourceId, policyId, acquisitionExclusionId, discoveryUrl, canonicalUrl, publishedAt, recordedAt, metadataHash]);
      await expectDenied(client, 'article outside exact canonical URL', `INSERT INTO public.articles
        (id,source_id,event_id,url_canonical,text_original,text_normalized,lang,published_at,captured_at,origin,live_exposure_id)
        VALUES ('01J00000000000000000000006',$1,NULL,'https://www.gov.uk/other','TEST ONLY out of scope','TEST ONLY out of scope',
          'en',$2,$3,'LIVE_REAL',$4)`, [sourceId, publishedAt, recordedAt, acquisitionExclusionId]);
      await expectDenied(client, 'article title outside exact approved title', `INSERT INTO public.articles
        (id,source_id,event_id,url_canonical,text_original,text_normalized,lang,published_at,captured_at,origin,live_exposure_id)
        VALUES ('01J00000000000000000000009',$1,NULL,$2,'TEST ONLY unauthorized text','TEST ONLY unauthorized text',
          'en',$3,$4,'LIVE_REAL',$5)`, [sourceId, canonicalUrl, publishedAt, recordedAt, acquisitionExclusionId]);
      await expectDenied(client, 'metadata version linked to another article', `INSERT INTO public.live_article_versions
        (id,article_id,receipt_id,version_number,metadata_hash,headline,published_at,content_hash,near_duplicate_signature,recorded_at)
        VALUES ('01J00000000000000000000007','01J00000000000000000000008',$1,1,$2,$3,$4,$5,$6,$7)`,
        [receiptId, metadataHash, title, publishedAt, contentHash, signature, recordedAt]);

      // Deterministic row IDs are repeat-safe. Append-only receipts represent a
      // distinct acquisition attempt in the product writer and are not collapsed.
      for (const statement of statements.slice(0, -1)) await client.query(statement.sql, statement.values);
      const latestVersion = await client.query(`SELECT version_number,metadata_hash
        FROM public.live_article_versions WHERE article_id=$1 ORDER BY version_number DESC LIMIT 1`, [articleId]);
      assert.deepEqual(latestVersion.rows, [{ version_number: 1, metadata_hash: metadataHash }]);
      const matchingReceipt = await client.query(`SELECT id FROM public.live_acquisition_receipts
        WHERE source_id=$1 AND source_item_id=$2 AND raw_payload_hash=$3
          AND adapter_version='govuk-rsh-content-api-metadata-v1' AND disposition='PERSISTED'`,
        [sourceId, sourceItemId, metadataHash]);
      assert.equal(matchingReceipt.rowCount, 1, 'same version and existing receipt make a repeat write a no-op');
      const afterRepeat = await client.query(`SELECT
        (SELECT count(id)::integer FROM public.sources WHERE id=$1) AS sources,
        (SELECT count(id)::integer FROM public.articles WHERE id=$2) AS articles,
        (SELECT count(id)::integer FROM public.live_source_policies WHERE id=$3) AS policies,
        (SELECT count(id)::integer FROM public.live_exposure_exclusions WHERE id IN ($4,$5,$6)) AS exclusions,
        (SELECT count(id)::integer FROM public.live_acquisition_receipts WHERE id=$7) AS receipts,
        (SELECT count(article_id)::integer FROM public.live_article_versions WHERE article_id=$2) AS versions`,
        [sourceId, articleId, policyId, acquisitionExclusionId, titleExclusionId, sourceIdentityExclusionId, receiptId]);
      assert.deepEqual(afterRepeat.rows[0], { sources: 1, articles: 1, policies: 1, exclusions: 3, receipts: 1, versions: 1 });

      await client.query('RESET ROLE');
      await client.query('SET LOCAL ROLE dialektik_core_app');
      const coreSources = await client.query(`SELECT id FROM public.sources WHERE id IN ($1,$2) ORDER BY id`, [sourceId, outsideSourceId]);
      assert.deepEqual(coreSources.rows.map((row) => row.id).sort(), [sourceId, outsideSourceId].sort());
      const coreArticles = await client.query(`SELECT id FROM public.articles WHERE id IN ($1,$2) ORDER BY id`, [articleId, outsideArticleId]);
      assert.deepEqual(coreArticles.rows.map((row) => row.id).sort(), [articleId, outsideArticleId].sort());
      assert.equal((await client.query('SELECT id FROM public.live_source_policies')).rowCount, 1);
      assert.equal((await client.query('SELECT id FROM public.live_exposure_exclusions')).rowCount, 3);
      assert.equal((await client.query('SELECT id FROM public.live_acquisition_receipts')).rowCount, 1);
      assert.equal((await client.query('SELECT article_id FROM public.live_article_versions')).rowCount, 1);

      await client.query('RESET ROLE');
      for (const role of ['anon', 'authenticated']) {
        await client.query(`SET LOCAL ROLE ${role}`);
        await expectDenied(client, `${role} cannot read live articles`, 'SELECT id FROM public.articles');
        await client.query('RESET ROLE');
      }
    } finally {
      await client.query('ROLLBACK');
    }

    const afterRollback = await client.query(`SELECT
      (SELECT count(id)::integer FROM public.sources) AS sources,
      (SELECT count(id)::integer FROM public.articles) AS articles,
      (SELECT count(id)::integer FROM public.live_source_policies) AS policies,
      (SELECT count(id)::integer FROM public.live_exposure_exclusions) AS exclusions,
      (SELECT count(id)::integer FROM public.live_acquisition_receipts) AS receipts,
      (SELECT count(article_id)::integer FROM public.live_article_versions) AS versions,
      (SELECT count(source_id)::integer FROM public.prospective_content_rights_write_guards) AS guards`);
    assert.deepEqual(afterRollback.rows[0], { sources: 0, articles: 0, policies: 0, exclusions: 0, receipts: 0, versions: 0, guards: 0 });
    console.log(JSON.stringify({
      event: 'govuk_writer_row_scope_postgres17_integration',
      cluster: '127.0.0.1:55442/postgres',
      migration_042: 'applied_to_disposable_local_cluster_only',
      positive_write_path: 'PASS',
      negative_cases: 14,
      repeated_deterministic_insert: 'PASS',
      core_read_policies: 'PASS',
      anon_authenticated_denied: 'PASS',
      rollback_rows_remaining: 0,
      remote_database_touched: false,
      acquisition_or_inference: false,
    }));
  } finally {
    await client.end();
  }
});
