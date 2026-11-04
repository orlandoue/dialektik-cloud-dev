import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { synthesisRelationSql } from '../../../packages/database/dist/migration/081_synthesis_relation.js';

test('synthesis classifications are constrained, nullable and update their cache timestamp', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.events (id text primary key)');
    await db.exec(synthesisRelationSql);
    await db.exec("insert into public.events (id) values ('one')");
    let result = await db.query("select synthesis_relation, synthesis_relation_updated_at from public.events where id='one'");
    assert.equal(result.rows[0].synthesis_relation, null);
    assert.equal(result.rows[0].synthesis_relation_updated_at, null);
    await db.exec("update public.events set synthesis_relation='TREND' where id='one'");
    result = await db.query("select synthesis_relation, synthesis_relation_updated_at from public.events where id='one'");
    assert.equal(result.rows[0].synthesis_relation, 'TREND');
    assert.ok(result.rows[0].synthesis_relation_updated_at);
    await assert.rejects(db.exec("update public.events set synthesis_relation='INVENTED' where id='one'"));
  } finally { await db.close(); }
});
