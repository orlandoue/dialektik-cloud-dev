import { describe, expect, it } from 'vitest';
import { diversifySemanticPairs, publishedEntityCount, type SemanticCandidatePair } from '../src/semantic/live-semantic-precluster.js';

const pair=(entity:string,n:number,other=''):SemanticCandidatePair => {
  const make=(id:string,headline:string)=>({articleId:id,sourceId:id,publishedAt:new Date('2026-11-04T12:00:00Z'),headline,eventKey:'',eventTitle:headline,eventSummary:''});
  return {left:make(`${n}a`,`${entity} ${other} responde a acusación`),right:make(`${n}b`,`${entity} ${other} anuncia respuesta`),clusterKey:entity};
};
describe('semantic pair diversification',()=>{
  it('chooses a different shared entity before a second Rabat pair',()=>{
    const pairs=[pair('Rabat',1),pair('Fernando',2,'Rabat'),pair('Hermosilla',3)];
    expect(diversifySemanticPairs(pairs,4).map(p=>p.left.articleId)).toEqual(['1a','3a']);
  });
  it('falls back to the next ranked entity when diversity is unavailable',()=>{
    expect(diversifySemanticPairs([pair('Rabat',1),pair('Rabat',2)],4)).toHaveLength(2);
  });
  it('counts existing coverage by shared entity',()=>{
    const titles=['Rabat responde a la acusación','Nuevo debate sobre Rabat','Corte revisa caso Silva'];
    expect(publishedEntityCount(pair('Rabat',1),titles)).toBe(2);
    expect(publishedEntityCount(pair('Hermosilla',2),titles)).toBe(0);
  });
});
