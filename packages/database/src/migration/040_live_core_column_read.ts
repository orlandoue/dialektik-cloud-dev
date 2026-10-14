import { sql, type Kysely, type Migration } from 'kysely';
import type { Database } from '../database.types';

const SCHEMA = String.raw`
GRANT SELECT (article_id, version_number, headline, excerpt, author, published_at, modified_at, declared_upstream)
  ON TABLE public.live_article_versions TO dialektik_core_app;
GRANT SELECT (id, exclusion_id, canonical_url, original_published_at, original_modified_at, source_item_id, discovery_channel, discovery_url, adapter_version, seen_at, disposition)
  ON TABLE public.live_acquisition_receipts TO dialektik_core_app;
GRANT SELECT (id, source_id, recorded_at, active, rights_class, policy)
  ON TABLE public.live_source_policies TO dialektik_core_app;
GRANT SELECT (id, first_seen_at)
  ON TABLE public.live_exposure_exclusions TO dialektik_core_app;
`;

const ROLLBACK = String.raw`
REVOKE SELECT (article_id, version_number, headline, excerpt, author, published_at, modified_at, declared_upstream)
  ON TABLE public.live_article_versions FROM dialektik_core_app;
REVOKE SELECT (id, exclusion_id, canonical_url, original_published_at, original_modified_at, source_item_id, discovery_channel, discovery_url, adapter_version, seen_at, disposition)
  ON TABLE public.live_acquisition_receipts FROM dialektik_core_app;
REVOKE SELECT (id, source_id, recorded_at, active, rights_class, policy)
  ON TABLE public.live_source_policies FROM dialektik_core_app;
REVOKE SELECT (id, first_seen_at)
  ON TABLE public.live_exposure_exclusions FROM dialektik_core_app;
`;

export const liveCoreColumnReadMigration: Migration = {
  async up(database: Kysely<Database>): Promise<void> {
    await sql.raw(SCHEMA).execute(database);
  },
  async down(database: Kysely<Database>): Promise<void> {
    await sql.raw(ROLLBACK).execute(database);
  },
};
