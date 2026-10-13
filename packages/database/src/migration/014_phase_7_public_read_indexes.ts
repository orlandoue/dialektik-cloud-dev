import { sql, type Migration } from 'kysely';

/**
 * Phase 7 adds only read-path indexes. Public API DTOs remain Core-owned and
 * no public-copy table, ranking column, score, or writable projection is added.
 */
const PHASE_7_PUBLIC_READ_INDEXES_SQL = String.raw`
create index idx_event_public_feed
  on events (detected_at desc, id desc)
  where merged_into is null;

create index idx_event_public_feed_category
  on events (category_id, detected_at desc, id desc)
  where merged_into is null;

create index idx_article_public_event_source
  on articles (event_id, source_id, captured_at desc)
  where event_id is not null;

create index idx_position_public_event
  on positions (event_id, neutral_rank asc, id asc)
  where publication_state = 'published' and status = 'active';

create index idx_relationship_public_event
  on relationships (event_id, confirmed_at asc, id asc)
  where publication_state = 'published' and rel_type <> 'R01b';

create index idx_contradiction_public_index
  on contradiction_publications (confirmed_at desc, id desc)
  where publication_state in ('published', 'requires_review');
`;

export const phase7PublicReadIndexesMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(PHASE_7_PUBLIC_READ_INDEXES_SQL).execute(database);
  },
};
