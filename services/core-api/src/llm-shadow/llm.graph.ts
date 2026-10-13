import { present } from './llm.assert.js';
import type {
  ProposedGraph,
  RelationDecision,
  RetrievalCandidate,
  VerifiedExtraction,
} from './llm.contracts.js';
import { sha256 } from './llm.schema.js';
export interface GraphPlacement {
  readonly occurrenceKey: string | null;
  readonly threadKey: string | null;
  readonly decision: 'MATCH' | 'DISTINCT' | 'UNKNOWN';
}
const key = (kind: string, identity: string) => kind + ':' + sha256(identity).slice(0, 24);
/** Only validated decisions enter this deterministic proposal assembler. */
export class DeterministicProposalGraph {
  private readonly members = new Map<
    string,
    { placement: GraphPlacement; extraction: VerifiedExtraction }
  >();
  propose(
    articleId: string,
    extraction: VerifiedExtraction,
    relations: readonly Readonly<{ candidate: RetrievalCandidate; relation: RelationDecision }>[],
  ): GraphPlacement {
    if (this.members.has(articleId) || this.members.size >= 30) throw new Error('LLM_GRAPH_BOUND');
    if (extraction.status !== 'OBSERVATION_AVAILABLE')
      return { occurrenceKey: null, threadKey: null, decision: 'UNKNOWN' };
    const same = relations.filter((r) => r.relation.occurrence === 'SAME');
    const sameOccurrences = new Set(same.map((r) => r.candidate.occurrenceKey));
    const sameThreads = new Set(
      relations
        .filter((r) => r.relation.thread === 'SAME' && r.candidate.threadKey)
        .map((r) => present(r.candidate.threadKey)),
    );
    if (
      sameOccurrences.size > 1 ||
      sameThreads.size > 1 ||
      relations.some(
        (r) =>
          r.relation.decision === 'UNKNOWN' ||
          r.relation.thread === 'UNKNOWN' ||
          r.relation.occurrence === 'UNKNOWN',
      )
    )
      return { occurrenceKey: null, threadKey: null, decision: 'UNKNOWN' };
    if (sameOccurrences.size === 1) {
      const target = present(same[0]).candidate;
      if (sameThreads.size && target.threadKey !== [...sameThreads][0])
        return { occurrenceKey: null, threadKey: null, decision: 'UNKNOWN' };
      return {
        occurrenceKey: target.occurrenceKey,
        threadKey: target.threadKey,
        decision: 'MATCH',
      };
    }
    const threadKey =
      sameThreads.size === 1
        ? present([...sameThreads][0])
        : extraction.boundedThread
          ? key('thread', articleId)
          : null;
    return { occurrenceKey: key('occurrence', articleId), threadKey, decision: 'DISTINCT' };
  }
  accept(articleId: string, placement: GraphPlacement, extraction: VerifiedExtraction): void {
    if (this.members.has(articleId)) throw new Error('LLM_DUPLICATE_ARTICLE');
    this.members.set(articleId, { placement, extraction });
  }
  snapshot(): ProposedGraph {
    const occurrences = new Map<
        string,
        { key: string; threadKey: string | null; articleIds: string[] }
      >(),
      threads = new Map<string, { key: string; occurrenceKeys: string[]; articleIds: string[] }>();
    for (const [id, { placement: p }] of this.members) {
      if (!p.occurrenceKey) continue;
      const o = occurrences.get(p.occurrenceKey) ?? {
        key: p.occurrenceKey,
        threadKey: p.threadKey,
        articleIds: [],
      };
      o.articleIds.push(id);
      occurrences.set(o.key, o);
      if (p.threadKey) {
        const t = threads.get(p.threadKey) ?? {
          key: p.threadKey,
          occurrenceKeys: [],
          articleIds: [],
        };
        t.articleIds.push(id);
        if (!t.occurrenceKeys.includes(o.key)) t.occurrenceKeys.push(o.key);
        threads.set(t.key, t);
      }
    }
    const os = [...occurrences.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((o) => ({
        ...o,
        articleIds: o.articleIds.sort(),
        generationHash: sha256(JSON.stringify(o)),
      }));
    const ts = [...threads.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((t) => ({
        ...t,
        articleIds: t.articleIds.sort(),
        occurrenceKeys: t.occurrenceKeys.sort(),
        generationHash: sha256(JSON.stringify(t)),
      }));
    const hashes: Record<string, string> = {};
    for (const [name, value] of Object.entries({
      article_decisions: [...this.members].map(([id, m]) => ({ id, ...m.placement })),
      occurrence_memberships: os.map((o) => [o.key, o.articleIds]),
      thread_memberships: ts.map((t) => [t.key, t.articleIds]),
      occurrence_generations: os,
      thread_generations: ts,
      candidate_applicability: [],
    }))
      hashes[name] = sha256(JSON.stringify(value));
    return { occurrences: os, threads: ts, streamHashes: hashes };
  }
}
