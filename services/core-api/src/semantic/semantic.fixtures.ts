import { createHash } from 'node:crypto';
import { parseUlid, type Ulid } from '@dialektik/database';
import type {
  SafeSemanticArticle,
  SemanticObservation,
  SemanticState,
} from './semantic.contracts.js';
import { requireSemanticValue } from './semantic.validation.js';

export const FIXTURE_VERSION = 'synthetic-product-v2';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function semanticFixtureId(key: string): Ulid {
  let bits = BigInt(
    '0x' +
      createHash('sha256')
        .update('dialektik-shadow:' + key)
        .digest('hex')
        .slice(0, 32),
  );
  let id = '';
  for (let index = 0; index < 26; index += 1) {
    id = ALPHABET.charAt(Number(bits & 31n)) + id;
    bits >>= 5n;
  }
  return parseUlid(id);
}
export const SEMANTIC_FIXTURE_SOURCES = [
  'Diario de Puerto Claro',
  'Radio del Estuario',
  'Agencia Horizonte',
  'Cuaderno del Barrio',
  'Gaceta de Villa Nube',
].map((name, index) => ({
  id: semanticFixtureId('source-' + String(index)),
  name: name + ' · sintético',
  canonicalDomain: 'source-' + String(index) + '.dialektik.invalid',
}));
const threads = {
  alpha: {
    title: 'Puerto Claro · revisión y reparación del puente',
    summary:
      'Demostración sintética de un proceso acotado: inspección, reparación y reapertura del puente del Estuario. Cada etapa es una ocurrencia distinta.',
  },
  beta: {
    title: 'Villa Nube · nueva sala de la biblioteca',
    summary: 'Demostración sintética independiente: apertura de una sala de lectura en Villa Nube.',
  },
  gamma: {
    title: 'Informe sobre un puente · ubicación sin resolver',
    summary:
      'Demostración sintética con información insuficiente para vincular el informe al puente de Puerto Claro.',
  },
} as const;
const match = (description: string): SemanticState => ({
  description,
  decision: 'MATCH',
  applicability: 'APPLICABLE',
});
const unknown = (description: string): SemanticState => ({
  description,
  decision: 'UNKNOWN',
  applicability: 'UNKNOWN_APPLICABILITY',
});
const definitions = [
  {
    key: 'alpha-1-a',
    thread: 'alpha',
    occurrence: 'alpha-1',
    source: 0,
    day: 1,
    hour: 9,
    title: 'Inspección del puente del Estuario',
    article: 'El municipio anuncia la inspección del puente',
    body: 'La municipalidad ficticia de Puerto Claro anunció una inspección del puente del Estuario para el 1 de octubre. La inspección es una etapa del proceso y no constituye la reparación.',
    occurrenceState: match('Inspección anunciada'),
    threadState: match('Revisión iniciada'),
  },
  {
    key: 'alpha-1-b',
    thread: 'alpha',
    occurrence: 'alpha-1',
    source: 1,
    day: 1,
    hour: 11,
    title: 'Inspección del puente del Estuario',
    article: 'El equipo técnico llega al puente',
    body: 'Radio del Estuario, medio ficticio, informó de la llegada del equipo técnico al mismo puente. Su pieza describe la inspección anunciada, sin afirmar que la reparación haya comenzado.',
    occurrenceState: match('Inspección en curso'),
    threadState: match('Revisión en curso'),
  },
  {
    key: 'alpha-1-c',
    thread: 'alpha',
    occurrence: 'alpha-1',
    source: 2,
    day: 1,
    hour: 15,
    title: 'Inspección del puente del Estuario',
    article: 'La inspección finaliza con un acta',
    body: 'Agencia Horizonte, fuente sintética, describió el cierre de la inspección del puente del Estuario. El acta recomienda una intervención posterior; esta pieza sigue describiendo la misma inspección.',
    occurrenceState: match('Inspección completada'),
    threadState: match('Reparación prevista'),
  },
  {
    key: 'alpha-2-a',
    thread: 'alpha',
    occurrence: 'alpha-2',
    source: 0,
    day: 2,
    hour: 9,
    title: 'Inicio de la reparación del puente',
    article: 'Comienza la reparación tras la inspección',
    body: 'En Puerto Claro ficticio comenzó una reparación el día posterior a la inspección. Se trata de otra ocurrencia dentro del proceso del mismo puente, no de una nueva pieza de la inspección.',
    occurrenceState: match('Reparación iniciada'),
    threadState: match('Reparación en curso'),
    related: 'alpha-1',
    relationDecision: 'DISTINCT',
  },
  {
    key: 'alpha-2-b',
    thread: 'alpha',
    occurrence: 'alpha-2',
    source: 3,
    day: 2,
    hour: 12,
    title: 'Inicio de la reparación del puente',
    article: 'El barrio documenta el inicio de las obras',
    body: 'Cuaderno del Barrio publicó una pieza sintética sobre las obras iniciadas esa mañana en el puente del Estuario. La pieza procede de otra fuente y cubre el mismo inicio de reparación.',
    occurrenceState: match('Reparación en curso'),
    threadState: match('Reparación en curso'),
  },
  {
    key: 'alpha-3-a',
    thread: 'alpha',
    occurrence: 'alpha-3',
    source: 0,
    day: 3,
    hour: 9,
    title: 'Reapertura del puente del Estuario',
    article: 'El puente vuelve a abrir después de las obras',
    body: 'El municipio ficticio comunicó la reapertura del puente del Estuario tras la reparación. La reapertura es una tercera ocurrencia distinta de la inspección y del inicio de obras.',
    occurrenceState: match('Reapertura comunicada'),
    threadState: match('Reapertura comunicada'),
    related: 'alpha-2',
    relationDecision: 'DISTINCT',
  },
  {
    key: 'beta-1-a',
    thread: 'beta',
    occurrence: 'beta-1',
    source: 4,
    day: 3,
    hour: 10,
    title: 'Apertura de la sala de lectura de Villa Nube',
    article: 'La biblioteca de Villa Nube abre una sala',
    body: 'En la localidad ficticia de Villa Nube se abrió una sala de lectura. Este acontecimiento no forma parte del proceso del puente de Puerto Claro.',
    occurrenceState: match('Apertura comunicada'),
    threadState: match('Sala abierta'),
  },
  {
    key: 'gamma-1-a',
    thread: 'gamma',
    occurrence: 'gamma-1',
    source: 1,
    day: 3,
    hour: 11,
    title: 'Informe de inspección sin ubicación identificada',
    article: 'Un informe menciona un puente sin identificarlo',
    body: 'Una pieza totalmente sintética menciona la inspección de un puente sin indicar localidad, nombre o fecha del suceso. No hay información suficiente para decidir si corresponde al puente del Estuario.',
    occurrenceState: unknown('Ubicación y relación sin resolver'),
    threadState: unknown('Información insuficiente'),
    related: 'alpha-1',
    relationDecision: 'UNKNOWN',
  },
] as const;
export const SEMANTIC_FIXTURES = definitions.map((definition, index) => {
  const thread = threads[definition.thread];
  const source = requireSemanticValue(SEMANTIC_FIXTURE_SOURCES[definition.source]);
  const observedAt =
    '2026-10-' +
    String(definition.day).padStart(2, '0') +
    'T' +
    String(definition.hour).padStart(2, '0') +
    ':00:00.000Z';
  const articleId = semanticFixtureId('article-' + definition.key);
  const article: SafeSemanticArticle = {
    id: articleId,
    canonicalUrl: 'https://' + source.canonicalDomain + '/' + definition.key,
    originalText: definition.article + '\n\nDEMOSTRACIÓN SINTÉTICA · ' + definition.body,
  };
  const observation: SemanticObservation = {
    id: semanticFixtureId('observation-' + definition.key),
    idempotencyKey: definition.key,
    provider: 'fixture',
    providerVersion: FIXTURE_VERSION,
    articleId,
    occurrenceId: semanticFixtureId('occurrence-' + definition.occurrence),
    threadId: semanticFixtureId('thread-' + definition.thread),
    occurrenceTitle: definition.title,
    threadTitle: thread.title,
    threadSummary: thread.summary,
    eventAt:
      definition.thread === 'gamma'
        ? null
        : '2026-10-' + String(definition.day).padStart(2, '0') + 'T08:00:00.000Z',
    observedAt,
    occurrenceState: definition.occurrenceState,
    threadState: definition.threadState,
    rationale:
      definition.thread === 'gamma'
        ? 'Fixture estático creado durante esta tarea de producto: faltan lugar y fecha; la relación permanece UNKNOWN. No se asigna el Article al Event.'
        : 'Fixture estático creado durante esta tarea de producto. El Article describe esta etapa del proceso; la coincidencia de la ocurrencia no implica equivalencia entre Assertions. No representa una revisión humana ni una predicción del candidato.',
    relation:
      'related' in definition
        ? {
            targetOccurrenceId: semanticFixtureId('occurrence-' + definition.related),
            decision: definition.relationDecision,
            applicability:
              definition.relationDecision === 'UNKNOWN' ? 'UNKNOWN_APPLICABILITY' : 'APPLICABLE',
          }
        : null,
  };
  return {
    article,
    observation,
    source,
    ordinal: index,
  };
});
export function semanticFixtureAt(index: number) {
  return requireSemanticValue(SEMANTIC_FIXTURES[index]);
}
