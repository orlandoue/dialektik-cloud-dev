import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, SignJWT } from 'jose';

import { AppModule } from '../dist/app.module.js';
import { loadCoreApiConfig } from '../dist/config/core-api-config.js';
import { createFastifyOptions } from '../dist/http/request-correlation.js';
import { SafeHttpExceptionFilter } from '../dist/http/safe-http-exception.filter.js';
import { SupabaseJwtVerifier } from '../dist/private-beta/supabase-jwt-verifier.js';

const require = createRequire(import.meta.url);
const { sql } = require('kysely');
const { createDatabase, destroyDatabase } = require('@dialektik/database');
const databaseUrl = process.env.DIALEKTIK_GOVUK_DISPOSABLE_CORE_DATABASE_URL;
const testerId = '2f0db489-178a-4fe0-9e6a-0e69f1d8be5c';
const issuer = 'https://example-project.supabase.co/auth/v1';

test('real PostgreSQL to authenticated Core HTTP exposes only metadata', { skip: databaseUrl === undefined }, async () => {
  const target = new URL(databaseUrl);
  assert.equal(target.protocol, 'postgresql:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55433');
  assert.equal(target.pathname, '/postgres');
  assert.equal(target.username, 'dialektik_core_app');
  assert.equal(target.password, '');

  const admin = createDatabase({
    connectionString: 'postgresql://postgres@127.0.0.1:55433/postgres',
    applicationName: 'dialektik-govuk-disposable-http-setup',
    maxConnections: 1,
  });
  let application;
  try {
    const identity = (await sql.raw("select current_setting('server_version') as version, inet_server_addr()::text as address, inet_server_port() as port").execute(admin)).rows[0];
    assert.deepEqual(identity, { version: '17.11', address: '127.0.0.1/32', port: 55433 });

    // Mirror only the existing Core base read grants in this disposable Supabase stub.
    await sql.raw("grant select (id,name,source_type,is_issuing_entity,canonical_domain,origin,created_at) on public.sources to dialektik_core_app").execute(admin);
    await sql.raw("grant select (id,source_id,event_id,url_canonical,origin,live_exposure_id,captured_at,published_at,updated_at_source,text_original,text_normalized,lang,clustering_score,declares_wire,processing_error,syndication_confidence,syndication_of) on public.articles to dialektik_core_app").execute(admin);
    await sql.raw("grant select (created_at,id,is_active,slug,sort_order) on public.categories to dialektik_core_app").execute(admin);
    await sql.raw("grant select (analysis_state,category_id,detected_at,id,merged_at,merged_by,merged_into,title_descriptive,window_from,window_to) on public.events to dialektik_core_app").execute(admin);
    await sql.raw("grant select (event_id,id,neutral_rank,publication_state,published_at,published_by,status,title_edited_at,title_edited_by,title_previous,title_text,tombstone_id) on public.positions to dialektik_core_app").execute(admin);
    await sql.raw("grant select (confirmed_at,confirmed_by,event_id,id,position_a_id,position_b_id,projection_hash,publication_state,ratio_comparable_at_publication,ratio_conflicting_at_publication,retracted_at,retracted_by,retraction_reason,threshold_rule_at_publication) on public.contradiction_publications to dialektik_core_app").execute(admin);
    await sql.raw("insert into auth.users(id) values ('" + testerId + "') on conflict(id) do nothing").execute(admin);
    await sql.raw("insert into public.private_beta_testers(user_id,enabled) values ('" + testerId + "',true) on conflict(user_id) do nothing").execute(admin);

    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...await exportJWK(publicKey), kid: 'disposable-govuk-http-test', alg: 'ES256', use: 'sig' };
    const verifier = new SupabaseJwtVerifier(issuer, createLocalJWKSet({ keys: [jwk] }));
    const now = Math.floor(Date.now() / 1000);
    const bearer = await new SignJWT({ role: 'authenticated', is_anonymous: false })
      .setProtectedHeader({ alg: 'ES256', kid: jwk.kid, typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setSubject(testerId)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(privateKey);
    const config = loadCoreApiConfig({
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_MAX: '1',
      NODE_ENV: 'production',
      SEMANTIC_MODE: 'disabled',
      CORE_API_HOST: '127.0.0.1',
      CORE_API_PORT: '3199',
      CORE_API_LOG_LEVEL: 'silent',
      SUPABASE_AUTH_ISSUER: issuer,
    });
    const fixture = await Test.createTestingModule({ imports: [AppModule.register(config)] })
      .overrideProvider(SupabaseJwtVerifier)
      .useValue(verifier)
      .compile();
    application = fixture.createNestApplication(new FastifyAdapter(createFastifyOptions(config)));
    application.useGlobalFilters(new SafeHttpExceptionFilter());
    await application.init();
    const http = application.getHttpAdapter().getInstance();
    const request = (url, token) => http.inject({
      method: 'GET',
      url,
      ...(token === undefined ? {} : { headers: { authorization: 'Bearer ' + token } }),
    });
    assert.equal((await request('/health/live')).statusCode, 200);
    assert.equal((await request('/health/ready')).statusCode, 200);
    for (const route of ['/live/news', '/live/sources', '/v1/feed', '/v1/contradictions']) {
      assert.equal((await request(route)).statusCode, 401, route + ' without bearer');
      assert.equal((await request(route, 'not-a-jwt')).statusCode, 401, route + ' invalid bearer');
    }
    const newsResponse = await request('/live/news', bearer);
    const sourceResponse = await request('/live/sources', bearer);
    assert.equal(newsResponse.statusCode, 200);
    assert.equal(sourceResponse.statusCode, 200);
    const news = JSON.parse(newsResponse.payload);
    const sources = JSON.parse(sourceResponse.payload);
    assert.equal(news.items.length, 1);
    assert.equal(sources.items.length, 1);
    const article = news.items[0];
    assert.equal(article.headline, 'Social housing landlord downgraded by RSH');
    assert.equal(article.canonical_url, 'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh');
    assert.equal(article.excerpt, null);
    assert.equal(article.semantic_assignment, 'UNASSIGNED');
    assert.equal(article.source.id, sources.items[0].id);
    assert.match(article.source.attribution, /Open Government Licence v3\.0/);
    const detailResponse = await request('/live/news/' + article.id, bearer);
    assert.equal(detailResponse.statusCode, 200);
    const detail = JSON.parse(detailResponse.payload);
    assert.equal(detail.content.body, null);
    assert.equal(detail.content.text, null);
    assert.equal(detail.content.representation, 'metadata_only');
    assert.equal(detail.provenance.discovery_channel, 'official_api');
    assert.equal(detail.provenance.source_item_id, '86f4abba-9eaa-412f-b048-5ed30aa74201');
    const provenanceResponse = await request('/live/news/' + article.id + '/provenance', bearer);
    assert.equal(provenanceResponse.statusCode, 200);
    const v1FeedResponse = await request('/v1/feed', bearer);
    const contradictionsResponse = await request('/v1/contradictions', bearer);
    assert.equal(v1FeedResponse.statusCode, 200);
    assert.equal(contradictionsResponse.statusCode, 200);

    try {
      await sql.raw("update public.private_beta_testers set enabled=false, revoked_at=clock_timestamp() where user_id='" + testerId + "'").execute(admin);
      assert.equal((await request('/live/news', bearer)).statusCode, 401);
    } finally {
      await sql.raw("update public.private_beta_testers set enabled=true, revoked_at=null where user_id='" + testerId + "'").execute(admin);
    }
    assert.equal((await request('/live/news', bearer)).statusCode, 200);
    console.log(JSON.stringify({
      event: 'disposable_authenticated_core_http',
      health: [200, 200],
      unauthenticated: 401,
      news: newsResponse.statusCode,
      sources: sourceResponse.statusCode,
      article: detailResponse.statusCode,
      provenance: provenanceResponse.statusCode,
      feed: v1FeedResponse.statusCode,
      contradictions: contradictionsResponse.statusCode,
      revoked: 401,
      restored: 200,
      articles: news.items.length,
      sources_count: sources.items.length,
      body_persisted: false,
      bearer_logged: false,
    }));
  } finally {
    await application?.close();
    await destroyDatabase(admin);
  }
});
