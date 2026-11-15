import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rawArticleRetentionSql } from '../../../packages/database/dist/migration/088_raw_article_retention.js';

// Behaviour was verified on PostgreSQL 16 against the governance schema:
// old raw-only articles are purged with their versions, receipts, exposure
// and retries; articles with an event, a semantic group or a recent date are
// kept; append-only triggers are re-enabled; failures roll everything back.
test('retention keeps at least 14 days and is not callable by app users', () => {
  assert.match(rawArticleRetentionSql, /p_older_than < interval '14 days' then raise exception/u);
  assert.match(rawArticleRetentionSql, /revoke all on function public\.dialektik_purge_raw_articles\(interval, integer\) from public, anon, authenticated/u);
  assert.match(rawArticleRetentionSql, /grant execute .* to dialektik_corporate_live_writer/u);
});

test('every foreign key to an article or its provenance protects it, checked at run time', () => {
  assert.match(rawArticleRetentionSql, /from pg_constraint c/u);
  assert.match(rawArticleRetentionSql, /a\.event_id is null/u);
  for (const parent of ['articles', 'live_article_versions', 'assertion_extraction_generations', 'live_acquisition_receipts', 'live_exposure_exclusions'])
    assert.match(rawArticleRetentionSql, new RegExp(`'public\\.${parent}'::regclass`, 'u'));
});

test('only user DELETE triggers of raw tables are disabled, and all are re-enabled', () => {
  assert.match(rawArticleRetentionSql, /not t\.tgisinternal and t\.tgenabled <> 'D' and \(t\.tgtype & 8\) = 8/u);
  assert.match(rawArticleRetentionSql, /alter table %s enable trigger %I/u);
  assert.match(rawArticleRetentionSql, /exception when others then\s+skipped := skipped \+ 1;/u);
});
