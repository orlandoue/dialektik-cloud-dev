import { describe, expect, it, vi } from 'vitest';

vi.mock('kysely', async (original) => ({
  ...(await original<typeof import('kysely')>()),
  sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({
    execute: (executor: { executeSql: (query: string, params: unknown[]) => unknown }) =>
      executor.executeSql(parts.join('?'), values),
  }),
}));
vi.mock('@dialektik/database', async (original) => ({
  ...(await original<typeof import('@dialektik/database')>()),
  setTransactionAuditContext: async () => undefined,
}));

import { LiveSemanticProductionService } from '../src/semantic/live-semantic-production.service.js';

const quoteA='Hermosilla sigue en prisión preventiva.';
const quoteB='La Corte confirmó la prisión preventiva.';
const candidate = {
  groupId:'01M6PDR012RKMF1CDA0YT5SEXP', title:'Corte confirma prisión preventiva', pairId:'01M6PDR6FX0NN8QJDKN7GR8FQ1',
  sameEvent:true, sameEventConfidence:100, relation:'CONSISTENT', ratioConflicting:0, ratioComparable:100,
  leftId:'01M6HT7ZZMQ7A3CZPSWK0TMS72', rightId:'01M6HYPS4M639P4CN7D17T3JCH', leftOrdinal:2, rightOrdinal:3,
  leftSource:'fuente-a', rightSource:'fuente-b', leftText:quoteA, rightText:quoteB,
  leftDate:new Date('2026-11-03T22:38:48Z'), rightDate:new Date('2026-11-03T22:48:10Z'),
  leftSpan:{quoted_text:quoteA,start:0,end:Array.from(quoteA).length},
  rightSpan:{quoted_text:quoteB,start:0,end:Array.from(quoteB).length},
};

describe('automatic selection and canonical promotion integration', () => {
  it('does not promote unless the explicit runtime flag is enabled', async () => {
    vi.stubEnv('DIALEKTIK_LIVE_SEMANTIC_AUTOPROMOTE_ENABLED','false');
    const service=new LiveSemanticProductionService({} as never, {} as never, {} as never);
    const run=(service as unknown as {autoPromoteRun:(...args:unknown[])=>Promise<number>}).autoPromoteRun.bind(service);
    expect(await run({},'run','actor','config')).toBe(0);
    vi.unstubAllEnvs();
  });
  it('passes the selected Hermosilla claims to the canonical transaction and reports refusals', async () => {
    vi.stubEnv('DIALEKTIK_LIVE_SEMANTIC_AUTOPROMOTE_ENABLED','true');
    const operations:string[]=[]; let promotionStatus='PROMOTED';
    const connection={executeSql:async () => ({rows:[candidate]})};
    const transaction={executeSql:async (query:string) => {
      if (query.includes('record_live_semantic_editorial_decision')) { operations.push('decision'); return {rows:[]}; }
      if (query.includes('promote_live_semantic_event_group')) { operations.push('promote'); return {rows:[{result:{status:promotionStatus}}]}; }
      throw Error('UNEXPECTED_SQL');
    }};
    const moderationWriter={database:{transaction:()=>({execute:async (fn:(tx:typeof transaction)=>Promise<void>)=>fn(transaction)})}};
    const service=new LiveSemanticProductionService({} as never, {} as never, moderationWriter as never);
    const run=(service as unknown as {autoPromoteRun:(...args:unknown[])=>Promise<number>}).autoPromoteRun.bind(service);
    expect(await run(connection,'01M6PDQH3WBGJ4ZNWZV38F2B3J','01M4YDQK00ED1T0R0R1AND0VE1','config')).toBe(1);
    expect(operations).toEqual(['decision','promote']);
    operations.length=0; promotionStatus='NEEDS_EDITORIAL_REVIEW';
    expect(await run(connection,'01M6PDQH3WBGJ4ZNWZV38F2B3J','01M4YDQK00ED1T0R0R1AND0VE1','config')).toBe(0);
    expect(operations).toEqual(['decision','promote']);
    vi.unstubAllEnvs();
  });
});
