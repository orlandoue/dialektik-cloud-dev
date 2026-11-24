// The hourly edition of Inicio: fixed rules, same input, same edition.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breakingCase, composeEdition, editionScore, EDITION_RULES } from '../dist/edition/edition-rules.js';

const now = new Date('2026-11-24T15:00:00Z');
const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000);
const ev = (id, outlets, lastH, extra = {}) => ({
  id, category: extra.category ?? 'politica',
  sourceIds: Array.from({ length: outlets }, (_, i) => `${extra.prefix ?? id}-s${i}`),
  firstCoverage: hoursAgo(extra.firstH ?? lastH + 1), lastCoverage: hoursAgo(lastH),
  duelAt: extra.duelH === undefined ? null : hoursAgo(extra.duelH),
});
const pin = (targetId, action, extra = {}) => ({ id: `p-${targetId}-${action}`, targetKind: extra.kind ?? 'event', targetId, action,
  reason: extra.reason ?? 'Motivo de prueba', expiresAt: new Date(now.getTime() + (extra.inH ?? 6) * 3_600_000) });

test('outlets weigh half every 12 hours', () => {
  assert.equal(editionScore(4, now, now), 4);
  assert.equal(editionScore(8, hoursAgo(12), now), 4);
  assert.equal(editionScore(4, hoursAgo(24), now), 1);
});

test('wider and newer first; ties by newest coverage, then id; deterministic', () => {
  const events = [ev('A', 3, 1), ev('B', 6, 1), ev('C', 3, 0.5), ev('D', 3, 1)];
  const order = composeEdition(events, [], [], now).items.map((i) => i.id);
  assert.deepEqual(order, ['B', 'C', 'A', 'D']);
  assert.deepEqual(composeEdition([...events].reverse(), [], [], now).items.map((i) => i.id), order, 'input order does not matter');
});

test('a story is one item: its outlets counted once, its newest case leads', () => {
  const events = [ev('A', 2, 5, { prefix: 'x' }), ev('B', 2, 1, { prefix: 'x' }), ev('C', 3, 1)];
  const items = composeEdition(events, [{ id: 'S1', title: 'Gira', eventIds: ['A', 'B'] }], [], now).items;
  assert.equal(items.length, 2);
  const story = items.find((i) => i.kind === 'story');
  assert.deepEqual(story.event_ids, ['A', 'B']);
  assert.equal(story.outlets, 2, 'same outlets in both cases count once');
  assert.equal(story.lead_event_id, 'B');
});

test('cases without coverage in 72 h leave; at most two of a category in a row', () => {
  const events = [ev('old', 9, 80), ev('p1', 9, 1), ev('p2', 8, 1), ev('p3', 7, 1), ev('e1', 2, 1, { category: 'economia' })];
  const items = composeEdition(events, [], [], now).items;
  assert.ok(!items.some((i) => i.id === 'old'));
  assert.deepEqual(items.map((i) => i.id), ['p1', 'p2', 'e1', 'p3']);
});

test('moderation: pinned first with its reason, hidden out, expired pins ignored', () => {
  const events = [ev('A', 9, 1), ev('B', 2, 1), ev('C', 5, 1), ev('D', 4, 1)];
  const edition = composeEdition(events, [], [
    pin('B', 'pin', { reason: 'Contexto necesario' }), pin('C', 'hide', { reason: 'Duplicado' }), pin('D', 'pin', { inH: -1 }),
  ], now);
  assert.deepEqual(edition.items.map((i) => i.id), ['B', 'A', 'D']);
  assert.equal(edition.items[0].pinned, true);
  assert.equal(edition.items[0].pin_reason, 'Contexto necesario');
  assert.deepEqual(edition.hidden, [{ kind: 'event', id: 'C', reason: 'Duplicado' }]);
});

test('the duel of the day: highest-scoring case with a duel under 36 h; a moderator can choose another', () => {
  const events = [ev('A', 9, 1, { duelH: 40 }), ev('B', 5, 1, { duelH: 3 }), ev('C', 3, 1, { duelH: 2 }), ev('D', 8, 1)];
  const auto = composeEdition(events, [], [], now);
  assert.equal(auto.duel_event_id, 'B', 'A is too old, D has no duel');
  assert.equal(auto.duel_reason, 'score');
  const chosen = composeEdition(events, [], [pin('C', 'duel', { reason: 'Más claro' })], now);
  assert.equal(chosen.duel_event_id, 'C');
  assert.equal(chosen.duel_reason, 'moderation');
  assert.equal(chosen.duel_pin_reason, 'Más claro');
  assert.equal(composeEdition([ev('A', 9, 1)], [], [], now).duel_event_id, null);
});

test('a hidden case cannot be the duel', () => {
  const events = [ev('A', 9, 1, { duelH: 1 }), ev('B', 2, 1, { duelH: 1 })];
  assert.equal(composeEdition(events, [], [pin('A', 'hide')], now).duel_event_id, 'B');
});

test('breaking: four outlets within the hour, outside the top', () => {
  const big = ev('N', EDITION_RULES.breaking.minOutlets, 0.1, { firstH: 0.5 });
  const current = composeEdition([ev('A', 9, 1)], [], [], now);
  assert.equal(breakingCase([ev('A', 9, 1), big], current, now)?.id, 'N');
  assert.equal(breakingCase([big], composeEdition([big], [], [], now), now), null, 'already in the top');
  assert.equal(breakingCase([ev('S', 3, 0.1, { firstH: 0.5 })], current, now), null, 'not wide enough');
  assert.equal(breakingCase([ev('O', 6, 0.1, { firstH: 3 })], current, now), null, 'not new');
});

test('the rules are versioned and say how they order', () => {
  const edition = composeEdition([ev('A', 2, 1)], [], [], now);
  assert.equal(edition.rules_version, 'v1');
  assert.match(edition.rules, /medios.*novedad.*sin IA/u);
});
