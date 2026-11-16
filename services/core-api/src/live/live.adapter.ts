import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import type { LiveSourcePolicy } from './live.registry.js';

export const LIVE_ADAPTER_VERSION = 'product-live-rss-atom-v1';
export const MAX_LIVE_FEED_BYTES = 2_000_000;
// Diario El Día's verified larger RSS feed contains 200 entries in a 393 KB
// response. Keep an exact item ceiling and persist in bounded batches.
export const MAX_LIVE_FEED_ITEMS = 200;
export const MAX_LIVE_FEED_BATCH_ITEMS = 50;

export interface LiveDiscoveredItem {
  readonly sourceItemId: string;
  readonly discoveredUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly headline: string | null;
  readonly excerpt: string | null;
  readonly author: string | null;
  readonly language: string;
  readonly originalLanguage: string | null;
  readonly publishedAt: Date | null;
  readonly modifiedAt: Date | null;
  readonly originalPublishedAt: string | null;
  readonly originalModifiedAt: string | null;
  readonly declaredUpstream: string | null;
  readonly rawPayloadHash: string;
  readonly errorCode: string | null;
}

export const liveHash = (text: string): string => createHash('sha256').update(text).digest('hex');
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function textValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  const parts = Object.entries(record(value))
    .filter(([key]) => !key.startsWith('@_'))
    .map(([, item]) => textValue(item))
    .filter((item): item is string => item !== null);
  return parts.length === 0 ? null : parts.join(' ');
}

const entities: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function cleanLiveText(input: string | null): string | null {
  if (input === null) return null;
  const clean = input
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole: string, name: string) => {
      if (name.startsWith('#')) {
        const code = name.toLowerCase().startsWith('#x')
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1));
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : '�';
      }
      return entities[name.toLowerCase()] ?? whole;
    })
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\/?(?:p|div|li|h[1-6]|blockquote|section|article|br)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
  return clean.length === 0 ? null : clean;
}

export function canonicalizeLiveUrl(value: string, policy?: LiveSourcePolicy): string {
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Article URL must be public HTTP(S) without credentials.');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  const alias = policy?.canonicalPathAliases?.[url.pathname];
  if (alias !== undefined) url.pathname = alias;
  return url.toString();
}

export function parseLiveTimestamp(raw: string | null): Date | null {
  if (raw === null) return null;
  // A source must declare timezone; host-local Date parsing must not invent one.
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(raw.trim())) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(raw.trim());
  const rfc = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s/.exec(raw.trim());
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  const year = Number(iso?.[1] ?? rfc?.[3]);
  const month = iso === null ? months.indexOf(rfc?.[2]?.toLowerCase() ?? '') + 1 : Number(iso[2]);
  const day = Number(iso?.[3] ?? rfc?.[1]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    !Number.isInteger(year) ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    return null;
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? new Date(millis) : null;
}

function itemFromEntry(
  entry: unknown,
  atom: boolean,
  policy: LiveSourcePolicy,
  payloadHash: string,
  feedRights: string | null,
): LiveDiscoveredItem {
  const item = record(entry);
  const links = array(item.link);
  const atomLink = links
    .map(record)
    .find((link) => link['@_rel'] === undefined || link['@_rel'] === 'alternate');
  const discoveredUrl = atom ? textValue(atomLink?.['@_href']) : textValue(item.link);
  const sourceItemId =
    textValue(atom ? item.id : item.guid) ??
    discoveredUrl ??
    `payload:${liveHash(JSON.stringify(entry))}`;
  let canonicalUrl: string | null = null;
  let errorCode: string | null = null;
  try {
    if (discoveredUrl !== null) canonicalUrl = canonicalizeLiveUrl(discoveredUrl, policy);
  } catch {
    errorCode = 'INVALID_ARTICLE_URL';
  }
  const originalPublishedAt = textValue(
    atom ? (item.published ?? item.updated) : (item.pubDate ?? item['dc:date']),
  );
  const originalModifiedAt = textValue(
    atom ? item.updated : (item['atom:updated'] ?? item.updated),
  );
  const headline = cleanLiveText(textValue(item.title));
  // The publisher's default/feed language is not evidence of an individual item.
  const originalLanguage = textValue(item['@_xml:lang'] ?? item['dc:language']);
  let language = 'und';
  if (originalLanguage !== null) {
    try {
      const declared = originalLanguage.trim();
      if (Intl.getCanonicalLocales(declared).length === 1) language = declared;
    } catch {
      // An absent or malformed item declaration stays undetermined.
    }
  }
  const rawExcerpt = textValue(atom ? item.summary : item.description);
  const declaredRights = textValue(item.rights ?? item.copyright ?? item['dc:rights']);
  const declaredUpstream = cleanLiveText(textValue(item['dc:source'] ?? item.source));
  const decodedRights = [
    textValue(item.title),
    rawExcerpt,
    declaredRights,
    feedRights,
    declaredUpstream,
  ]
    .map(cleanLiveText)
    .filter((value) => value !== null)
    .join(' ');
  const upstreamExternal =
    declaredUpstream !== null &&
    ![policy.publisherName, policy.canonicalDomain].includes(declaredUpstream) &&
    !policy.allowedArticleDomains.some(
      (domain) =>
        declaredUpstream === `https://${domain}` || declaredUpstream === `https://${domain}/`,
    );
  const thirdParty =
    /(?:©|&(?:amp;)*(?:copy|#0*169|#x0*a9);|copyright|all rights reserved|courtesy of|credit\s*:)/i.test(
      decodedRights,
    ) || upstreamExternal;
  const publishedAt = parseLiveTimestamp(originalPublishedAt);
  if (canonicalUrl === null) errorCode ??= 'MISSING_ARTICLE_URL';
  else if (!policy.allowedArticleDomains.includes(new URL(canonicalUrl).hostname))
    errorCode = 'UNAPPROVED_ARTICLE_DOMAIN';
  if (headline === null) errorCode ??= 'MISSING_HEADLINE';
  if (publishedAt === null) errorCode ??= 'MISSING_OR_INVALID_PUBLICATION_DATE';
  if (thirdParty) errorCode = 'THIRD_PARTY_OR_COPYRIGHT_MARKER';
  return {
    sourceItemId,
    discoveredUrl,
    canonicalUrl,
    headline,
    excerpt:
      policy.storagePolicy === 'METADATA_AND_FEED_EXCERPT' && !thirdParty
        ? cleanLiveText(rawExcerpt)
        : null,
    author: cleanLiveText(
      textValue(atom ? record(item.author).name : (item.author ?? item['dc:creator'])),
    ),
    language,
    originalLanguage,
    publishedAt,
    modifiedAt: parseLiveTimestamp(originalModifiedAt),
    originalPublishedAt,
    originalModifiedAt,
    declaredUpstream,
    rawPayloadHash: payloadHash,
    errorCode,
  };
}

export interface ParsedLiveFeedBatches {
  readonly itemCount: number;
  readonly batches: Iterable<readonly LiveDiscoveredItem[]>;
}

export function parseLiveFeedBatches(
  payload: string,
  policy: LiveSourcePolicy,
): ParsedLiveFeedBatches {
  if (Buffer.byteLength(payload, 'utf8') > MAX_LIVE_FEED_BYTES) throw new Error('FEED_TOO_LARGE');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(payload))
    throw new Error('DTD_OR_ENTITY_DECLARATION_REJECTED');
  try {
    SyntaxValidator.validate(payload);
  } catch {
    throw new Error('INVALID_FEED_XML');
  }
  // Bound nesting before allocating parser output; feeds need only a small XML tree.
  let depth = 0;
  for (const match of payload.matchAll(/<\/?[a-zA-Z][^>]*>/g)) {
    if (match[0].startsWith('</')) depth--;
    else if (!match[0].endsWith('/>')) depth++;
    if (depth > 32) throw new Error('FEED_NESTING_TOO_DEEP');
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    htmlEntities: true,
  });
  let parsed: unknown;
  try {
    parsed = parser.parse(payload) as unknown;
  } catch {
    throw new Error('FEED_XML_PARSING_FAILED');
  }
  const root = record(parsed);
  const atom = root.feed !== undefined;
  const channel = atom ? record(root.feed) : record(record(root.rss).channel);
  const entries = atom ? array(channel.entry) : array(channel.item);
  const feedRights = textValue(channel.rights ?? channel.copyright ?? channel['dc:rights']);
  if (root.feed === undefined && root.rss === undefined) throw new Error('UNSUPPORTED_FEED_FORMAT');
  if (entries.length > MAX_LIVE_FEED_ITEMS) throw new Error('FEED_ITEM_LIMIT_EXCEEDED');
  const hash = liveHash(payload);
  return {
    itemCount: entries.length,
    batches: {
      *[Symbol.iterator](): IterableIterator<readonly LiveDiscoveredItem[]> {
        for (let offset = 0; offset < entries.length; offset += MAX_LIVE_FEED_BATCH_ITEMS) {
          yield entries
            .slice(offset, offset + MAX_LIVE_FEED_BATCH_ITEMS)
            .map((entry) => itemFromEntry(entry, atom, policy, hash, feedRights));
        }
      },
    },
  };
}

export function parseLiveFeed(
  payload: string,
  policy: LiveSourcePolicy,
): readonly LiveDiscoveredItem[] {
  return [...parseLiveFeedBatches(payload, policy).batches].flat();
}

/** URL-only fallback for malformed feeds: exposure must survive failed parsing. */
export function discoverMalformedFeedUrls(
  payload: string,
  _policy?: LiveSourcePolicy,
): readonly string[] {
  return [
    ...new Set(
      [...payload.matchAll(/https?:\/\/[^\s<>"']+/g)].map((match) =>
        match[0].replace(/&amp;/g, '&'),
      ),
    ),
  ].filter((url) => {
    try {
      canonicalizeLiveUrl(url);
      return true;
    } catch {
      return false;
    }
  });
}

/** Conservative metadata identities, including GUID/Atom IDs with no usable URL. */
export function discoverMalformedFeedIdentities(payload: string): readonly {
  readonly canonicalUrl: string | null;
  readonly sourceItemId: string | null;
}[] {
  const urls = discoverMalformedFeedUrls(payload).map((url) => ({
    canonicalUrl: canonicalizeLiveUrl(url),
    sourceItemId: null,
  }));
  const ids = [
    ...new Set(
      [
        ...payload.matchAll(
          /<(?:[a-zA-Z_][\w.-]*:)?(?:guid|id)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z_][\w.-]*:)?(?:guid|id)\s*>/gi,
        ),
      ]
        .map((match) =>
          cleanLiveText(match[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') ?? null),
        )
        .filter((value): value is string => value !== null),
    ),
  ];
  return [...urls, ...ids.map((id) => ({ canonicalUrl: null, sourceItemId: id }))];
}

export function nearDuplicateSignature(text: string): string {
  const words = [
    ...new Set(
      text
        .toLocaleLowerCase('en')
        .normalize('NFKC')
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ].sort();
  return `metadata-token-set-v1:${liveHash(words.join(' '))}`;
}
