import { sql, type Migration } from 'kysely';

// Newest-first index of live article versions (migration 100). The news and
// video listings pick the newest candidates by version publication date;
// without this index each listing computed the latest version of every live
// article (~24,000) before keeping the first hundred (2.4 s for Chilean
// videos on the free database). With it the listing walks the newest
// versions and stops once the page is full. About 1-2 MB. Idempotent.
export const liveVersionsByPublishedSql = String.raw`
create index if not exists live_versions_by_published
  on public.live_article_versions (published_at desc, article_id desc);
analyze public.live_article_versions;
`;

export const liveVersionsByPublishedMigration: Migration = {
  async up(db) { await sql.raw(liveVersionsByPublishedSql).execute(db); },
  async down(db) { await sql`drop index if exists public.live_versions_by_published`.execute(db); },
};
