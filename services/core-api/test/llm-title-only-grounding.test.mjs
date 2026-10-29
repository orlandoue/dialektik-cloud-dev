import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifyExtraction } from '../dist/llm-shadow/llm.grounding.js';

const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const fact = (id, role, field, source, start, end) => ({
  id,
  role,
  value: Array.from(source).slice(start, end).join(''),
  evidence: { field, start, end, inputHash: hash(source) },
});

test('an absent body allows a grounded title-only observation', () => {
  const title = 'El consejo aprobó la medida el 2026-10-28';
  const points = Array.from(title);
  const actionStart = title.indexOf('aprobó');
  const dateStart = title.indexOf('2026-10-28');
  const result = verifyExtraction(
    {
      status: 'OBSERVATION_AVAILABLE',
      boundedOccurrence: true,
      boundedThread: false,
      facts: [
        fact(
          'f1',
          'action',
          'title',
          title,
          actionStart,
          actionStart + Array.from('aprobó').length,
        ),
        fact('f2', 'date', 'title', title, dateStart, dateStart + 10),
      ],
    },
    { title: points.join(''), body: '' },
  );
  assert.equal(result.status, 'OBSERVATION_AVAILABLE');
  assert.equal(result.facts.length, 2);
  assert.ok(result.facts.every((item) => item.evidence.field === 'title'));
});

test('an absent body permits an honest insufficient-evidence result', () => {
  const result = verifyExtraction(
    {
      status: 'INSUFFICIENT_EVIDENCE',
      boundedOccurrence: false,
      boundedThread: false,
      facts: [],
    },
    { title: 'Titular breve sin fecha explícita', body: '' },
  );
  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
});

test('all of a non-empty body remains forbidden even when split into facts', () => {
  const body = 'aprobó 2026-10-28';
  assert.throws(
    () =>
      verifyExtraction(
        {
          status: 'OBSERVATION_AVAILABLE',
          boundedOccurrence: true,
          boundedThread: false,
          facts: [
            fact('f1', 'action', 'body', body, 0, 7),
            fact('f2', 'date', 'body', body, 7, 17),
          ],
        },
        { title: 'Otro titular', body },
      ),
    /LLM_COMPLETE_BODY_EVIDENCE_FORBIDDEN/,
  );
});
