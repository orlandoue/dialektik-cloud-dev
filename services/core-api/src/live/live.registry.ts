import { parseUlid, type SourceType, type Ulid } from '@dialektik/database';

export type LiveRightsClass =
  | 'LIVE_READY'
  | 'DISCOVERY_ONLY'
  | 'LICENSE_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'PROHIBITED_OR_UNSAFE'
  | 'TECHNICALLY_UNRELIABLE';
export type LiveStoragePolicy = 'METADATA_ONLY' | 'METADATA_AND_FEED_EXCERPT';

export interface LiveSourcePolicy {
  readonly sourceId: Ulid;
  readonly registryKey: string;
  readonly publisherName: string;
  readonly canonicalDomain: string;
  readonly sourceType: SourceType;
  readonly publisherFamily: string | null;
  readonly category: string | null;
  readonly discoveryChannel: 'rss_atom' | 'news_sitemap' | 'official_api';
  readonly endpoint: string;
  readonly rightsClass: LiveRightsClass;
  readonly storagePolicy: LiveStoragePolicy;
  readonly active: boolean;
  readonly rightsEvidenceUrl: string;
  readonly rightsReviewStatus?: string | null;
  readonly authorizationReference?: string | null;
  readonly rightsVerifiedAt: string;
  readonly attribution: string;
  readonly language: string;
  readonly allowedArticleDomains: readonly string[];
  readonly canonicalPathAliases?: Readonly<Record<string, string>>;
}

// These legacy candidates are discovery-only until consultation, storage and
// display rights are documented for this deployment. A policy row is not a
// source activation or a polling schedule.
export const LIVE_SOURCE_POLICIES: readonly LiveSourcePolicy[] = [
  {
    sourceId: parseUlid('01K6MYH0000000000000000001'),
    registryKey: 'nasa-news-releases',
    publisherName: 'NASA',
    canonicalDomain: 'nasa.gov',
    sourceType: 'other',
    publisherFamily: 'NASA',
    category: null,
    discoveryChannel: 'rss_atom',
    endpoint: 'https://www.nasa.gov/news-release/feed/',
    rightsClass: 'PERMISSION_REQUIRED',
    storagePolicy: 'METADATA_ONLY',
    active: false,
    rightsEvidenceUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
    rightsVerifiedAt: '2026-10-03T10:16:19.000Z',
    attribution: 'NASA is a discovery candidate only; no acquisition is enabled.',
    language: 'en',
    allowedArticleDomains: ['www.nasa.gov', 'nasa.gov'],
  },
  {
    sourceId: parseUlid('01K6MYH0000000000000000002'),
    registryKey: 'usgs-news',
    publisherName: 'USGS',
    canonicalDomain: 'usgs.gov',
    sourceType: 'other',
    publisherFamily: 'USGS',
    category: null,
    discoveryChannel: 'rss_atom',
    endpoint: 'https://www.usgs.gov/news/rss.xml',
    rightsClass: 'TECHNICALLY_UNRELIABLE',
    storagePolicy: 'METADATA_ONLY',
    active: false,
    rightsEvidenceUrl:
      'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    rightsVerifiedAt: '2026-10-03T10:16:19.000Z',
    attribution: 'USGS. Candidate route unavailable; acquisition disabled.',
    language: 'en',
    allowedArticleDomains: ['www.usgs.gov', 'usgs.gov'],
  },
];

export function assertLiveSourceReady(policy: LiveSourcePolicy): void {
  if (
    !policy.active ||
    policy.rightsClass !== 'LIVE_READY' ||
    !policy.rightsEvidenceUrl.startsWith('https://') ||
    !Number.isFinite(Date.parse(policy.rightsVerifiedAt)) ||
    policy.attribution.trim().length === 0
  ) {
    throw new Error('Source does not have an active documented LIVE_READY policy.');
  }
  const endpoint = new URL(policy.endpoint);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    policy.allowedArticleDomains.length === 0
  ) {
    throw new Error('Source acquisition route is invalid.');
  }
}

