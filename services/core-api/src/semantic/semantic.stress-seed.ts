import { inAuditedTransaction, type Database } from '@dialektik/database';
import type { Kysely } from 'kysely';
import type { CoreApiConfig } from '../config/core-api-config.js';
import { semanticFixtureId } from './semantic.fixtures.js';
import { seedAuthoredSemanticFixtures } from './semantic.seed.js';
import {
  SEMANTIC_STRESS_WORLD,
  StressFixtureSemanticObservationProvider,
  semanticStressId,
} from './semantic.stress-fixtures.js';
import { requireSemanticValue } from './semantic.validation.js';

export async function seedSemanticStressFixtures(
  database: Kysely<Database>,
  config: Readonly<CoreApiConfig>,
) {
  const target = new URL(config.databaseUrl);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    !/^\/dialektik_(?:semantic_stress_v1|test_[a-z0-9_]+)$/.test(target.pathname)
  ) {
    throw new Error(
      'Stress seeding requires its isolated local profile or a disposable test database.',
    );
  }
  const result = await seedAuthoredSemanticFixtures(database, config, {
    fixtures: SEMANTIC_STRESS_WORLD.fixtures,
    sources: SEMANTIC_STRESS_WORLD.sources,
    provider: new StressFixtureSemanticObservationProvider(),
    concurrentThreads: true,
  });
  // Curated Event taxonomy and Event windows already exist. They are not Story
  // epistemic dimensions and never encode the number or authority of Sources.
  const categories = new Map(
    (await database.selectFrom('categories').select(['id', 'slug']).execute()).map((category) => [
      category.slug,
      category.id,
    ]),
  );
  await inAuditedTransaction(
    database,
    {
      action: 'metadata_updated',
      actorId: null,
      actorType: 'system',
      correlationId: semanticStressId('presentation-taxonomy'),
      reasonCode: 'synthetic_product_stress_taxonomy',
    },
    async (transaction) => {
      for (const event of SEMANTIC_STRESS_WORLD.events) {
        const categoryId = requireSemanticValue(categories.get(event.categorySlug));
        const existing = await transaction
          .selectFrom('events')
          .select(['category_id', 'window_to'])
          .where('id', '=', event.id)
          .executeTakeFirstOrThrow();
        if (
          existing.category_id !== semanticFixtureId('category') &&
          existing.category_id !== categoryId
        )
          throw new Error('Stress Event taxonomy conflicts with existing data.');
        if (existing.window_to !== null && existing.window_to.toISOString() !== event.windowTo)
          throw new Error('Stress Event window conflicts with existing data.');
        if (
          existing.category_id !== categoryId ||
          (existing.window_to?.toISOString() ?? null) !== event.windowTo
        )
          await transaction
            .updateTable('events')
            .set({ category_id: categoryId, window_to: event.windowTo })
            .where('id', '=', event.id)
            .execute();
      }
    },
  );
  return {
    ...result,
    profile: 'stress' as const,
    version: SEMANTIC_STRESS_WORLD.version,
    seed: SEMANTIC_STRESS_WORLD.seed,
    counts: SEMANTIC_STRESS_WORLD.counts,
    cases: SEMANTIC_STRESS_WORLD.cases,
  };
}
