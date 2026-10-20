// Bounded real-source DEV evidence capture, WITHOUT database access or polling.
// Single approved GOV.UK RSH publisher, seven pinned official URLs maximum.
// This is repeatable surveillance of an allowlist, NOT automated discovery.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { acquireGovUkRshPreviewBatch } from '../../services/core-api/dist/live/govuk-product-acquisition.js';
import { GOVUK_RSH_RIGHTS_REVIEWED_AT } from '../../services/core-api/dist/live/govuk-product-acquisition.js';
import { GOVUK_CURATED_ARTICLE_URLS } from '../../services/core-api/dist/live/govuk-content-api-parser.js';

export function digest(items) {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex');
}

export function safeProjection(items, checkedAt = new Date()) {
  if (items.length < 2 || items.length > 7) throw Error('SOURCE_ITEM_COUNT_OUT_OF_SCOPE');
  if (new Set(items.map(i => i.canonicalUrl)).size !== items.length)
    throw Error('DUPLICATE_CANONICAL_URL');
  const projected = items.map(i => {
    if (!GOVUK_CURATED_ARTICLE_URLS.includes(i.canonicalUrl) ||
        i.publisher !== 'Regulator of Social Housing' ||
        i.title.trim().length < 1 || i.title.length > 1024 ||
        !Number.isFinite(Date.parse(i.publishedAt)))
      throw Error('SOURCE_METADATA_OUT_OF_SCOPE');
    return {
      content_id: i.contentId,
      canonical_url: i.canonicalUrl,
      headline: i.title,
      publisher: i.publisher,
      published_at: i.publishedAt,
      modified_at: i.modifiedAt,
      attribution: i.attribution,
      rights_evidence_url: i.rightsEvidenceUrl,
    };
  }).sort((a,b)=>a.canonical_url.localeCompare(b.canonical_url));
  return {
    schema: 'dialektik-readonly-source-watch-v1',
    mode: 'ALLOWLIST_RECHECK_ONLY',
    acquisition_source: 'GOVUK_OFFICIAL_CONTENT_API',
    source_count: 1,
    approved_publisher: 'Regulator of Social Housing',
    rights_reviewed_at: GOVUK_RSH_RIGHTS_REVIEWED_AT,
    acquisition_checked_at: checkedAt.toISOString(),
    item_count: projected.length,
    metadata_content_digest_sha256: digest(projected),
    articles: projected,
    rights_checked_live: true,
    robots_checked_live: true,
    full_text_saved: false,
    database_writes: 0,
    discovering_new_urls: false,
    persisted_article_count: 0,
    generating_events: false,
    generating_contradictions: false,
    production_permission: false,
  };
}

async function main() {
  if (process.env.DATABASE_URL ||
      process.env.DIALEKTIK_GOVUK_ACQUISITION_DATABASE_URL ||
      process.env.DIALEKTIK_GOVUK_RSH_PERSIST_ENABLED === 'true')
    throw Error('PERSISTENCE_SECRETS_NOT_ALLOWED_IN_READONLY_MONITOR');
  const file = process.env.DIALEKTIK_WATCH_OUTPUT;
  if (!file || !resolve(file).startsWith(resolve(process.env.RUNNER_TEMP ?? '/tmp') + '/'))
    throw Error('OUTPUT_MUST_BE_RUNNER_TEMP');
  const when = new Date();
  const items = await acquireGovUkRshPreviewBatch({recordedAt:when});
  const receipt = safeProjection(items, when);
  await mkdir(dirname(resolve(file)), {recursive:true});
  await writeFile(file, JSON.stringify(receipt,null,2)+'\n', {encoding:'utf8',flag:'wx',mode:0o600});
  console.log('SOURCE=GOVUK_RSH');
  console.log('VERIFIED_ORIGINAL_PUBLISHER_ITEMS='+receipt.item_count);
  console.log('CONTENT_DIGEST_SHA256='+receipt.metadata_content_digest_sha256);
  console.log('AUTOMATED_DISCOVERY=false');
  console.log('ARTICLE_DB_WRITES=0');
  console.log('EVENTS_AND_CONTRADICTIONS=0');
  console.log('LIVE_RIGHTS_AND_ROBOTS_RECHECKED=true');
}
if (process.argv[1] && import.meta.url === new URL('file://'+resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error('READONLY_WATCH_FAIL_CLOSED',error instanceof Error ? error.message : 'UNKNOWN');
    process.exitCode=1;
  });
}
