import { createHash } from 'node:crypto';
import { assertUnicodeScalars } from '../ephemeral/ephemeral.normalization.js';

const MAX_ARTICLE_BODY_BYTES = 2 * 1024 * 1024;
export const GOVUK_FIRST_ARTICLE_URL =
  'https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh';
export const GOVUK_FIRST_ARTICLE_PATH =
  '/government/news/social-housing-landlord-downgraded-by-rsh';
export const GOVUK_CURATED_ARTICLE_URLS = Object.freeze([
  GOVUK_FIRST_ARTICLE_URL,
  'https://www.gov.uk/government/news/regulator-of-social-housing-de-registers-pivotal-housing-association',
  'https://www.gov.uk/government/news/regulator-of-social-housing-publishes-the-rent-standard-2026',
  'https://www.gov.uk/government/news/social-housing-landlords-to-invest-record-amounts-in-repairs-and-new-homes',
  'https://www.gov.uk/government/news/governance-and-viability-downgrades-for-non-compliant-landlord',
]);
export const GOVUK_CONTENT_API_ORIGIN = 'https://www.gov.uk';
export const GOVUK_CONTENT_API_URL =
  GOVUK_CONTENT_API_ORIGIN + '/api/content' + GOVUK_FIRST_ARTICLE_PATH;
export const GOVUK_USER_AGENT =
  'DialektikProductShadow/1.0 (bounded local-only article qualification)';
export const GOVUK_ATTRIBUTION =
  '© Regulator of Social Housing. Contains public sector information licensed under the Open Government Licence v3.0.';

export interface ParsedGovUkContentItem {
  readonly contentId: string | null;
  readonly basePath: string;
  readonly documentType: string;
  readonly schemaName: string;
  readonly title: string;
  readonly publisher: string;
  readonly firstPublishedAt: string;
  readonly publicUpdatedAt: string | null;
  readonly locale: string | null;
  readonly body: Buffer;
  readonly sourceBodySha256: string;
  readonly bodyFormat: 'html' | 'govspeak';
  readonly completeBodyPresent: true;
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\u0000');
}

function canonicalTimestamp(value: unknown, nullable = false): string | null {
  if (nullable && (value === null || value === undefined)) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('GOVUK_ARTICLE_DATE_INVALID');
  return new Date(value).toISOString();
}

/** This adapter is restricted to the exact authorized GOV.UK news URL. */
export function govUkContentApiUrl(articleUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(articleUrl);
  } catch {
    throw new Error('GOVUK_ARTICLE_URL_INVALID');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== GOVUK_CONTENT_API_ORIGIN ||
    !GOVUK_CURATED_ARTICLE_URLS.some((allowed) => allowed === parsed.href) ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  )
    throw new Error('GOVUK_ARTICLE_URL_OUT_OF_SCOPE');
  return GOVUK_CONTENT_API_ORIGIN + '/api/content' + parsed.pathname;
}

function expectedGovUkBasePath(articleUrl: string): string {
  return new URL(articleUrl).pathname;
}

const htmlEntities: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  pound: '£',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  bull: '•',
  middot: '·',
  raquo: '»',
  laquo: '«',
});

/** Convert only the Content API's rendered news body into visible paragraph text. */
export function normalizeGovUkContentBody(body: string): Buffer {
  if (!body.trim() || Buffer.byteLength(body, 'utf8') > MAX_ARTICLE_BODY_BYTES)
    throw new Error('GOVUK_CONTENT_ITEM_INVALID');
  assertUnicodeScalars(body);
  if (
    /!\[[^\]]*\]\s*\(|<(?:img|iframe|video|audio|figure|picture|object|embed|script|style)\b/iu.test(
      body,
    ) ||
    /(?:third.party|syndicat(?:ed|ion)|reprinted with permission|reproduced with permission|all rights reserved|copyright notice|©)/iu.test(
      body,
    )
  )
    throw new Error('GOVUK_ARTICLE_RIGHTS_EXCEPTION');

  const tags = Array.from(body.matchAll(/<\/?([A-Za-z][A-Za-z0-9:-]*)\b[^>]*>/gu), (match) =>
    (match[1] ?? '').toLowerCase(),
  );
  const allowedTags = new Set([
    'a',
    'abbr',
    'b',
    'blockquote',
    'br',
    'caption',
    'dd',
    'del',
    'div',
    'dl',
    'dt',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'li',
    'ol',
    'p',
    'pre',
    's',
    'section',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'time',
    'tr',
    'u',
    'ul',
  ]);
  if (tags.some((tag) => !allowedTags.has(tag)) || /<(?!\/?[A-Za-z])/u.test(body))
    throw new Error('GOVUK_CONTENT_MARKUP_UNSUPPORTED');

  let text = body
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<br\b[^>]*\/?>/giu, '\n')
    .replace(/<li\b[^>]*>/giu, '\n• ')
    .replace(
      /<\/(?:p|div|h[1-6]|blockquote|pre|ul|ol|section|table|thead|tbody|tr|dl|dt|dd|li)>/giu,
      '\n\n',
    )
    .replace(
      /<(?:p|div|h[1-6]|blockquote|pre|ul|ol|section|table|thead|tbody|tr|dl|dt|dd)\b[^>]*>/giu,
      '\n\n',
    )
    .replace(
      /<\/?(?:a|abbr|b|caption|del|em|hr|i|s|small|span|strong|sub|sup|td|th|time|u)\b[^>]*>/giu,
      '',
    );
  text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/giu, (_whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const point = Number.parseInt(entity.slice(2), 16);
      if (
        !Number.isSafeInteger(point) ||
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error('GOVUK_HTML_ENTITY_INVALID');
      return String.fromCodePoint(point);
    }
    if (entity.startsWith('#')) {
      const point = Number.parseInt(entity.slice(1), 10);
      if (
        !Number.isSafeInteger(point) ||
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error('GOVUK_HTML_ENTITY_INVALID');
      return String.fromCodePoint(point);
    }
    const decoded = htmlEntities[entity];
    if (decoded === undefined) throw new Error('GOVUK_HTML_ENTITY_UNSUPPORTED');
    return decoded;
  });
  text = text
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (!text) throw new Error('GOVUK_CONTENT_ITEM_INVALID');
  assertUnicodeScalars(text);
  return Buffer.from(text, 'utf8');
}

export function parseGovUkContentItem(
  acquired: Uint8Array,
  articleUrl = GOVUK_FIRST_ARTICLE_URL,
): ParsedGovUkContentItem {
  govUkContentApiUrl(articleUrl);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(acquired));
  } catch {
    throw new Error('GOVUK_CONTENT_JSON_INVALID');
  }
  const item = asRecord(parsed);
  const details = asRecord(item?.details);
  const links = asRecord(item?.links);
  const organizations = Array.isArray(links?.organisations) ? links.organisations : [];
  const organizationTitles = organizations
    .map(asRecord)
    .map((organization) => organization?.title)
    .filter(nonEmptyString);
  const linkedPublisher = organizationTitles.find((name) => name === 'Regulator of Social Housing');
  const contentId = item?.content_id;
  const basePath = item?.base_path;
  const documentType = item?.document_type;
  const schemaName = item?.schema_name;
  const title = item?.title;
  const rawLocale = item?.locale;
  const locale = rawLocale ?? null;
  const firstPublishedAt = canonicalTimestamp(item?.first_published_at);
  const publicUpdatedAt = canonicalTimestamp(item?.public_updated_at, true);
  const rawBody = details?.body;

  if (
    !item ||
    !details ||
    !links ||
    !(
      nonEmptyString(contentId) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(contentId)
    ) ||
    basePath !== expectedGovUkBasePath(articleUrl) ||
    documentType !== 'press_release' ||
    schemaName !== 'news_article' ||
    !nonEmptyString(title) ||
    linkedPublisher !== 'Regulator of Social Housing' ||
    !firstPublishedAt ||
    !(
      locale === null ||
      (nonEmptyString(locale) && /^[A-Za-z][A-Za-z0-9-]{0,34}$/u.test(locale))
    ) ||
    typeof rawBody !== 'string'
  )
    throw new Error('GOVUK_CONTENT_ITEM_INVALID');

  const normalizedBody = normalizeGovUkContentBody(rawBody);
  const rawBodyBytes = Buffer.from(rawBody, 'utf8');
  const sourceBodySha256 = hashBytes(rawBodyBytes);
  rawBodyBytes.fill(0);
  return Object.freeze({
    contentId,
    basePath,
    documentType,
    schemaName,
    title,
    publisher: linkedPublisher,
    firstPublishedAt,
    publicUpdatedAt,
    locale,
    body: normalizedBody,
    sourceBodySha256,
    bodyFormat: /<[A-Za-z][^>]*>/u.test(rawBody) ? ('html' as const) : ('govspeak' as const),
    completeBodyPresent: true,
  });
}
