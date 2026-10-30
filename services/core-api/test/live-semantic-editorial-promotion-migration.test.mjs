import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../../packages/database/src/migration/060_live_semantic_editorial_promotion.ts', import.meta.url),
  'utf8',
);
const finalizeMigration = readFileSync(
  new URL('../../../packages/database/src/migration/062_finalize_live_semantic_promotion.ts', import.meta.url),
  'utf8',
);
const provider = readFileSync(
  new URL('../../../packages/database/src/migration/provider.ts', import.meta.url),
  'utf8',
);
const productionService = readFileSync(
  new URL('../src/semantic/live-semantic-production.service.ts', import.meta.url),
  'utf8',
);
const exceptionFilter = readFileSync(
  new URL('../src/http/safe-http-exception.filter.ts', import.meta.url),
  'utf8',
);

test('registers migration 060 and retains narrow signed-promotion gates', () => {
  assert.match(provider, /'060_live_semantic_editorial_promotion': liveSemanticEditorialPromotionMigration/);
  assert.match(provider, /'061_live_semantic_proposal_members_order': liveSemanticProposalMembersOrderMigration/);
  assert.match(provider, /'062_finalize_live_semantic_promotion': finalizeLiveSemanticPromotionMigration/);
  assert.match(migration, /dialektik_require_context_actor\(actor_identity\)/);
  assert.match(migration, /editorial_single_editor_authorizations/);
  assert.match(migration, /substring\(item\.text_original from quote_start\+1 for quote_end-quote_start\)<>quote_text/);
  assert.match(migration, /pair_row\.relation='CONSISTENT'/);
  assert.match(migration, /ratio_conflicting=0/);
  assert.match(migration, /'confirmed','live_semantic_candidate_acceptance'/);
  assert.match(migration, /'confirmed','live_semantic_command_receipt'/);
  assert.match(migration, /on conflict\(id\) where id is not null/i);
  assert.doesNotMatch(migration, /\bdrop\s+constraint\b/i);
  assert.doesNotMatch(migration, /grant\s+[^;]*\bto\s+public\b/i);
});

test('validates deferred graph constraints before returning and allows stale invalid publications to be demoted', () => {
  assert.match(finalizeMigration, /set constraints all immediate;\\n\$\{promotionFinalizeMarker\}/u);
  assert.match(finalizeMigration, /row_data ->> 'confirmed_by' is distinct from old_row_data ->> 'confirmed_by'/u);
  assert.match(finalizeMigration, /row_data ->> 'publication_state'='published'/u);
  assert.match(finalizeMigration, /set search_path=pg_catalog,public,extensions/u);
  assert.doesNotMatch(finalizeMigration, /\bdrop\s+constraint\b/i);
  assert.doesNotMatch(finalizeMigration, /grant\s+[^;]*\bto\s+public\b/i);
});

test('inserts immutable proposal members before creating the submitted proposal', () => {
  const members = migration.indexOf('insert into public.moderation_review_proposal_members');
  const proposal = migration.indexOf('insert into public.moderation_review_proposals', members);
  assert.ok(members >= 0 && proposal > members);
  assert.match(migration.slice(members, proposal), /select proposal_identity,assertion_id,null/);
});

test('classifies audit-context and promotion SQL failures through the same safe error mapping', () => {
  const promote = productionService.slice(productionService.indexOf('async promote('));
  const context = promote.indexOf('await setTransactionAuditContext');
  const sqlCall = promote.indexOf('select public.dialektik_promote_live_semantic_event_group');
  const errorMapping = promote.indexOf('throw semanticPromotionDatabaseError(error, failureStage)');
  const tryBlock = promote.lastIndexOf('try {', context);
  assert.ok(tryBlock >= 0 && context > tryBlock);
  assert.ok(sqlCall > context && errorMapping > sqlCall);
  assert.match(promote, /try \{\s*return await database\.transaction\(\)\.execute/u);
  assert.match(promote, /catch \(error\) \{\s*if \(error instanceof ModerationHttpError \|\| error instanceof ConflictException\)/u);
  assert.match(productionService, /function semanticPromotionDatabaseError\(/u);
  assert.match(productionService, /MOD_SEMANTIC_PROMOTION_DATABASE_FAILURE/u);
  assert.match(productionService, /sqlState: databaseCode/u);
  assert.match(productionService, /failureStage: "transaction" \| "audit_context" \| "promotion_function"/u);
  assert.match(exceptionFilter, /exception instanceof ModerationHttpError \? exception\.diagnostic/u);
  assert.match(exceptionFilter, /diagnostic === undefined \? \{\} : \{ diagnostic \}/u);
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
