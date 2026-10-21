import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePreviousDiscoveryReceipt,loadPreviousDiscoveryReceipt} from './govuk-incremental-receipt.mjs';
const at=new Date('2026-10-21T12:00:00.000Z');
const make=(other={})=>({
 schema:'dialektik-govuk-housing-two-publisher-readonly-v1',
 checkedAt:'2026-10-21T11:00:00.000Z',publisherCount:2,
 sourceIdentitiesVerified:true,databaseWrites:0,eventsGenerated:0,
 contradictionsGenerated:0,bodyPersisted:false,
 items:[{sourceId:'govuk_rsh_official',sourceItemId:'rsh-one',
   canonicalUrl:'https://www.gov.uk/government/news/rsh-one',metadataHash:'a'.repeat(64)},
   {sourceId:'govuk_mhclg_official',sourceItemId:'mhclg-one',
   canonicalUrl:'https://www.gov.uk/government/news/mhclg-one',metadataHash:'b'.repeat(64)}],
 ...other
});
test('validates bounded version identities without transferring source policy',()=>{
 const x=validatePreviousDiscoveryReceipt(make(),at);
 assert.equal(x.length,2);
 assert.deepEqual(Object.keys(x[0]).sort(),['canonicalUrl','metadataHash','sourceId','sourceItemId']);
 assert.equal(x[0].metadataHash,'a'.repeat(64));
});
test('bootstrap explicitly lacks any earlier publication history',async()=>{
 assert.deepEqual(await loadPreviousDiscoveryReceipt(undefined,at),
   {previous:[],continuity:'BOOTSTRAP_UNVERIFIED_HISTORY'});
});
test('reject false publisher identity, disallowed payload authority and bad URL',()=>{
 for(const data of [
   make({publisherCount:1}),make({databaseWrites:1}),
   make({eventsGenerated:1}),make({sourceIdentitiesVerified:false}),
   make({items:[{...make().items[0],sourceId:'unknown_publisher'},make().items[1]]}),
   make({items:[{...make().items[0],canonicalUrl:'https://other.invalid/news'},make().items[1]]})
 ])assert.throws(()=>validatePreviousDiscoveryReceipt(data,at),/INCREMENTAL_RECEIPT_/);
});
test('reject duplicate, stale, and future CI receipts',()=>{
 const x=make();
 for(const data of [
   make({items:[x.items[0],{...x.items[1],canonicalUrl:x.items[0].canonicalUrl}]}),
   make({items:[x.items[0],{...x.items[0]}]}),
   make({checkedAt:'2026-10-17T00:00:00.000Z'}),
   make({checkedAt:'2026-10-22T00:00:00.000Z'})
 ])assert.throws(()=>validatePreviousDiscoveryReceipt(data,at),/INCREMENTAL_RECEIPT_/);
});
test('invalid or absent source snapshot fails without inferred counts',()=>{
 assert.throws(()=>validatePreviousDiscoveryReceipt({},at),/INCREMENTAL_RECEIPT_/);
 assert.throws(()=>validatePreviousDiscoveryReceipt(make({items:[]}),at),/INCREMENTAL_RECEIPT_/);
});

test('invalid metadata hashes, item IDs and re-used source keys are rejected',()=>{
  const original=make();
  for(const raw of [
    make({items:[{...original.items[0],metadataHash:'wrong'},original.items[1]]}),
    make({items:[{...original.items[0],sourceItemId:'bad/injection'},original.items[1]]}),
    make({items:[original.items[0],{...original.items[0],canonicalUrl:'https://www.gov.uk/government/news/a-second-url'}]})
  ])assert.throws(()=>validatePreviousDiscoveryReceipt(raw,at),/INCREMENTAL_RECEIPT_/);
});
