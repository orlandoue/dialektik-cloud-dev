// Story proposals from names, words and dates (no AI), on cases of the dry
// run of 19 Nov 2026.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proposeStories, storyNames, storySignature } from '../dist/stories/story-grouping.js';

const event = (id, title, headlines, first, last = first, sources = ['A', 'B']) => ({
  id, title, headlines, sourceIds: sources, firstPublished: new Date(first), lastPublished: new Date(last),
});

const tour = [
  event('E1', 'Presidente Kast inicia viaje a Asia', ['Presidente Kast inició viaje a Asia: Su primera parada es Vietnam',
    'Presidente Kast inicia gira oficial por Asia: las claves y agenda de la visita oficial'], '2026-11-14T13:00Z', '2026-11-15T12:00Z'),
  event('E2', 'Gira por Asia de Presidente Kast en Vietnam', ['Presidente Kast inicia gira por Asia en Vietnam con foco en comercio',
    'Con foco en las relaciones comerciales: Presidente Kast da inicio a su gira por Asia en Vietnam'], '2026-11-15T04:00Z', '2026-11-15T17:00Z'),
  event('E3', 'Presidente Kast llega a Vietnam e inicia su primera gira por Asia', ['Presidente Kast llega a Vietnam e inicia su primera gira por Asia: participará en la APEC en China',
    'Kast llega a China para participar en cumbre APEC y sostener su primera reunión bilateral con Xi Jinping'], '2026-11-16T16:00Z', '2026-11-17T03:00Z'),
];
const slimming = [
  event('S1', 'Agresión a Luis Slimming en Arica', ['Luis Slimming fue agredido en el escenario durante show en Arica',
    'Luis Slimming relata cómo fue ataque que sufrió durante show en Arica'], '2026-11-13T00:30Z', '2026-11-13T11:50Z'),
  event('S2', 'Agresión a Luis Slimming en show en Arica', ['Comediante Luis Slimming sufrió agresión en show en Arica',
    'Luis Slimming y la agresión que sufrió en Arica'], '2026-11-13T01:20Z', '2026-11-13T11:30Z'),
];
const unrelated = [
  event('U1', 'Hombre murió baleado en Recoleta', ['Hombre murió baleado mientras llegaba a visitar a un familiar en Recoleta'], '2026-11-17T11:00Z'),
  event('U2', 'Incendio en Maipú', ['Incendio en Maipú deja una persona fallecida'], '2026-11-15T12:40Z'),
];

test('names are capitalised words inside a phrase, and acronyms', () => {
  const names = storyNames('Kast participa en cumbre APEC: Cerezas, comercio con China');
  assert.ok(names.has('apec') && names.has('china'));
  assert.ok(!names.has('kast'), 'the first word of a phrase is not a name by its capital');
});

test('a tour becomes one story; a repeated note joins; unrelated news stays alone', () => {
  const proposals = proposeStories([...tour, ...slimming, ...unrelated], []);
  const sets = proposals.map((p) => p.eventIds.join(','));
  assert.deepEqual(sets.sort(), ['E1,E2,E3', 'S1,S2']);
  assert.ok(proposals.every((p) => p.targetGroupId === null));
  assert.ok(tour.some((e) => e.title === proposals.find((p) => p.eventIds.length === 3).suggestedTitle));
});

test('far apart in time, the same names do not make one story', () => {
  const later = event('S3', 'Agresión a Luis Slimming en Arica', ['Luis Slimming vuelve a Arica'], '2026-11-20T00:00Z');
  const proposals = proposeStories([slimming[0], later], []);
  assert.equal(proposals.length, 0);
});

test('new coverage of an approved story is proposed as an addition to it', () => {
  const proposals = proposeStories(tour, [{ id: 'G1', eventIds: ['E1', 'E2'] }]);
  assert.deepEqual(proposals.map((p) => [p.targetGroupId, p.eventIds]), [['G1', ['E3']]]);
  // An approved story with nothing new proposes nothing.
  assert.equal(proposeStories(tour.slice(0, 2), [{ id: 'G1', eventIds: ['E1', 'E2'] }]).length, 0);
});

test('a rejected set is not proposed again', () => {
  const rejected = new Set([storySignature(null, ['S1', 'S2'])]);
  assert.equal(proposeStories(slimming, [], rejected).length, 0);
});
