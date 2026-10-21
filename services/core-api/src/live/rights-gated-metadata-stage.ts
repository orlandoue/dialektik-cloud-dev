import { createHash } from 'node:crypto';

/**
 * A PURE, OFFLINE pre-write planning boundary. It never fetches, grants rights,
 * queries PostgreSQL, groups occurrences, or emits contradiction findings.
 *
 * SourcePolicy is operator-supplied evidence of a separately completed rights
 * review. Setting approved=true is NOT a technical or legal rights review.
 * Never pipe self-reported remote payload fields into SourcePolicy.
 */
export interface MetadataSourcePolicy {
  readonly sourceId: string;
  readonly publisherId: string;
  readonly canonicalOrigin: string;
  readonly rightsDecisionId: string;
  readonly rightsEvidenceUrl: string;
  readonly rightsReviewedAt: string;
  readonly robotsCheckedAt: string;
  readonly acquisitionApproved: boolean;
  readonly metadataRetentionApproved: boolean;
  readonly robotsAllowsPlannedPath: boolean;
  readonly maxItemsPerBatch: number;
}

export interface ProposedMetadataItem {
  readonly sourceId: string;
  readonly sourceItemId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly modifiedAt: string | null;
}

export interface PreviouslyStagedMetadata {
  readonly sourceId: string;
  readonly sourceItemId: string;
  readonly canonicalUrl: string;
  readonly metadataHash: string;
}

export interface StagedMetadataItem {
  readonly sourceId: string;
  readonly publisherId: string;
  readonly sourceItemId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly modifiedAt: string | null;
  readonly metadataHash: string;
  readonly deduplicationKey: string;
  readonly status: 'NEW' | 'UPDATED' | 'UNCHANGED';
  readonly policyDecisionId: string;
  readonly rightsEvidenceUrl: string;
}

export interface OfflineMetadataPlan {
  readonly schema: 'dialektik-metadata-prewrite-plan-v1';
  readonly plannedAt: string;
  readonly items: readonly StagedMetadataItem[];
  readonly counts: Readonly<{ new: number; updated: number; unchanged: number }>;
  readonly distinctPublishers: number;
  readonly databaseWrites: 0;
  readonly acquisitionPerformed: false;
  readonly writesAuthorized: false;
  readonly realWorldOccurrenceInferred: false;
  readonly eventsGenerated: false;
  readonly contradictionsGenerated: false;
  readonly publicReleaseAuthority: false;
}

const SOURCE_ID = /^[a-z][a-z0-9_:-]{2,71}$/u;
const SOURCE_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const DAY_MS = 86_400_000;
const MAX_REVIEW_AGE_MS = 30 * DAY_MS;
const MAX_BATCH = 60;
const MAX_POLICIES = 8;

function assertCanonicalTimestamp(value: string, error: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)) {
    throw new Error(error);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(error);
  }
  return parsed;
}

function assertExternalHttps(value: string, error: string): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error(error);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(error); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      url.search || url.hash || url.href !== value || !/^[a-z0-9.-]+$/u.test(host) ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      /^\d+(?:\.\d+){3}$/u.test(host) || !host.includes('.')) {
    throw new Error(error);
  }
  return url;
}

function sha(value: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function itemKey(sourceId: string, sourceItemId: string): string {
  return JSON.stringify([sourceId, sourceItemId]);
}

/**
 * Results are deterministic except for an explicitly supplied audit clock.
 * The returned policies are assertions, not an authorization token.
 */
export function planRightsGatedMetadata(
  policies: readonly MetadataSourcePolicy[],
  candidates: readonly ProposedMetadataItem[],
  previous: readonly PreviouslyStagedMetadata[],
  at: Date,
): OfflineMetadataPlan {
  const time = at.getTime();
  if (!Number.isFinite(time)) throw new Error('METADATA_STAGE_CLOCK_INVALID');
  if (policies.length < 1 || policies.length > MAX_POLICIES ||
      candidates.length < 1 || candidates.length > MAX_BATCH ||
      previous.length > 10_000) throw new Error('METADATA_STAGE_SCOPE_INVALID');

  const registry = new Map<string, MetadataSourcePolicy>();
  for (const policy of policies) {
    if (!SOURCE_ID.test(policy.sourceId) || !SOURCE_ID.test(policy.publisherId) ||
        !SOURCE_ITEM_ID.test(policy.rightsDecisionId) ||
        !Number.isInteger(policy.maxItemsPerBatch) ||
        policy.maxItemsPerBatch < 1 || policy.maxItemsPerBatch > MAX_BATCH ||
        policy.acquisitionApproved !== true || policy.metadataRetentionApproved !== true ||
        policy.robotsAllowsPlannedPath !== true) {
      throw new Error('METADATA_SOURCE_POLICY_NOT_AUTHORIZED');
    }
    const origin = assertExternalHttps(policy.canonicalOrigin, 'METADATA_SOURCE_ORIGIN_INVALID');
    if (origin.href !== origin.origin + '/' || policy.canonicalOrigin !== origin.origin) {
      throw new Error('METADATA_SOURCE_ORIGIN_INVALID');
    }
    assertExternalHttps(policy.rightsEvidenceUrl, 'METADATA_RIGHTS_EVIDENCE_INVALID');
    const rightsAt = assertCanonicalTimestamp(policy.rightsReviewedAt, 'METADATA_RIGHTS_REVIEW_INVALID');
    const robotsAt = assertCanonicalTimestamp(policy.robotsCheckedAt, 'METADATA_ROBOTS_REVIEW_INVALID');
    if (rightsAt > time || robotsAt > time ||
        time - rightsAt > MAX_REVIEW_AGE_MS || time - robotsAt > MAX_REVIEW_AGE_MS) {
      throw new Error('METADATA_POLICY_REVIEW_EXPIRED');
    }
    if (registry.has(policy.sourceId)) throw new Error('METADATA_DUPLICATE_SOURCE_POLICY');
    registry.set(policy.sourceId, policy);
  }

  const prior = new Map<string, PreviouslyStagedMetadata>();
  for (const entry of previous) {
    if (!SOURCE_ID.test(entry.sourceId) || !SOURCE_ITEM_ID.test(entry.sourceItemId) ||
        !HASH.test(entry.metadataHash)) throw new Error('METADATA_PREVIOUS_STATE_INVALID');
    const url = assertExternalHttps(entry.canonicalUrl, 'METADATA_PREVIOUS_STATE_INVALID');
    if (url.href !== entry.canonicalUrl) throw new Error('METADATA_PREVIOUS_STATE_INVALID');
    const key = itemKey(entry.sourceId, entry.sourceItemId);
    if (prior.has(key)) throw new Error('METADATA_PREVIOUS_STATE_DUPLICATE');
    prior.set(key, entry);
  }

  const touched = new Set<string>();
  const urls = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const staged: StagedMetadataItem[] = [];
  for (const item of candidates) {
    const policy = registry.get(item.sourceId);
    if (!policy || !SOURCE_ITEM_ID.test(item.sourceItemId) ||
        typeof item.title !== 'string' || item.title.trim() !== item.title ||
        item.title.length < 1 || Array.from(item.title).length > 1024 ||
        /[\u0000-\u001f\u007f]/u.test(item.title)) {
      throw new Error('METADATA_ITEM_OUT_OF_SCOPE');
    }
    const canonical = assertExternalHttps(item.canonicalUrl, 'METADATA_CANONICAL_URL_INVALID');
    if (canonical.origin !== policy.canonicalOrigin || canonical.pathname === '/') {
      throw new Error('METADATA_SOURCE_BOUNDARY_VIOLATION');
    }
    const publication = assertCanonicalTimestamp(item.publishedAt, 'METADATA_PUBLICATION_DATE_INVALID');
    const revision = item.modifiedAt === null
      ? null : assertCanonicalTimestamp(item.modifiedAt, 'METADATA_REVISION_DATE_INVALID');
    if (publication > time || (revision !== null && (revision < publication || revision > time))) {
      throw new Error('METADATA_ITEM_DATE_OUT_OF_SCOPE');
    }
    const key = itemKey(item.sourceId, item.sourceItemId);
    if (touched.has(key) || urls.has(item.canonicalUrl)) {
      throw new Error('METADATA_ITEM_DUPLICATED_IN_BATCH');
    }
    touched.add(key);
    urls.add(item.canonicalUrl);
    const nextCount = (sourceCounts.get(item.sourceId) ?? 0) + 1;
    if (nextCount > policy.maxItemsPerBatch) throw new Error('METADATA_SOURCE_BATCH_CAP_EXCEEDED');
    sourceCounts.set(item.sourceId, nextCount);

    const metadataHash = sha([
      item.sourceId, item.sourceItemId, item.canonicalUrl,
      item.title, item.publishedAt, item.modifiedAt ?? '',
    ]);
    const past = prior.get(key);
    if (past !== undefined && past.canonicalUrl !== item.canonicalUrl) {
      throw new Error('METADATA_SOURCE_ID_URL_REASSIGNMENT_NEEDS_REVIEW');
    }
    const status = past === undefined ? 'NEW'
      : past.metadataHash === metadataHash ? 'UNCHANGED' : 'UPDATED';
    staged.push(Object.freeze({
      ...item,
      publisherId: policy.publisherId,
      metadataHash,
      deduplicationKey: sha([item.sourceId, item.sourceItemId]),
      status,
      policyDecisionId: policy.rightsDecisionId,
      rightsEvidenceUrl: policy.rightsEvidenceUrl,
    }));
  }
  staged.sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId) ||
    a.canonicalUrl.localeCompare(b.canonicalUrl) ||
    a.sourceItemId.localeCompare(b.sourceItemId));
  return Object.freeze({
    schema: 'dialektik-metadata-prewrite-plan-v1',
    plannedAt: at.toISOString(),
    items: Object.freeze(staged),
    counts: Object.freeze({
      new: staged.filter((item) => item.status === 'NEW').length,
      updated: staged.filter((item) => item.status === 'UPDATED').length,
      unchanged: staged.filter((item) => item.status === 'UNCHANGED').length,
    }),
    distinctPublishers: new Set(staged.map((item) => item.publisherId)).size,
    databaseWrites: 0,
    acquisitionPerformed: false,
    writesAuthorized: false,
    realWorldOccurrenceInferred: false,
    eventsGenerated: false,
    contradictionsGenerated: false,
    publicReleaseAuthority: false,
  });
}
