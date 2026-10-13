import { type Database, type Ulid } from '@dialektik/database';
import type { Kysely } from 'kysely';
import type { CoreApiConfig } from '../config/core-api-config.js';
import {
  SEMANTIC_FIXTURES,
  SEMANTIC_FIXTURE_SOURCES,
  semanticFixtureId,
} from './semantic.fixtures.js';
import { FixtureSemanticObservationProvider } from './semantic.providers.js';
import { SemanticRepository } from './semantic.repository.js';
import { SemanticApplicationService } from './semantic.service.js';
import type { SemanticObservationProvider } from './semantic.contracts.js';

type AuthoredSemanticFixture = (typeof SEMANTIC_FIXTURES)[number];

export async function seedSemanticFixtures(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
) {
  return seedAuthoredSemanticFixtures(database, config, {
    fixtures: SEMANTIC_FIXTURES,
    sources: SEMANTIC_FIXTURE_SOURCES,
    provider: new FixtureSemanticObservationProvider(),
  });
}

export async function seedAuthoredSemanticFixtures(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
  profile: Readonly<{
    fixtures: readonly AuthoredSemanticFixture[];
    sources: readonly (typeof SEMANTIC_FIXTURE_SOURCES)[number][];
    provider: SemanticObservationProvider;
    concurrentThreads?: true;
  }>,
) {
  if (config.nodeEnvironment === 'production' || config.semanticMode !== 'fixture') {
    throw new Error('Synthetic seeding is development/test only.');
  }
  let observationBatches: readonly (readonly AuthoredSemanticFixture[])[] = [profile.fixtures];
  if (profile.concurrentThreads === true) {
    const occurrenceThreads = new Map<Ulid, Ulid>();
    const batches = new Map<Ulid, AuthoredSemanticFixture[]>();
    for (const fixture of profile.fixtures) {
      const observation = fixture.observation;
      const existing = occurrenceThreads.get(observation.occurrenceId);
      if (existing !== undefined && existing !== observation.threadId)
        throw new Error('Independent fixture Stories cannot share an Occurrence.');
      occurrenceThreads.set(observation.occurrenceId, observation.threadId);
      const batch = batches.get(observation.threadId) ?? [];
      batch.push(fixture);
      batches.set(observation.threadId, batch);
    }
    for (const fixture of profile.fixtures) {
      const observation = fixture.observation;
      if (
        observation.relation !== null &&
        occurrenceThreads.get(observation.relation.targetOccurrenceId) !== observation.threadId
      )
        throw new Error(
          'Concurrent fixture Stories cannot have cross-Story relation dependencies.',
        );
    }
    observationBatches = [...batches.values()];
  }
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto('categories')
      .values({
        id: semanticFixtureId('category'),
        slug: 'synthetic-semantic-demo',
        sort_order: 999,
        is_active: true,
        created_at: '2026-10-01T00:00:00.000Z',
      })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .execute();
    await transaction
      .insertInto('category_localizations')
      .values({
        category_id: semanticFixtureId('category'),
        locale: 'es',
        name: 'Demostración sintética',
      })
      .onConflict((conflict) => conflict.columns(['category_id', 'locale']).doNothing())
      .execute();
    // Bound parameter and payload size while avoiding two network round trips
    // for every synthetic identity in the opt-in stress profile.
    for (let offset = 0; offset < profile.sources.length; offset += 100) {
      const batch = profile.sources.slice(offset, offset + 100);
      await transaction
        .insertInto('sources')
        .values(
          batch.map((source) => ({
            id: source.id,
            name: source.name,
            canonical_domain: source.canonicalDomain,
            source_type: 'other',
            origin: source.canonicalDomain.startsWith('stress-')
              ? ('STRESS_SYNTHETIC' as const)
              : ('FIXTURE' as const),
            is_issuing_entity: false,
            created_at: '2026-10-01T00:00:00.000Z',
          })),
        )
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();
      const existing = new Map(
        (
          await transaction
            .selectFrom('sources')
            .select(['id', 'name', 'canonical_domain'])
            .where(
              'id',
              'in',
              batch.map((source) => source.id),
            )
            .execute()
        ).map((source) => [source.id, source]),
      );
      for (const source of batch) {
        const stored = existing.get(source.id);
        if (stored?.name !== source.name || stored.canonical_domain !== source.canonicalDomain) {
          throw new Error('Synthetic Source identity conflicts with existing data.');
        }
      }
    }
    for (let offset = 0; offset < profile.fixtures.length; offset += 100) {
      const batch = profile.fixtures.slice(offset, offset + 100);
      await transaction
        .insertInto('articles')
        .values(
          batch.map((fixture) => ({
            id: fixture.article.id,
            source_id: fixture.source.id,
            event_id: null,
            url_canonical: fixture.article.canonicalUrl,
            text_original: fixture.article.originalText,
            text_normalized: fixture.article.originalText,
            lang: 'es',
            published_at: fixture.observation.observedAt,
            captured_at: fixture.observation.observedAt,
            origin: fixture.source.canonicalDomain.startsWith('stress-')
              ? ('STRESS_SYNTHETIC' as const)
              : ('FIXTURE' as const),
            updated_at_source: null,
            declares_wire: null,
            syndication_of: null,
            syndication_confidence: null,
            clustering_score: null,
            processing_error: null,
          })),
        )
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();
      const existing = new Map(
        (
          await transaction
            .selectFrom('articles')
            .select(['id', 'source_id', 'text_original', 'url_canonical'])
            .where(
              'id',
              'in',
              batch.map((fixture) => fixture.article.id),
            )
            .execute()
        ).map((article) => [article.id, article]),
      );
      for (const fixture of batch) {
        const stored = existing.get(fixture.article.id);
        if (
          stored?.source_id !== fixture.source.id ||
          stored.text_original !== fixture.article.originalText ||
          stored.url_canonical !== fixture.article.canonicalUrl
        ) {
          throw new Error('Synthetic Article identity conflicts with existing data.');
        }
      }
    }
  });
  const service = new SemanticApplicationService(new SemanticRepository(database), config);
  let applied = 0;
  const observationIds = profile.fixtures.map((fixture) => fixture.observation.id);
  let nextBatch = 0;
  const worker = async () => {
    while (nextBatch < observationBatches.length) {
      const batch = observationBatches[nextBatch];
      nextBatch += 1;
      if (batch === undefined) throw new Error('Missing authored fixture batch.');
      // Preserve every Story's observation/state-chain order. Only explicitly
      // independent fixture Stories may run on the bounded four-worker pool.
      for (const fixture of batch)
        if (await service.ingestArticle(fixture.article.id, profile.provider)) applied += 1;
    }
  };
  const completed = await Promise.allSettled(
    Array.from({ length: Math.min(4, observationBatches.length) }, worker),
  );
  const failed = completed.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return {
    mode: 'fixture',
    articles: profile.fixtures.length,
    threads: new Set(profile.fixtures.map((fixture) => fixture.observation.threadId)).size,
    occurrences: new Set(profile.fixtures.map((fixture) => fixture.observation.occurrenceId)).size,
    applied,
    replayed: profile.fixtures.length - applied,
    observationIds,
  };
}
