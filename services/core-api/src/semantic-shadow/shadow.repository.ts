import { createHash } from 'node:crypto';
import type { Database } from '@dialektik/database';
import { sql, type Kysely, type Selectable } from 'kysely';
import { liveHash, nearDuplicateSignature } from '../live/live.adapter.js';
import {
  AUTHENTICATED_LIVE_REGISTRY_SHA256,
  LIVE_EXCLUSION_CLASS,
  LIVE_EXCLUSION_REGISTRY_IDENTITY,
  type ShadowPreflightArticle,
  type ShadowPreflight,
} from './shadow.contracts.js';

export type ShadowExclusionRow = Selectable<Database['live_exposure_exclusions']>;

/** Exact immutable export convention used by sync-news-live.mts. */
export function shadowRegistryHash(rows: readonly ShadowExclusionRow[]): string {
  const serialized =
    JSON.stringify(
      {
        registryVersion: LIVE_EXCLUSION_REGISTRY_IDENTITY,
        exclusionClass: LIVE_EXCLUSION_CLASS,
        semanticGold: false,
        candidatePredictions: false,
        entries: rows,
      },
      null,
      2,
    ) + '\n';
  return createHash('sha256').update(serialized).digest('hex');
}

export interface ShadowPreflightLineage {
  id: string;
  headline: string | null;
  source_id: string;
  source_origin: string;
  version_article_id: string | null;
  receipt_id: string | null;
  receipt_source_id: string | null;
  receipt_disposition: string | null;
  policy_source_id: string | null;
  policy_active: boolean | null;
  policy_rights_class: string | null;
  policy_storage_policy: string | null;
  registry_key: string | null;
}

/** A metadata-only or incomplete lineage must never be labeled feed_excerpt. */
export function assertReadableShadowLineage(
  row: ShadowPreflightLineage,
): asserts row is ShadowPreflightLineage & { headline: string } {
  if (
    row.source_origin !== 'LIVE_REAL' ||
    row.headline === null ||
    row.headline.trim().length === 0 ||
    row.version_article_id !== row.id ||
    row.receipt_id === null ||
    row.receipt_source_id !== row.source_id ||
    row.receipt_disposition !== 'PERSISTED' ||
    row.policy_source_id !== row.source_id ||
    row.policy_active !== true ||
    row.policy_rights_class !== 'LIVE_READY' ||
    row.policy_storage_policy !== 'METADATA_AND_FEED_EXCERPT' ||
    row.registry_key === null ||
    row.registry_key.trim().length === 0
  )
    throw new Error('UNSUPPORTED_SHADOW_PREFLIGHT_LINEAGE');
}

interface PreflightRow extends ShadowPreflightLineage {
  excerpt: string | null;
  canonical_url: string;
  source_item_id: string | null;
  published_at: Date;
  first_available_at: Date;
  language: string;
  permitted_representation_sha256: string;
  source_name: string;
  content_hash: string | null;
  near_duplicate_signature: string | null;
}

export class ShadowPreflightRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async read(): Promise<
    Readonly<{ articles: readonly ShadowPreflightArticle[]; registry: ShadowPreflight['registry'] }>
  > {
    return this.database
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (transaction) => {
        await sql`set transaction read only`.execute(transaction);
        const exclusions = await transaction
          .selectFrom('live_exposure_exclusions')
          .selectAll()
          .orderBy('id')
          .execute();
        const actualHash = shadowRegistryHash(exclusions);
        const authenticated = actualHash === AUTHENTICATED_LIVE_REGISTRY_SHA256;
        // Original Article text is deliberately never selected. Its storage
        // convention combines metadata and is not full-body source material.
        const result = await sql<PreflightRow>`
        select a.id, v.headline, v.excerpt, coalesce(r.canonical_url, a.url_canonical) as canonical_url,
          r.source_item_id, a.published_at, a.captured_at as first_available_at,
          a.lang as language, encode(sha256(convert_to(a.text_original, 'UTF8')), 'hex') as permitted_representation_sha256,
          s.id as source_id, s.name as source_name, s.origin as source_origin,
          v.article_id as version_article_id, r.id as receipt_id,
          r.source_id as receipt_source_id, r.disposition as receipt_disposition,
          p.source_id as policy_source_id, p.active as policy_active,
          p.rights_class as policy_rights_class, p.storage_policy as policy_storage_policy,
          p.registry_key, v.content_hash, v.near_duplicate_signature
        from articles a join sources s on s.id = a.source_id
        left join lateral (select * from live_article_versions where article_id = a.id
          order by version_number desc limit 1) v on true
        left join live_acquisition_receipts r on r.id = v.receipt_id
        left join live_source_policies p on p.id = r.policy_id
        where a.origin = 'LIVE_REAL'
        order by a.captured_at, a.id
      `.execute(transaction);
        const articles: ShadowPreflightArticle[] = result.rows.map((row) => {
          // Historical acquisition policy proves the stored representation.
          // This does not invent a mechanism for subsequent policy revocations.
          assertReadableShadowLineage(row);
          const permittedText = [row.headline, row.excerpt]
            .filter((value) => value !== null)
            .join('\n');
          const fingerprintsMatch =
            row.content_hash === liveHash(permittedText.normalize('NFC')) &&
            row.near_duplicate_signature === nearDuplicateSignature(permittedText);
          const matching = exclusions.filter(
            (entry) =>
              entry.registry_key === row.registry_key &&
              entry.exclusion_status === LIVE_EXCLUSION_CLASS,
          );
          const urlCovered = matching.some((entry) => entry.canonical_url === row.canonical_url);
          const guidCovered =
            row.source_item_id !== null &&
            matching.some((entry) => entry.source_item_id === row.source_item_id);
          const textCovered = matching.some(
            (entry) =>
              entry.content_hash === row.content_hash &&
              entry.near_duplicate_signature === row.near_duplicate_signature &&
              (entry.canonical_url === row.canonical_url ||
                entry.source_item_id === row.source_item_id),
          );
          return {
            article_id: row.id,
            headline: row.headline,
            canonical_url: row.canonical_url,
            source_item_id: row.source_item_id,
            published_at: row.published_at.toISOString(),
            first_available_at: row.first_available_at.toISOString(),
            language: row.language,
            authorized_content_sha256: row.content_hash,
            authorized_content_signature: row.near_duplicate_signature,
            permitted_representation_sha256: row.permitted_representation_sha256,
            source: { id: row.source_id, name: row.source_name },
            representation: 'feed_excerpt',
            body: null,
            input_sufficiency: 'INVALID_FOR_CANDIDATE',
            reason_code: 'FULL_SOURCE_REQUIRED',
            exclusion_verified:
              authenticated && fingerprintsMatch && urlCovered && guidCovered && textCovered,
            authoritative_semantic_assignment: 'UNASSIGNED',
          };
        });
        return {
          articles,
          registry: {
            identity: LIVE_EXCLUSION_REGISTRY_IDENTITY,
            expected_sha256: AUTHENTICATED_LIVE_REGISTRY_SHA256,
            actual_sha256: actualHash,
            row_count: exclusions.length,
            authenticated,
          },
        };
      });
  }
}
