import { createHash } from 'node:crypto';
import {
  inAuditedTransaction,
  parseUlid,
  setTransactionAuditContext,
  type Database,
  type Ulid,
} from '@dialektik/database';
import { ConflictException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type {
  EventThread,
  Occurrence,
  OccurrenceState,
  SemanticApplicability,
  SemanticArticle,
  SemanticDecisionStatus,
  SemanticMembership,
  SemanticObservation,
  SemanticProvenance,
  SemanticRelation,
  SemanticSource,
  SemanticStateTransition,
  ThreadDetail,
  ThreadTimeline,
} from './semantic.contracts.js';
import { semanticFixtureId } from './semantic.fixtures.js';
import { canonicalSemanticJson, requireSemanticValue } from './semantic.validation.js';

interface StateRow {
  state_id: string;
  revision: number;
  previous_state_id: string | null;
  description: string;
  decision: SemanticDecisionStatus;
  applicability: SemanticApplicability;
  observed_at: Date;
}
type ThreadRow = StateRow & {
  id: string;
  title: string;
  summary: string;
  mode: 'fixture';
  occurrence_count: number;
  article_count: number;
  source_count: number;
  first_observed: Date;
  last_observed: Date;
};
type OccurrenceRow = StateRow & {
  id: string;
  title: string;
  event_id: string;
  thread_id: string;
  thread_title: string;
  event_at: Date | null;
};
interface ArticleRow {
  article_id: string;
  article_title: string;
  published_at: Date;
  source_id: string;
  source_name: string;
  canonical_domain: string;
  decision: SemanticDecisionStatus;
  applicability: SemanticApplicability;
}
type MembershipRow = ArticleRow & {
  observation_id: string;
  occurrence_id: string;
  thread_id: string;
  observed_at: Date;
};
type ProvenanceRow = MembershipRow & {
  provenance_id: string;
  provider: string;
  provider_version: string;
  rationale: string;
  span_id: string | null;
  assertion_id: string | null;
};
function state(row: StateRow): OccurrenceState {
  return {
    id: row.state_id,
    revision: row.revision,
    previousStateId: row.previous_state_id,
    description: row.description,
    decision: row.decision,
    applicability: row.applicability,
    observedAt: row.observed_at.toISOString(),
  };
}
function source(row: ArticleRow): SemanticSource {
  return { id: row.source_id, name: row.source_name, canonicalDomain: row.canonical_domain };
}
function article(row: ArticleRow): SemanticArticle {
  return {
    id: row.article_id,
    title: row.article_title,
    publishedAt: row.published_at.toISOString(),
    source: source(row),
    decision: row.decision,
    applicability: row.applicability,
  };
}
function membership(row: MembershipRow): SemanticMembership {
  return {
    observationId: row.observation_id,
    articleId: row.article_id,
    occurrenceId: row.occurrence_id,
    threadId: row.thread_id,
    decision: row.decision,
    applicability: row.applicability,
    observedAt: row.observed_at.toISOString(),
  };
}
function provenance(row: ProvenanceRow): SemanticProvenance {
  return {
    id: row.provenance_id,
    article: article(row),
    provider: row.provider,
    providerVersion: row.provider_version,
    rationale: row.rationale,
    observedAt: row.observed_at.toISOString(),
    spanId: row.span_id,
    assertionId: row.assertion_id,
  };
}
function uniqueSources(articles: readonly SemanticArticle[]): SemanticSource[] {
  return [...new Map(articles.map((item) => [item.source.id, item.source])).values()].sort(
    (left, right) => left.name.localeCompare(right.name),
  );
}

export class SemanticRepository {
  constructor(readonly database: Kysely<Database>) {}

  async appendObservation(observation: SemanticObservation): Promise<boolean> {
    const hash = createHash('sha256').update(canonicalSemanticJson(observation)).digest('hex');
    return inAuditedTransaction(
      this.database,
      {
        action: 'created',
        actorId: null,
        actorType: 'system',
        correlationId: observation.id,
        reasonCode: 'synthetic_product_semantic_shadow',
      },
      async (transaction) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${'shadow-observation:' + observation.provider + ':' + observation.providerVersion + ':' + observation.idempotencyKey}, 0))`.execute(
          transaction,
        );
        const replay = await transaction
          .selectFrom('semantic_observations')
          .select(['id', 'payload_hash'])
          .where((expression) =>
            expression.or([
              expression('id', '=', observation.id),
              expression.and([
                expression('provider', '=', 'fixture'),
                expression('provider_version', '=', observation.providerVersion),
                expression('idempotency_key', '=', observation.idempotencyKey),
              ]),
            ]),
          )
          .executeTakeFirst();
        if (replay !== undefined) {
          if (replay.payload_hash !== hash || replay.id !== observation.id) {
            throw new ConflictException(
              'Observation identity was already used for different content.',
            );
          }
          return false;
        }
        await sql`select pg_advisory_xact_lock(hashtextextended(${'shadow-thread:' + observation.threadId}, 0))`.execute(
          transaction,
        );
        const input = await transaction
          .selectFrom('articles')
          .selectAll()
          .where('id', '=', observation.articleId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('semantic_event_threads')
          .values({
            id: observation.threadId,
            title: observation.threadTitle,
            summary: observation.threadSummary,
            mode: 'fixture',
            created_at: observation.observedAt,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .execute();
        const thread = await transaction
          .selectFrom('semantic_event_threads')
          .selectAll()
          .where('id', '=', observation.threadId)
          .executeTakeFirstOrThrow();
        if (
          thread.title !== observation.threadTitle ||
          thread.summary !== observation.threadSummary
        ) {
          throw new ConflictException('Thread identity has incompatible immutable metadata.');
        }
        const eventId = semanticFixtureId('event-for-' + observation.occurrenceId);
        const existingOccurrence = await transaction
          .selectFrom('semantic_occurrences')
          .selectAll()
          .where('id', '=', observation.occurrenceId)
          .executeTakeFirst();
        if (existingOccurrence === undefined) {
          await transaction
            .insertInto('events')
            .values({
              id: eventId,
              title_descriptive: observation.occurrenceTitle,
              category_id: semanticFixtureId('category'),
              window_from: observation.eventAt ?? observation.observedAt,
              window_to: null,
              detected_at: observation.observedAt,
              analysis_state: 'ANALYSIS_PENDING',
              merged_into: null,
              merged_by: null,
              merged_at: null,
            })
            .execute();
          await transaction
            .insertInto('semantic_occurrences')
            .values({
              id: observation.occurrenceId,
              event_id: eventId,
              thread_id: observation.threadId,
              title: observation.occurrenceTitle,
              event_at: observation.eventAt,
              created_at: observation.observedAt,
            })
            .execute();
        } else if (
          existingOccurrence.thread_id !== observation.threadId ||
          existingOccurrence.title !== observation.occurrenceTitle ||
          (existingOccurrence.event_at?.toISOString() ?? null) !== observation.eventAt
        ) {
          throw new ConflictException('Occurrence identity has incompatible immutable metadata.');
        }
        const base = {
          article_id: observation.articleId,
          occurrence_id: observation.occurrenceId,
          thread_id: observation.threadId,
          decision: observation.occurrenceState.decision,
          applicability: observation.occurrenceState.applicability,
          observed_at: observation.observedAt,
        };
        await transaction
          .insertInto('semantic_observations')
          .values({
            ...base,
            id: observation.id,
            provider: 'fixture',
            provider_version: observation.providerVersion,
            idempotency_key: observation.idempotencyKey,
            payload_hash: hash,
            rationale: observation.rationale,
          })
          .execute();
        await transaction
          .insertInto('semantic_memberships')
          .values({
            ...base,
            id: semanticFixtureId('membership-' + observation.id),
            observation_id: observation.id,
          })
          .execute();
        await transaction
          .insertInto('semantic_provenance')
          .values({
            id: semanticFixtureId('provenance-' + observation.id),
            observation_id: observation.id,
            article_id: observation.articleId,
            source_id: input.source_id,
            span_id: null,
            assertion_id: null,
          })
          .execute();
        const previousOccurrence = await transaction
          .selectFrom('semantic_occurrence_states')
          .select(['id', 'revision'])
          .where('occurrence_id', '=', observation.occurrenceId)
          .orderBy('revision', 'desc')
          .executeTakeFirst();
        const previousThread = await transaction
          .selectFrom('semantic_thread_states')
          .select(['id', 'revision'])
          .where('thread_id', '=', observation.threadId)
          .orderBy('revision', 'desc')
          .executeTakeFirst();
        const occurrenceStateId = semanticFixtureId('occurrence-state-' + observation.id);
        const threadStateId = semanticFixtureId('thread-state-' + observation.id);
        await transaction
          .insertInto('semantic_occurrence_states')
          .values({
            id: occurrenceStateId,
            occurrence_id: observation.occurrenceId,
            revision: (previousOccurrence?.revision ?? 0) + 1,
            previous_state_id: previousOccurrence?.id ?? null,
            ...observation.occurrenceState,
            observation_id: observation.id,
            observed_at: observation.observedAt,
          })
          .execute();
        await transaction
          .insertInto('semantic_thread_states')
          .values({
            id: threadStateId,
            thread_id: observation.threadId,
            revision: (previousThread?.revision ?? 0) + 1,
            previous_state_id: previousThread?.id ?? null,
            ...observation.threadState,
            observation_id: observation.id,
            observed_at: observation.observedAt,
          })
          .execute();
        await transaction
          .insertInto('semantic_state_transitions')
          .values([
            {
              id: semanticFixtureId('occurrence-transition-' + observation.id),
              entity_kind: 'occurrence',
              occurrence_state_id: occurrenceStateId,
              thread_state_id: null,
              observation_id: observation.id,
              observed_at: observation.observedAt,
            },
            {
              id: semanticFixtureId('thread-transition-' + observation.id),
              entity_kind: 'thread',
              occurrence_state_id: null,
              thread_state_id: threadStateId,
              observation_id: observation.id,
              observed_at: observation.observedAt,
            },
          ])
          .execute();
        if (observation.relation !== null) {
          await transaction
            .insertInto('semantic_relations')
            .values({
              id: semanticFixtureId('relation-' + observation.id),
              observation_id: observation.id,
              from_occurrence_id: observation.occurrenceId,
              to_occurrence_id: observation.relation.targetOccurrenceId,
              decision: observation.relation.decision,
              applicability: observation.relation.applicability,
            })
            .execute();
        }
        if (base.decision === 'MATCH' && base.applicability === 'APPLICABLE') {
          if (input.event_id !== null && input.event_id !== eventId) {
            throw new ConflictException('Fixture Article already belongs to a different Event.');
          }
          await setTransactionAuditContext(transaction, {
            action: 'membership_changed',
            actorId: null,
            actorType: 'system',
            correlationId: observation.id,
            reasonCode: 'synthetic_product_semantic_membership',
          });
          await transaction
            .updateTable('articles')
            .set({ event_id: eventId })
            .where('id', '=', observation.articleId)
            .execute();
        }
        return true;
      },
    );
  }

  async safeArticle(id: Ulid) {
    return this.database
      .selectFrom('articles')
      .select(['id', 'url_canonical', 'text_original'])
      .where('id', '=', id)
      .executeTakeFirst();
  }
  async listThreads(after?: string, limit = 50): Promise<EventThread[]> {
    const rows = await sql<ThreadRow>`
      with page as (
        select * from semantic_event_threads where id > ${after ?? ''}::text order by id limit ${limit + 1}
      ), current_memberships as (
        select distinct on (article_id) * from semantic_memberships
        order by article_id, observed_at desc, id desc
      )
      select t.*, st.id as state_id, st.revision, st.previous_state_id, st.description,
        st.decision, st.applicability, st.observed_at,
        oc.occurrence_count, membership_counts.article_count, membership_counts.source_count,
        observations.first_observed, observations.last_observed
      from page t
      join lateral (select * from semantic_thread_states where thread_id = t.id order by revision desc limit 1) st on true
      join lateral (select count(*)::int as occurrence_count from semantic_occurrences where thread_id = t.id) oc on true
      join lateral (select min(observed_at) as first_observed, max(observed_at) as last_observed
        from semantic_observations where thread_id = t.id) observations on true
      join lateral (select count(distinct m.article_id)::int as article_count, count(distinct a.source_id)::int as source_count
        from current_memberships m join articles a on a.id = m.article_id where m.thread_id = t.id) membership_counts on true
      order by t.id
    `.execute(this.database);
    return rows.rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      mode: row.mode,
      state: state(row),
      occurrenceCount: row.occurrence_count,
      articleCount: row.article_count,
      sourceCount: row.source_count,
      firstObserved: row.first_observed.toISOString(),
      lastObserved: row.last_observed.toISOString(),
    }));
  }

  async threadSnapshot(
    id: Ulid,
  ): Promise<{ detail: ThreadDetail; timeline: ThreadTimeline } | undefined> {
    // One repeatable-read snapshot, fixed query count independent of the Occurrence count.
    return this.database
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (transaction) => {
        const thread = await transaction
          .selectFrom('semantic_event_threads')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (thread === undefined) return undefined;
        const threadState = await transaction
          .selectFrom('semantic_thread_states')
          .selectAll()
          .where('thread_id', '=', id)
          .orderBy('revision', 'desc')
          .executeTakeFirstOrThrow();
        const occurrences = (
          await sql<OccurrenceRow>`
        select oc.*, t.title as thread_title, st.id as state_id, st.revision, st.previous_state_id,
          st.description, st.decision, st.applicability, st.observed_at
        from semantic_occurrences oc join semantic_event_threads t on t.id = oc.thread_id
        join lateral (select * from semantic_occurrence_states where occurrence_id = oc.id order by revision desc limit 1) st on true
        where oc.thread_id = ${id} order by oc.event_at, oc.id
      `.execute(transaction)
        ).rows;
        const memberships = (
          await sql<MembershipRow & { is_current: boolean }>`
        select m.*, not exists (
          select 1 from semantic_memberships newer where newer.article_id = m.article_id
          and (newer.observed_at, newer.id) > (m.observed_at, m.id)
        ) as is_current, split_part(a.text_original, E'\\n', 1) as article_title,
          a.published_at, s.id as source_id, s.name as source_name, s.canonical_domain
        from semantic_memberships m join articles a on a.id = m.article_id join sources s on s.id = a.source_id
        where m.thread_id = ${id} order by m.observed_at, m.id
      `.execute(transaction)
        ).rows;
        const provenanceRows = (
          await sql<ProvenanceRow>`
        select o.*, p.id as provenance_id, p.span_id, p.assertion_id,
          split_part(a.text_original, E'\\n', 1) as article_title, a.published_at,
          s.id as source_id, s.name as source_name, s.canonical_domain
        from semantic_provenance p join semantic_observations o on o.id = p.observation_id
        join articles a on a.id = p.article_id join sources s on s.id = p.source_id
        where o.thread_id = ${id} order by o.observed_at, p.id
      `.execute(transaction)
        ).rows;
        interface RelationRow {
          id: string;
          from_occurrence_id: string;
          to_occurrence_id: string;
          from_title: string;
          to_title: string;
          decision: SemanticDecisionStatus;
          applicability: SemanticApplicability;
          provenance_id: string;
        }
        const relations: SemanticRelation[] = (
          await sql<RelationRow>`
        select distinct on (r.from_occurrence_id, r.to_occurrence_id) r.*, f.title as from_title,
          t.title as to_title, p.id as provenance_id
        from semantic_relations r join semantic_occurrences f on f.id = r.from_occurrence_id
        join semantic_occurrences t on t.id = r.to_occurrence_id
        join semantic_observations o on o.id = r.observation_id
        join semantic_provenance p on p.observation_id = o.id
        where f.thread_id = ${id} or t.thread_id = ${id}
        order by r.from_occurrence_id, r.to_occurrence_id, o.observed_at desc, o.id desc
      `.execute(transaction)
        ).rows.map((row) => ({
          id: row.id,
          fromOccurrenceId: row.from_occurrence_id,
          toOccurrenceId: row.to_occurrence_id,
          fromTitle: row.from_title,
          toTitle: row.to_title,
          decision: row.decision,
          applicability: row.applicability,
          provenanceId: row.provenance_id,
        }));
        interface TransitionRow {
          id: string;
          entity_kind: 'occurrence' | 'thread';
          occurrence_id: string | null;
          observed_at: Date;
          provenance_id: string;
          description: string;
          decision: SemanticDecisionStatus;
          applicability: SemanticApplicability;
          previous_description: string | null;
          previous_decision: SemanticDecisionStatus | null;
          previous_applicability: SemanticApplicability | null;
        }
        const transitions: SemanticStateTransition[] = (
          await sql<TransitionRow>`
        select tr.id, tr.entity_kind, co.occurrence_id, tr.observed_at, p.id as provenance_id,
          coalesce(co.description, ct.description) as description,
          coalesce(co.decision, ct.decision) as decision, coalesce(co.applicability, ct.applicability) as applicability,
          coalesce(po.description, pt.description) as previous_description,
          coalesce(po.decision, pt.decision) as previous_decision,
          coalesce(po.applicability, pt.applicability) as previous_applicability
        from semantic_state_transitions tr join semantic_observations o on o.id = tr.observation_id
        join semantic_provenance p on p.observation_id = o.id
        left join semantic_occurrence_states co on co.id = tr.occurrence_state_id
        left join semantic_thread_states ct on ct.id = tr.thread_state_id
        left join semantic_occurrence_states po on po.id = co.previous_state_id
        left join semantic_thread_states pt on pt.id = ct.previous_state_id
        where o.thread_id = ${id} order by tr.observed_at, tr.entity_kind, tr.id
      `.execute(transaction)
        ).rows.map((row) => ({
          id: row.id,
          entityKind: row.entity_kind,
          occurrenceId: row.occurrence_id,
          previousState:
            row.previous_description === null
              ? null
              : {
                  description: row.previous_description,
                  decision: requireSemanticValue(row.previous_decision),
                  applicability: requireSemanticValue(row.previous_applicability),
                },
          newState: {
            description: row.description,
            decision: row.decision,
            applicability: row.applicability,
          },
          observedAt: row.observed_at.toISOString(),
          provenanceId: row.provenance_id,
        }));
        const current = memberships.filter((row) => row.is_current);
        const occurrenceDtos: Occurrence[] = occurrences.map((row) => {
          const articles = current.filter((item) => item.occurrence_id === row.id).map(article);
          const sources = uniqueSources(articles);
          return {
            id: row.id,
            eventId: row.event_id,
            threadId: row.thread_id,
            threadTitle: row.thread_title,
            title: row.title,
            eventAt: row.event_at?.toISOString() ?? null,
            state: state(row),
            articleCount: articles.length,
            sourceCount: sources.length,
            articles,
            sources,
            provenance: provenanceRows
              .filter((item) => item.occurrence_id === row.id)
              .map(provenance),
            relations: relations.filter(
              (item) => item.fromOccurrenceId === row.id || item.toOccurrenceId === row.id,
            ),
          };
        });
        const first = memberships[0];
        const last = memberships.at(-1);
        if (first === undefined || last === undefined)
          throw new Error('Incomplete semantic Thread.');
        const detail: ThreadDetail = {
          id: thread.id,
          title: thread.title,
          summary: thread.summary,
          mode: 'fixture',
          state: state({ ...threadState, state_id: threadState.id }),
          occurrenceCount: occurrenceDtos.length,
          articleCount: current.length,
          sourceCount: uniqueSources(current.map(article)).length,
          firstObserved: first.observed_at.toISOString(),
          lastObserved: last.observed_at.toISOString(),
          occurrences: occurrenceDtos,
          sources: uniqueSources(current.map(article)),
          relations,
        };
        return {
          detail,
          timeline: {
            occurrences: occurrenceDtos,
            arrivals: memberships.map(membership),
            transitions,
          },
        };
      });
  }
  async occurrenceThread(id: Ulid): Promise<Ulid | undefined> {
    return (
      await this.database
        .selectFrom('semantic_occurrences')
        .select('thread_id')
        .where('id', '=', id)
        .executeTakeFirst()
    )?.thread_id;
  }
  async articleContext(id: Ulid): Promise<SemanticMembership[]> {
    return (
      await this.database
        .selectFrom('semantic_memberships')
        .selectAll()
        .where('article_id', '=', id)
        .orderBy('observed_at')
        .orderBy('id')
        .execute()
    ).map((row) =>
      membership({
        ...row,
        source_id: '',
        source_name: '',
        canonical_domain: '',
        article_title: '',
        published_at: row.observed_at,
      }),
    );
  }
  async articleDetail(id: Ulid) {
    const row = await this.database
      .selectFrom('articles as a')
      .innerJoin('sources as s', 's.id', 'a.source_id')
      .select([
        'a.id',
        'a.text_original',
        'a.published_at',
        's.id as source_id',
        's.name',
        's.canonical_domain',
      ])
      .where('a.id', '=', id)
      .where('a.id', 'in', (expression) =>
        expression.selectFrom('semantic_memberships').select('article_id'),
      )
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          id: row.id,
          title: requireSemanticValue(row.text_original.split('\n')[0]),
          originalText: row.text_original,
          publishedAt: row.published_at.toISOString(),
          source: { id: row.source_id, name: row.name, canonicalDomain: row.canonical_domain },
          memberships: await this.articleContext(parseUlid(row.id)),
        };
  }
  async getProvenance(id: Ulid): Promise<SemanticProvenance | undefined> {
    const row = (
      await sql<ProvenanceRow>`
      select o.*, p.id as provenance_id, p.span_id, p.assertion_id,
        split_part(a.text_original, E'\\n', 1) as article_title, a.published_at,
        s.id as source_id, s.name as source_name, s.canonical_domain
      from semantic_provenance p join semantic_observations o on o.id = p.observation_id
      join articles a on a.id = p.article_id join sources s on s.id = p.source_id where p.id = ${id}
    `.execute(this.database)
    ).rows[0];
    return row === undefined ? undefined : provenance(row);
  }
}
