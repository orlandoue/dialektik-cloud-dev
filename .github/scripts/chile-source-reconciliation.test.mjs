import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {audit} from './chile-source-reconciliation.mjs';
const input=JSON.parse(readFileSync('docs/operations/source-audit/chile-staged-snapshot-2026-10-26.json'));
const reviews=JSON.parse(readFileSync('docs/operations/source-audit/chile-external-review-2026-10-26.json'));
const copy=o=>JSON.parse(JSON.stringify(o));
test('all 13 Chile records remain unlicensed and exactly reconciled',()=>{
 const r=audit(input,reviews);
 assert.equal(r.total,13);
 assert.equal(r.newsAuthorized,0);
 assert.equal(r.dbWrites,0);
 assert.equal(r.items.filter(x=>x.synthetic).length,4);
 assert.equal(r.states.SYNTHETIC_RECEIPT,4);
 assert.equal(r.states.NON_ARTICLE_LANDING,2);
 assert.equal(r.states.TITLE_MISMATCH,2);
 assert.equal(r.states.PUBLIC_ARTICLE_LINK_MATCH,4);
 assert.equal(r.states.UNVERIFIED_RESTRICTED_ACCESS,1);
 assert.ok(r.items.every(x=>x.publicationAuthorized===false));
});
test('do not upgrade probable fixture even when a URL exists',()=>{
 const r=copy(reviews);
 r.records.find(x=>x.recordKey==='CL003').reviewStatus='PUBLIC_ARTICLE_LINK_MATCH';
 assert.throws(()=>audit(input,r),/SYNTHETIC_RECEIPT_NOT_QUARANTINED/);
});
test('review URL and license cannot be forged',()=>{
 const r=copy(reviews);
 r.records[0].releaseAuthority=true;
 assert.throws(()=>audit(input,r),/REVIEW_INVALID/);
 const s=copy(reviews);s.records[0].reviewedUrl='https://unrelated.example/story';
 assert.throws(()=>audit(input,s),/REVIEW_INVALID/);
 const t=copy(input);t.records[0].canonicalUrl='https://bcentral.cl.evil.example/story';
 const u=copy(reviews);u.records[0].reviewedUrl=t.records[0].canonicalUrl;
 assert.throws(()=>audit(t,u),/SOURCE_ORIGIN_MISMATCH/);
});
test('missing review fails closed',()=>{
 const r=copy(reviews);r.records.pop();
 assert.throws(()=>audit(input,r),/AUDIT_SCOPE_INVALID/);
});
