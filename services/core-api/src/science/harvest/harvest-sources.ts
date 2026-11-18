import { XMLParser } from 'fast-xml-parser';

import { arxivTopic, openAlexTopic } from '../study-topics.js';

import {
  abstractFromInvertedIndex, authorsOf, dateParts, normalizeDoi, openAlexPrecision, precisionOf, reviewOf, stripJats,
  type FetchLike, type ResolvedStudy,
} from '../study-resolver.js';

/**
 * Readers of the daily harvest. Each one turns one source's answer into
 * studies for the cache: metadata, the abstract the authors wrote and a
 * link. Never full text. A record without a DOI is skipped and counted.
 */
export type HarvestSource = 'openalex_cl' | 'scielo_cl' | 'europepmc' | 'arxiv';

export interface HarvestedStudy extends ResolvedStudy {
  harvest_source: HarvestSource;
}

export interface SourceBatch {
  studies: HarvestedStudy[];
  /** Records that had no DOI or no title. */
  skipped: number;
}

export interface HarvestOptions {
  fetcher: FetchLike;
  /** Days back from `now`. */
  days: number;
  now: Date;
  /** Upper bound per source and run. */
  limit: number;
  openAlexApiKey?: string | undefined;
  contactEmail?: string | undefined;
  arxivCategories: string[];
  /** Counts each request for science_api_usage. */
  onCall?: (source: string, ok: boolean) => void;
  /** Waits between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** 429 and 503 are retried after a pause: arXiv asks clients to slow down. */
export const RETRY_DELAYS_MS = [5_000, 15_000];
const MAX_RETRY_AFTER_MS = 30_000;

const TIMEOUT_MS = 30_000;
/** Pages per source and run: a source of records without DOI cannot loop forever. */
export const MAX_PAGES = 20;

function userAgent(options: HarvestOptions): string {
  return options.contactEmail
    ? `Dialektik-harvest/1.0 (+https://dialektik-core-dev.onrender.com; mailto:${options.contactEmail})`
    : 'Dialektik-harvest/1.0 (+https://dialektik-core-dev.onrender.com)';
}

async function fetchOnce(options: HarvestOptions, source: string, url: URL, accept: string):
  Promise<{ body: string } | { status: number; retryAfterMs: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let ok = false;
  try {
    const response = await options.fetcher(url.toString(), {
      headers: { accept, 'user-agent': userAgent(options) },
      signal: controller.signal,
    });
    if (!response.ok) {
      const header = (response as unknown as { headers?: { get?(name: string): string | null } }).headers?.get?.('retry-after');
      const seconds = header === null || header === undefined ? Number.NaN : Number.parseInt(header, 10);
      return { status: response.status, retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : null };
    }
    const body = await (response as unknown as { text(): Promise<string> }).text();
    ok = true;
    return { body };
  } finally {
    clearTimeout(timer);
    options.onCall?.(source, ok);
  }
}

async function fetchText(options: HarvestOptions, source: string, url: URL, accept: string): Promise<string> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    const result = await fetchOnce(options, source, url, accept);
    if ('body' in result) return result.body;
    const retryable = result.status === 429 || result.status === 503;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw new Error(`${source} answered ${result.status}`);
    await sleep(Math.min(result.retryAfterMs ?? RETRY_DELAYS_MS[attempt]!, MAX_RETRY_AFTER_MS));
  }
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

const clean = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/<[^>]+>/gu, ' ').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/\s+/gu, ' ').trim();
  return text === '' ? null : text;
};

const clip = (value: string | null, max: number): string | null =>
  value === null ? null : value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/** «Family Initials», three names then «et al.». */
function authorList(names: string[]): string | null {
  const formatted = names
    .map((name) => name.replace(/\s+/gu, ' ').trim())
    .filter((name) => name !== '')
    .map((name) => {
      if (name.includes(',')) {
        const [family, given = ''] = name.split(',', 2).map((p) => p.trim());
        const initials = given.split(/[\s.-]+/u).filter(Boolean).map((p) => p[0]!.toUpperCase()).join('');
        return initials ? `${family} ${initials}` : family!;
      }
      const parts = name.split(' ');
      if (parts.length === 1) return name;
      const family = parts.at(-1)!;
      const initials = parts.slice(0, -1).map((p) => p[0]!.toUpperCase()).join('');
      return `${family} ${initials}`;
    });
  if (formatted.length === 0) return null;
  return clip(formatted.length > 4 ? `${formatted.slice(0, 3).join(', ')}, et al.` : formatted.join(', '), 600);
}

const language = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim().toLowerCase().slice(0, 3) : '';
  const code = { eng: 'en', spa: 'es', por: 'pt' }[text] ?? text.slice(0, 2);
  return /^[a-z]{2}$/u.test(code) ? code : null;
};

// ---- OpenAlex: works with an author at a Chilean institution ---------------

export function parseOpenAlexWork(work: Record<string, unknown>): HarvestedStudy | null {
  const doi = typeof work.doi === 'string' ? normalizeDoi(work.doi) : null;
  const title = clip(clean(work.display_name) ?? clean(work.title), 1000);
  if (doi === null || title === null) return null;
  const authorships = Array.isArray(work.authorships) ? (work.authorships as Record<string, unknown>[]) : [];
  const institutions = authorships.flatMap((a) => (Array.isArray(a.institutions) ? (a.institutions as Record<string, unknown>[]) : []));
  const source = (work.primary_location as { source?: { display_name?: unknown; type?: unknown } } | undefined)?.source;
  const openAccess = work.open_access as { is_oa?: unknown } | undefined;
  const abstract = clip(abstractFromInvertedIndex(work.abstract_inverted_index), 12000);
  return {
    doi,
    title,
    review: reviewOf({ doi, openalexType: typeof work.type === 'string' ? work.type : null,
      openalexSourceType: typeof (source as { type?: unknown } | undefined)?.type === 'string'
        ? (source as { type: string }).type : null }),
    published_precision: openAlexPrecision(typeof work.publication_date === 'string' ? work.publication_date : null),
    authors: authorList(authorships.map((a) => String((a.author as { display_name?: unknown } | undefined)?.display_name ?? ''))),
    institution: clip(clean(institutions.find((i) => String(i.country_code ?? '').toUpperCase() === 'CL')?.display_name)
      ?? clean(institutions[0]?.display_name), 300),
    journal: clip(clean(source?.display_name), 300),
    published_at: typeof work.publication_date === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(work.publication_date) ? work.publication_date : null,
    abstract,
    abstract_source: abstract === null ? null : 'OpenAlex',
    abstract_language: language(work.language),
    access: openAccess?.is_oa === true ? 'Abierto' : openAccess?.is_oa === false ? 'Pago' : null,
    retracted: work.is_retracted === true,
    retracted_at: null,
    made_in_chile: institutions.some((i) => String(i.country_code ?? '').toUpperCase() === 'CL'),
    topic: openAlexTopic(work.primary_topic),
    harvest_source: 'openalex_cl',
  };
}

export async function harvestOpenAlex(options: HarvestOptions): Promise<SourceBatch> {
  const from = day(new Date(options.now.getTime() - options.days * 86_400_000));
  const studies: HarvestedStudy[] = [];
  let skipped = 0;
  let cursor = '*';
  let pages = 0;
  while (studies.length < options.limit && cursor && pages < MAX_PAGES) {
    pages += 1;
    const url = new URL('https://api.openalex.org/works');
    url.searchParams.set('filter', `authorships.institutions.country_code:CL,from_publication_date:${from},has_doi:true,type:article|preprint|review`);
    url.searchParams.set('sort', 'publication_date:desc');
    url.searchParams.set('per-page', '100');
    url.searchParams.set('cursor', cursor);
    if (options.openAlexApiKey) url.searchParams.set('api_key', options.openAlexApiKey);
    if (options.contactEmail) url.searchParams.set('mailto', options.contactEmail);
    const body = JSON.parse(await fetchText(options, 'openalex', url, 'application/json')) as {
      results?: Record<string, unknown>[]; meta?: { next_cursor?: string | null };
    };
    const results = body.results ?? [];
    for (const work of results) {
      const study = parseOpenAlexWork(work);
      if (study === null) skipped += 1;
      else if (studies.length < options.limit) studies.push(study);
    }
    cursor = results.length === 0 ? '' : body.meta?.next_cursor ?? '';
  }
  return { studies, skipped };
}

// ---- Europe PMC: health articles and preprints with a Chilean affiliation --

export function parseEuropePmcResult(result: Record<string, unknown>): HarvestedStudy | null {
  const doi = typeof result.doi === 'string' ? normalizeDoi(result.doi) : null;
  const title = clip(clean(result.title)?.replace(/\.$/u, '') ?? null, 1000);
  if (doi === null || title === null) return null;
  const preprint = result.source === 'PPR';
  const types = ((result.pubTypeList as { pubType?: unknown } | undefined)?.pubType);
  const typeList = (Array.isArray(types) ? types : [types]).map((t) => String(t ?? '').toLowerCase());
  const journalInfo = result.journalInfo as { journal?: { title?: unknown } } | undefined;
  const bookOrPreprintServer = (result.bookOrReportDetails as { publisher?: unknown } | undefined)?.publisher;
  const abstract = clip(clean(result.abstractText), 12000);
  const affiliation = clean(result.affiliation);
  const published = typeof result.firstPublicationDate === 'string' ? result.firstPublicationDate : null;
  return {
    doi,
    title,
    // MEDLINE indexes journals; a preprint server says so.
    review: preprint ? 'preprint' : 'peer_reviewed',
    published_precision: 'day',
    authors: authorList(String(result.authorString ?? '').replace(/\.$/u, '').split(/,\s*/u)),
    institution: clip(affiliation, 300),
    journal: clip(clean(journalInfo?.journal?.title) ?? clean(bookOrPreprintServer), 300),
    published_at: published && /^\d{4}-\d{2}-\d{2}$/u.test(published) ? published : null,
    abstract,
    abstract_source: abstract === null ? null : 'Europe PMC',
    abstract_language: language(result.language),
    access: result.isOpenAccess === 'Y' ? 'Abierto' : null,
    retracted: typeList.some((t) => t.includes('retracted publication')),
    retracted_at: null,
    made_in_chile: affiliation !== null && /\bchile\b/iu.test(affiliation),
    // Europe PMC indexes life sciences and medicine.
    topic: 'salud',
    harvest_source: 'europepmc',
  };
}

export async function harvestEuropePmc(options: HarvestOptions): Promise<SourceBatch> {
  const from = day(new Date(options.now.getTime() - options.days * 86_400_000));
  const to = day(options.now);
  const studies: HarvestedStudy[] = [];
  let skipped = 0;
  let cursor = '*';
  let pages = 0;
  while (studies.length < options.limit && cursor && pages < MAX_PAGES) {
    pages += 1;
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    url.searchParams.set('query', `AFF:"Chile" AND (SRC:MED OR SRC:PPR) AND HAS_DOI:y AND FIRST_PDATE:[${from} TO ${to}]`);
    url.searchParams.set('resultType', 'core');
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('cursorMark', cursor);
    const body = JSON.parse(await fetchText(options, 'europepmc', url, 'application/json')) as {
      resultList?: { result?: Record<string, unknown>[] }; nextCursorMark?: string;
    };
    const results = body.resultList?.result ?? [];
    for (const result of results) {
      const study = parseEuropePmcResult(result);
      if (study === null) skipped += 1;
      else if (studies.length < options.limit) studies.push(study);
    }
    const next = body.nextCursorMark ?? '';
    cursor = results.length === 0 || next === cursor ? '' : next;
  }
  return { studies, skipped };
}

// ---- arXiv: newest preprints in a few categories -------------------------

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, isArray: (name) =>
  ['entry', 'author', 'affiliation'].includes(name) });

const textOf = (value: unknown): string | null => {
  if (Array.isArray(value)) return textOf(value[0]);
  if (value !== null && typeof value === 'object') return clean((value as { '#text'?: unknown })['#text']);
  return clean(typeof value === 'number' ? String(value) : value);
};

/** `<arxiv:primary_category term="astro-ph.GA"/>`, else the first category. */
function primaryCategory(entry: Record<string, unknown>): string | null {
  const term = (value: unknown): string | null => {
    const item = Array.isArray(value) ? value[0] : value;
    const t = item !== null && typeof item === 'object' ? (item as Record<string, unknown>)['@_term'] : null;
    return typeof t === 'string' ? t : null;
  };
  return term(entry.primary_category) ?? term(entry.category);
}

export function parseArxivFeed(body: string): SourceBatch {
  const feed = (xml.parse(body) as { feed?: { entry?: Record<string, unknown>[] } }).feed;
  const studies: HarvestedStudy[] = [];
  let skipped = 0;
  for (const entry of feed?.entry ?? []) {
    const id = textOf(entry.id)?.match(/arxiv\.org\/abs\/([^v\s]+?)(?:v\d+)?$/iu)?.[1];
    const title = clip(textOf(entry.title), 1000);
    if (!id || title === null) { skipped += 1; continue; }
    const authors = (entry.author as Record<string, unknown>[] | undefined) ?? [];
    const affiliations = authors.flatMap((a) => ((a.affiliation as unknown[] | undefined) ?? []).map(textOf)).filter((a): a is string => a !== null);
    const published = textOf(entry.published);
    const abstract = clip(textOf(entry.summary), 12000);
    studies.push({
      doi: `10.48550/arxiv.${id.toLowerCase()}`,
      title,
      review: 'preprint',
      published_precision: 'day',
      authors: authorList(authors.map((a) => textOf(a.name) ?? '')),
      institution: clip(affiliations[0] ?? null, 300),
      journal: 'arXiv',
      published_at: published?.slice(0, 10) ?? null,
      abstract,
      abstract_source: abstract === null ? null : 'arXiv',
      abstract_language: 'en',
      access: 'Abierto',
      retracted: false,
      retracted_at: null,
      made_in_chile: affiliations.some((a) => /\bchile\b/iu.test(a)),
      topic: arxivTopic(primaryCategory(entry)),
      harvest_source: 'arxiv',
    });
  }
  return { studies, skipped };
}

export async function harvestArxiv(options: HarvestOptions): Promise<SourceBatch> {
  if (options.arxivCategories.length === 0) return { studies: [], skipped: 0 };
  const url = new URL('https://export.arxiv.org/api/query');
  url.searchParams.set('search_query', options.arxivCategories.map((c) => `cat:${c}`).join(' OR '));
  url.searchParams.set('sortBy', 'submittedDate');
  url.searchParams.set('sortOrder', 'descending');
  url.searchParams.set('max_results', String(Math.min(options.limit, 200)));
  const batch = parseArxivFeed(await fetchText(options, 'arxiv', url, 'application/atom+xml'));
  const since = new Date(options.now.getTime() - options.days * 86_400_000).toISOString().slice(0, 10);
  return { studies: batch.studies.filter((s) => s.published_at === null || s.published_at >= since), skipped: batch.skipped };
}

// ---- SciELO Chile: through Crossref, prefix 10.4067 ------------------------
//
// SciELO Chile registers its DOIs with Crossref under 10.4067. Its OAI-PMH
// endpoint refuses automated clients from cloud runners, so the official
// Crossref API is used instead; it carries the abstract when the journal
// deposited it.

export const SCIELO_CHILE_PREFIX = '10.4067';

export function parseCrossrefScieloItem(item: Record<string, unknown>): HarvestedStudy | null {
  const doi = typeof item.DOI === 'string' ? normalizeDoi(item.DOI) : null;
  const titles = Array.isArray(item.title) ? item.title : [];
  const title = clip(clean(titles[0]), 1000);
  if (doi === null || title === null) return null;
  const authors = Array.isArray(item.author) ? (item.author as Record<string, unknown>[]) : [];
  const affiliations = authors.flatMap((a) => (Array.isArray(a.affiliation) ? (a.affiliation as { name?: unknown }[]) : []))
    .map((a) => clean(a.name)).filter((a): a is string => a !== null);
  const containers = Array.isArray(item['container-title']) ? item['container-title'] : [];
  const abstract = clip(stripJats(item.abstract), 12000);
  return {
    doi,
    title,
    review: reviewOf({ doi, crossrefType: typeof item.type === 'string' ? item.type : 'journal-article' }),
    published_precision: precisionOf(item.published) ?? precisionOf(item.issued) ?? 'day',
    authors: clip(authorsOf(item), 600),
    institution: clip(affiliations.find((a) => /\bchile\b/iu.test(a)) ?? affiliations[0] ?? null, 300),
    journal: clip(clean(containers[0]), 300),
    published_at: dateParts(item.published) ?? dateParts(item.issued),
    abstract,
    abstract_source: abstract === null ? null : 'Crossref (SciELO Chile)',
    abstract_language: language(item.language),
    access: 'Abierto',
    retracted: false,
    retracted_at: null,
    made_in_chile: affiliations.some((a) => /\bchile\b/iu.test(a)),
    // Crossref keeps no subject taxonomy for these records.
    topic: null,
    harvest_source: 'scielo_cl',
  };
}

export async function harvestScielo(options: HarvestOptions): Promise<SourceBatch> {
  const from = day(new Date(options.now.getTime() - options.days * 86_400_000));
  const studies: HarvestedStudy[] = [];
  let skipped = 0;
  let cursor = '*';
  let pages = 0;
  while (studies.length < options.limit && cursor && pages < MAX_PAGES) {
    pages += 1;
    const url = new URL(`https://api.crossref.org/prefixes/${SCIELO_CHILE_PREFIX}/works`);
    url.searchParams.set('filter', `from-pub-date:${from},type:journal-article`);
    url.searchParams.set('rows', '100');
    url.searchParams.set('cursor', cursor);
    if (options.contactEmail) url.searchParams.set('mailto', options.contactEmail);
    const body = JSON.parse(await fetchText(options, 'crossref', url, 'application/json')) as {
      message?: { items?: Record<string, unknown>[]; 'next-cursor'?: string };
    };
    const items = body.message?.items ?? [];
    for (const item of items) {
      const study = parseCrossrefScieloItem(item);
      if (study === null) skipped += 1;
      else if (studies.length < options.limit) studies.push(study);
    }
    cursor = items.length === 0 ? '' : body.message?.['next-cursor'] ?? '';
  }
  return { studies, skipped };
}

export const HARVESTERS: Record<HarvestSource, (options: HarvestOptions) => Promise<SourceBatch>> = {
  openalex_cl: harvestOpenAlex,
  europepmc: harvestEuropePmc,
  scielo_cl: harvestScielo,
  arxiv: harvestArxiv,
};
