import { Inject, Injectable } from '@nestjs/common';

import { gone, analysisUnavailable, notFound } from './public-api.error.js';
import { PublicApiRepository } from './public-api.repository.js';
import type {
  AttributionRow,
  EventRow,
  FeedRow,
  PositionListRow,
  PublicAssertionRow,
} from './public-api.repository.js';
import type {
  AttributionDto,
  ClaimSpanDto,
  ContradictionDto,
  EventCardDto,
  EventDetailDto,
  FormedByDto,
  PositionDetailDto,
  PositionListItemDto,
  PublicAssertionDto,
  PublicPage,
  PublicReadResult,
  RelationshipDto,
  SourceDto,
  TombstoneDto,
} from './public-api.types.js';
import { encodeCursor } from './public-api.validation.js';
import type { PageRequest } from './public-api.validation.js';

const EDITORIAL_DISPLAY = 'equipo editorial' as const;

function iso(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('Invalid persisted public timestamp.');
  }
  return value.toISOString();
}

function latest(values: readonly Date[]): Date {
  if (values.length === 0) throw new TypeError('A public representation requires a timestamp.');
  return new Date(Math.max(...values.map((value) => value.getTime())));
}

function eventCard(row: FeedRow | EventRow): EventCardDto {
  const positionCount = row.analysis_state === 'ANALYSIS_PENDING' ? null : row.position_count;
  if (row.analysis_state === 'PUBLISHED' && row.position_count < 1) {
    throw new TypeError('Published Event has no published Position.');
  }
  return {
    id: row.id,
    title_descriptive: row.title_descriptive,
    category: row.category,
    detected_at: iso(row.detected_at),
    analysis_state: row.analysis_state,
    source_count: row.source_count,
    position_count: positionCount,
  };
}

function positionListItem(row: PositionListRow): PositionListItemDto {
  if (row.neutral_rank < 1 || row.ordinal < 1 || row.total < row.ordinal) {
    throw new TypeError('Invalid persisted Position order.');
  }
  return {
    id: row.id,
    ordinal: row.ordinal,
    total: row.total,
    neutral_rank: row.neutral_rank,
    title: row.title_text,
    published_at: iso(row.published_at),
    assertion_count: row.assertion_count,
    formed_by_count: row.formed_by_count,
    evidence_absence: row.evidence_absence,
    evidence_absence_reason: null,
  };
}

function groupAttributions(rows: readonly AttributionRow[]): ReadonlyMap<string, AttributionDto[]> {
  const grouped = new Map<string, AttributionDto[]>();
  for (const row of rows) {
    const values = grouped.get(row.span_id) ?? [];
    values.push({
      order: row.order,
      attributor: row.attributor,
      attributor_type: row.attributor_type,
    });
    grouped.set(row.span_id, values);
  }
  return grouped;
}

function assertionDto(
  row: PublicAssertionRow,
  attributions: ReadonlyMap<string, AttributionDto[]>,
): PublicAssertionDto {
  const span: ClaimSpanDto = {
    id: row.span_id,
    quoted_text: row.quoted_text,
    location: row.location,
    attribution_chain: attributions.get(row.span_id) ?? [],
    article: {
      id: row.article_id,
      url_canonical: row.url_canonical,
      published_at: iso(row.article_published_at),
      source: {
        id: row.source_id,
        name: row.source_name,
        source_type: row.source_type,
      },
    },
    captured_at: iso(row.captured_at),
    highlight_ranges: [
      {
        start: row.text_offset_start,
        end: row.text_offset_end,
        assertion_id: row.assertion_id,
      },
    ],
    rectified: null,
  };
  return {
    id: row.assertion_id,
    ordinal_in_span: row.assertion_ordinal,
    is_principal: row.is_principal,
    span,
    epistemic_class: row.epistemic_class,
    epistemic_reason: row.epistemic_reason,
    evidence_by_stance_for_assertion: null,
    my_evaluation: null,
  };
}

@Injectable()
export class PublicApiService {
  public constructor(
    @Inject(PublicApiRepository)
    private readonly repository: PublicApiRepository,
  ) {}

  public async feed(input: {
    readonly category?: string;
    readonly topic?: string;
    readonly page: PageRequest;
    readonly followedSourceIds?: readonly string[];
    readonly blindspots?: boolean;
    readonly includeSynthesis?: boolean;
  }): Promise<PublicReadResult<PublicPage<EventCardDto>>> {
    const rows = await this.repository.listFeed({
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.topic === undefined ? {} : { topic: input.topic }),
      cursor: input.page.cursor,
      limit: input.page.limit,
      ...(input.followedSourceIds === undefined ? {} : {followedSourceIds: input.followedSourceIds}),
      ...(input.blindspots ? {blindspots:true} : {}),
    });
    const visible = rows.slice(0, input.page.limit);
    const last = visible.at(-1);
    const nextCursor =
      rows.length > input.page.limit && last !== undefined
        ? encodeCursor('feed', input.page.filterFingerprint, last.detected_at, last.id)
        : null;
    return {
      body: { items: visible.map((row) => ({...eventCard(row), ...(input.includeSynthesis ? {synthesis_relation:row.synthesis_relation ?? null} : {}), ...(input.followedSourceIds === undefined ? {} : {is_followed_source_match:row.is_followed_source_match === true})})), next_cursor: nextCursor },
      lastModified:
        visible.length === 0
          ? new Date(0)
          : latest(visible.map((row) => row.representation_updated_at)),
    };
  }

  public async countBlindspots(followedSourceIds: readonly string[]): Promise<number> {
    return this.repository.countBlindspots(followedSourceIds);
  }

  public async event(id: string, includeCoverage = false, followedSourceIds?: readonly string[]): Promise<PublicReadResult<EventDetailDto>> {
    const row = await this.#requireCurrentEvent(id);
    const primaryFacts = await this.repository.findPrimaryFacts(id);
    if (primaryFacts.length > 1) throw new TypeError('Event has more than one primary fact.');
    const primary = primaryFacts[0];
    const followedMatch = followedSourceIds === undefined ? undefined : await this.repository.eventHasFollowedSources(id, followedSourceIds);
    const coverage = includeCoverage && row.analysis_state === 'PUBLISHED'
      ? await this.repository.listEventCoverage(id) : [];
    const linkedArticles = includeCoverage && row.analysis_state === 'PUBLISHED'
      ? await this.repository.listEventArticles(id) : [];
    const related = includeCoverage && row.analysis_state === 'PUBLISHED'
      ? await this.repository.listContradictions({cursor:null,limit:100,eventId:id}) : [];
    const positions = new Map<string, {id:string;title:string;assertions:{id:string;assertion_text:string;quoted_text:string;article_id:string;source_name:string;source_id?:string;is_followed?:boolean}[]}>();
    const articles = new Map<string, {id:string;title:string;source_name:string;published_at:string;url:string;source_id?:string;is_followed?:boolean}>();
    for (const item of coverage) {
      const position=positions.get(item.position_id) ?? {id:item.position_id,title:item.position_title,assertions:[]};
      position.assertions.push({id:item.assertion_id,assertion_text:item.assertion_text,quoted_text:item.quoted_text,article_id:item.article_id,source_name:item.source_name,
        ...(followedSourceIds === undefined ? {} : {source_id:item.source_id,is_followed:followedSourceIds.includes(item.source_id)})});
      positions.set(item.position_id,position);
      articles.set(item.article_id,{id:item.article_id,title:item.article_title,source_name:item.source_name,published_at:iso(item.published_at),url:item.url,
        ...(followedSourceIds === undefined ? {} : {source_id:item.source_id,is_followed:followedSourceIds.includes(item.source_id)})});
    }
    for (const item of linkedArticles) {
      articles.set(item.article_id,{id:item.article_id,title:item.article_title,source_name:item.source_name,published_at:iso(item.published_at),url:item.url,
        ...(followedSourceIds === undefined ? {} : {source_id:item.source_id,is_followed:followedSourceIds.includes(item.source_id)})});
    }
    return {
      body: {
        ...eventCard(row),
        ...(followedSourceIds === undefined ? {} : {is_followed_source_match:followedMatch === true}),
        ...(includeCoverage ? {positions:[...positions.values()],articles:[...articles.values()],
          contrasts:related.map(item=>({id:item.id,position_a_id:item.position_a_id,position_b_id:item.position_b_id,
            kind:item.threshold_rule==='v1:editorial_focus_contrast'?'contrast':'contradiction'}))} : {}),
        window: {
          from: iso(row.window_from),
          to: row.window_to === null ? null : iso(row.window_to),
        },
        primary_fact:
          primary === undefined
            ? null
            : {
                statement: primary.statement,
                primary_publication_url: primary.primary_publication_url,
                primary_source: {
                  id: primary.primary_source_id,
                  name: primary.primary_source_name,
                },
              },
        merged_into: null,
      },
      lastModified: row.representation_updated_at,
    };
  }

  public async positions(id: string): Promise<PublicReadResult<readonly PositionListItemDto[]>> {
    const event = await this.#requireCurrentEvent(id);
    if (event.analysis_state === 'ANALYSIS_PENDING') throw analysisUnavailable();
    const rows = await this.repository.listPositions(id);
    if (rows.length === 0) throw new TypeError('Published Event has no public Positions.');
    return {
      body: rows.map(positionListItem),
      lastModified: latest(rows.map((row) => row.representation_updated_at)),
    };
  }

  public async position(id: string): Promise<PublicReadResult<PositionDetailDto>> {
    const state = await this.repository.findPositionState(id);
    if (state === undefined || state.publication_state === 'internal') throw notFound();
    const event = await this.#requireCurrentEvent(state.event_id);
    if (
      state.publication_state !== 'published' ||
      state.status !== 'active' ||
      state.tombstone_id !== null
    ) {
      throw gone(await this.#positionTombstone(id));
    }
    const rows = await this.repository.listPositions(event.id);
    const row = rows.find((candidate) => candidate.id === id);
    if (row === undefined) throw new TypeError('Public Position failed current read projection.');
    const assertionRows = await this.repository.listPositionAssertions(id);
    const attributions = await this.repository.listAttributions([
      ...new Set(assertionRows.map((assertion) => assertion.span_id)),
    ]);
    const formedByRows = await this.repository.listFormedBy(id);
    if (formedByRows.length !== row.formed_by_count ||
        (formedByRows.length === 0 && !row.has_reviewed_single_claim)) {
      throw new TypeError('Public Position formation is incomplete.');
    }
    const formedBy: readonly FormedByDto[] = formedByRows.map((formation) => ({
      relationship_id: formation.relationship_id,
      declared_by_display: EDITORIAL_DISPLAY,
      declared_at: iso(formation.confirmed_at),
    }));
    const attributionMap = groupAttributions(attributions);
    return {
      body: {
        ...positionListItem(row),
        source_count: new Set(assertionRows.map((assertion) => assertion.source_id)).size,
        assertions: assertionRows.map((assertion) => assertionDto(assertion, attributionMap)),
        formed_by: formedBy,
      },
      lastModified: latest([
        row.representation_updated_at,
        ...assertionRows.flatMap((assertion) => [
          assertion.captured_at,
          assertion.article_published_at,
        ]),
        ...formedByRows.map((formation) => formation.confirmed_at),
      ]),
    };
  }

  public async unclusteredAssertions(
    id: string,
  ): Promise<PublicReadResult<readonly PublicAssertionDto[]>> {
    const event = await this.#requireCurrentEvent(id);
    if (event.analysis_state !== 'ANALYSIS_PENDING') throw notFound();
    const rows = await this.repository.listUnclusteredAssertions(id);
    const attributions = await this.repository.listAttributions([
      ...new Set(rows.map((assertion) => assertion.span_id)),
    ]);
    const attributionMap = groupAttributions(attributions);
    return {
      body: rows.map((row) => assertionDto(row, attributionMap)),
      lastModified: latest([
        event.representation_updated_at,
        ...rows.flatMap((row) => [row.captured_at, row.article_published_at]),
      ]),
    };
  }

  public async relationships(id: string): Promise<PublicReadResult<readonly RelationshipDto[]>> {
    const event = await this.#requireCurrentEvent(id);
    const rows = await this.repository.listRelationships(id);
    const endpointRows = await this.repository.listRelationshipEndpoints(
      rows.map((relationship) => relationship.id),
    );
    const endpoints = new Map<string, RelationshipDto['endpoints'][number][]>();
    for (const row of endpointRows) {
      const values = endpoints.get(row.relationship_id) ?? [];
      values.push({ assertion_id: row.assertion_id, role: row.role });
      endpoints.set(row.relationship_id, values);
    }
    const body = rows.map((row): RelationshipDto => {
      const relationshipEndpoints = endpoints.get(row.id) ?? [];
      if (relationshipEndpoints.length !== 2) {
        throw new TypeError('Public Relationship does not have exactly two endpoints.');
      }
      return {
        id: row.id,
        rel_type: row.rel_type,
        scope: row.scope,
        endpoints: relationshipEndpoints,
        non_comparable_reason: row.non_comparable_reason,
        triggering_evidence_id: row.triggering_evidence_id,
        rectified_by: row.rectified_by,
        confirmed_at: iso(row.confirmed_at),
      };
    });
    return {
      body,
      lastModified: latest([
        event.representation_updated_at,
        ...rows.map((relationship) => relationship.confirmed_at),
      ]),
    };
  }

  public async contradictions(
    page: PageRequest,
    followedSourceIds?: readonly string[],
  ): Promise<PublicReadResult<PublicPage<ContradictionDto>>> {
    const rows = await this.repository.listContradictions({
      cursor: page.cursor,
      limit: page.limit,
      ...(followedSourceIds === undefined ? {} : {followedSourceIds}),
    });
    const visible = rows.slice(0, page.limit);
    const last = visible.at(-1);
    const nextCursor =
      rows.length > page.limit && last !== undefined
        ? encodeCursor('contradictions', page.filterFingerprint, last.confirmed_at, last.id)
        : null;
    return {
      body: {
        items: visible.map((row) => ({
          id: row.id,
          ...(followedSourceIds === undefined ? {} : {is_followed_source_match:row.is_followed_source_match === true}),
          event_id: row.event_id,
          event_title: row.event_title,
          position_a: {
            id: row.position_a_id,
            ordinal: row.position_a_ordinal,
            title: row.position_a_title,
          },
          position_b: {
            id: row.position_b_id,
            ordinal: row.position_b_ordinal,
            title: row.position_b_title,
          },
          ratio: { conflicting: row.ratio_conflicting, comparable: row.ratio_comparable },
          threshold_rule: row.threshold_rule,
          confirmed_at: iso(row.confirmed_at),
          needs_review: row.needs_review,
        })),
        next_cursor: nextCursor,
      },
      lastModified:
        visible.length === 0 ? new Date(0) : latest(visible.map((row) => row.confirmed_at)),
    };
  }

  public async source(id: string): Promise<PublicReadResult<SourceDto>> {
    const row = await this.repository.findSource(id);
    if (row === undefined) throw notFound();
    return {
      body: { id: row.id, name: row.name, source_type: row.source_type },
      lastModified: row.created_at,
    };
  }

  async #positionTombstone(id: string): Promise<TombstoneDto> {
    const tombstone = await this.repository.findPositionTombstone(id);
    if (tombstone === undefined) {
      return {
        operation: 'absorbed',
        successors: [],
        occurred_at: new Date(0).toISOString(),
        reason: 'The Position is no longer current.',
      };
    }
    const successors = await this.repository.listPositionSuccessors(id);
    return {
      operation: tombstone.operation,
      successors: successors.map((successor) => ({
        type: 'Position',
        id: successor.id,
        title: successor.title,
      })),
      occurred_at: iso(tombstone.occurred_at),
      reason: tombstone.reason,
    };
  }

  async #requireCurrentEvent(id: string): Promise<EventRow> {
    const row = await this.repository.findEvent(id);
    if (row === undefined) throw notFound();
    if (row.merged_into !== null) {
      if (row.merged_at === null) throw new TypeError('Merged Event lacks merge timestamp.');
      throw gone({
        operation: 'merge',
        successors: [
          {
            type: 'Event',
            id: row.merged_into,
            ...(row.successor_title === null ? {} : { title: row.successor_title }),
          },
        ],
        occurred_at: iso(row.merged_at),
        reason: 'The Event was merged into its canonical successor.',
      });
    }
    return row;
  }
}
