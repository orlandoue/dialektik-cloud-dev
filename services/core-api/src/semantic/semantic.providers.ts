import type {
  SafeSemanticArticle,
  SemanticObservation,
  SemanticObservationProvider,
} from './semantic.contracts.js';
import { FIXTURE_VERSION, SEMANTIC_FIXTURES } from './semantic.fixtures.js';

export class FixtureSemanticObservationProvider implements SemanticObservationProvider {
  readonly name = 'fixture';
  readonly version = FIXTURE_VERSION;
  observe(article: SafeSemanticArticle): Promise<SemanticObservation> {
    const fixture = SEMANTIC_FIXTURES.find((item) => item.article.id === article.id);
    if (
      fixture === undefined ||
      fixture.article.canonicalUrl !== article.canonicalUrl ||
      fixture.article.originalText !== article.originalText
    ) {
      throw new Error(
        'Fixture provider accepts only the exact authored synthetic product Articles.',
      );
    }
    return Promise.resolve(fixture.observation);
  }
}

/** Boundary only. No imports, process launch, candidate code, thresholds or predictions. */
export class FrozenV10_11ObservationProvider implements SemanticObservationProvider {
  readonly name = 'v10_11';
  readonly version = 'ea47eb75e955b9a51d15dc0135c81145130553ca';
  observe(_article: SafeSemanticArticle): Promise<SemanticObservation> {
    return Promise.reject(
      new Error(
        'V10.11 is disabled: final semantic validation and activation authority are absent. Use SEMANTIC_MODE=fixture.',
      ),
    );
  }
}
export function selectSemanticObservationProvider(mode: string): SemanticObservationProvider {
  if (mode === 'fixture') return new FixtureSemanticObservationProvider();
  if (mode === 'v10_11')
    throw new Error('V10.11 activation is not authorized; candidate execution is unavailable.');
  throw new Error('Semantic ingestion requires SEMANTIC_MODE=fixture.');
}
