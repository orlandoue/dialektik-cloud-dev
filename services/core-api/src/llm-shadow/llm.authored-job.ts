import { present } from './llm.assert.js';
import { generateUlid, type Database } from '@dialektik/database';
import { sql, type Kysely } from 'kysely';
import type { EphemeralProcessingRequest } from '../ephemeral/ephemeral.contracts.js';
import { AUTHORED_LLM_ARTICLES } from './llm.recorded.js';
import { sha256, type createLLMConfig } from './llm.schema.js';
import { LLMShadowRepository } from './llm.repository.js';
import type { LLMShadowJobInput } from './llm.job.js';
/** Newly authored .invalid fixtures. No publisher request, scientific input, or old labels. */
export async function seedAuthoredLLMJob(
  database: Kysely<Database>,
  config: ReturnType<typeof createLLMConfig>,
) {
  const databaseClock = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(database);
  const now = databaseClock.rows[0]?.now.getTime();
  if (now === undefined) throw new Error('AUTHORED_FIXTURE_DATABASE_CLOCK_UNAVAILABLE');
  const runId = generateUlid({ now: () => now }),
    sourceId = generateUlid({ now: () => now });
  const time = new Date(now).toISOString(),
    domain = 'llm-authored-' + sourceId.toLowerCase() + '.invalid',
    policyId = sha256('authored-product-policy:' + sourceId);
  await database
    .insertInto('sources')
    .values({
      id: sourceId,
      name: 'Authored LLM product fixtures',
      source_type: 'other',
      canonical_domain: domain,
      is_issuing_entity: false,
      created_at: time,
    })
    .execute();
  await database
    .insertInto('content_access_policies')
    .values({
      id: policyId,
      source_id: sourceId,
      content_access_mode: 'FULLTEXT_EPHEMERAL',
      metadata_storage: true,
      excerpt_storage: false,
      fulltext_acquisition: true,
      fulltext_machine_processing: true,
      fulltext_persistence: false,
      derived_semantic_persistence: true,
      minimal_evidence_fragment: true,
      redisplay: true,
      external_source_link: true,
      evidence_quote_max_codepoints: 512,
      rights_evidence_url: 'https://' + domain + '/authored-rights',
      rights_verified_at: time,
      recorded_at: time,
    })
    .execute();
  const rights = {
    metadataStorage: true,
    excerptStorage: false,
    fulltextAcquisition: true,
    fulltextMachineProcessing: true,
    fulltextPersistence: false,
    derivedSemanticPersistence: true,
    minimalEvidenceFragment: true,
    redisplay: true,
    externalSourceLink: true,
  };
  const hooks = new LLMShadowRepository(database, runId, config, 'local');
  const rightsHash = sha256(
    'Author-created synthetic fixture: local processing and bounded evidence permitted; no external transmission.',
  );
  await hooks.appendRouteGrant(
    sourceId,
    null,
    policyId,
    'LOCAL_ONLY_PROCESSING',
    rightsHash,
    rights,
  );
  const inputs: LLMShadowJobInput[] = [];
  for (let n = 0; n < AUTHORED_LLM_ARTICLES.length; n++) {
    const a = present(AUTHORED_LLM_ARTICLES[n]),
      articleId = generateUlid({ now: () => now + n + 1 }),
      versionId = generateUlid({ now: () => now + n + 1 });
    const url = 'https://' + domain + '/' + articleId,
      publishedAt = '2026-10-01T00:00:00.000Z',
      availableAt = new Date(now - 1000 + n).toISOString();
    const inputHash = sha256(a.body),
      titleHash = sha256(a.title);
    await database
      .insertInto('live_exposure_exclusions')
      .values({
        id: sha256('llm-product-exclusion:' + articleId),
        registry_key: 'LLM_PRODUCT_AUTHORED_V1',
        publisher_name: 'Authored synthetic fixtures',
        canonical_url: url,
        source_item_id: articleId,
        published_at: publishedAt,
        first_seen_at: time,
        discovery_url: null,
        reason:
          'Permanent product-development exclusion from final V2; authored fixture, not real news.',
        content_hash: inputHash,
        near_duplicate_signature: titleHash,
        exclusion_status: 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2',
      })
      .execute();
    await database
      .insertInto('articles')
      .values({
        id: articleId,
        source_id: sourceId,
        event_id: null,
        url_canonical: url,
        text_original: a.title,
        text_normalized: a.title,
        lang: 'en',
        published_at: publishedAt,
        captured_at: time,
        updated_at_source: null,
        declares_wire: null,
        syndication_of: null,
        syndication_confidence: null,
        clustering_score: null,
        processing_error: null,
      })
      .execute();
    await hooks.appendRouteGrant(
      sourceId,
      articleId,
      policyId,
      'LOCAL_ONLY_PROCESSING',
      rightsHash,
      rights,
    );
    const request: EphemeralProcessingRequest = {
      metadata: {
        articleId,
        articleVersionId: versionId,
        sourceId,
        canonicalUrl: url,
        publisherItemId: articleId,
        publishedAt,
        availableAt,
        modifiedAt: null,
        acquiredAt: time,
        language: 'en',
        title: a.title,
        contentEncoding: 'utf-8',
      },
      policy: {
        policyId,
        sourceId,
        active: true,
        accessMode: 'FULLTEXT_EPHEMERAL',
        evidenceMaxCodepoints: 512,
        rights: {
          metadataStorage: true,
          excerptStorage: false,
          fulltextAcquisition: true,
          fulltextMachineProcessing: true,
          fulltextPersistence: false,
          derivedSemanticPersistence: true,
          minimalEvidenceFragment: true,
          redisplay: true,
          externalSourceLink: true,
        },
      },
      providerRunId: runId,
      position: n + 1,
      permanentExclusionVerified: true,
    };
    inputs.push({
      request,
      frozen: { articleId, versionId, sourceId, policyId, inputHash, titleHash },
      route: 'LOCAL_ONLY_PROCESSING',
      content: {
        acquire: () => Promise.resolve(Buffer.from(a.body)),
        parse: () =>
          Promise.resolve({
            title: a.title,
            body: Buffer.from(a.body),
            completeOriginalText: true,
          }),
      },
    });
  }
  return { runId, inputs, rightsHash };
}
