import type { LLMGeneration, StructuredLLMTransport } from './llm.contracts.js';
import { sha256 } from './llm.schema.js';
import { exactObject } from './llm.grounding.js';
export const AUTHORED_LLM_ARTICLES = [
  {
    title: 'Alder files Harbor case',
    body: 'On 2026-10-01 Agency Alder filed case R-17 in Northport for Harbor Inquiry. This is original authored development text, not a news publisher quotation.',
  },
  {
    title: 'Harbor filing reported by another fixture source',
    body: 'Agency Alder filed case R-17 on 2026-10-01 in Northport, within Harbor Inquiry. Independently authored wording exercises the same bounded filing only.',
  },
  {
    title: 'Harbor hearing follows the filing',
    body: 'On 2026-10-03 Agency Alder held a hearing in case R-17 in Northport for Harbor Inquiry. The hearing is distinct from the filing in these authored fixtures.',
  },
  {
    title: 'Quarry hearing concerns another case',
    body: 'On 2026-10-04 Agency Alder held a hearing in case X-88 in Southport for Quarry Inquiry. This separately authored case exercises a different Thread.',
  },
  {
    title: 'Commentary without a bounded happening',
    body: 'General commentary discusses public administration and policy as topics. This authored text identifies no bounded happening or process.',
  },
  {
    title: 'Harbor update has unresolved identity',
    body: 'On 2026-10-04 Agency Alder described an unresolved step in case R-17 in Northport for Harbor Inquiry. This authored fixture intentionally requires abstention.',
  },
] as const;
/** Deterministic authored CI/development transport. Never claims a Gemini execution. */
export class RecordedProductTransport implements StructuredLLMTransport {
  readonly kind = 'local' as const;
  readonly name = 'recorded-product-v1';
  async generate(
    stage: 'extraction' | 'relation',
    input: unknown,
    _schema: unknown,
    signal: AbortSignal,
  ): Promise<LLMGeneration> {
    await Promise.resolve();
    if (signal.aborted) throw new Error('LLM_ABORTED');
    const value = input as Record<string, unknown>;
    let output: unknown;
    if (stage === 'extraction') {
      if (
        typeof value.body !== 'string' ||
        typeof value.title !== 'string' ||
        !AUTHORED_LLM_ARTICLES.some((a) => a.body === value.body && a.title === value.title)
      )
        throw new Error('RECORDED_FIXTURE_REQUIRED');
      const body = value.body;
      if (body.includes('General commentary'))
        output = {
          status: 'NOT_APPLICABLE',
          boundedOccurrence: false,
          boundedThread: false,
          facts: [],
        };
      else {
        const action = body.includes('unresolved')
          ? 'unresolved'
          : body.includes('filed')
            ? 'filed'
            : 'hearing';
        const facts = [
          ['action', action],
          ['date', /2026-10-[0-9]{2}/.exec(body)?.[0] ?? ''],
          ['external_id', body.includes('R-17') ? 'R-17' : 'X-88'],
          ['process', body.includes('Harbor Inquiry') ? 'Harbor Inquiry' : 'Quarry Inquiry'],
          ['participant', 'Agency Alder'],
          ['location', body.includes('Northport') ? 'Northport' : 'Southport'],
        ].map(([role, text], i) => {
          if (!text) throw new Error('RECORDED_FIXTURE_REQUIRED');
          const index = body.indexOf(text),
            start = Array.from(body.slice(0, index)).length;
          return {
            id: 'f' + String(i),
            role,
            value: text,
            evidence: {
              field: 'body',
              start,
              end: start + Array.from(text).length,
              inputHash: sha256(body),
            },
          };
        });
        output = {
          status: 'OBSERVATION_AVAILABLE',
          boundedOccurrence: true,
          boundedThread: true,
          facts,
        };
      }
    } else {
      const left = exactObject(value.left, ['extraction', 'facts']),
        right = exactObject(value.right, ['extraction', 'facts']);
      if (!Array.isArray(left.facts) || !Array.isArray(right.facts))
        throw new Error('RECORDED_FIXTURE_REQUIRED');
      const get = (facts: unknown[], role: string) =>
        facts.find(
          (f) => f && typeof f === 'object' && (f as Record<string, unknown>).role === role,
        ) as Record<string, unknown> | undefined;
      const equal = (role: string) =>
        get(left.facts as unknown[], role)?.value === get(right.facts as unknown[], role)?.value;
      const support = (facts: unknown[]) => facts.map((f) => (f as Record<string, unknown>).id);
      const uncertain =
        get(left.facts, 'action')?.value === 'unresolved' ||
        get(right.facts, 'action')?.value === 'unresolved';
      const sameProcess = equal('external_id') && equal('process'),
        sameOccurrence = sameProcess && equal('date') && equal('action') && equal('location');
      output = {
        decision: uncertain
          ? 'UNKNOWN'
          : sameOccurrence
            ? 'SAME_OCCURRENCE'
            : sameProcess
              ? 'DIFFERENT_OCCURRENCE_SAME_THREAD'
              : 'DIFFERENT_THREAD',
        occurrence: uncertain ? 'UNKNOWN' : sameOccurrence ? 'SAME' : 'DISTINCT',
        thread: uncertain ? 'UNKNOWN' : sameProcess ? 'SAME' : 'DISTINCT',
        leftFacts: uncertain ? [] : support(left.facts),
        rightFacts: uncertain ? [] : support(right.facts),
      };
    }
    return {
      output,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null, cost: null },
    };
  }
}
