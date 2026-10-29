import { readFileSync } from 'node:fs';
import { parseLiveFeed, liveHash, nearDuplicateSignature, LIVE_ADAPTER_VERSION } from '../../../services/core-api/dist/live/live.adapter.js';
import database from '../../../packages/database/dist/index.js';

const { generateUlid } = database;
const input = JSON.parse(readFileSync(0, 'utf8'));
const now = new Date();
const source = input.source;
const policy = {
  publisherName: source.name,
  canonicalDomain: source.canonical_domain,
  allowedArticleDomains: [source.canonical_domain, `www.${source.canonical_domain}`],
  storagePolicy: 'METADATA_ONLY',
};
const seenUrls = new Set();
const seenGuids = new Set();
const items = parseLiveFeed(input.xml, policy)
  .filter((item) => item.errorCode === null && item.excerpt === null && item.canonicalUrl &&
    item.discoveredUrl && item.headline && item.headline.length <= 500 && item.publishedAt &&
    item.publishedAt.getTime() <= now.getTime() + 300000 &&
    item.publishedAt.getTime() >= now.getTime() - 10 * 86400000 &&
    item.sourceItemId && item.sourceItemId.length <= 2048)
  .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
const output = [];
for (const item of items) {
  if (seenUrls.has(item.canonicalUrl) || seenGuids.has(item.sourceItemId)) continue;
  seenUrls.add(item.canonicalUrl);
  seenGuids.add(item.sourceItemId);
  const contentHash = liveHash(item.headline.normalize('NFC'));
  const signature = nearDuplicateSignature(item.headline);
  const metadata = {
    headline: item.headline, excerpt: null, author: item.author,
    publishedAt: item.publishedAt.toISOString(),
    modifiedAt: item.modifiedAt?.toISOString() ?? null,
    canonicalUrl: item.canonicalUrl, declaredUpstream: item.declaredUpstream,
  };
  const id = () => generateUlid({ now: () => now.getTime() });
  output.push({
    sourceId: source.id, policyId: source.policy_id, publisher: source.name,
    domain: source.canonical_domain, registryKey: source.registry_key,
    discoveryUrl: source.endpoint, capturedAt: now.toISOString(),
    articleId: id(), receiptId: id(), versionId: id(),
    exclusionId: liveHash(`${source.registry_key}\n${item.canonicalUrl}`),
    versionExclusionId: liveHash(`${source.registry_key}\n${item.canonicalUrl}\n${contentHash}`),
    guidExclusionId: liveHash(`${source.registry_key}\nsource-item:${item.sourceItemId}`),
    headline: item.headline, author: item.author, language: item.language,
    canonicalUrl: item.canonicalUrl, discoveredUrl: item.discoveredUrl,
    sourceItemId: item.sourceItemId, publishedAt: metadata.publishedAt,
    modifiedAt: metadata.modifiedAt, originalPublishedAt: item.originalPublishedAt,
    originalModifiedAt: item.originalModifiedAt, declaredUpstream: item.declaredUpstream,
    rawPayloadHash: item.rawPayloadHash, contentHash, signature,
    metadataHash: liveHash(JSON.stringify(metadata)), adapterVersion: LIVE_ADAPTER_VERSION,
  });
  if (output.length >= 12) break;
}
process.stdout.write(JSON.stringify({source: source.name, parsed: items.length, items: output}));
