import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Kysely, PostgresDialect } from 'kysely';
import { LiveRepository } from '../dist/live/live.repository.js';
import { LiveApplicationService } from '../dist/live/live.service.js';

function fakeDb() {
  const queries = [];
  const pool = {
    async connect() {
      return {
        async query(command, params) {
          const raw = typeof command === 'string' ? {text:command,values:params??[]} : command;
          queries.push(raw);
          if (raw.text.includes('as staged_record_count')) {
            return { rows: [{ id:'test-id', name:'Medio de prueba',
              canonical_domain:'biobiochile.cl',source_type:'news',staged_record_count:2 }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  return { db:new Kysely({dialect:new PostgresDialect({pool})}),queries };
}
test('registered Chile publishers remain independently visible as review-required, not authorized', async () => {
  const {db,queries}=fakeDb();
  try {
    const svc=new LiveApplicationService(new LiveRepository(db));
    const result=await svc.registeredSources('CL');
    assert.equal(result.mode,'UNVERIFIED_SOURCE_REGISTRY');
    assert.equal(result.license_status,'NOT_ATTESTED');
    assert.equal(result.operational_source_count,0);
    assert.equal(result.items[0].review_status,'PENDING_INDEPENDENT_VERIFICATION');
    assert.equal(result.items[0].staged_record_count,2);
    assert.equal(result.items[0].canonical_domain,'biobiochile.cl');
    assert.equal(queries.length,2);
    const directory=queries.find(x=>x.text.includes('as staged_record_count'));
    assert.ok(directory);
    assert.match(directory.text,/from sources s/i);
    assert.doesNotMatch(directory.text,/join live_source_policies/i);
    assert.match(directory.text,/canonical_domain in \(/i);
    assert.ok(directory.values.includes('biobiochile.cl'));
    assert.ok(!directory.values.includes('gov.uk'));
    assert.doesNotMatch(directory.text,/headline|text_original|excerpt/i);
    const licensed=queries.find(x=>x.text.includes('live_source_policies'));
    assert.match(licensed.text,/rightsReviewStatus/);
    assert.match(licensed.text,/authorizationReference/);
  } finally {await db.destroy();}
});
test('unsupported countries do not disclose Chile directory rows',async()=>{
  const {db,queries}=fakeDb();
  try{
    const result=await new LiveApplicationService(new LiveRepository(db)).registeredSources('PE');
    assert.deepEqual(result.items,[]);
    assert.equal(result.operational_source_count,0);
    assert.deepEqual(queries,[]);
  }finally{await db.destroy();}
});
