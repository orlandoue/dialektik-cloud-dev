/**
 * Resolves a DOI from Crossref and OpenAlex, server side only. Only
 * bibliographic facts are taken: title, authors, journal, date, abstract,
 * language, access, retraction, and whether an author's institution is in
 * Chile. Design, population, sample, follow-up, funding and conflicts are
 * left to a moderator: nothing is extracted by a model.
 */
export interface ResolvedStudy {
  doi: string;
  title: string;
  review: 'peer_reviewed' | 'preprint';
  authors: string | null;
  institution: string | null;
  journal: string | null;
  published_at: string | null;
  abstract: string | null;
  abstract_language: string | null;
  access: string | null;
  retracted: boolean;
  retracted_at: string | null;
  made_in_chile: boolean;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** DOIs are case-insensitive; stored lower case without a resolver prefix. */
export function normalizeDoi(input: string): string | null {
  const doi = input.trim().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//iu, '').replace(/^doi:\s*/iu, '').toLowerCase();
  return /^10\.\d{4,9}\/\S+$/u.test(doi) && doi.length <= 300 ? doi : null;
}

const USER_AGENT = 'Dialektik/1.0 (+https://dialektik-core-dev.onrender.com)';
const TIMEOUT_MS = 8_000;

async function fetchJson(fetcher: FetchLike, url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.replace(/\s+/gu, ' ').trim() : null;

const first = (value: unknown): string | null => (Array.isArray(value) ? text(value[0]) : text(value));

function dateParts(value: unknown): string | null {
  const parts = (value as { 'date-parts'?: unknown[][] } | undefined)?.['date-parts']?.[0];
  if (!Array.isArray(parts) || typeof parts[0] !== 'number') return null;
  const [year, month = 1, day = 1] = parts as number[];
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Crossref abstracts come as JATS XML. */
function stripJats(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const plain = raw.replace(/<jats:title>[^<]*<\/jats:title>/giu, ' ').replace(/<[^>]+>/gu, ' ')
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'");
  return text(plain);
}

/** OpenAlex stores abstracts as an inverted index of words to positions. */
export function abstractFromInvertedIndex(index: unknown): string | null {
  if (!index || typeof index !== 'object') return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) if (typeof position === 'number') words[position] = word;
  }
  return text(words.filter((w) => w !== undefined).join(' '));
}

function authorsOf(crossref: Record<string, unknown> | null): string | null {
  const list = Array.isArray(crossref?.author) ? (crossref!.author as Record<string, unknown>[]) : [];
  const names = list
    .map((a) => {
      const family = text(a.family);
      const given = text(a.given);
      if (family === null) return text(a.name);
      const initials = given === null ? '' : ` ${given.split(/[\s-]+/u).map((p) => p[0]?.toUpperCase() ?? '').join('')}`;
      return `${family}${initials}`;
    })
    .filter((n): n is string => n !== null);
  if (names.length === 0) return null;
  return names.length > 4 ? `${names.slice(0, 3).join(', ')}, et al.` : names.join(', ');
}

export async function resolveStudy(doi: string, fetcher: FetchLike = fetch as unknown as FetchLike): Promise<ResolvedStudy | null> {
  const encoded = encodeURIComponent(doi);
  const [crossrefBody, openalex] = await Promise.all([
    fetchJson(fetcher, `https://api.crossref.org/works/${encoded}`),
    fetchJson(fetcher, `https://api.openalex.org/works/https://doi.org/${encoded}`),
  ]);
  const crossref = (crossrefBody?.message ?? null) as Record<string, unknown> | null;
  const title = first(crossref?.title) ?? text(openalex?.title) ?? text(openalex?.display_name);
  if (title === null) return null;

  const crossrefType = text(crossref?.type);
  const crossrefSubtype = text(crossref?.subtype);
  const openalexType = text(openalex?.type);
  const preprint = crossrefSubtype === 'preprint' || crossrefType === 'posted-content' || openalexType === 'preprint';

  const authorships = Array.isArray(openalex?.authorships) ? (openalex!.authorships as Record<string, unknown>[]) : [];
  const institutions = authorships.flatMap((a) => (Array.isArray(a.institutions) ? (a.institutions as Record<string, unknown>[]) : []));
  const primarySource = (openalex?.primary_location as { source?: { display_name?: unknown } } | undefined)?.source;
  const openAccess = openalex?.open_access as { is_oa?: unknown } | undefined;

  // A retraction notice in Crossref names its date; OpenAlex flags the work.
  const updates = Array.isArray(crossref?.['updated-by']) ? (crossref!['updated-by'] as Record<string, unknown>[]) : [];
  const retraction = updates.find((u) => text(u.type)?.toLowerCase() === 'retraction');
  const retractedAt = retraction ? dateParts(retraction.updated) : null;
  const retracted = retraction !== undefined || openalex?.is_retracted === true;

  return {
    doi,
    title,
    review: preprint ? 'preprint' : 'peer_reviewed',
    authors: authorsOf(crossref),
    institution: text(institutions[0]?.display_name),
    journal: first(crossref?.['container-title']) ?? text(primarySource?.display_name) ?? (preprint ? first(crossref?.institution) : null),
    published_at: dateParts(crossref?.published) ?? dateParts(crossref?.issued) ?? text(openalex?.publication_date),
    abstract: stripJats(crossref?.abstract) ?? abstractFromInvertedIndex(openalex?.abstract_inverted_index),
    abstract_language: (() => {
      const language = text(openalex?.language) ?? text(crossref?.language);
      return language !== null && /^[a-z]{2,3}$/u.test(language) ? language : null;
    })(),
    access: openAccess?.is_oa === true ? 'Abierto' : openAccess?.is_oa === false ? 'Pago' : null,
    retracted,
    retracted_at: retractedAt,
    made_in_chile: institutions.some((i) => text(i.country_code)?.toUpperCase() === 'CL'),
  };
}

/** Same literal rule as the app: spaces and quotation marks normalised. */
export function normalizeLiteral(value: string): string {
  return value
    .replace(/[“”„«»"]/gu, '"')
    .replace(/[‘’‚`´]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

export function isLiteralFragment(fragment: string, abstract: string | null): boolean {
  const needle = normalizeLiteral(fragment);
  return abstract !== null && needle.length >= 3 && normalizeLiteral(abstract).includes(needle);
}
