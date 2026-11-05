import { describe, expect, it } from 'vitest';
import { validateAutoScope } from '../src/semantic/live-semantic-auto-guard.js';

const leftText='Hermosilla sigue en prisión preventiva.';
const rightText='La Corte confirmó la prisión preventiva.';
const left = { sourceId:'a', textOriginal:leftText, selectedQuote:leftText, start:0, end:Array.from(leftText).length, publishedAt:new Date('2026-11-04T00:00:00Z') };
const right = { sourceId:'b', textOriginal:rightText, selectedQuote:rightText, start:0, end:Array.from(rightText).length, publishedAt:new Date('2026-11-04T12:00:00Z') };
const consistent = { sameEvent:true, sameEventConfidence:95, relation:'CONSISTENT', ratioConflicting:0, ratioComparable:90 };
describe('automatic publication guard', () => {
  it('accepts literal cross-source evidence from the same case', () => {
    expect(validateAutoScope(consistent,left,right).sameEvent).toBe(true);
  });
  it('rejects invalid offsets, sources, times and scores', () => {
    expect(() => validateAutoScope(consistent,{...left,end:left.end-1},right)).toThrow('AUTO_SCOPE_PROVENANCE_INVALID');
    expect(() => validateAutoScope(consistent,left,{...right,sourceId:'a'})).toThrow('AUTO_SCOPE_SOURCES_INVALID');
    expect(() => validateAutoScope(consistent,left,{...right,publishedAt:new Date('2026-11-08')})).toThrow('AUTO_SCOPE_WINDOW_INVALID');
    expect(() => validateAutoScope({...consistent,ratioComparable:40},left,right)).toThrow();
  });
  it('rejects football coverage mixed with non-football coverage', () => {
    const text='El futbolista anotó dos goles.';
    expect(() => validateAutoScope(consistent,{...left,textOriginal:text,selectedQuote:text,start:0,end:Array.from(text).length},right)).toThrow('AUTO_SCOPE_TOPIC_INVALID');
  });
});
