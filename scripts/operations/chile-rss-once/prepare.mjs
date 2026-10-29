import { readFileSync } from 'node:fs';
import { parseLiveFeed, liveHash, nearDuplicateSignature, LIVE_ADAPTER_VERSION } from '../../../services/core-api/dist/live/live.adapter.js';
import database from '../../../packages/database/dist/index.js';

const { generateUlid } = database;
const input = JSON.parse(readFileSync(0, 'utf8'));
const now = new Date();
const source = input.source;
const policy = {
  sourceId: source.id,
  registryKey: source.registry_key,
  publisherName: source.name,
  canonicalDomain: source.canonical_domain,
  discoveryChannel: source.discovery_channel,
  language: source.language,
  allowedArticleDomains: [source.canonical_domain, `www.${source.canonical_domain}`],
  canonicalPathAliases: source.canonical_path_aliases ?? {},
  storagePolicy: source.storage_policy ?? 'METADATA_ONLY',
};
const seenUrls = new Set();
const seenGuids = new Set();
const dateInSantiago = (date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const targetDate = process.env.DIALEKTIK_RSS_PUBLICATION_DATE ?? dateInSantiago(new Date());
const items = parseLiveFeed(input.xml, policy)
  .filter((item) => item.errorCode === null && item.canonicalUrl &&
    item.discoveredUrl && item.headline && item.headline.length <= 500 && item.publishedAt &&
    item.publishedAt.getTime() <= now.getTime() + 300000 &&
    dateInSantiago(item.publishedAt) === targetDate &&
    item.sourceItemId && item.sourceItemId.length <= 2048)
  .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
const output = [];
for (const item of items) {
  if (seenUrls.has(item.canonicalUrl) || seenGuids.has(item.sourceItemId)) continue;
  seenUrls.add(item.canonicalUrl);
  seenGuids.add(item.sourceItemId);
  const articleText = [item.headline, item.excerpt].filter((part) => part !== null).join('. ');
  const normalizedText = articleText.normalize('NFKC').toLocaleLowerCase('es-CL');
  const contentHash = liveHash(articleText.normalize('NFC'));
  const signature = nearDuplicateSignature(articleText);
  const metadata = {
    headline: item.headline, excerpt: item.excerpt, author: item.author,
    publishedAt: item.publishedAt.toISOString(),
    modifiedAt: item.modifiedAt?.toISOString() ?? null,
    canonicalUrl: item.canonicalUrl, declaredUpstream: item.declaredUpstream,
  };
  const id = () => generateUlid({ now: () => now.getTime() });
  output.push({
    sourceId: source.id, policyId: source.policy_id, publisher: source.name,
    domain: source.canonical_domain, registryKey: source.registry_key,
    discoveryChannel: source.discovery_channel, storagePolicy: source.storage_policy,
    discoveryUrl: source.endpoint, capturedAt: now.toISOString(),
    articleId: id(), receiptId: id(), versionId: id(),
    exclusionId: liveHash(`${source.registry_key}\n${item.canonicalUrl}`),
    versionExclusionId: liveHash(`${source.registry_key}\n${item.canonicalUrl}\n${contentHash}`),
    guidExclusionId: liveHash(`${source.registry_key}\nsource-item:${item.sourceItemId}`),
    headline: item.headline, excerpt: item.excerpt, articleText, normalizedText,
    author: item.author, language: item.language,
    canonicalUrl: item.canonicalUrl, discoveredUrl: item.discoveredUrl,
    sourceItemId: item.sourceItemId, publishedAt: metadata.publishedAt,
    modifiedAt: metadata.modifiedAt, originalPublishedAt: item.originalPublishedAt,
    originalModifiedAt: item.originalModifiedAt, declaredUpstream: item.declaredUpstream,
    rawPayloadHash: item.rawPayloadHash, contentHash, signature,
    metadataHash: liveHash(JSON.stringify(metadata)), adapterVersion: LIVE_ADAPTER_VERSION,
  });
}
process.stdout.write(JSON.stringify({source: source.name, parsed: items.length, items: output}));
