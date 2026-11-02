import { describe, expect, it } from 'vitest';
import { validateJointScope } from '../src/semantic/live-semantic-scope.contract.js';

const left = '📍 En Atacama durante 2026 la inversión del MOP será 115 millones.';
const right = 'En Atacama durante 2026 la inversión del MOP será 130 millones.';
const payload = () => ({
  status: 'ALIGNED', sharedSubject: 'MOP', sharedPeriod: '2026', sharedScope: 'Atacama',
  left: { quotedText:'la inversión del MOP será 115 millones.', subject:'MOP', period:'2026', scope:'Atacama', assertionText:'El MOP invertirá 115 millones.' },
  right:{ quotedText:'la inversión del MOP será 130 millones.', subject:'MOP', period:'2026', scope:'Atacama', assertionText:'El MOP invertirá 130 millones.' },
  relation:'CONTRADICTORY', ratioConflicting:75, ratioComparable:90,
});
describe('joint scope review', () => {
  it('grounds both quotes with Unicode codepoint offsets', () => {
    const v=validateJointScope(payload(),left,right);
    expect(v.scopeAligned).toBe(true);
    expect(Array.from(left).slice(v.left.charStart,v.left.charEnd).join('')).toBe(v.left.quotedText);
  });
  it('rejects a disagreement when geography differs', () => {
    const v=payload(); v.right.scope='Coquimbo y Atacama';
    expect(() => validateJointScope(v,left,right)).toThrow('JOINT_SCOPE_NOT_GROUNDED');
  });
  it('rejects invented or missing dates even if the model declares alignment', () => {
    const v=payload(); v.left.period='2025';v.right.period='2025';v.sharedPeriod='2025';
    expect(() => validateJointScope(v,left,right)).toThrow('JOINT_SCOPE_NOT_GROUNDED');
  });
  it('does not replace an inexact quote with an unrelated sentence', () => {
    const v=payload();v.left.quotedText='MOP invertirá 115 millones';
    expect(() => validateJointScope(v,left,right)).toThrow('JOINT_SCOPE_NOT_GROUNDED');
  });
  it('requires 70 comparability for a conflict', () => {
    const v=payload();v.ratioConflicting=55;v.ratioComparable=69;
    expect(() => validateJointScope(v,left,right)).toThrow('JOINT_RELATION_INVALID');
  });
  it('accepts an explicit not comparable result without promoting it', () => {
    const v=payload();v.status='NOT_ALIGNED';v.relation='NOT_COMPARABLE';v.ratioConflicting=0;v.ratioComparable=0;
    expect(validateJointScope(v,left,right).scopeAligned).toBe(false);
  });
});
