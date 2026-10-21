import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const PUBLISHERS=Object.freeze({govuk_rsh_official:'regulator_of_social_housing',govuk_mhclg_official:'ministry_housing_communities'});
const SOURCES=new Set(['govuk_rsh_official','govuk_mhclg_official']);
const CANONICAL=/^https:\/\/www\.gov\.uk\/government\/news\/[a-z0-9-]+$/u;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/u;
const HASH=/^[0-9a-f]{64}$/u;
const TIMESTAMP=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const MAX_AGE=3*24*60*60*1000;

// CI artifact continuity is not a complete historical record or rights authority.
export function validatePreviousDiscoveryReceipt(receipt,at){
  if(!receipt||receipt.schema!=='dialektik-govuk-housing-two-publisher-readonly-v1'||
    receipt.publisherCount!==2||receipt.sourceIdentitiesVerified!==true||
    receipt.databaseWrites!==0||receipt.eventsGenerated!==0||
    receipt.contradictionsGenerated!==0||receipt.bodyPersisted!==false||
    !Array.isArray(receipt.items)||receipt.items.length<2||receipt.items.length>10)
    throw Error('INCREMENTAL_RECEIPT_CONTRACT_INVALID');
  if(typeof receipt.checkedAt!=='string'||!TIMESTAMP.test(receipt.checkedAt)||
    !Number.isFinite(at.getTime())||
    new Date(receipt.checkedAt).toISOString()!==receipt.checkedAt)
    throw Error('INCREMENTAL_RECEIPT_DATE_INVALID');
  const elapsed=at.getTime()-Date.parse(receipt.checkedAt);
  if(elapsed<0||elapsed>MAX_AGE)throw Error('INCREMENTAL_RECEIPT_NOT_CONTIGUOUS');
  const previous=[],identities=new Set(),urls=new Set(),sources=new Set();
  for(const item of receipt.items){
    if(!item||!SOURCES.has(item.sourceId)||item.publisherId!==PUBLISHERS[item.sourceId]||
      typeof item.title!=='string'||!item.title.trim()||item.title!==item.title.trim()||
      /[\u0000-\u001f\u007f]/u.test(item.title)||Array.from(item.title).length>1024||
      typeof item.publishedAt!=='string'||!TIMESTAMP.test(item.publishedAt)||
      new Date(item.publishedAt).toISOString()!==item.publishedAt||
      !(item.modifiedAt===null||(typeof item.modifiedAt==='string'&&
        TIMESTAMP.test(item.modifiedAt)&&new Date(item.modifiedAt).toISOString()===item.modifiedAt))||
      (item.modifiedAt!==null&&item.modifiedAt<item.publishedAt)||
      typeof item.sourceItemId!=='string'||
      !ID.test(item.sourceItemId)||typeof item.canonicalUrl!=='string'||
      !CANONICAL.test(item.canonicalUrl)||typeof item.metadataHash!=='string'||
      !HASH.test(item.metadataHash))throw Error('INCREMENTAL_RECEIPT_ITEM_INVALID');
    const computed=createHash('sha256').update(JSON.stringify([
      item.sourceId,item.sourceItemId,item.canonicalUrl,item.title,
      item.publishedAt,item.modifiedAt??''
    ])).digest('hex');
    if(computed!==item.metadataHash)throw Error('INCREMENTAL_RECEIPT_HASH_MISMATCH');
    const key=JSON.stringify([item.sourceId,item.sourceItemId]);
    if(identities.has(key)||urls.has(item.canonicalUrl))throw Error('INCREMENTAL_RECEIPT_DUPLICATE');
    identities.add(key);urls.add(item.canonicalUrl);sources.add(item.sourceId);
    previous.push({sourceId:item.sourceId,sourceItemId:item.sourceItemId,
      canonicalUrl:item.canonicalUrl,metadataHash:item.metadataHash});
  }
  if(sources.size!==2)throw Error('INCREMENTAL_RECEIPT_PUBLISHER_COUNT');
  return previous;
}
export async function loadPreviousDiscoveryReceipt(path,at){
  if(path===undefined)return {previous:[],continuity:'BOOTSTRAP_UNVERIFIED_HISTORY'};
  const size=await stat(path);
  if(!size.isFile()||size.size<100||size.size>65536)throw Error('INCREMENTAL_RECEIPT_FILE_INVALID');
  let receipt;
  try{receipt=JSON.parse(await readFile(path,'utf8'))}
  catch{throw Error('INCREMENTAL_RECEIPT_JSON_INVALID')}
  return {previous:validatePreviousDiscoveryReceipt(receipt,at),
    continuity:'PREVIOUS_SUCCESSFUL_CI_SNAPSHOT'};
}
