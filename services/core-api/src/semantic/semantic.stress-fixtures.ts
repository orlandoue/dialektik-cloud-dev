import type { Ulid } from '@dialektik/database';
import type {
  SafeSemanticArticle,
  SemanticObservation,
  SemanticObservationProvider,
  SemanticState,
} from './semantic.contracts.js';
import { semanticFixtureId } from './semantic.fixtures.js';
import { requireSemanticValue } from './semantic.validation.js';
import { STRESS_FIXTURE_VERSION, STRESS_FIXTURE_SEED } from './semantic.stress-version.js';

/** Product-only, authored fiction. This module has no research/provider inputs. */
export { STRESS_FIXTURE_VERSION, STRESS_FIXTURE_SEED };
export function semanticStressId(key: string, seed = STRESS_FIXTURE_SEED): Ulid {
  return semanticFixtureId(STRESS_FIXTURE_VERSION + ':' + String(seed) + ':' + key);
}
const CATEGORY_SLUGS = [
  'pais',
  'politica',
  'internacional',
  'deportes',
  'ciencia',
  'tecnologia',
  'economia',
] as const;
const PLACES = [
  'Puerto Claro',
  'Villa Nube',
  'Estuario Azul',
  'Valle del Álamo',
  'Isla del Faro',
  'Río Ítaca',
  'Bahía de la Ñora',
  'Loma Serena',
];
const SUBJECTS = [
  'biblioteca',
  'puente peatonal',
  'huerto vecinal',
  'observatorio',
  'archivo municipal',
  'sendero del estuario',
  'sala de música',
  'taller comunitario',
];
const START = Date.UTC(2026, 10, 1);
const instant = (days: number, minutes = 0) =>
  new Date(START + days * 86_400_000 + minutes * 60_000).toISOString();
const state = (
  description: string,
  decision: SemanticState['decision'] = 'MATCH',
  applicability: SemanticState['applicability'] = 'APPLICABLE',
): SemanticState => ({ description, decision, applicability });

export function generateSemanticStressWorld(seed = STRESS_FIXTURE_SEED) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Stress seed must be an unsigned 32-bit integer.');
  let randomState = seed;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState;
  };
  const id = (key: string) => semanticStressId(key, seed);
  const sources = Array.from({ length: 36 }, (_, index) => ({
    id: id('source-' + String(index)),
    name:
      (index === 35
        ? 'Cuaderno de las Comunidades del Estuario, las Bibliotecas del Valle y el Archivo de la Memoria Cotidiana de Villa Nube'
        : requireSemanticValue(
            [
              'Diario del Álamo',
              'Diario del Alba',
              'Radio de la Ñora',
              'Agencia del Río',
              'Cuaderno del Estuario',
              'Gaceta del Valle',
            ][index % 6],
          ) +
          ' ' +
          String(index + 1)) + ' · sintético',
    canonicalDomain: 'stress-' + seed.toString(16) + '-' + String(index) + '.dialektik.invalid',
  }));
  const fixtures: {
    article: SafeSemanticArticle;
    observation: SemanticObservation;
    source: (typeof sources)[number];
    ordinal: number;
  }[] = [];
  const events: { id: Ulid; threadId: Ulid; categorySlug: string; windowTo: string | null }[] = [];
  const stories: { id: Ulid; title: string; occurrenceIds: Ulid[]; articleIds: Ulid[] }[] = [];
  for (let storyIndex = 0; storyIndex < 64; storyIndex += 1) {
    const storyKey = 'story-' + String(storyIndex).padStart(2, '0');
    const threadId = id(storyKey);
    const eventCount =
      storyIndex < 4 ? [28, 15, 8, 5][storyIndex] : [1, 1, 2, 3, 5, 8][(storyIndex - 4) % 6];
    const place = requireSemanticValue(PLACES[storyIndex % PLACES.length]);
    const subject = requireSemanticValue(
      SUBJECTS[Math.floor(storyIndex / PLACES.length) % SUBJECTS.length],
    );
    const title =
      storyIndex === 0
        ? 'Puerto Claro · veintiocho etapas del archivo y la biblioteca del Estuario'
        : storyIndex === 4
          ? 'Sí'
          : storyIndex === 3
            ? place +
              ' · una sala de lectura, su ampliación y las sucesivas etapas del proyecto vecinal\nUn proceso ficticio descrito con un título deliberadamente extenso para comprobar la lectura y la navegación sin confundir etapas distintas'
            : place + ' · evolución de ' + subject + ' ' + String(storyIndex + 1);
    const summary =
      storyIndex === 4
        ? 'Muestra sintética.'
        : storyIndex === 0
          ? 'Un proceso completamente ficticio recorre la planificación, el traslado y la apertura de un archivo vecinal durante varios meses. Cada etapa conserva su identidad, sus fechas conocidas o ausentes y las noticias que la describen. ' +
            'La relación entre algunas etapas sigue sin resolver; la falta de fecha y la aplicabilidad desconocida se registran por separado. '.repeat(
              10,
            )
          : 'Historia enteramente sintética sobre ' +
            subject +
            ' en ' +
            place +
            '. Sus etapas y fuentes se crean para comprobar el producto; no describen noticias reales.';
    const story = { id: threadId, title, occurrenceIds: [] as Ulid[], articleIds: [] as Ulid[] };
    stories.push(story);
    for (let eventIndex = 0; eventIndex < requireSemanticValue(eventCount); eventIndex += 1) {
      const occurrenceId = id(storyKey + '-event-' + String(eventIndex).padStart(2, '0'));
      story.occurrenceIds.push(occurrenceId);
      const day = storyIndex + eventIndex * 3;
      const unknownDate =
        (storyIndex === 0 && [3, 9, 27].includes(eventIndex)) ||
        (storyIndex > 0 && (storyIndex + eventIndex) % 11 === 0);
      const occurrenceTitle =
        eventIndex === 0 && storyIndex === 4
          ? 'Apertura'
          : place +
            ' · etapa ' +
            String(eventIndex + 1) +
            ' de ' +
            subject +
            (eventIndex === 2
              ? ': revisión de los espacios, las rutas de acceso, el catálogo provisional y las próximas actividades de las comunidades del Estuario'
              : '');
      const articleCount =
        storyIndex === 0
          ? eventIndex === 0
            ? 28
            : eventIndex === 1
              ? 10
              : eventIndex === 2
                ? 3
                : eventIndex < 25
                  ? 2
                  : 1
          : storyIndex === 4
            ? 1
            : storyIndex === 6
              ? 10
              : 3;
      events.push({
        id: semanticFixtureId('event-for-' + occurrenceId),
        threadId,
        categorySlug: requireSemanticValue(CATEGORY_SLUGS[storyIndex % CATEGORY_SLUGS.length]),
        windowTo: eventIndex === 2 ? instant(day + 21, 480) : null,
      });
      for (let articleIndex = 0; articleIndex < articleCount; articleIndex += 1) {
        const key =
          storyKey +
          '-event-' +
          String(eventIndex).padStart(2, '0') +
          '-news-' +
          String(articleIndex).padStart(2, '0');
        const sourceIndex =
          storyIndex === 0
            ? (eventIndex * 3 + articleIndex) % 20
            : storyIndex === 4 || storyIndex === 6
              ? 24
              : (storyIndex + eventIndex + articleIndex + (random() % 36)) % 36;
        const source = requireSemanticValue(sources[sourceIndex]);
        const articleId = id(key);
        story.articleIds.push(articleId);
        const headline =
          storyIndex === 0 && eventIndex === 0 && articleIndex === 0
            ? 'El archivo de Puerto Claro prepara una nueva etapa de su traslado junto a la biblioteca del Estuario y describe los trabajos del catálogo, la reorganización de las salas, los recorridos de acceso y las actividades previstas para las comunidades del valle ficticio'
            : storyIndex === 4
              ? 'Abre'
              : place +
                ': ' +
                (articleIndex === 0
                  ? 'se anuncia'
                  : articleIndex === 1
                    ? 'se documenta'
                    : 'se actualiza') +
                ' la etapa ' +
                String(eventIndex + 1) +
                ' de ' +
                subject;
        const body =
          'DEMOSTRACIÓN SINTÉTICA · Texto original creado para synthetic-product-stress-v1. En ' +
          place +
          ', una comunidad ficticia describe esta etapa de ' +
          subject +
          '. ' +
          (unknownDate
            ? 'La fecha del suceso no se proporciona. '
            : 'La fecha del suceso forma parte de este relato ficticio. ') +
          (articleIndex === 0 && eventIndex === 0
            ? 'El catálogo, los espacios de lectura y los recorridos se describen como parte de una historia inventada. Cada etapa tiene identidad propia y las fuentes repetidas no añaden autoridad ni equivalencia. '.repeat(
                9,
              )
            : 'Esta pieza conserva su fuente y su procedencia propias.');
        const occurrenceState =
          storyIndex === 0 && eventIndex === 3
            ? state('Identidad sin resolver; fecha del suceso ausente', 'UNKNOWN', 'APPLICABLE')
            : storyIndex === 0 && eventIndex === 4
              ? state(
                  'Identidad coincidente; aplicabilidad aún sin resolver',
                  'MATCH',
                  'UNKNOWN_APPLICABILITY',
                )
              : (storyIndex === 0 && eventIndex === 5) || storyIndex === 11
                ? state(
                    'Información insuficiente para identificar la etapa',
                    'UNKNOWN',
                    'UNKNOWN_APPLICABILITY',
                  )
                : storyIndex === 0 && eventIndex === 6
                  ? state(
                      'Etapa distinta; comparación fuera del ámbito declarado',
                      'DISTINCT',
                      'INAPPLICABLE',
                    )
                  : state(
                      articleIndex === 0
                        ? 'Etapa anunciada'
                        : articleIndex === articleCount - 1
                          ? 'Etapa documentada'
                          : 'Etapa en seguimiento',
                    );
        const threadState =
          storyIndex === 11
            ? state('Relación entre etapas sin resolver', 'UNKNOWN', 'APPLICABLE')
            : storyIndex === 12
              ? state(
                  'Proceso identificado; aplicabilidad sin resolver',
                  'MATCH',
                  'UNKNOWN_APPLICABILITY',
                )
              : state('Proceso ficticio · etapa ' + String(eventIndex + 1) + ' observada');
        const relation =
          eventIndex === 0 || articleIndex > 0
            ? null
            : {
                targetOccurrenceId: requireSemanticValue(story.occurrenceIds[eventIndex - 1]),
                decision: (eventIndex % 5 === 0
                  ? 'UNKNOWN'
                  : 'DISTINCT') as SemanticState['decision'],
                applicability: (eventIndex % 7 === 0
                  ? 'UNKNOWN_APPLICABILITY'
                  : 'APPLICABLE') as SemanticState['applicability'],
              };
        fixtures.push({
          article: {
            id: articleId,
            canonicalUrl: 'https://' + source.canonicalDomain + '/' + key,
            originalText: headline + '\n\n' + body,
          },
          observation: {
            id: id('observation-' + key),
            idempotencyKey: key,
            provider: 'fixture',
            providerVersion: STRESS_FIXTURE_VERSION,
            articleId,
            occurrenceId,
            threadId,
            occurrenceTitle,
            threadTitle: title,
            threadSummary: summary,
            eventAt: unknownDate ? null : instant(day, 480),
            observedAt: instant(day, 600 + articleIndex),
            occurrenceState,
            threadState,
            rationale:
              'Procedencia enteramente sintética, generada con versión ' +
              STRESS_FIXTURE_VERSION +
              ' y semilla ' +
              String(seed) +
              '. ' +
              (occurrenceState.decision === 'UNKNOWN'
                ? 'La identidad permanece sin resolver de forma explícita. '
                : 'Esta observación describe una etapa ficticia concreta. ') +
              'La decisión y la aplicabilidad son dimensiones independientes. No constituye revisión humana, equivalencia entre Assertions ni predicción de un modelo. ' +
              (storyIndex === 0 && eventIndex === 0 && articleIndex === 0
                ? 'El registro conserva la fuente, la noticia, el momento observado, el estado anterior y su transición para comprobar una explicación técnica extensa sin sumar autoridad. '.repeat(
                    7,
                  )
                : ''),
            relation,
          },
          source,
          ordinal: fixtures.length,
        });
      }
    }
  }
  const cases = {
    deepStory: requireSemanticValue(stories[0]).id,
    timeline15: requireSemanticValue(stories[1]).id,
    timeline8: requireSemanticValue(stories[2]).id,
    longStoryTitle: requireSemanticValue(stories[3]).id,
    timeline1: requireSemanticValue(stories[4]).id,
    timeline3: requireSemanticValue(stories[7]).id,
    oneSourceManyNews: requireSemanticValue(stories[6]).id,
    unknownStory: requireSemanticValue(stories[11]).id,
    unknownApplicabilityStory: requireSemanticValue(stories[12]).id,
    largestEvent: requireSemanticValue(requireSemanticValue(stories[0]).occurrenceIds[0]),
    coverage10: requireSemanticValue(requireSemanticValue(stories[0]).occurrenceIds[1]),
    coverage3: requireSemanticValue(requireSemanticValue(stories[0]).occurrenceIds[2]),
    missingDateEvent: requireSemanticValue(requireSemanticValue(stories[0]).occurrenceIds[3]),
    unknownApplicabilityEvent: requireSemanticValue(
      requireSemanticValue(stories[0]).occurrenceIds[4],
    ),
    insufficientIdentityEvent: requireSemanticValue(
      requireSemanticValue(stories[0]).occurrenceIds[5],
    ),
    distinctInapplicableEvent: requireSemanticValue(
      requireSemanticValue(stories[0]).occurrenceIds[6],
    ),
    coverage1: requireSemanticValue(requireSemanticValue(stories[4]).occurrenceIds[0]),
    longestArticle: requireSemanticValue(requireSemanticValue(stories[0]).articleIds[0]),
    shortestArticle: requireSemanticValue(requireSemanticValue(stories[4]).articleIds[0]),
    longestSource: requireSemanticValue(sources[35]).id,
    longProvenance: semanticFixtureId(
      'provenance-' + requireSemanticValue(fixtures[0]).observation.id,
    ),
  };
  return {
    version: STRESS_FIXTURE_VERSION,
    seed,
    sources,
    fixtures,
    stories,
    events,
    cases,
    counts: {
      stories: stories.length,
      events: events.length,
      articles: fixtures.length,
      sources: sources.length,
      observations: fixtures.length,
      transitions: fixtures.length * 2,
    },
  };
}
export const SEMANTIC_STRESS_WORLD = generateSemanticStressWorld();

export class StressFixtureSemanticObservationProvider implements SemanticObservationProvider {
  readonly name = 'fixture';
  readonly version = STRESS_FIXTURE_VERSION;
  private readonly articles = new Map(
    SEMANTIC_STRESS_WORLD.fixtures.map((fixture) => [fixture.article.id, fixture]),
  );
  observe(article: SafeSemanticArticle): Promise<SemanticObservation> {
    const fixture = this.articles.get(article.id);
    if (
      fixture === undefined ||
      fixture.article.canonicalUrl !== article.canonicalUrl ||
      fixture.article.originalText !== article.originalText
    )
      throw new Error(
        'Stress fixture provider accepts only exact generated synthetic product Articles.',
      );
    return Promise.resolve(fixture.observation);
  }
}
