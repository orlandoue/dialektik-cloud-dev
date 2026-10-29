import { present } from './llm.assert.js';
import { verifyEvidenceLocator } from '../ephemeral/ephemeral.normalization.js';
import {
  FACT_ROLES,
  OBSERVATION_STATUSES,
  RELATION_DECISIONS,
  IDENTITY_OUTCOMES,
  type GroundedFact,
  type VerifiedExtraction,
  type RelationDecision,
} from './llm.contracts.js';
import { sha256 } from './llm.schema.js';
export function exactObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new Error('LLM_SCHEMA_INVALID');
  return raw as Record<string, unknown>;
}
function enumeration<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error('LLM_SCHEMA_INVALID');
  return value as T;
}
export function verifyExtraction(
  raw: unknown,
  input: Readonly<{ title: string; body: string }>,
): VerifiedExtraction {
  const value = exactObject(raw, ['status', 'boundedOccurrence', 'boundedThread', 'facts']);
  const status = enumeration(value.status, OBSERVATION_STATUSES);
  if (
    typeof value.boundedOccurrence !== 'boolean' ||
    typeof value.boundedThread !== 'boolean' ||
    !Array.isArray(value.facts) ||
    value.facts.length > 12
  )
    throw new Error('LLM_SCHEMA_INVALID');
  const facts: GroundedFact[] = value.facts.map((unknownFact): GroundedFact => {
    const fact = exactObject(unknownFact, ['id', 'role', 'value', 'evidence']);
    const evidence = exactObject(fact.evidence, ['field', 'start', 'end', 'inputHash']);
    const field = enumeration(evidence.field, ['title', 'body'] as const),
      role = enumeration(fact.role, FACT_ROLES);
    if (
      typeof fact.id !== 'string' ||
      !/^f[0-9]{1,2}$/.test(fact.id) ||
      typeof fact.value !== 'string' ||
      Array.from(fact.value).length < 1 ||
      Array.from(fact.value).length > 128 ||
      typeof evidence.start !== 'number' ||
      typeof evidence.end !== 'number' ||
      !Number.isSafeInteger(evidence.start) ||
      !Number.isSafeInteger(evidence.end) ||
      typeof evidence.inputHash !== 'string'
    )
      throw new Error('LLM_SCHEMA_INVALID');
    const original = input[field],
      slice = Array.from(original).slice(evidence.start, evidence.end).join('');
    if (
      fact.value !== slice ||
      fact.value === input.body ||
      evidence.inputHash !== sha256(original)
    )
      throw new Error('LLM_EVIDENCE_INVALID');
    const locator = {
      field,
      start: evidence.start,
      end: evidence.end,
      sourceSha256: evidence.inputHash,
      spanSha256: sha256(slice),
    };
    try {
      verifyEvidenceLocator(locator, original);
    } catch {
      throw new Error('LLM_EVIDENCE_INVALID');
    }
    const isoDate =
      (role === 'date' || role === 'end_date') &&
      /^\d{4}-\d{2}-\d{2}$/.test(slice) &&
      Number.isFinite(Date.parse(slice)) &&
      new Date(slice).toISOString().slice(0, 10) === slice
        ? slice
        : null;
    return Object.freeze({
      id: fact.id,
      role,
      valueHash: sha256(slice),
      retrievalHash: sha256(role === 'external_id' ? slice : slice.normalize('NFC').toLowerCase()),
      evidence: Object.freeze(locator),
      isoDate,
    });
  });
  if (new Set(facts.map((f) => f.id)).size !== facts.length) throw new Error('LLM_SCHEMA_INVALID');
  if (
    status !== 'OBSERVATION_AVAILABLE' &&
    (facts.length || value.boundedOccurrence || value.boundedThread)
  )
    throw new Error('LLM_UNSUPPORTED_FACT');
  const roles = new Set(facts.map((f) => f.role));
  if (
    status === 'OBSERVATION_AVAILABLE' &&
    (!value.boundedOccurrence ||
      !roles.has('action') ||
      !(roles.has('date') || roles.has('external_id')))
  )
    throw new Error('LLM_UNBOUNDED_OBSERVATION');
  if (
    value.boundedThread &&
    (!value.boundedOccurrence || !roles.has('process') || !roles.has('external_id'))
  )
    throw new Error('LLM_UNBOUNDED_THREAD');
  const start = facts.find((f) => f.role === 'date')?.isoDate,
    end = facts.find((f) => f.role === 'end_date')?.isoDate;
  const coverage = new Set<number>();
  for (const f of facts.filter((f) => f.evidence.field === 'body'))
    for (let n = f.evidence.start; n < f.evidence.end; n++) coverage.add(n);
  // An absent body is not a fully reproduced body. Title-only callers still
  // need their own rights and execution authorization before reaching here.
  if (input.body.length > 0 && coverage.size === Array.from(input.body).length)
    throw new Error('LLM_COMPLETE_BODY_EVIDENCE_FORBIDDEN');
  if (start && end && start > end) throw new Error('LLM_CHRONOLOGY_INVALID');
  return Object.freeze({
    status,
    boundedOccurrence: value.boundedOccurrence,
    boundedThread: value.boundedThread,
    facts: Object.freeze(facts),
  });
}
function factIds(raw: unknown, facts: readonly GroundedFact[]): readonly string[] {
  if (
    !Array.isArray(raw) ||
    raw.length > 12 ||
    raw.some((x) => typeof x !== 'string' || !facts.some((f) => f.id === x)) ||
    new Set(raw).size !== raw.length
  )
    throw new Error('LLM_RELATION_SUPPORT_INVALID');
  return Object.freeze(raw as string[]);
}
export function verifyRelation(
  raw: unknown,
  left: VerifiedExtraction,
  right: VerifiedExtraction,
): RelationDecision {
  const value = exactObject(raw, ['decision', 'occurrence', 'thread', 'leftFacts', 'rightFacts']);
  const decision = enumeration(value.decision, RELATION_DECISIONS),
    occurrence = enumeration(value.occurrence, IDENTITY_OUTCOMES),
    thread = enumeration(value.thread, IDENTITY_OUTCOMES);
  const leftFacts = factIds(value.leftFacts, left.facts),
    rightFacts = factIds(value.rightFacts, right.facts);
  if (
    (decision === 'SAME_OCCURRENCE' &&
      (occurrence !== 'SAME' || !['SAME', 'UNKNOWN'].includes(thread))) ||
    (decision === 'DIFFERENT_OCCURRENCE_SAME_THREAD' &&
      (occurrence !== 'DISTINCT' || thread !== 'SAME')) ||
    (decision === 'DIFFERENT_THREAD' && (occurrence !== 'DISTINCT' || thread !== 'DISTINCT')) ||
    (decision === 'UNKNOWN' &&
      (!['UNKNOWN', 'DISTINCT'].includes(occurrence) || thread !== 'UNKNOWN')) ||
    (decision === 'NOT_APPLICABLE' &&
      (occurrence !== 'NOT_APPLICABLE' || thread !== 'NOT_APPLICABLE'))
  )
    throw new Error('LLM_RELATION_AXES_INVALID');
  if (
    !['UNKNOWN', 'NOT_APPLICABLE'].includes(decision) &&
    (!leftFacts.length || !rightFacts.length)
  )
    throw new Error('LLM_RELATION_SUPPORT_INVALID');
  const selectedLeft = left.facts.filter((f) => leftFacts.includes(f.id)),
    selectedRight = right.facts.filter((f) => rightFacts.includes(f.id));
  const values = (facts: readonly GroundedFact[], role: string) =>
    facts.filter((f) => f.role === role).map((f) => f.valueHash);
  const intersect = (a: readonly string[], b: readonly string[]) => a.some((x) => b.includes(x));
  if (occurrence === 'SAME') {
    if (
      !left.boundedOccurrence ||
      !right.boundedOccurrence ||
      !values(selectedLeft, 'action').length ||
      !values(selectedRight, 'action').length ||
      !(
        intersect(values(selectedLeft, 'date'), values(selectedRight, 'date')) ||
        intersect(values(selectedLeft, 'external_id'), values(selectedRight, 'external_id'))
      )
    )
      throw new Error('LLM_RELATION_SUPPORT_INVALID');
    const start = (v: VerifiedExtraction) => v.facts.find((f) => f.role === 'date')?.isoDate;
    const end = (v: VerifiedExtraction) =>
      v.facts.find((f) => f.role === 'end_date')?.isoDate ?? start(v);
    if (
      start(left) &&
      start(right) &&
      end(left) &&
      end(right) &&
      (present(end(left)) < present(start(right)) || present(end(right)) < present(start(left)))
    )
      throw new Error('LLM_CHRONOLOGY_INVALID');
    for (const role of ['external_id', 'location']) {
      const a = values(left.facts, role),
        b = values(right.facts, role);
      if (a.length && b.length && !intersect(a, b)) throw new Error('LLM_MATERIAL_CONFLICT');
    }
  }
  if (
    thread === 'SAME' &&
    (!left.boundedThread ||
      !right.boundedThread ||
      !intersect(values(selectedLeft, 'external_id'), values(selectedRight, 'external_id')) ||
      !values(selectedLeft, 'process').length ||
      !values(selectedRight, 'process').length)
  )
    throw new Error('LLM_RELATION_SUPPORT_INVALID');
  return Object.freeze({ decision, occurrence, thread, leftFacts, rightFacts });
}
