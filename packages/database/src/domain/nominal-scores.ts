declare const scoreBrand: unique symbol;

type NominalScore<Name extends string> = Readonly<{
  readonly kind: Name;
  readonly value: number;
  readonly [scoreBrand]: Name;
}>;

export type SimilarityScore = NominalScore<'semantic_similarity'>;
export type CandidateScore = NominalScore<'equivalence_candidate_score'>;
export type ClusteringScore = NominalScore<'event_clustering_score'>;
export type ExtractionConfidence = NominalScore<'extraction_confidence'>;
export type EvidenceRelevance = NominalScore<'evidence_relevance'>;

function score<Name extends string>(kind: Name, value: number): NominalScore<Name> {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${kind} must be a finite number in the inclusive range 0..1.`);
  }
  return { kind, value } as NominalScore<Name>;
}

export const nominalScores = {
  similarity: (value: number): SimilarityScore => score('semantic_similarity', value),
  candidate: (value: number): CandidateScore => score('equivalence_candidate_score', value),
  clustering: (value: number): ClusteringScore => score('event_clustering_score', value),
  extraction: (value: number): ExtractionConfidence => score('extraction_confidence', value),
  evidenceRelevance: (value: number): EvidenceRelevance => score('evidence_relevance', value),
} as const;
