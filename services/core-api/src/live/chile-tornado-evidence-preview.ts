/**
 * Human-reviewed evidence links for one bounded real occurrence (Santiago, Chile).
 *
 * Metadata is a static, dated editorial selection of publicly visible headlines;
 * this is NOT live scraping, an acquired Article, an event model output, or semantic
 * clustering. Do not copy article bodies, screenshots, summaries or private metadata.
 */
export const CHILE_TORNADO_PREVIEW_KEY =
  'editorial-preview:cl:estacion-central:2026-10-13:ef0' as const;
export const CHILE_TORNADO_REVIEW_DATE = '2026-10-19' as const;

export interface CuratedEventEvidence {
  readonly publisher: string;
  readonly publisherKind: 'INDEPENDENT_NEWSROOM' | 'PRIMARY_GOVERNMENT_SOURCE';
  readonly headline: string;
  readonly canonicalUrl: string;
  readonly publishedOn: string;
  readonly occurrenceKey: typeof CHILE_TORNADO_PREVIEW_KEY;
}

const DOCUMENTS: readonly CuratedEventEvidence[] = Object.freeze([
  {
    publisher: 'La Tercera',
    publisherKind: 'INDEPENDENT_NEWSROOM',
    headline: 'DMC confirma tornado en Estación Central: vientos alcanzaron los 137 km/h',
    canonicalUrl: 'https://www.latercera.com/nacional/noticia/dmc-confirma-tornado-en-estacion-central-vientos-alcanzaron-los-137-kmh/',
    publishedOn: '2026-10-13',
    occurrenceKey: CHILE_TORNADO_PREVIEW_KEY,
  },
  {
    publisher: 'BioBioChile',
    publisherKind: 'INDEPENDENT_NEWSROOM',
    headline: 'DMC confirma que fenómeno registrado en Estación Central sería un tornado',
    canonicalUrl: 'https://www.biobiochile.cl/noticias/nacional/region-metropolitana/2026/10/13/dmc-asegura-que-fenomeno-apreciado-en-estacion-central-seria-un-tornado.shtml',
    publishedOn: '2026-10-13',
    occurrenceKey: CHILE_TORNADO_PREVIEW_KEY,
  },
  {
    publisher: 'Cooperativa',
    publisherKind: 'INDEPENDENT_NEWSROOM',
    headline: '[VIDEO] Meteorología confirmó "evento tornádico" en Estación Central',
    canonicalUrl: 'https://www.instagram.cooperativa.cl/noticias/pais/desastres-naturales/video-meteorologia-confirmo-evento-tornadico-en-estacion-central/2026-10-13/175530.html',
    publishedOn: '2026-10-13',
    occurrenceKey: CHILE_TORNADO_PREVIEW_KEY,
  },
  {
    publisher: 'T13',
    publisherKind: 'INDEPENDENT_NEWSROOM',
    headline: 'Intentan rescatar a familia atrapada tras inédito tornado en Estación Central: árbol cayó sobre su casa',
    canonicalUrl: 'https://www.t13.cl/noticia/nacional/intentan-rescatar-familia-atrapada-tras-tornado-estacion-central-14-10-2026',
    publishedOn: '2026-10-14',
    occurrenceKey: CHILE_TORNADO_PREVIEW_KEY,
  },
  {
    publisher: 'Gobierno de Santiago',
    publisherKind: 'PRIMARY_GOVERNMENT_SOURCE',
    headline: 'Gobernador de Santiago y alcalde de Estación Central coordinan catastro de viviendas afectadas por tornado',
    canonicalUrl: 'https://www.gobiernosantiago.cl/2026/10/14/gobernador-de-santiago-y-alcalde-de-estacion-central-coordinan-catastro-de-viviendas-afectadas-por-tornado/',
    publishedOn: '2026-10-14',
    occurrenceKey: CHILE_TORNADO_PREVIEW_KEY,
  },
]);

const ALLOWED_URLS = new Map(DOCUMENTS.map((document) =>
  [document.publisher, document.canonicalUrl] as const,
));

/** Rejects unrelated entities, different occurrences, link substitution and source duplication. */
export function editoriallyLinkTornadoDocuments(
  documents: readonly CuratedEventEvidence[],
): readonly CuratedEventEvidence[] {
  if (documents.length < 3 || documents.length > DOCUMENTS.length)
    throw new Error('CURATED_PREVIEW_EVIDENCE_COUNT_INVALID');
  const publishers = new Set<string>();
  const links = new Set<string>();
  for (const document of documents) {
    const parsed = new URL(document.canonicalUrl);
    if (document.occurrenceKey !== CHILE_TORNADO_PREVIEW_KEY ||
        document.publishedOn < '2026-10-13' ||
        document.publishedOn > '2026-10-14' ||
        parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        parsed.search || parsed.hash ||
        ALLOWED_URLS.get(document.publisher) !== document.canonicalUrl ||
        !document.headline.trim() ||
        publishers.has(document.publisher) || links.has(document.canonicalUrl) ||
        !DOCUMENTS.some((known) =>
          known.publisher === document.publisher &&
          known.headline === document.headline &&
          known.publishedOn === document.publishedOn &&
          known.publisherKind === document.publisherKind)) {
      throw new Error('CURATED_PREVIEW_EVIDENCE_OUT_OF_SCOPE');
    }
    publishers.add(document.publisher);
    links.add(document.canonicalUrl);
  }
  const independent = documents.filter((item) =>
    item.publisherKind === 'INDEPENDENT_NEWSROOM');
  if (independent.length < 2 ||
      !documents.some((item) => item.publisherKind === 'PRIMARY_GOVERNMENT_SOURCE')) {
    throw new Error('CURATED_PREVIEW_INDEPENDENCE_NOT_MET');
  }
  return Object.freeze([...documents].sort((a, b) =>
    b.publishedOn.localeCompare(a.publishedOn) ||
    a.publisher.localeCompare(b.publisher)));
}

export function chileTornadoEditorialPreview() {
  const publications = editoriallyLinkTornadoDocuments(DOCUMENTS);
  return {
    mode: 'CURATED_REAL_EVENT_EVIDENCE_PREVIEW' as const,
    persisted: false as const,
    semantic_engine_executed: false as const,
    grouping_method: 'HUMAN_REVIEWED_FIXED_OCCURRENCE' as const,
    verified_on: CHILE_TORNADO_REVIEW_DATE,
    id: CHILE_TORNADO_PREVIEW_KEY,
    title: 'Tornado EF-0 en Estación Central, Santiago',
    occurred_on: '2026-10-13',
    location: 'Estación Central, Región Metropolitana, Chile',
    category: 'País',
    editorial_evidence: 'El mismo fenómeno meteorológico del 13 de octubre de 2026, en Estación Central, aparece en cuatro medios y un comunicado del Gobierno de Santiago. No se agrupan automáticamente otras tormentas o tornados.',
    warning: 'Caso piloto de enlaces seleccionados y verificados editorialmente. No es un Event almacenado ni un resultado automático del motor semántico.',
    independent_newsroom_count: publications.filter((p) => p.publisherKind === 'INDEPENDENT_NEWSROOM').length,
    source_count: publications.length,
    publications: publications.map((p) => ({
      headline: p.headline,
      publisher: p.publisher,
      publisher_kind: p.publisherKind,
      canonical_url: p.canonicalUrl,
      published_on: p.publishedOn,
    })),
  };
}
