import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Ulid } from '@dialektik/database';
import type { PublisherMarket } from './live.publisher-market.js';
import {
  LiveRepository,
  type LiveNewsQuery,
  type LiveReadRow,
  type LiveSourceReadRow,
} from './live.repository.js';

function sourceDto(row: LiveSourceReadRow) {
  return {
    id: row.id,
    name: row.name,
    source_type: row.source_type,
    canonical_domain: row.canonical_domain,
    publisher_family:
      typeof row.policy.publisherFamily === 'string' ? row.policy.publisherFamily : null,
    category: typeof row.policy.category === 'string' ? row.policy.category : null,
    origin: 'LIVE_REAL' as const,
    rights_class: row.policy.rightsClass,
    storage_policy: row.policy.storagePolicy,
    rights_evidence_url: row.policy.rightsEvidenceUrl,
    discovery_channel: row.policy.discoveryChannel,
    discovery_url: row.policy.endpoint,
    attribution: row.policy.attribution,
  };
}

function newsDto(row: LiveReadRow) {
  const metadataOnly = row.policy.storagePolicy === 'METADATA_ONLY';
  return {
    id: row.id,
    headline: row.headline,
    excerpt: metadataOnly ? null : row.excerpt,
    canonical_url: row.canonical_url,
    published_at: row.published_at.toISOString(),
    modified_at: row.modified_at?.toISOString() ?? null,
    first_seen_at: row.first_seen_at.toISOString(),
    source: sourceDto({
      id: row.source_id,
      name: row.source_name,
      source_type: row.source_type,
      canonical_domain: row.canonical_domain,
      policy: row.policy,
    }),
    origin: 'LIVE_REAL' as const,
    semantic_assignment: row.event_id === null ? ('UNASSIGNED' as const) : ('EVENT_LINKED' as const),
    version_count: row.version_count,
  };
}

function provenanceDto(row: LiveReadRow) {
  return {
    published_at: row.published_at.toISOString(),
    modified_at: row.modified_at?.toISOString() ?? null,
    discovery_channel: row.discovery_channel,
    discovery_url: row.discovery_url,
    source_item_id: row.source_item_id,
    canonical_url: row.canonical_url,
    original_published_at: row.original_published_at,
    original_modified_at: row.original_modified_at,
    first_seen_at: row.first_seen_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
    adapter_version: row.adapter_version,
    rights_class: row.policy.rightsClass,
    rights_evidence_url: row.policy.rightsEvidenceUrl,
    exclusion_status: 'PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2' as const,
    receipt_count: row.receipt_count,
  };
}

@Injectable()
export class LiveApplicationService {
  constructor(@Inject(LiveRepository) private readonly repository: LiveRepository) {}
  async list(query: LiveNewsQuery) {
    const rows = await this.repository.list(query);
    const items = rows.slice(0, query.limit).map(newsDto);
    return {
      origin: 'LIVE_REAL' as const,
      semantic_mode: items.some((item) => item.semantic_assignment === 'EVENT_LINKED')
        ? ('mixed' as const)
        : ('unassigned' as const),
      items,
      next_cursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }
  async article(id: Ulid, market: PublisherMarket = 'CL') {
    const row = await this.repository.article(id, market);
    if (row === undefined) throw new NotFoundException('Live Article not found.');
    return {
      ...newsDto(row),
      author: row.policy.storagePolicy === 'METADATA_ONLY' ? null : row.author,
      content: {
        representation:
          row.policy.storagePolicy === 'METADATA_ONLY' ? 'metadata_only' : 'feed_excerpt',
        text: row.policy.storagePolicy === 'METADATA_ONLY' ? null : row.excerpt,
        body: null,
        storage_policy: row.policy.storagePolicy,
      },
      provenance: provenanceDto(row),
      declared_upstream:
        row.policy.storagePolicy === 'METADATA_ONLY' ? null : row.declared_upstream,
    };
  }
  async provenance(id: Ulid, market: PublisherMarket = 'CL') {
    const row = await this.repository.article(id, market);
    if (row === undefined) throw new NotFoundException('Live provenance not found.');
    return provenanceDto(row);
  }
  async registeredSources(market: PublisherMarket = 'CL') {
    const [rows, reviewed] = await Promise.all([
      this.repository.registeredSources(market),
      this.repository.sources(undefined, market),
    ]);
    return {
      mode: 'UNVERIFIED_SOURCE_REGISTRY' as const,
      country_code: market,
      license_status: 'NOT_ATTESTED' as const,
      operational_source_count: reviewed.length,
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        canonical_domain: row.canonical_domain,
        source_type: row.source_type,
        staged_record_count: Number(row.staged_record_count),
        review_status: 'PENDING_INDEPENDENT_VERIFICATION' as const,
      })),
    };
  }
  async sources(market: PublisherMarket = 'CL') {
    return { items: (await this.repository.sources(undefined, market)).map(sourceDto) };
  }
  async source(id: Ulid, market: PublisherMarket = 'CL') {
    const rows = await this.repository.sources(id, market);
    const row = rows[0];
    if (row === undefined) throw new NotFoundException('Live Source not found.');
    return sourceDto(row);
  }
}
