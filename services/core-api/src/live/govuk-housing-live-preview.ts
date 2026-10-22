import { createHash } from 'node:crypto';
import { govUkRobotsAllowsPath } from './govuk-product-acquisition.js';

/**
 * Two original government publishers; PRIVATE-BETA metadata projection only.
 * This module never opens a database connection, saves source bodies, proposes
 * same-occurrence clusters or reports contradictions.
 */
const ORIGIN = 'https://www.gov.uk';
const RIGHTS = 'https://www.gov.uk/help/terms-conditions';
const REVIEWED_AT = '2026-10-21T00:00:00.000Z';
const MAX_REVIEW_AGE = 30 * 86400_000;
const MAX_ITEMS = 5;
const PUBLISHERS = [
  { sourceId: 'govuk_rsh_official', publisher: 'Regulator of Social Housing',
    filter: 'regulator-of-social-housing' },
  { sourceId: 'govuk_mhclg_official', publisher: 'Ministry of Housing, Communities and Local Government',
    filter: 'ministry-of-housing-communities-local-government' },
] as const;
const NEWS_PATH = /^\/government\/news\/[a-z0-9-]+$/u;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

type Fetcher = typeof fetch;
export interface VerifiedHousingHeadline {
  readonly source_id: string;
  readonly content_id: string;
  readonly publisher: string;
  readonly headline: string;
  readonly canonical_url: string;
  readonly published_at: string;
  readonly modified_at: string | null;
  readonly rights_evidence_url: string;
  readonly evidence_hash: string;
  readonly semantic_assignment: 'UNASSIGNED';
}

function reject(): never { throw new Error('GOVUK_HOUSING_PREVIEW_VERIFICATION_FAILED'); }

async function bytes(fetcher: Fetcher, path: string, mime: string, limit: number): Promise<Uint8Array> {
  const url = ORIGIN + path; // fixed origin; all paths constructed in this file
  const response = await fetcher(url, {
    method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: mime, 'User-Agent': 'DialektikProductMetadata/1.0' },
  });
  if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().includes(mime) ||
      (response.url && response.url !== url) || !response.body) {
    await response.body?.cancel(); reject();
  }
  const claimed = response.headers.get('content-length');
  if (claimed !== null && (!/^\d+$/u.test(claimed) || Number(claimed) > limit)) reject();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > limit) { await reader.cancel(); reject(); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(count);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function decode(data: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { reject(); }
  finally { data.fill(0); }
}
function parseJson(data: Uint8Array): unknown {
  try { return JSON.parse(decode(data)); }
  catch { reject(); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}
function date(value: unknown, at: Date, nullable = false): string | null {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(value)) reject();
  const d = new Date(value);
  if (!Number.isFinite(d.getTime()) || d > at) reject();
  return d.toISOString();
}
function verifiedItem(raw: unknown, path: string, publisher: typeof PUBLISHERS[number],
                      at: Date): VerifiedHousingHeadline {
  const item = record(raw);
  const links = record(item.links);
  const orgs = links.organisations;
  if (item.base_path !== path || item.schema_name !== 'news_article' ||
      item.document_type !== 'press_release' || (item.locale && item.locale !== 'en') ||
      !Array.isArray(orgs) || !orgs.some((v: unknown) => record(v).title === publisher.publisher) ||
      typeof item.content_id !== 'string' || !UUID.test(item.content_id)) reject();
  if (typeof item.title !== 'string' || /[\u0000-\u001f\u007f]/u.test(item.title)) reject();
  const title = item.title.trim().normalize('NFC');
  if (title !== item.title || title.length === 0 || Array.from(title).length > 1024) reject();
  const published = date(item.first_published_at, at);
  const modified = date(item.public_updated_at, at, true);
  if (!published || (modified !== null && modified < published)) reject();
  const canonical = ORIGIN + path;
  const hash = createHash('sha256').update(JSON.stringify([
    publisher.sourceId, item.content_id, canonical, title, published, modified ?? '',
  ])).digest('hex');
  return Object.freeze({
    source_id: publisher.sourceId,
    content_id: item.content_id,
    publisher: publisher.publisher,
    headline: title,
    canonical_url: canonical,
    published_at: published,
    modified_at: modified,
    rights_evidence_url: RIGHTS,
    evidence_hash: hash,
    semantic_assignment: 'UNASSIGNED',
  });
}

export async function acquireGovUkHousingReadOnlyPreview(
  fetcher: Fetcher = fetch,
  at = new Date(),
) {
  const reviewed = Date.parse(REVIEWED_AT);
  if (!Number.isFinite(at.getTime()) || at.getTime() < reviewed ||
      at.getTime() - reviewed > MAX_REVIEW_AGE) reject();
  const robots = decode(await bytes(fetcher, '/robots.txt', 'text/plain', 512 * 1024));
  if (!govUkRobotsAllowsPath(robots, '/api/search.json')) reject();
  const all: VerifiedHousingHeadline[] = [];
  const seen = new Set<string>();
  for (const publisher of PUBLISHERS) {
    const searchPath = '/api/search.json?filter_organisations=' + publisher.filter +
      '&count=40&order=-public_timestamp&fields=link,title,public_timestamp';
    const search = record(parseJson(await bytes(fetcher, searchPath, 'application/json', 768 * 1024)));
    if (!Array.isArray(search.results) || search.results.length > 40) reject();
    const paths: string[] = [];
    for (const result of search.results) {
      const hit = record(result);
      if (typeof hit.link !== 'string') reject();
      if (!hit.link.startsWith('/government/news/')) continue;
      if (!NEWS_PATH.test(hit.link)) reject();
      if (!seen.has(hit.link) && !paths.includes(hit.link)) paths.push(hit.link);
      if (paths.length >= MAX_ITEMS) break;
    }
    if (paths.length === 0) reject();
    for (const path of paths) {
      if (!govUkRobotsAllowsPath(robots, '/api/content' + path)) reject();
      const raw = parseJson(await bytes(fetcher, '/api/content' + path, 'application/json', 5 * 1024 * 1024));
      const item = verifiedItem(raw, path, publisher, at);
      if (seen.has(path)) reject();
      seen.add(path);
      all.push(item);
    }
  }
  if (new Set(all.map(x => x.source_id)).size !== 2) reject();
  all.sort((a, b) => b.published_at.localeCompare(a.published_at) ||
    a.canonical_url.localeCompare(b.canonical_url));
  return Object.freeze({
    mode: 'TWO_OFFICIAL_PUBLISHERS_LIVE_METADATA_PREVIEW' as const,
    origin: 'EXTERNAL_OFFICIAL_API' as const,
    persisted: false as const,
    generated_events: false as const,
    generated_contradictions: false as const,
    verified_publishers: 2 as const,
    checked_at: at.toISOString(),
    items: Object.freeze(all),
  });
}
