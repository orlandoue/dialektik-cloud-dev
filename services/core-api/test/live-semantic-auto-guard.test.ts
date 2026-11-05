import { describe, expect, it } from 'vitest';
import { validateAutoScope } from '../src/semantic/live-semantic-auto-guard.js';

const left = { sourceId: 'a', textOriginal: 'En Atacama durante 2026 el MOP invertirá 115 millones.', selectedQuote: 'el MOP invertirá 115 millones.', publishedAt: new Date('2026-11-04T00:00:00Z'), category: 'politica' };
const right = { sourceId: 'b', textOriginal: 'En Atacama durante 2026 el MOP invertirá 130 millones.', selectedQuote: 'el MOP invertirá 130 millones.', publishedAt: new Date('2026-11-04T12:00:00Z'), category: 'politica' };
const aligned = () => ({ status:'ALIGNED', sharedSubject:'MOP', sharedPeriod:'2026', sharedScope:'Atacama',
  left:{quotedText:left.selectedQuote,subject:'MOP',period:'2026',scope:'Atacama',assertionText:left.selectedQuote},
  right:{quotedText:right.selectedQuote,subject:'MOP',period:'2026',scope:'Atacama',assertionText:right.selectedQuote},
  relation:'CONTRADICTORY',ratioConflicting:75,ratioComparable:90 });

describe('automatic publication guard', () => {
  it('accepts current matching quotes, sources, scope and category', () => {
    expect(validateAutoScope(aligned(),left,right).scopeAligned).toBe(true);
  });
  it('rejects scope changes and quotes different from the selected provenance', () => {
    const wrongScope=aligned(); wrongScope.right.scope='Coquimbo';
    expect(() => validateAutoScope(wrongScope,left,right)).toThrow();
    expect(() => validateAutoScope(aligned(),{...left,selectedQuote:'MOP invertirá 115 millones.'},right)).toThrow('AUTO_SCOPE_PROVENANCE_INVALID');
  });
  it('rejects different categories, the same source and stale windows', () => {
    expect(() => validateAutoScope(aligned(),left,{...right,category:'deportes'})).toThrow('AUTO_SCOPE_CATEGORY_INVALID');
    expect(() => validateAutoScope(aligned(),left,{...right,sourceId:'a'})).toThrow('AUTO_SCOPE_SOURCES_INVALID');
    expect(() => validateAutoScope(aligned(),left,{...right,publishedAt:new Date('2026-11-08T00:00:00Z')})).toThrow('AUTO_SCOPE_WINDOW_INVALID');
  });
});
