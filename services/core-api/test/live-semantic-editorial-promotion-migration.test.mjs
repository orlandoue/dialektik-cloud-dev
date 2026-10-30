import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../../packages/database/src/migration/060_live_semantic_editorial_promotion.ts', import.meta.url),
  'utf8',
);
const provider = readFileSync(
  new URL('../../../packages/database/src/migration/provider.ts', import.meta.url),
  'utf8',
);

test('registers migration 060 and retains narrow signed-promotion gates', () => {
  assert.match(provider, /'060_live_semantic_editorial_promotion': liveSemanticEditorialPromotionMigration/);
  assert.match(migration, /dialektik_require_context_actor\(actor_identity\)/);
  assert.match(migration, /editorial_single_editor_authorizations/);
  assert.match(migration, /substring\(item\.text_original from quote_start\+1 for quote_end-quote_start\)<>quote_text/);
  assert.match(migration, /pair_row\.relation='CONSISTENT'/);
  assert.match(migration, /ratio_conflicting=0/);
  assert.match(migration, /on conflict\(id\) where id is not null/i);
  assert.doesNotMatch(migration, /\bdrop\s+constraint\b/i);
  assert.doesNotMatch(migration, /grant\s+[^;]*\bto\s+public\b/i);
});

test('limits the new inference grants to the named sources and short excerpts', () => {
  assert.match(migration, /s\.canonical_domain in \('elmostrador\.cl','youtube\.com'\)/);
  assert.match(migration, /maximum_excerpt_characters',700/);
  assert.match(migration, /maximum_quote_codepoints',300/);
  assert.match(migration, /'youtube_transcripts',false/);
  assert.match(migration, /'fulltext_acquisition',false/);
  assert.match(migration, /'fulltext_persistence',false/);
  assert.match(migration, /interval '30 days'/);
});
