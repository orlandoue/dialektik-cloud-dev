import type {
  AssertionSimilarityInputProvenance,
  AssertionType,
  CandidateClassState,
  createDatabase,
  DatabaseExecutor,
  JsonValue,
  ModerationTaskState,
  RelationConfidence,
  SourceType,
  TemporalScope,
  Ulid,
} from '@dialektik/database';
import { sql } from 'kysely';

import {
  assessEquivalenceReviewCurrentness,
  type EquivalenceReviewCurrentness,
} from './equivalence-review-currentness.js';

export interface EquivalenceReviewQueueItem extends EquivalenceReviewCurrentness {
  readonly taskId: Ulid;
  readonly candidateClassId: Ulid;
  readonly eventId: Ulid;
  readonly eventTitle: string;
  readonly taskState: ModerationTaskState;
  readonly candidateState: CandidateClassState;
  readonly internalPriority: number;
  readonly inputProvenance: AssertionSimilarityInputProvenance;
  readonly createdAt: Date;
  readonly selectedAssertionIds: readonly Ulid[];
  readonly assignedTo: Ulid | null;
}

export interface EquivalenceReviewAssertion {
  readonly assertionId: Ulid;
  readonly assertionType: AssertionType;
  readonly subjectRef: string;
  readonly temporalScope: TemporalScope;
  readonly populationScope: JsonValue | null;
  readonly comparisonBase: string | null;
  readonly quotedText: string;
  readonly normalizedInterpretation: string | null;
  readonly attributionChain: readonly string[];
  readonly articleId: Ulid;
  readonly articleUrl: string;
  readonly articleTitle: string | null;
  readonly articleAuthor: string | null;
  readonly articlePublishedAt: Date | null;
  readonly sourceId: Ulid;
  readonly sourceName: string;
  readonly sourceType: SourceType;
}

export interface EquivalenceReviewPair {
  readonly relationshipId: Ulid;
  readonly assertionAId: Ulid;
  readonly assertionBId: Ulid;
  readonly internalSimilarity: number;
  readonly confidence: RelationConfidence;
}

export interface EquivalenceReviewDetail extends EquivalenceReviewQueueItem {
  readonly assertions: readonly EquivalenceReviewAssertion[];
  readonly proposals: readonly EquivalenceReviewProposal[];
  readonly r01bMatrix: readonly EquivalenceReviewPair[];
}

export interface EquivalenceReviewProposal {
  readonly proposalId: Ulid;
  readonly outcome: 'accept_subset' | 'split';
  readonly state: 'submitted' | 'confirmed' | 'refused';
  readonly proposerId: Ulid;
  readonly submittedAt: Date;
  readonly decidedBy: Ulid | null;
  readonly decidedAt: Date | null;
  readonly decisionReason: string | null;
  readonly members: readonly {
    readonly assertionId: Ulid;
    readonly partitionOrdinal: number | null;
  }[];
}

interface QueueRow {
  readonly taskId: Ulid;
  readonly candidateClassId: Ulid;
  readonly eventId: Ulid;
  readonly eventTitle: string;
  readonly taskState: ModerationTaskState;
  readonly candidateState: CandidateClassState;
  readonly internalPriority: number;
  readonly inputProvenance: AssertionSimilarityInputProvenance;
  readonly createdAt: Date;
  readonly eventMergedInto: Ulid | null;
  readonly assignedTo: Ulid | null;
  readonly phase5RunId: Ulid;
  readonly runEventId: Ulid;
  readonly relationConfidence: RelationConfidence;
}

interface MemberRow {
  readonly candidateClassId: Ulid;
  readonly assertionId: Ulid;
  readonly assertionType: AssertionType;
  readonly subjectRef: string;
  readonly temporalScope: TemporalScope;
  readonly populationScope: JsonValue | null;
  readonly comparisonBase: string | null;
  readonly assertionLifecycleState: 'active' | 'invalidated' | 'withdrawn';
  readonly assertionSuccessorId: Ulid | null;
  readonly spanId: Ulid;
  readonly spanTombstoneId: Ulid | null;
  readonly quotedText: string;
  readonly articleId: Ulid;
  readonly articleEventId: Ulid | null;
  readonly articleUrl: string;
  readonly articleTitle: string | null;
  readonly articleAuthor: string | null;
  readonly articlePublishedAt: Date | null;
  readonly sourceId: Ulid;
  readonly sourceName: string;
  readonly sourceType: SourceType;
}

type DialektikDatabase = ReturnType<typeof createDatabase>;

interface MatrixRow {
  readonly runId: Ulid;
  readonly relationshipId: Ulid;
  readonly relationshipEventId: Ulid;
  readonly relationshipType: 'R01a' | 'R01b' | 'R05' | 'R06' | 'R07' | 'R11a' | 'R11b';
  readonly publicationState: 'proposed' | 'published' | 'rejected';
  readonly scope: 'intra_event' | 'cross_event' | 'intra_article';
  readonly declaredBy: Ulid | null;
  readonly confirmedBy: Ulid | null;
  readonly confirmedAt: Date | null;
  readonly assertionAId: Ulid;
  readonly assertionBId: Ulid;
  readonly roleA: 'source' | 'target' | 'peer';
  readonly roleB: 'source' | 'target' | 'peer';
  readonly internalSimilarity: number | null;
  readonly confidence: RelationConfidence | null;
}

/**
 * Internal persistence adapter only. It is intentionally not a Nest provider
 * and is not reachable from an HTTP controller while OD-12 remains open.
 */
export class EquivalenceReviewRepository {
  private constructor(private readonly database: DatabaseExecutor) {}

  public static list(database: DialektikDatabase): Promise<readonly EquivalenceReviewQueueItem[]> {
    return database
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute((transaction) => new EquivalenceReviewRepository(transaction).listSnapshot());
  }

  public static find(
    database: DialektikDatabase,
    taskId: Ulid,
  ): Promise<EquivalenceReviewDetail | null> {
    return database
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute((transaction) =>
        new EquivalenceReviewRepository(transaction).findInSnapshot(taskId),
      );
  }

  public static findInTransaction(
    database: DatabaseExecutor,
    taskId: Ulid,
  ): Promise<EquivalenceReviewDetail | null> {
    return new EquivalenceReviewRepository(database).findInSnapshot(taskId);
  }

  private async listSnapshot(): Promise<readonly EquivalenceReviewQueueItem[]> {
    const rows = await this.baseTaskQuery()
      .orderBy('task.state', 'asc')
      .orderBy('task.priority', 'desc')
      .orderBy('task.created_at', 'asc')
      .orderBy('task.id', 'asc')
      .execute();

    if (rows.length === 0) return Object.freeze([]);
    const members = await this.loadMembersForCandidates(
      rows.map(({ candidateClassId }) => candidateClassId),
    );
    const membersByCandidate = new Map<Ulid, MemberRow[]>();
    for (const member of members) {
      const candidateMembers = membersByCandidate.get(member.candidateClassId) ?? [];
      candidateMembers.push(member);
      membersByCandidate.set(member.candidateClassId, candidateMembers);
    }
    const currentInterpretationCounts = await this.loadCurrentInterpretationCounts(
      members.map(({ assertionId }) => assertionId),
    );
    const matrixRows = await this.loadMatrixRows([
      ...new Set(rows.map(({ phase5RunId }) => phase5RunId)),
    ]);

    return Object.freeze(
      rows.map((row) =>
        this.toQueueItem(
          row,
          membersByCandidate.get(row.candidateClassId) ?? [],
          currentInterpretationCounts,
          this.phase5ProposalIsValid(
            row,
            membersByCandidate.get(row.candidateClassId) ?? [],
            matrixRows,
          ),
        ),
      ),
    );
  }

  private async findInSnapshot(taskId: Ulid): Promise<EquivalenceReviewDetail | null> {
    const row = await this.baseTaskQuery().where('task.id', '=', taskId).executeTakeFirst();
    if (row === undefined) return null;

    const members = await this.loadMembers(row.candidateClassId);
    const assertionIds = new Set(members.map(({ assertionId }) => assertionId));
    const interpretations = await this.database
      .selectFrom('claim_interpretations')
      .select(['id', 'assertion_id', 'normalized_form', 'supersedes_id'])
      .where('assertion_id', 'in', [...assertionIds])
      .execute();
    const supersededInterpretationIds = new Set(
      interpretations.flatMap(({ supersedes_id: supersedesId }) =>
        supersedesId === null ? [] : [supersedesId],
      ),
    );
    const currentRows = interpretations.filter(({ id }) => !supersededInterpretationIds.has(id));
    const currentInterpretationCounts = this.countInterpretations(currentRows);
    const matrixRows = await this.loadMatrixRows([row.phase5RunId]);
    const queueItem = this.toQueueItem(
      row,
      members,
      currentInterpretationCounts,
      this.phase5ProposalIsValid(row, members, matrixRows),
    );
    const currentInterpretations = new Map<Ulid, string>();
    for (const interpretation of currentRows) {
      if (currentInterpretationCounts.get(interpretation.assertion_id) === 1) {
        currentInterpretations.set(interpretation.assertion_id, interpretation.normalized_form);
      }
    }
    const spanIds = members.map(({ spanId }) => spanId);
    const attributionRows = await this.database
      .selectFrom('attribution_chain')
      .select(['span_id', 'attributor'])
      .where('span_id', 'in', spanIds)
      .orderBy('span_id', 'asc')
      .orderBy('order', 'asc')
      .execute();
    const attributionBySpan = new Map<Ulid, string[]>();
    for (const attribution of attributionRows) {
      const chain = attributionBySpan.get(attribution.span_id) ?? [];
      chain.push(attribution.attributor);
      attributionBySpan.set(attribution.span_id, chain);
    }

    return Object.freeze({
      ...queueItem,
      assertions: Object.freeze(
        members.map((member) =>
          Object.freeze({
            articleId: member.articleId,
            articleUrl: member.articleUrl,
            articleTitle: member.articleTitle,
            articleAuthor: member.articleAuthor,
            articlePublishedAt: member.articlePublishedAt,
            assertionId: member.assertionId,
            assertionType: member.assertionType,
            attributionChain: Object.freeze(attributionBySpan.get(member.spanId) ?? []),
            comparisonBase: member.comparisonBase,
            normalizedInterpretation: currentInterpretations.get(member.assertionId) ?? null,
            populationScope: member.populationScope,
            quotedText: member.quotedText,
            sourceId: member.sourceId,
            sourceName: member.sourceName,
            sourceType: member.sourceType,
            subjectRef: member.subjectRef,
            temporalScope: member.temporalScope,
          }),
        ),
      ),
      proposals: await this.loadProposals(row.taskId),
      r01bMatrix: this.toMatrix(row.phase5RunId, assertionIds, matrixRows),
    });
  }

  private baseTaskQuery() {
    return this.database
      .selectFrom('moderation_tasks as task')
      .innerJoin('candidate_classes as candidate', 'candidate.id', 'task.target_id')
      .leftJoin(
        'moderation_review_proposals as origin_proposal',
        'origin_proposal.id',
        'candidate.origin_proposal_id',
      )
      .leftJoin(
        'assertion_similarity_run_candidate_classes as direct_link',
        'direct_link.candidate_class_id',
        'candidate.id',
      )
      .leftJoin(
        'assertion_similarity_run_candidate_classes as original_link',
        'original_link.candidate_class_id',
        'origin_proposal.candidate_class_id',
      )
      .innerJoin('assertion_similarity_runs as run', (join) =>
        join.on(
          'run.id',
          '=',
          sql<Ulid>`coalesce(${sql.ref('direct_link.run_id')}, ${sql.ref('original_link.run_id')})`,
        ),
      )
      .innerJoin('events as event', 'event.id', 'candidate.event_id')
      .select([
        'task.id as taskId',
        'candidate.id as candidateClassId',
        'event.id as eventId',
        'event.title_descriptive as eventTitle',
        'task.state as taskState',
        'candidate.state as candidateState',
        'task.priority as internalPriority',
        'run.input_provenance as inputProvenance',
        'task.created_at as createdAt',
        'event.merged_into as eventMergedInto',
        'task.assigned_to as assignedTo',
        'run.id as phase5RunId',
        'run.event_id as runEventId',
        'run.relation_confidence as relationConfidence',
      ])
      .where('task.target_type', '=', 'CandidateClass')
      .where('task.task_type', '=', 'equivalence_review');
  }

  private toQueueItem(
    row: QueueRow,
    members: readonly MemberRow[],
    currentInterpretationCounts: ReadonlyMap<Ulid, number>,
    phase5ProposalIsValid: boolean,
  ): EquivalenceReviewQueueItem {
    const memberIds = members.map(({ assertionId }) => assertionId);
    const currentness = assessEquivalenceReviewCurrentness({
      candidateState: row.candidateState,
      eventIsCurrent: row.eventMergedInto === null,
      everyArticleBelongsToEvent: members.every(
        ({ articleEventId }) => articleEventId === row.eventId,
      ),
      everyAssertionIsCurrent: members.every(
        ({ assertionLifecycleState, assertionSuccessorId }) =>
          assertionLifecycleState === 'active' && assertionSuccessorId === null,
      ),
      everyInterpretationIsCurrent:
        memberIds.length > 0 &&
        memberIds.every((assertionId) => currentInterpretationCounts.get(assertionId) === 1),
      everySpanIsCurrent: members.every(({ spanTombstoneId }) => spanTombstoneId === null),
      memberCount: members.length,
      phase5ProposalIsValid,
      taskState: row.taskState,
    });

    return Object.freeze({
      assignedTo: row.assignedTo,
      candidateClassId: row.candidateClassId,
      candidateState: row.candidateState,
      createdAt: row.createdAt,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      inputProvenance: row.inputProvenance,
      internalPriority: row.internalPriority,
      selectedAssertionIds: Object.freeze([]),
      staleReasons: currentness.staleReasons,
      isCurrentSnapshot: currentness.isCurrentSnapshot,
      taskId: row.taskId,
      taskState: row.taskState,
    });
  }

  private async loadMembers(candidateClassId: Ulid): Promise<readonly MemberRow[]> {
    return this.loadMembersForCandidates([candidateClassId]);
  }

  private async loadMembersForCandidates(
    candidateClassIds: readonly Ulid[],
  ): Promise<readonly MemberRow[]> {
    if (candidateClassIds.length === 0) return [];
    const rows = await this.database
      .selectFrom('candidate_class_members as member')
      .innerJoin('assertions as assertion', 'assertion.id', 'member.assertion_id')
      .innerJoin('claim_spans as span', 'span.id', 'assertion.claim_span_id')
      .innerJoin('articles as article', 'article.id', 'span.article_id')
      .innerJoin('sources as source', 'source.id', 'article.source_id')
      .leftJoin('assertions as successor', 'successor.supersedes_id', 'assertion.id')
      .select([
        'member.candidate_class_id as candidateClassId',
        'assertion.id as assertionId',
        'assertion.assertion_type as assertionType',
        'assertion.subject_ref as subjectRef',
        'assertion.temporal_scope as temporalScope',
        'assertion.population_scope as populationScope',
        'assertion.comparison_base as comparisonBase',
        'assertion.lifecycle_state as assertionLifecycleState',
        'successor.id as assertionSuccessorId',
        'span.id as spanId',
        'span.tombstone_id as spanTombstoneId',
        'span.quoted_text as quotedText',
        'article.id as articleId',
        'article.event_id as articleEventId',
        'article.url_canonical as articleUrl',
        'article.published_at as articlePublishedAt',
        sql<string | null>`(
          select version.headline from live_article_versions version
          where version.article_id = article.id
          order by version.version_number desc limit 1
        )`.as('articleTitle'),
        sql<string | null>`(
          select version.author from live_article_versions version
          where version.article_id = article.id
          order by version.version_number desc limit 1
        )`.as('articleAuthor'),
        'source.id as sourceId',
        'source.name as sourceName',
        'source.source_type as sourceType',
      ])
      .where('member.candidate_class_id', 'in', candidateClassIds)
      .orderBy('member.candidate_class_id', 'asc')
      .orderBy('assertion.id', 'asc')
      .execute();
    return rows;
  }

  private async loadCurrentInterpretationCounts(
    assertionIds: readonly Ulid[],
  ): Promise<ReadonlyMap<Ulid, number>> {
    if (assertionIds.length === 0) return new Map();
    const rows = await this.database
      .selectFrom('claim_interpretations')
      .select(['id', 'assertion_id', 'supersedes_id'])
      .where('assertion_id', 'in', assertionIds)
      .execute();
    const supersededIds = new Set(
      rows.flatMap(({ supersedes_id: id }) => (id === null ? [] : [id])),
    );
    return this.countInterpretations(rows.filter(({ id }) => !supersededIds.has(id)));
  }

  private countInterpretations(
    rows: readonly { readonly assertion_id: Ulid }[],
  ): ReadonlyMap<Ulid, number> {
    const counts = new Map<Ulid, number>();
    for (const row of rows) {
      counts.set(row.assertion_id, (counts.get(row.assertion_id) ?? 0) + 1);
    }
    return counts;
  }

  private async loadMatrixRows(runIds: readonly Ulid[]): Promise<readonly MatrixRow[]> {
    if (runIds.length === 0) return [];
    const rows = await this.database
      .selectFrom('assertion_similarity_run_relationships as relationship_link')
      .innerJoin(
        'relationships as relationship',
        'relationship.id',
        'relationship_link.relationship_id',
      )
      .innerJoin('relationship_endpoints as endpoint_a', (join) =>
        join
          .onRef('endpoint_a.relationship_id', '=', 'relationship.id')
          .on('endpoint_a.endpoint_order', '=', 1),
      )
      .innerJoin('relationship_endpoints as endpoint_b', (join) =>
        join
          .onRef('endpoint_b.relationship_id', '=', 'relationship.id')
          .on('endpoint_b.endpoint_order', '=', 2),
      )
      .select([
        'relationship_link.run_id as runId',
        'relationship.id as relationshipId',
        'relationship.event_id as relationshipEventId',
        'relationship.rel_type as relationshipType',
        'relationship.publication_state as publicationState',
        'relationship.scope',
        'relationship.declared_by as declaredBy',
        'relationship.confirmed_by as confirmedBy',
        'relationship.confirmed_at as confirmedAt',
        'endpoint_a.assertion_id as assertionAId',
        'endpoint_b.assertion_id as assertionBId',
        'endpoint_a.role as roleA',
        'endpoint_b.role as roleB',
        'relationship.similarity_score as internalSimilarity',
        'relationship.confidence',
      ])
      .where('relationship_link.run_id', 'in', runIds)
      .orderBy('endpoint_a.assertion_id', 'asc')
      .orderBy('endpoint_b.assertion_id', 'asc')
      .execute();
    return rows;
  }

  private phase5ProposalIsValid(
    row: QueueRow,
    members: readonly MemberRow[],
    matrixRows: readonly MatrixRow[],
  ): boolean {
    if (row.runEventId !== row.eventId || members.length < 2) return false;
    const memberIds = new Set(members.map(({ assertionId }) => assertionId));
    const expectedPairs = new Set<string>();
    const orderedIds = [...memberIds].sort();
    for (let leftIndex = 0; leftIndex < orderedIds.length; leftIndex += 1) {
      const leftId = orderedIds[leftIndex];
      if (leftId === undefined) return false;
      for (let rightIndex = leftIndex + 1; rightIndex < orderedIds.length; rightIndex += 1) {
        const rightId = orderedIds[rightIndex];
        if (rightId === undefined) return false;
        expectedPairs.add(`${leftId}:${rightId}`);
      }
    }
    const actualPairs = new Set<string>();
    for (const matrixRow of matrixRows) {
      if (
        matrixRow.runId !== row.phase5RunId ||
        !memberIds.has(matrixRow.assertionAId) ||
        !memberIds.has(matrixRow.assertionBId)
      ) {
        continue;
      }
      const orderedPair = [matrixRow.assertionAId, matrixRow.assertionBId].sort();
      const leftId = orderedPair[0];
      const rightId = orderedPair[1];
      if (
        leftId === undefined ||
        rightId === undefined ||
        leftId === rightId ||
        matrixRow.relationshipType !== 'R01b' ||
        matrixRow.publicationState !== 'proposed' ||
        matrixRow.relationshipEventId !== row.eventId ||
        matrixRow.scope !== 'intra_event' ||
        matrixRow.declaredBy !== null ||
        matrixRow.confirmedBy !== null ||
        matrixRow.confirmedAt !== null ||
        matrixRow.roleA !== 'peer' ||
        matrixRow.roleB !== 'peer' ||
        matrixRow.internalSimilarity === null ||
        matrixRow.confidence !== row.relationConfidence
      ) {
        return false;
      }
      const key = `${leftId}:${rightId}`;
      if (actualPairs.has(key)) return false;
      actualPairs.add(key);
    }
    return (
      actualPairs.size === expectedPairs.size &&
      [...expectedPairs].every((pair) => actualPairs.has(pair))
    );
  }

  private toMatrix(
    runId: Ulid,
    assertionIds: ReadonlySet<Ulid>,
    rows: readonly MatrixRow[],
  ): readonly EquivalenceReviewPair[] {
    return Object.freeze(
      rows.flatMap((row) =>
        row.runId !== runId ||
        row.relationshipType !== 'R01b' ||
        row.internalSimilarity === null ||
        row.confidence === null ||
        !assertionIds.has(row.assertionAId) ||
        !assertionIds.has(row.assertionBId)
          ? []
          : [
              Object.freeze({
                ...row,
                confidence: row.confidence,
                internalSimilarity: row.internalSimilarity,
              }),
            ],
      ),
    );
  }

  private async loadProposals(taskId: Ulid): Promise<readonly EquivalenceReviewProposal[]> {
    const proposals = await this.database
      .selectFrom('moderation_review_proposals')
      .select([
        'id as proposalId',
        'outcome',
        'state',
        'proposer_id as proposerId',
        'submitted_at as submittedAt',
        'decided_by as decidedBy',
        'decided_at as decidedAt',
        'decision_reason as decisionReason',
      ])
      .where('task_id', '=', taskId)
      .orderBy('submitted_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    if (proposals.length === 0) return Object.freeze([]);
    const proposalIds = proposals.map(({ proposalId }) => proposalId);
    const members = await this.database
      .selectFrom('moderation_review_proposal_members')
      .select([
        'proposal_id as proposalId',
        'assertion_id as assertionId',
        'partition_ordinal as partitionOrdinal',
      ])
      .where('proposal_id', 'in', proposalIds)
      .orderBy('proposal_id', 'asc')
      .orderBy('partition_ordinal', 'asc')
      .orderBy('assertion_id', 'asc')
      .execute();
    return Object.freeze(
      proposals.map((proposal) =>
        Object.freeze({
          ...proposal,
          members: Object.freeze(
            members
              .filter(({ proposalId }) => proposalId === proposal.proposalId)
              .map(({ assertionId, partitionOrdinal }) =>
                Object.freeze({ assertionId, partitionOrdinal }),
              ),
          ),
        }),
      ),
    );
  }
}
