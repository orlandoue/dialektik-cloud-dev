import { present } from './llm.assert.js';
import type { RetrievalCandidate, VerifiedExtraction } from './llm.contracts.js';
/** Internal retrieval affinity is never an identity decision or a public score. */
export class BoundedCandidateIndex {
  private readonly candidates = new Map<string, RetrievalCandidate>();
  private readonly postings = new Map<string, Set<string>>();
  add(candidate: RetrievalCandidate): void {
    if (this.candidates.has(candidate.articleId) || this.candidates.size >= 30)
      throw new Error('LLM_INDEX_BOUND');
    this.candidates.set(candidate.articleId, candidate);
    for (const fact of candidate.extraction.facts.filter((f) => f.role !== 'topic')) {
      const key = fact.role + ':' + fact.retrievalHash,
        ids = this.postings.get(key) ?? new Set<string>();
      ids.add(candidate.articleId);
      this.postings.set(key, ids);
    }
  }
  retrieve(
    extraction: VerifiedExtraction,
    availableAt: string,
    articleId: string,
    topK: number,
  ): readonly RetrievalCandidate[] {
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 5) throw new Error('LLM_TOPK_INVALID');
    const scores = new Map<string, number>();
    for (const fact of extraction.facts.filter((f) => f.role !== 'topic'))
      for (const id of this.postings.get(fact.role + ':' + fact.retrievalHash) ?? [])
        scores.set(
          id,
          (scores.get(id) ?? 0) +
            (fact.role === 'external_id' ? 8 : fact.role === 'process' ? 4 : 1),
        );
    return [...scores]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id]) => present(this.candidates.get(id)))
      .filter(
        (c) =>
          Date.parse(c.availableAt) < Date.parse(availableAt) ||
          (Date.parse(c.availableAt) === Date.parse(availableAt) && c.articleId < articleId),
      )
      .slice(0, topK);
  }
  clear(): void {
    this.candidates.clear();
    this.postings.clear();
  }
}
