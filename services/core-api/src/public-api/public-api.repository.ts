import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';
import type { PageCursor } from './public-api.validation.js';

export interface FeedRow {
  readonly id: string;
  readonly title_descriptive: string;
  readonly category: string;
  readonly detected_at: Date;
  readonly analysis_state: 'ANALYSIS_PENDING' | 'PUBLISHED';
  readonly source_count: number;
  readonly position_count: number;
  readonly representation_updated_at: Date;
  readonly synthesis_relation?: 'CONTRADICTION' | 'DIFFERENT_FOCUS' | 'DEVELOPING' | 'TREND' | null;
  readonly is_followed_source_match?: boolean;
}

export interface EventRow extends FeedRow {
  readonly window_from: Date;
  readonly window_to: Date | null;
  readonly merged_into: string | null;
  readonly merged_at: Date | null;
  readonly successor_title: string | null;
}

export interface PrimaryFactRow {
  readonly statement: string;
  readonly primary_publication_url: string;
  readonly primary_source_id: string;
  readonly primary_source_name: string;
}

export interface PositionListRow {
  readonly id: string;
  readonly ordinal: number;
  readonly total: number;
  readonly neutral_rank: number;
  readonly title_text: string;
  readonly published_at: Date;
  readonly assertion_count: number;
  readonly formed_by_count: number;
  readonly has_reviewed_single_claim: boolean;
  readonly evidence_absence: 'no_evidence_yet' | 'inconclusive' | null;
  readonly representation_updated_at: Date;
}

export interface PositionStateRow {
  readonly id: string;
  readonly event_id: string;
  readonly publication_state: 'internal' | 'published' | 'superseded';
  readonly status: 'active' | 'merged' | 'split' | 'withdrawn';
  readonly tombstone_id: string | null;
}

export interface PublicAssertionRow {
  readonly assertion_id: string;
  readonly assertion_ordinal: number;
  readonly is_principal: boolean;
  readonly epistemic_class: 'not_evaluable' | null;
  readonly epistemic_reason: string | null;
  readonly span_id: string;
  readonly quoted_text: string;
  readonly location: 'headline' | 'lede' | 'body' | 'caption';
  readonly captured_at: Date;
  readonly text_offset_start: number;
  readonly text_offset_end: number;
  readonly article_id: string;
  readonly url_canonical: string;
  readonly article_published_at: Date;
  readonly source_id: string;
  readonly source_name: string;
  readonly source_type: string;
}

export interface EventCoverageRow {
  readonly position_id: string; readonly position_title: string;
  readonly assertion_id: string; readonly assertion_text: string; readonly quoted_text: string;
  readonly article_id: string; readonly article_title: string; readonly url: string;
  readonly published_at: Date; readonly source_name: string; readonly source_id: string;
  readonly article_text: string;
}

export interface AttributionRow {
  readonly span_id: string;
  readonly order: number;
  readonly attributor: string;
  readonly attributor_type: string;
}

export interface FormedByRow {
  readonly relationship_id: string;
  readonly confirmed_at: Date;
}

export interface RelationshipRow {
  readonly id: string;
  readonly rel_type: 'R01a' | 'R05' | 'R06' | 'R07' | 'R11a' | 'R11b';
  readonly scope: 'intra_event' | 'cross_event' | 'intra_article';
  readonly non_comparable_reason: string | null;
  readonly triggering_evidence_id: string | null;
  readonly rectified_by: 'SOURCE' | 'MODERATION' | null;
  readonly confirmed_at: Date;
}

export interface RelationshipEndpointRow {
  readonly relationship_id: string;
  readonly assertion_id: string;
  readonly role: 'peer' | 'source' | 'target';
  readonly endpoint_order: number;
}

export interface ContradictionRow {
  readonly is_followed_source_match?: boolean;
  readonly id: string;
  readonly event_id: string;
  readonly event_title: string;
  readonly position_a_id: string;
  readonly position_a_ordinal: number;
  readonly position_a_title: string;
  readonly position_b_id: string;
  readonly position_b_ordinal: number;
  readonly position_b_title: string;
  readonly ratio_conflicting: number;
  readonly ratio_comparable: number;
  readonly threshold_rule: string;
  readonly confirmed_at: Date;
  readonly needs_review: boolean;
}

export interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly source_type: string;
  readonly created_at: Date;
}

export interface PositionTombstoneRow {
  readonly operation: 'split' | 'merge' | 'absorbed';
  readonly reason: string;
  readonly occurred_at: Date;
}

export interface PositionSuccessorRow {
  readonly id: string;
  readonly title: string;
  readonly ordinal: number;
}

/** A single-claim position is public only through the signed editorial promotion path. */
function reviewedSingleClaim(positionId: string, eventId: string) {
  return sql`exists (
    select 1 from public.live_semantic_promotion_claims promoted_claim
    join public.live_semantic_promotion_positions promoted_position
      on promoted_position.group_id=promoted_claim.group_id
      and promoted_position.position_id=promoted_claim.position_id
      and promoted_position.event_id=${sql.ref(eventId)}
    join public.live_semantic_editorial_decisions decision
      on decision.group_id=promoted_claim.group_id and decision.decision='APPROVED'
      and decision.editor_user_id=promoted_position.editor_user_id
      and decision.selected_claims @> jsonb_build_array(jsonb_build_object(
        'articleId',promoted_claim.article_id::text,'ordinal',promoted_claim.claim_ordinal))
    join public.assertions selected_assertion on selected_assertion.id=promoted_claim.assertion_id
      and selected_assertion.position_id=promoted_claim.position_id
      and selected_assertion.claim_span_id=promoted_claim.claim_span_id
      and selected_assertion.lifecycle_state='active' and selected_assertion.is_principal
    join public.claim_spans selected_span on selected_span.id=promoted_claim.claim_span_id
      and selected_span.article_id=promoted_claim.article_id and selected_span.tombstone_id is null
    join public.articles source_article on source_article.id=promoted_claim.article_id
      and source_article.event_id=${sql.ref(eventId)} and source_article.origin='LIVE_REAL'
    join public.evidence selected_evidence on selected_evidence.id=promoted_claim.evidence_id
      and selected_evidence.scope_assertion_id=selected_assertion.id
      and selected_evidence.anchor_span_id=selected_span.id
      and selected_evidence.publication_state='published'
      and selected_evidence.approved_by=decision.editor_user_id
      and selected_evidence.approved_at is not null
      and selected_evidence.citable_source_url=source_article.url_canonical
    join lateral (select policy.* from public.live_source_policies policy
      where policy.source_id=source_article.source_id order by policy.recorded_at desc,policy.id desc limit 1) current_policy
      on current_policy.active and current_policy.rights_class='LIVE_READY'
      and current_policy.policy->>'rightsReviewStatus'='APPROVED'
      and nullif(current_policy.policy->>'authorizationReference','') is not null
      and nullif(current_policy.policy->>'rightsEvidenceUrl','') is not null
      and nullif(current_policy.policy->>'endpoint','') is not null
      and current_policy.policy->>'rightsEvidenceUrl' not in ('https://supabase.com','[https://supabase.com](https://supabase.com)')
      and current_policy.policy->>'endpoint' not in ('https://supabase.com','[https://supabase.com](https://supabase.com)')
    where promoted_claim.position_id=${sql.ref(positionId)}
      and exists(select 1 from public.live_acquisition_receipts receipt
        where receipt.exclusion_id=source_article.live_exposure_id
          and receipt.source_id=source_article.source_id and receipt.disposition='PERSISTED')
      and coalesce((select case when jsonb_typeof(policy.policy->'quarantinedArticleIds')='array'
          then not (policy.policy->'quarantinedArticleIds' @> jsonb_build_array(source_article.id::text))
          else false end from public.live_source_policies policy
        where policy.source_id=source_article.source_id and policy.policy ? 'quarantinedArticleIds'
        order by policy.recorded_at desc,policy.id desc limit 1),true)
      and not exists(select 1 from public.assertions successor where successor.supersedes_id=selected_assertion.id)
      and (select count(*) from public.assertions current_assertion
        where current_assertion.position_id=promoted_claim.position_id and current_assertion.lifecycle_state='active'
          and not exists(select 1 from public.assertions successor where successor.supersedes_id=current_assertion.id))=1
  )`;
}

/**
 * Publication gate for public Event list AND direct detail/position routes.
 * A bare PUBLISHED database flag is not evidence. All visible active
 * Positions need either confirmed R01a formation or a signed single-claim
 * promotion, plus active, non-superseded source-backed evidence.
 * ANALYSIS_PENDING is permitted only with an authentic linked Article.
 */
const groundedEvent = sql`
  not exists (
    select 1 from public.editorial_event_splits editorial_split
    where editorial_split.original_event_id = event_row.id
  )
  and exists (
    select 1 from articles grounded_article
    where grounded_article.event_id = event_row.id
      and grounded_article.origin = 'LIVE_REAL'
  )
  and (
    event_row.analysis_state = 'ANALYSIS_PENDING'
    or (
      event_row.analysis_state = 'PUBLISHED'
      and exists (
        select 1 from positions grounded_position
        where grounded_position.event_id = event_row.id
          and grounded_position.publication_state = 'published'
          and grounded_position.status = 'active'
      )
      and not exists (
        select 1 from positions invalid_position
        where invalid_position.event_id = event_row.id
          and invalid_position.publication_state = 'published'
          and invalid_position.status = 'active'
          and (
            invalid_position.neutral_rank is null
            or invalid_position.published_at is null
            or invalid_position.published_by is null
            or (not exists (
              select 1 from position_formed_by formation
              join relationships formed_relation
                on formed_relation.id = formation.relationship_id
              where formation.position_id = invalid_position.id
                and formed_relation.rel_type = 'R01a'
                and formed_relation.publication_state = 'published'
                and formed_relation.declared_by is not null
                and formed_relation.confirmed_by is not null
                and formed_relation.confirmed_at is not null
            ) and not ${reviewedSingleClaim('invalid_position.id', 'event_row.id')})
            or not exists (
              select 1 from assertions grounded_assertion
              join claim_spans grounded_span
                on grounded_span.id = grounded_assertion.claim_span_id
              join articles grounded_source_article
                on grounded_source_article.id = grounded_span.article_id
              where grounded_assertion.position_id = invalid_position.id
                and grounded_assertion.lifecycle_state = 'active'
                and grounded_span.tombstone_id is null
                and grounded_source_article.event_id = event_row.id
                and not exists (
                  select 1 from assertions successor
                  where successor.supersedes_id = grounded_assertion.id
                )
                and exists (
                  select 1 from evidence approved_evidence
                  where approved_evidence.scope_assertion_id = grounded_assertion.id
                    and approved_evidence.publication_state = 'published'
                    and approved_evidence.approved_at is not null
                )
            )
          )
      )
    )
  )
`;

@Injectable()
export class PublicApiRepository {
  public constructor(
    @Inject(CoreDatabaseService)
    private readonly databaseService: CoreDatabaseService,
  ) {}

  public async listFeed(input: {
    readonly category?: string;
    readonly topic?: string;
    readonly cursor: PageCursor | null;
    readonly limit: number;
    readonly followedSourceIds?: readonly string[];
    readonly blindspots?: boolean;
  }): Promise<readonly FeedRow[]> {
    const categoryClause =
      input.category === undefined ? sql`` : sql`and category_row.slug = ${input.category}`;
    const topicClause =
      input.topic === undefined
        ? sql``
        : sql`and exists (
            select 1
            from event_topics event_topic
            join topics topic_row on topic_row.id = event_topic.topic_id
            where event_topic.event_id = event_row.id
              and event_topic.valid_to is null
              and topic_row.status = 'active'
              and topic_row.canonical_slug = ${input.topic}
          )`;
    const follows = input.followedSourceIds;
    const match = follows === undefined ? sql`false` : sql`exists(select 1 from public.articles followed_article
      where followed_article.event_id=event_row.id and followed_article.origin='LIVE_REAL'
        and followed_article.source_id::text=any(${follows}::text[]))`;
    const cursorMatch = input.cursor === null || follows === undefined ? sql`false` : sql`exists(select 1 from public.articles followed_cursor
      where followed_cursor.event_id=${input.cursor.id}::dialektik_ulid and followed_cursor.origin='LIVE_REAL'
        and followed_cursor.source_id::text=any(${follows}::text[]))`;
    const cursorClause = input.cursor === null ? sql`` : follows === undefined
      ? sql`and (event_row.detected_at,event_row.id)<(${input.cursor.timestamp},${input.cursor.id}::dialektik_ulid)`
      : sql`and ((${match})::int,event_row.detected_at,event_row.id)<((${cursorMatch})::int,${input.cursor.timestamp},${input.cursor.id}::dialektik_ulid)`;
    const blindspotClause = !input.blindspots ? sql`` : sql`and event_row.analysis_state='PUBLISHED' and not (${match})
      and ((select count(distinct a.source_id) from public.articles a where a.event_id=event_row.id and a.origin='LIVE_REAL') >= 2
        or exists(select 1 from public.contradiction_publications c where c.event_id=event_row.id
          and c.publication_state='published' and c.confirmed_at is not null and c.confirmed_by is not null))`;
    const result = await sql<FeedRow>`
      select
        event_row.id,
        event_row.title_descriptive,
        category_row.slug as category,
        event_row.detected_at,
        event_row.analysis_state,
        event_row.synthesis_relation,
        ${match} as is_followed_source_match,
        (
          select count(distinct article_row.source_id)::integer
          from articles article_row
          where article_row.event_id = event_row.id
        ) as source_count,
        (
          select count(*)::integer
          from positions position_row
          where position_row.event_id = event_row.id
            and position_row.publication_state = 'published'
            and position_row.status = 'active'
        ) as position_count,
        greatest(
          event_row.detected_at,
          coalesce(event_row.synthesis_relation_updated_at, event_row.detected_at),
          coalesce((
            select max(article_row.captured_at)
            from articles article_row
            where article_row.event_id = event_row.id
          ), event_row.detected_at),
          coalesce((
            select max(position_row.published_at)
            from positions position_row
            where position_row.event_id = event_row.id
              and position_row.publication_state = 'published'
              and position_row.status = 'active'
          ), event_row.detected_at)
        ) as representation_updated_at
      from events event_row
      join categories category_row on category_row.id = event_row.category_id
      where event_row.merged_into is null
        and category_row.is_active
        -- Fail closed: a published Event without a published active Position
        -- cannot be represented by eventCard(). Never expose it in the feed.
        and ${groundedEvent}
        ${categoryClause}
        ${topicClause}
        ${blindspotClause}
        ${cursorClause}
      order by ${follows === undefined ? sql`` : sql`(${match})::int desc,`} event_row.detected_at desc, event_row.id desc
      limit ${input.limit + 1}
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async eventHasFollowedSources(eventId: string, followedSourceIds: readonly string[]): Promise<boolean> {
    if (followedSourceIds.length === 0) return false;
    const result = await sql<{matched:boolean}>`select exists(select 1 from public.articles a
      where a.event_id=${eventId}::dialektik_ulid and a.origin='LIVE_REAL'
        and a.source_id::text=any(${followedSourceIds}::text[])) as matched`.execute(this.databaseService.database);
    return result.rows[0]?.matched === true;
  }

  public async countBlindspots(followedSourceIds: readonly string[]): Promise<number> {
    if (followedSourceIds.length === 0) return 0;
    const result = await sql<{count:number}>`select count(*)::int as count from events event_row
      join categories category_row on category_row.id=event_row.category_id
      where event_row.merged_into is null and category_row.is_active and event_row.analysis_state='PUBLISHED'
        and ${groundedEvent}
        and not exists(select 1 from public.articles a where a.event_id=event_row.id and a.origin='LIVE_REAL'
          and a.source_id::text=any(${followedSourceIds}::text[]))
        and ((select count(distinct a.source_id) from public.articles a where a.event_id=event_row.id and a.origin='LIVE_REAL') >= 2
          or exists(select 1 from public.contradiction_publications c where c.event_id=event_row.id
            and c.publication_state='published' and c.confirmed_at is not null and c.confirmed_by is not null))`.execute(this.databaseService.database);
    return result.rows[0]?.count ?? 0;
  }

  public async findEvent(id: string): Promise<EventRow | undefined> {
    const result = await sql<EventRow>`
      select
        event_row.id,
        event_row.title_descriptive,
        category_row.slug as category,
        event_row.detected_at,
        event_row.analysis_state,
        event_row.synthesis_relation,
        event_row.window_from,
        event_row.window_to,
        event_row.merged_into,
        event_row.merged_at,
        successor.title_descriptive as successor_title,
        (
          select count(distinct article_row.source_id)::integer
          from articles article_row
          where article_row.event_id = event_row.id
        ) as source_count,
        (
          select count(*)::integer
          from positions position_row
          where position_row.event_id = event_row.id
            and position_row.publication_state = 'published'
            and position_row.status = 'active'
        ) as position_count,
        greatest(
          event_row.detected_at,
          coalesce(event_row.synthesis_relation_updated_at, event_row.detected_at),
          coalesce(event_row.merged_at, event_row.detected_at),
          coalesce((
            select max(article_row.captured_at)
            from articles article_row
            where article_row.event_id = event_row.id
          ), event_row.detected_at),
          coalesce((
            select max(position_row.published_at)
            from positions position_row
            where position_row.event_id = event_row.id
              and position_row.publication_state = 'published'
              and position_row.status = 'active'
          ), event_row.detected_at)
        ) as representation_updated_at
      from events event_row
      join categories category_row on category_row.id = event_row.category_id
      left join events successor on successor.id = event_row.merged_into
      where event_row.id = ${id}::dialektik_ulid
        and ${groundedEvent}
    `.execute(this.databaseService.database);
    return result.rows[0];
  }

  public async findPrimaryFacts(eventId: string): Promise<readonly PrimaryFactRow[]> {
    const result = await sql<PrimaryFactRow>`
      select
        primary_fact.statement,
        primary_fact.primary_publication_url,
        source_row.id as primary_source_id,
        source_row.name as primary_source_name
      from primary_facts primary_fact
      join sources source_row on source_row.id = primary_fact.primary_source_id
      where primary_fact.event_id = ${eventId}::dialektik_ulid
      order by primary_fact.id
      limit 2
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async listPositions(eventId: string): Promise<readonly PositionListRow[]> {
    const result = await sql<PositionListRow>`
      select
        position_row.id,
        row_number() over (
          order by position_row.neutral_rank asc, position_row.id asc
        )::integer as ordinal,
        count(*) over ()::integer as total,
        position_row.neutral_rank,
        position_row.title_text,
        position_row.published_at,
        (
          select count(*)::integer
          from assertions assertion_row
          join claim_spans span_row on span_row.id = assertion_row.claim_span_id
          where assertion_row.position_id = position_row.id
            and assertion_row.lifecycle_state = 'active'
            and span_row.tombstone_id is null
            and not exists (
              select 1 from assertions successor
              where successor.supersedes_id = assertion_row.id
            )
        ) as assertion_count,
        (
          select count(*)::integer
          from position_formed_by formation
          where formation.position_id = position_row.id
        ) as formed_by_count,
        ${reviewedSingleClaim('position_row.id', 'position_row.event_id')} as has_reviewed_single_claim,
        evidence_absence.evidence_absence,
        greatest(
          position_row.published_at,
          coalesce((
            select max(relationship_row.confirmed_at)
            from position_formed_by formation
            join relationships relationship_row on relationship_row.id = formation.relationship_id
            where formation.position_id = position_row.id
          ), position_row.published_at),
          coalesce((
            select max(evidence_row.approved_at)
            from assertions assertion_row
            join evidence evidence_row on evidence_row.scope_assertion_id = assertion_row.id
            where assertion_row.position_id = position_row.id
              and evidence_row.publication_state = 'published'
          ), position_row.published_at),
          coalesce((
            select max(assessment.confirmed_at)
            from assertions assertion_row
            join evidence_assessments assessment on assessment.assertion_id = assertion_row.id
            where assertion_row.position_id = position_row.id
          ), position_row.published_at)
        ) as representation_updated_at
      from positions position_row
      left join position_evidence_absence evidence_absence
        on evidence_absence.position_id = position_row.id
      where position_row.event_id = ${eventId}::dialektik_ulid
        and position_row.publication_state = 'published'
        and position_row.status = 'active'
      order by position_row.neutral_rank asc, position_row.id asc
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async findPositionState(id: string): Promise<PositionStateRow | undefined> {
    const result = await sql<PositionStateRow>`
      select id, event_id, publication_state, status, tombstone_id
      from positions
      where id = ${id}::dialektik_ulid
    `.execute(this.databaseService.database);
    return result.rows[0];
  }

  public async findPositionTombstone(id: string): Promise<PositionTombstoneRow | undefined> {
    const result = await sql<PositionTombstoneRow>`
      select operation, reason, occurred_at
      from position_tombstones
      where position_id = ${id}::dialektik_ulid
    `.execute(this.databaseService.database);
    return result.rows[0];
  }

  public async listPositionSuccessors(id: string): Promise<readonly PositionSuccessorRow[]> {
    const result = await sql<PositionSuccessorRow>`
      select successor.id, successor.title_text as title, link.ordinal
      from position_tombstones tombstone
      join position_tombstone_successors link on link.tombstone_id = tombstone.id
      join positions successor on successor.id = link.successor_position_id
      where tombstone.position_id = ${id}::dialektik_ulid
      order by link.ordinal
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async listEventCoverage(eventId: string): Promise<readonly EventCoverageRow[]> {
    const result = await sql<EventCoverageRow>`
      select p.id::text as position_id,p.title_text as position_title,a.id::text as assertion_id,
        ev.summary as assertion_text,span.quoted_text,article.id::text as article_id,
        version.headline as article_title,article.url_canonical as url,
        article.published_at,source.name as source_name,source.id::text as source_id,
        article.text_original as article_text
      from public.positions p
      join public.assertions a on a.position_id=p.id and a.lifecycle_state='active'
        and not exists(select 1 from public.assertions successor where successor.supersedes_id=a.id)
      join public.claim_spans span on span.id=a.claim_span_id and span.tombstone_id is null
      join public.articles article on article.id=span.article_id and article.event_id=p.event_id and article.origin='LIVE_REAL'
      join public.sources source on source.id=article.source_id and source.origin='LIVE_REAL'
      join lateral (select v.* from public.live_article_versions v where v.article_id=article.id order by v.version_number desc limit 1) version on true
      join lateral (select policy.* from public.live_source_policies policy where policy.source_id=article.source_id
        order by policy.recorded_at desc,policy.id desc limit 1) policy on policy.active and policy.rights_class='LIVE_READY'
        and policy.policy->>'rightsReviewStatus'='APPROVED' and nullif(policy.policy->>'authorizationReference','') is not null
        and nullif(policy.policy->>'rightsEvidenceUrl','') is not null and nullif(policy.policy->>'endpoint','') is not null
        and policy.policy->>'rightsEvidenceUrl' not in ('https://supabase.com','[https://supabase.com](https://supabase.com)')
        and policy.policy->>'endpoint' not in ('https://supabase.com','[https://supabase.com](https://supabase.com)')
      join lateral (select evidence.* from public.evidence evidence
        where evidence.scope_assertion_id=a.id and evidence.anchor_span_id=span.id and evidence.publication_state='published'
          and evidence.approved_by is not null and evidence.approved_at is not null
          and evidence.citable_source_url=article.url_canonical
          and not exists(select 1 from public.evidence next where next.supersedes_id=evidence.id)
        order by evidence.approved_at desc,evidence.id desc limit 1) ev on true
      where p.event_id=${eventId}::dialektik_ulid and p.publication_state='published' and p.status='active'
        and exists(select 1 from public.live_acquisition_receipts receipt where receipt.source_id=article.source_id
          and receipt.exclusion_id=article.live_exposure_id and receipt.disposition='PERSISTED')
        and coalesce((select case when jsonb_typeof(q.policy->'quarantinedArticleIds')='array'
          then not (q.policy->'quarantinedArticleIds' @> jsonb_build_array(article.id::text)) else false end
          from public.live_source_policies q where q.source_id=article.source_id and q.policy ? 'quarantinedArticleIds'
          order by q.recorded_at desc,q.id desc limit 1),true)
      order by p.neutral_rank,source.name,article.id,a.id` .execute(this.databaseService.database);
    return result.rows;
  }

  public async listEventArticles(eventId: string): Promise<readonly Pick<EventCoverageRow, 'article_id' | 'article_title' | 'source_name' | 'source_id' | 'published_at' | 'url'>[]> {
    const result = await sql<Pick<EventCoverageRow, 'article_id' | 'article_title' | 'source_name' | 'source_id' | 'published_at' | 'url'>>`
      select article.id::text as article_id, version.headline as article_title,
        source.name as source_name, source.id::text as source_id, article.published_at, article.url_canonical as url
      from public.articles article
      join public.sources source on source.id=article.source_id and source.origin='LIVE_REAL'
      join lateral (select v.* from public.live_article_versions v where v.article_id=article.id order by v.version_number desc limit 1) version on true
      join lateral (select p.* from public.live_source_policies p where p.source_id=article.source_id
        order by p.recorded_at desc,p.id desc limit 1) policy on policy.active and policy.rights_class='LIVE_READY'
        and policy.policy->>'rightsReviewStatus'='APPROVED' and nullif(policy.policy->>'authorizationReference','') is not null
        and nullif(policy.policy->>'rightsEvidenceUrl','') is not null and nullif(policy.policy->>'endpoint','') is not null
        and policy.policy->>'rightsEvidenceUrl' not in ('https://supabase.com','[https://supabase.com](https://supabase.com)')
        and policy.policy->>'endpoint' not in ('https://supabase.com','[https://supabase.com](https://supabase.com)')
      where article.event_id=${eventId}::dialektik_ulid and article.origin='LIVE_REAL'
        and exists(select 1 from public.live_acquisition_receipts r where r.source_id=article.source_id
          and r.exclusion_id=article.live_exposure_id and r.disposition='PERSISTED')
        and coalesce((select case when jsonb_typeof(q.policy->'quarantinedArticleIds')='array'
          then not (q.policy->'quarantinedArticleIds' @> jsonb_build_array(article.id::text)) else false end
          from public.live_source_policies q where q.source_id=article.source_id and q.policy ? 'quarantinedArticleIds'
          order by q.recorded_at desc,q.id desc limit 1),true)
      order by article.published_at desc,article.id`.execute(this.databaseService.database);
    return result.rows;
  }

  public async listPositionAssertions(positionId: string): Promise<readonly PublicAssertionRow[]> {
    const result = await sql<PublicAssertionRow>`
      select
        assertion_row.id as assertion_id,
        assertion_row.ordinal as assertion_ordinal,
        assertion_row.is_principal,
        assertion_row.epistemic_class,
        assertion_row.epistemic_reason,
        span_row.id as span_id,
        span_row.quoted_text,
        span_row.location,
        span_row.captured_at,
        span_row.text_offset_start,
        span_row.text_offset_end,
        article_row.id as article_id,
        article_row.url_canonical,
        article_row.published_at as article_published_at,
        source_row.id as source_id,
        source_row.name as source_name,
        source_row.source_type
      from assertions assertion_row
      join claim_spans span_row on span_row.id = assertion_row.claim_span_id
      join articles article_row on article_row.id = span_row.article_id
      join sources source_row on source_row.id = article_row.source_id
      where assertion_row.position_id = ${positionId}::dialektik_ulid
        and assertion_row.lifecycle_state = 'active'
        and span_row.tombstone_id is null
        and not exists (
          select 1 from assertions successor
          where successor.supersedes_id = assertion_row.id
        )
      order by span_row.captured_at asc, span_row.id asc, assertion_row.ordinal asc,
        assertion_row.id asc
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async listUnclusteredAssertions(eventId: string): Promise<readonly PublicAssertionRow[]> {
    const result = await sql<PublicAssertionRow>`
      select
        assertion_row.id as assertion_id,
        assertion_row.ordinal as assertion_ordinal,
        assertion_row.is_principal,
        assertion_row.epistemic_class,
        assertion_row.epistemic_reason,
        span_row.id as span_id,
        span_row.quoted_text,
        span_row.location,
        span_row.captured_at,
        span_row.text_offset_start,
        span_row.text_offset_end,
        article_row.id as article_id,
        article_row.url_canonical,
        article_row.published_at as article_published_at,
        source_row.id as source_id,
        source_row.name as source_name,
        source_row.source_type
      from assertions assertion_row
      join claim_spans span_row on span_row.id = assertion_row.claim_span_id
      join articles article_row on article_row.id = span_row.article_id
      join sources source_row on source_row.id = article_row.source_id
      where article_row.event_id = ${eventId}::dialektik_ulid
        and assertion_row.position_id is null
        and assertion_row.lifecycle_state = 'active'
        and span_row.tombstone_id is null
        and not exists (
          select 1 from assertions successor
          where successor.supersedes_id = assertion_row.id
        )
      order by span_row.captured_at asc, span_row.id asc, assertion_row.ordinal asc,
        assertion_row.id asc
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async listAttributions(spanIds: readonly string[]): Promise<readonly AttributionRow[]> {
    if (spanIds.length === 0) return [];
    const result = await sql<AttributionRow>`
      select span_id, "order", attributor, attributor_type
      from attribution_chain
      where span_id in (${sql.join(spanIds.map((id) => sql`${id}::dialektik_ulid`))})
      order by span_id, "order"
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async listFormedBy(positionId: string): Promise<readonly FormedByRow[]> {
    const result = await sql<FormedByRow>`
      select relationship_row.id as relationship_id, relationship_row.confirmed_at
      from position_formed_by formation
      join relationships relationship_row on relationship_row.id = formation.relationship_id
      where formation.position_id = ${positionId}::dialektik_ulid
        and relationship_row.rel_type = 'R01a'
        and relationship_row.publication_state = 'published'
        and relationship_row.declared_by is not null
        and relationship_row.confirmed_by is not null
        and relationship_row.confirmed_at is not null
      order by formation.ordinal
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async listRelationships(eventId: string): Promise<readonly RelationshipRow[]> {
    const result = await sql<RelationshipRow>`
      select
        id,
        rel_type,
        scope,
        non_comparable_reason,
        triggering_evidence_id,
        rectified_by,
        confirmed_at
      from relationships
      where event_id = ${eventId}::dialektik_ulid
        and publication_state = 'published'
        and rel_type <> 'R01b'
        and confirmed_at is not null
        and not exists (
          select 1
          from relationship_endpoints endpoint
          join assertions assertion_row on assertion_row.id = endpoint.assertion_id
          join claim_spans span_row on span_row.id = assertion_row.claim_span_id
          join articles article_row on article_row.id = span_row.article_id
          where endpoint.relationship_id = relationships.id
            and (
              assertion_row.lifecycle_state <> 'active'
              or span_row.tombstone_id is not null
              or article_row.event_id is distinct from relationships.event_id
              or exists (
                select 1 from assertions successor
                where successor.supersedes_id = assertion_row.id
              )
            )
        )
      order by confirmed_at asc, id asc
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async listRelationshipEndpoints(
    relationshipIds: readonly string[],
  ): Promise<readonly RelationshipEndpointRow[]> {
    if (relationshipIds.length === 0) return [];
    const result = await sql<RelationshipEndpointRow>`
      select relationship_id, assertion_id, role, endpoint_order
      from relationship_endpoints
      where relationship_id in (
        ${sql.join(relationshipIds.map((id) => sql`${id}::dialektik_ulid`))}
      )
      order by relationship_id, endpoint_order
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async listContradictions(input: {
    readonly cursor: PageCursor | null;
    readonly limit: number;
    readonly eventId?: string;
    readonly followedSourceIds?: readonly string[];
  }): Promise<readonly ContradictionRow[]> {
    const follows=input.followedSourceIds;
    const match=follows===undefined ? sql`false` : sql`exists(select 1 from public.articles followed_article
      where followed_article.event_id=event_row.id and followed_article.origin='LIVE_REAL'
        and followed_article.source_id::text=any(${follows}::text[]))`;
    const cursorMatch=input.cursor===null || follows===undefined ? sql`false` : sql`exists(select 1
      from public.contradiction_publications cursor_publication join public.articles cursor_article
        on cursor_article.event_id=cursor_publication.event_id and cursor_article.origin='LIVE_REAL'
      where cursor_publication.id=${input.cursor.id}::dialektik_ulid
        and cursor_article.source_id::text=any(${follows}::text[]))`;
    const cursorClause=input.cursor===null ? sql`` : follows===undefined
      ? sql`and (publication.confirmed_at,publication.id)<(${input.cursor.timestamp},${input.cursor.id}::dialektik_ulid)`
      : sql`and ((${match})::int,publication.confirmed_at,publication.id)<((${cursorMatch})::int,${input.cursor.timestamp},${input.cursor.id}::dialektik_ulid)`;
    const result = await sql<ContradictionRow>`
      select
        publication.id,
        publication.event_id,
        ${match} as is_followed_source_match,
        case when publication.threshold_rule_at_publication='v1:editorial_focus_contrast'
          then 'Contraste de enfoques: ' || event_row.title_descriptive
          else event_row.title_descriptive end as event_title,
        position_a.id as position_a_id,
        position_a.neutral_rank as position_a_ordinal,
        position_a.title_text as position_a_title,
        position_b.id as position_b_id,
        position_b.neutral_rank as position_b_ordinal,
        position_b.title_text as position_b_title,
        publication.ratio_conflicting_at_publication as ratio_conflicting,
        publication.ratio_comparable_at_publication as ratio_comparable,
        publication.threshold_rule_at_publication as threshold_rule,
        publication.confirmed_at,
        (publication.publication_state = 'requires_review') as needs_review
      from contradiction_publications publication
      join events event_row on event_row.id = publication.event_id
      join positions position_a on position_a.id = publication.position_a_id
        and position_a.event_id = event_row.id
      join positions position_b on position_b.id = publication.position_b_id
        and position_b.event_id = event_row.id
      where publication.publication_state in ('published', 'requires_review')
        ${input.eventId === undefined ? sql`` : sql`and publication.event_id=${input.eventId}::dialektik_ulid`}
        and event_row.merged_into is null
        and event_row.analysis_state = 'PUBLISHED'
        and publication.confirmed_by is not null
        and publication.confirmed_at is not null
        and position_a.id <> position_b.id
        and ${groundedEvent}
        and position_a.publication_state = 'published'
        and position_a.status = 'active'
        and position_b.publication_state = 'published'
        and position_b.status = 'active'
        -- Both positions need confirmed formation or a signed, source-backed
        -- single-claim editorial promotion.
        and (exists (
          select 1 from position_formed_by formation
          join relationships relationship_row
            on relationship_row.id = formation.relationship_id
          where formation.position_id = position_a.id
        ) or ${reviewedSingleClaim('position_a.id', 'event_row.id')})
        and (exists (
          select 1 from position_formed_by formation
          join relationships relationship_row
            on relationship_row.id = formation.relationship_id
          where formation.position_id = position_b.id
        ) or ${reviewedSingleClaim('position_b.id', 'event_row.id')})
        and exists (
          select 1 from assertions assertion_row
          join claim_spans claim on claim.id = assertion_row.claim_span_id
          where assertion_row.position_id = position_a.id
            and assertion_row.lifecycle_state = 'active'
            and claim.tombstone_id is null
        )
        and exists (
          select 1 from assertions assertion_row
          join claim_spans claim on claim.id = assertion_row.claim_span_id
          where assertion_row.position_id = position_b.id
            and assertion_row.lifecycle_state = 'active'
            and claim.tombstone_id is null
        )
        ${cursorClause}
      order by ${follows === undefined ? sql`` : sql`(${match})::int desc,`} publication.confirmed_at desc, publication.id desc
      limit ${input.limit + 1}
    `.execute(this.databaseService.database);
    return result.rows;
  }

  public async findSource(id: string): Promise<SourceRow | undefined> {
    const result = await sql<SourceRow>`
      select id, name, source_type, created_at
      from sources
      where id = ${id}::dialektik_ulid
    `.execute(this.databaseService.database);
    return result.rows[0];
  }
}
