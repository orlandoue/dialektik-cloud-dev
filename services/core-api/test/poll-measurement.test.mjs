// The poll rule for duels: same pollster, same subject and same round.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { readPoll, comparePolls, pollTitle } = await import('../dist/semantic/poll-measurement.js');
const { parseCsv, judgeDuel, previewMarkdown } = await import('../dist/semantic/poll-preview.cli.js');

const at = (day) => new Date(`2026-11-${String(day).padStart(2, '0')}T12:00:00Z`);
const t = (text, day = 16) => ({ text, publishedAt: at(day) });

test('a poll is recognised with its pollster, subject, round and figure', () => {
  const p = readPoll(t('Aprobación de Kast cae a 27% según Cadem. La encuesta fue levantada entre el 12 y el 14 de noviembre.'));
  assert.equal(p.isPoll, true);
  assert.equal(p.pollster, 'Cadem');
  assert.ok(p.subjects.includes('kast'));
  assert.ok(!p.subjects.includes('cadem'));
  assert.equal(p.figure, 27);
  assert.equal(p.fieldwork, '2026-11-14');
  assert.equal(readPoll(t('Kast inaugura el año legislativo en Valparaíso')).isPoll, false);
  assert.equal(readPoll(t('Sondeo: 6 de cada 10 rechazan la reforma')).isPoll, false, 'no percentage, no pollster');
});

test('same pollster, subject and round: same measurement; a different figure is «Distinta cifra»', () => {
  const cadem = t('Cadem: aprobación de Kast llega a 27%', 16);
  assert.deepEqual(comparePolls(cadem, t('Kast marca 27% de aprobación en la encuesta Cadem', 17)),
    { kind: 'same_measurement', differentFigure: false });
  assert.deepEqual(comparePolls(cadem, t('Cadem: aprobación de Kast sube a 29%', 16)),
    { kind: 'same_measurement', differentFigure: true });
});

test('two different polls are different events', () => {
  const cadem = t('Aprobación de Kast cae a 27% según Cadem', 16);
  assert.deepEqual(comparePolls(cadem, t('Aprobación de Kast cae bajo el 20% según Pulso Ciudadano', 16)),
    { kind: 'different', reason: 'different_pollster' });
  assert.deepEqual(comparePolls(cadem, t('Aprobación de Kast bajo el 20%, según encuesta', 16)),
    { kind: 'different', reason: 'pollster_missing' });
  assert.deepEqual(comparePolls(cadem, t('Cadem: aprobación de Matthei llega a 31%', 16)),
    { kind: 'different', reason: 'different_subject' });
  assert.deepEqual(comparePolls(cadem, t('Aprobación de Kast en 25% según Cadem', 10)),
    { kind: 'different', reason: 'different_round' });
  assert.deepEqual(comparePolls(cadem, t('Kast responde a sus críticos en La Moneda', 16)),
    { kind: 'different', reason: 'poll_and_non_poll' });
  assert.deepEqual(comparePolls(t('Kast viaja a Argentina'), t('Kast se reúne con Milei')), { kind: 'not_poll' });
  // A written fieldwork date wins over publication dates.
  assert.equal(comparePolls(
    t('Cadem: aprobación de Kast 27%, encuesta realizada el 14 de noviembre', 16),
    t('Cadem: aprobación de Kast 27%, encuesta realizada el 7 de noviembre', 16)).kind, 'different');
});

test('a poll event\'s title names its pollster', () => {
  assert.equal(pollTitle('Aprobación de Kast en 27%', 'Cadem'), 'Cadem: Aprobación de Kast en 27%');
  assert.equal(pollTitle('Cadem: aprobación de Kast', 'Cadem'), 'Cadem: aprobación de Kast');
});

test('the dry run reads the Supabase CSV and sorts duels', () => {
  const csv = 'duel_id,event_title,side,outlet,published_at,text_start,quotes\n'
    + 'd1,Aprobación de Kast,A,T13,2026-11-16T10:00:00Z,"Cadem: aprobación de Kast 27%",\n'
    + 'd1,Aprobación de Kast,B,La Tercera,2026-11-16T11:00:00Z,"Aprobación de Kast bajo 20%, según Pulso Ciudadano",\n'
    + 'd2,Kast y la encuesta,A,BioBio,2026-11-16T10:00:00Z,"Cadem: aprobación de Kast 27%",\n'
    + 'd2,Kast y la encuesta,B,Emol,2026-11-16T12:00:00Z,"Kast llega a 29% de aprobación en Cadem","una cita, con ""comillas"""\n'
    + 'd3,Presupuesto,A,Emol,2026-11-16T10:00:00Z,Hacienda presenta el presupuesto,\n'
    + 'd3,Presupuesto,B,T13,2026-11-16T10:00:00Z,La oposición critica el presupuesto,\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 6);
  assert.equal(rows[3].quotes, 'una cita, con "comillas"');
  const md = previewMarkdown(rows);
  assert.match(md, /## Se separarían \(1\)[\s\S]*Aprobación de Kast\*\* — encuestadoras distintas/u);
  assert.match(md, /«Distinta cifra» \(misma medición, cifras distintas\) \(1\)[\s\S]*Kast y la encuesta/u);
  assert.match(md, /No son encuestas: la regla no aplica \(1\)/u);
  assert.equal(judgeDuel({ id: 'x', title: '', a: [], b: [] }).outcome, 'no_aplica');
});
