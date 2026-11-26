import {describe,expect,it} from 'vitest';
import {loadCoreApiConfig} from '../src/config/core-api-config.js';

const original='postgresql://dialektik_core_app.vclsswwfhljczxgnsciq:OldPassword123@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
const candidate='postgresql://dialektik_core_app_next.vclsswwfhljczxgnsciq:NewPassword456@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
const config=(environment:Record<string,string>)=>loadCoreApiConfig({
 NODE_ENV:'production',DATABASE_URL:original,...environment
});
describe('Opt-in Core DB role cutover guard',()=>{
 it('defaults to existing primary DATABASE_URL even if candidate is present',()=>{
   const result=config({DATABASE_URL_CANDIDATE:candidate});
   expect(result.databaseUrl).toBe(original);
 });
 it('chooses secondary role only with explicit candidate slot',()=>{
   expect(config({DIALEKTIK_CORE_DB_SLOT:'candidate',DATABASE_URL_CANDIDATE:candidate}).databaseUrl)
     .toBe(candidate);
 });
 it('candidate requires separately configured alternate URL',()=>{
   expect(()=>config({DIALEKTIK_CORE_DB_SLOT:'candidate'})).toThrow(/Candidate Core database URL is required/);
 });
 it('rejects accidental invalid slot and mismatched host, database, port, TLS or user',()=>{
   expect(()=>config({DIALEKTIK_CORE_DB_SLOT:'activate',DATABASE_URL_CANDIDATE:candidate}))
     .toThrow(/DIALEKTIK_CORE_DB_SLOT/);
   for(const bad of [
     candidate.replace('aws-0-us-east-1.pooler.supabase.com','other-host.invalid'),
     candidate.replace(':5432/',':5433/'),
     candidate.replace('/postgres?','/other?'),
     candidate.replace('sslmode=verify-full','sslmode=disable'),
     candidate.replace('dialektik_core_app_next.','postgres.'),
     candidate.replace('dialektik_core_app_next.','dialektik_govuk_metadata_writer.'),
     original
   ])expect(()=>config({DIALEKTIK_CORE_DB_SLOT:'candidate',DATABASE_URL_CANDIDATE:bad}))
     .toThrow(/Candidate Core database target or role is not authorized/);
 });
 it('does not select a candidate under an unapproved primary role',()=>{
   expect(()=>loadCoreApiConfig({
      NODE_ENV:'production',DATABASE_URL:original.replace('dialektik_core_app.','postgres.'),
      DIALEKTIK_CORE_DB_SLOT:'candidate',DATABASE_URL_CANDIDATE:candidate
   })).toThrow(/not authorized/);
 });
 it('never prints connection strings or passwords in refusal messages',()=>{
   for(const bad of [candidate.replace(':5432/',':6000/'),'invalid-url']){
     let message='';
     try{config({DIALEKTIK_CORE_DB_SLOT:'candidate',DATABASE_URL_CANDIDATE:bad});}catch(err){
       message=String(err);
     }
     expect(message).not.toContain('OldPassword123');
     expect(message).not.toContain('NewPassword456');
     expect(message).not.toContain('pooler.supabase.com');
   }
 });
});
