import { parseArxivFeed } from './harvest/harvest-sources.js';
import { authorsOf, dateParts, normalizeDoi, reviewOf, type FetchLike, type StudyReview, type ResolvedStudy, type ResolverOptions } from './study-resolver.js';

/**
 * C2 lookup: a DOI, a link or a title. A link is never downloaded (no
 * article page, PDF or full text): only a DOI or an arXiv id written in it
 * is read. A title is searched in Crossref (query.bibliographic), OpenAlex
 * and arXiv, and up to three candidates come back for the reader to pick.
 */
export type LookupQuery =
  | { kind: 'doi'; doi: string }
  | { kind: 'link_without_doi' }
  | { kind: 'title'; text: string };

export interface LookupCandidate {
  doi: string;
  title: string;
  authors: string | null;
  journal: string | null;
  year: number | null;
  /** Never assumed: «not_reported» unless the source says. */
  review: StudyReview;
}

const ARXIV_ID = /(?:arxiv\.org\/(?:abs|pdf|html)\/|^arxiv:\s*)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/iu;
const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s?#"'<>]+/u;

export const arxivDoi = (id: string): string => `10.48550/arxiv.${id.toLowerCase()}`;

export function classifyLookup(input: string): LookupQuery {
  const q = input.trim();
  const arxiv = q.match(ARXIV_ID)?.[1];
  if (arxiv) return { kind: 'doi', doi: arxivDoi(arxiv) };
  let decoded = q;
  try { decoded = decodeURIComponent(q); } catch { /* keep as typed */ }
  const doiText = decoded.match(DOI_IN_TEXT)?.[0]?.replace(/[.,;)\]]+$/u, '');
  const doi = doiText ? normalizeDoi(doiText) : null;
  if (doi !== null) return { kind: 'doi', doi };
  if (/^https?:\/\//iu.test(q) || /^www\./iu.test(q)) return { kind: 'link_without_doi' };
  return { kind: 'title', text: q.replace(/\s+/gu, ' ') };
}

const LOOKUP_HOSTS = new Set(['api.crossref.org', 'api.openalex.org', 'export.arxiv.org']);
const TIMEOUT_MS = 8_000;

async function fetchBody(fetcher: FetchLike, url: URL, options: ResolverOptions, source: 'crossref' | 'openalex' | 'arxiv'): Promise<string | null> {
  if (!LOOKUP_HOSTS.has(url.hostname) || url.protocol !== 'https:') throw new Error(`Not a metadata API: ${url.hostname}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let ok = false;
  try {
    const response = await fetcher(url.toString(), {
      headers: { accept: source === 'arxiv' ? 'application/atom+xml' : 'application/json',
        'user-agent': options.contactEmail ? `Dialektik/1.0 (mailto:${options.contactEmail})` : 'Dialektik/1.0' },
      signal: controller.signal,
    });
    ok = response.ok;
    if (!response.ok) return null;
    return await (response as unknown as { text(): Promise<string> }).text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.onCall?.(source, ok);
  }
}

const clean = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ').trim() : null;

async function fromCrossref(text: string, fetcher: FetchLike, options: ResolverOptions): Promise<LookupCandidate[]> {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query.bibliographic', text);
  url.searchParams.set('rows', '3');
  url.searchParams.set('select', 'DOI,title,author,container-title,published,issued,type,subtype');
  if (options.contactEmail) url.searchParams.set('mailto', options.contactEmail);
  const body = await fetchBody(fetcher, url, options, 'crossref');
  if (body === null) return [];
  const items = ((JSON.parse(body) as { message?: { items?: Record<string, unknown>[] } }).message?.items) ?? [];
  return items.flatMap((item) => {
    const doi = typeof item.DOI === 'string' ? normalizeDoi(item.DOI) : null;
    const title = clean(Array.isArray(item.title) ? item.title[0] : null);
    if (doi === null || title === null) return [];
    const date = dateParts(item.published) ?? dateParts(item.issued);
    return [{
      doi, title, authors: authorsOf(item),
      journal: clean(Array.isArray(item['container-title']) ? item['container-title'][0] : null),
      year: date === null ? null : Number(date.slice(0, 4)),
      review: reviewOf({ doi, crossrefType: typeof item.type === 'string' ? item.type : null,
        crossrefSubtype: typeof item.subtype === 'string' ? item.subtype : null }),
    }];
  });
}

async function fromOpenAlex(text: string, fetcher: FetchLike, options: ResolverOptions): Promise<LookupCandidate[]> {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', text);
  url.searchParams.set('filter', 'has_doi:true');
  url.searchParams.set('per-page', '3');
  if (options.openAlexApiKey) url.searchParams.set('api_key', options.openAlexApiKey);
  const body = await fetchBody(fetcher, url, options, 'openalex');
  if (body === null) return [];
  const results = (JSON.parse(body) as { results?: Record<string, unknown>[] }).results ?? [];
  return results.flatMap((work) => {
    const doi = typeof work.doi === 'string' ? normalizeDoi(work.doi) : null;
    const title = clean(work.display_name);
    if (doi === null || title === null) return [];
    const names = (Array.isArray(work.authorships) ? work.authorships as { author?: { display_name?: unknown } }[] : [])
      .map((a) => clean(a.author?.display_name)).filter((n): n is string => n !== null);
    return [{
      doi, title,
      authors: names.length === 0 ? null : names.length > 4 ? `${names.slice(0, 3).join(', ')}, et al.` : names.join(', '),
      journal: clean((work.primary_location as { source?: { display_name?: unknown } } | undefined)?.source?.display_name),
      year: typeof work.publication_year === 'number' ? work.publication_year : null,
      review: reviewOf({ doi, openalexType: typeof work.type === 'string' ? work.type : null,
        openalexSourceType: (() => {
          const type = (work.primary_location as { source?: { type?: unknown } } | undefined)?.source?.type;
          return typeof type === 'string' ? type : null;
        })() }),
    }];
  });
}

async function fromArxiv(text: string, fetcher: FetchLike, options: ResolverOptions): Promise<LookupCandidate[]> {
  const url = new URL('https://export.arxiv.org/api/query');
  url.searchParams.set('search_query', `ti:"${text.replace(/["\\]/gu, ' ').slice(0, 200)}"`);
  url.searchParams.set('max_results', '3');
  const body = await fetchBody(fetcher, url, options, 'arxiv');
  if (body === null) return [];
  return parseArxivFeed(body).studies.map((s) => ({
    doi: s.doi, title: s.title, authors: s.authors, journal: 'arXiv',
    year: s.published_at === null ? null : Number(s.published_at.slice(0, 4)), review: 'preprint' as const,
  }));
}

/** Up to three candidates: Crossref first, then OpenAlex, then arXiv. */
export async function searchByTitle(text: string, fetcher: FetchLike, options: ResolverOptions = {}): Promise<LookupCandidate[]> {
  const [crossref, openalex, arxiv] = await Promise.all([
    fromCrossref(text, fetcher, options).catch(() => []),
    fromOpenAlex(text, fetcher, options).catch(() => []),
    fromArxiv(text, fetcher, options).catch(() => []),
  ]);
  const seen = new Set<string>();
  const merged: LookupCandidate[] = [];
  const queues = [crossref, openalex, arxiv].map((list) => [...list]);
  // Round robin: each source gives its first candidate not already shown.
  while (merged.length < 3 && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      while (queue.length > 0 && seen.has(queue[0]!.doi)) queue.shift();
      const candidate = queue.shift();
      if (candidate && merged.length < 3) {
        seen.add(candidate.doi);
        merged.push(candidate);
      }
    }
  }
  return merged.slice(0, 3);
}

/** arXiv preprints are not in Crossref; their metadata comes from arXiv. */
export async function resolveArxiv(doi: string, fetcher: FetchLike, options: ResolverOptions = {}): Promise<ResolvedStudy | null> {
  const id = doi.match(/^10\.48550\/arxiv\.(.+)$/iu)?.[1];
  if (!id) return null;
  const url = new URL('https://export.arxiv.org/api/query');
  url.searchParams.set('id_list', id);
  const body = await fetchBody(fetcher, url, options, 'arxiv');
  if (body === null) return null;
  const study = parseArxivFeed(body).studies[0];
  if (!study) return null;
  const { harvest_source: _ignored, ...resolved } = study;
  return resolved;
}
