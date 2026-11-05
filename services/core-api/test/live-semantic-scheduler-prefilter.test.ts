import { describe, expect, it } from 'vitest';
import { controversyScore, hasSpecificHeadlineOverlap } from '../src/semantic/live-semantic-scheduler-prefilter.js';
describe('semantic scheduler headline prefilter',()=>{
  it('rejects unrelated events that only share a country and general financial crisis',()=>{
    expect(hasSpecificHeadlineOverlap('Presidente de Paraguay presenta su renuncia en medio de una crisis política y financiera','Crisis financiera en Paraguay: jugadores de la Albirroja alzaron la voz y solidarizan con afectados')).toBe(false);
  });
  it('retains a pair sharing specific event words',()=>{
    expect(hasSpecificHeadlineOverlap('Codelco anuncia despidos en división El Teniente','Trabajadores cuestionan despidos en Codelco El Teniente')).toBe(true);
  });
  it('prioritizes controversies without treating the score as proof of a conflict',()=>{
    expect(controversyScore('Fiscalía denuncia y la defensa rechaza acusación')).toBeGreaterThan(
      controversyScore('Fiscalía informa avance de la investigación'));
    expect(controversyScore('Noticias deportivas')).toBe(0);
  });
});
