import { describe, expect, it } from 'vitest';
import { LiveSemanticCallBudget } from '../src/semantic/live-semantic-call-budget.js';

describe('shared semantic model budget',()=>{
  it('limits the total across concurrent callers, including failed calls',async()=>{
    let calls=0;
    const budget=new LiveSemanticCallBudget(2,async()=>{calls++;if(calls===2) throw new Error('offline');return new Response('{}');});
    await budget.request('https://example.test');
    await expect(budget.request('https://example.test')).rejects.toThrow('offline');
    await expect(budget.request('https://example.test')).rejects.toThrow('SEMANTIC_CALL_BUDGET_EXHAUSTED');
    expect(calls).toBe(2);expect(budget.used).toBe(2);expect(budget.available).toBe(false);
  });
  it('halts after a quota response',async()=>{
    const budget=new LiveSemanticCallBudget(25,async()=>new Response('{}',{status:429}));
    await budget.request('https://example.test');
    expect(budget.available).toBe(false);
    await expect(budget.request('https://example.test')).rejects.toThrow('SEMANTIC_CALL_BUDGET_EXHAUSTED');
  });
  it('rejects limits over 25',()=>{expect(()=>new LiveSemanticCallBudget(26)).toThrow('SEMANTIC_CALL_BUDGET_INVALID');});
});
