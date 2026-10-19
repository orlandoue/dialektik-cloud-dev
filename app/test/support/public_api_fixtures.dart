import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';

const String pendingEventId = '01K4W4M7R0B000000000000001';
const String publishedEventId = '01K4W4M7R0B000000000000002';
const String positionAId = '01K4W4M7R0B000000000000011';
const String positionBId = '01K4W4M7R0B000000000000012';
const String sourceAId = '01K4W4M7R0B000000000000021';
const String sourceBId = '01K4W4M7R0B000000000000022';

Map<String, Object?> eventCardJson({
  String id = pendingEventId,
  String title = 'Banco central publica decisión de tasas',
  String category = 'economia',
  String analysisState = 'ANALYSIS_PENDING',
  int sourceCount = 2,
  int? positionCount,
}) => <String, Object?>{
  'id': id,
  'title_descriptive': title,
  'category': category,
  'detected_at': '2026-09-15T12:00:00.000Z',
  'analysis_state': analysisState,
  'source_count': sourceCount,
  'position_count': positionCount,
};

Map<String, Object?> eventDetailJson({
  String id = pendingEventId,
  String title = 'Banco central publica decisión de tasas',
  String analysisState = 'ANALYSIS_PENDING',
  int? positionCount,
  bool withPrimaryFact = true,
}) => <String, Object?>{
  ...eventCardJson(
    id: id,
    title: title,
    analysisState: analysisState,
    positionCount: positionCount,
  ),
  'window': <String, Object?>{'from': '2026-09-15T11:00:00.000Z', 'to': null},
  'primary_fact': withPrimaryFact
      ? <String, Object?>{
          'statement': 'El banco central publicó su decisión.',
          'primary_publication_url': 'https://example.test/decision',
          'primary_source': <String, Object?>{
            'id': sourceAId,
            'name': 'Agencia Uno',
          },
        }
      : null,
  'merged_into': null,
};

Map<String, Object?> sourceJson({
  String id = sourceAId,
  String name = 'Agencia Uno',
}) => <String, Object?>{'id': id, 'name': name, 'source_type': 'news_agency'};

Map<String, Object?> assertionJson({
  String id = '01K4W4M7R0B000000000000031',
  String text = 'La tasa de referencia se mantuvo sin cambios.',
  String sourceId = sourceAId,
  String sourceName = 'Agencia Uno',
  String languagePath = 'es',
}) => <String, Object?>{
  'id': id,
  'ordinal_in_span': 1,
  'is_principal': true,
  'span': <String, Object?>{
    'id': '01K4W4M7R0B000000000000041',
    'quoted_text': text,
    'location': 'body',
    'attribution_chain': <Object?>[
      <String, Object?>{
        'order': 1,
        'attributor': 'Banco Central',
        'attributor_type': 'organization',
      },
    ],
    'article': <String, Object?>{
      'id': '01K4W4M7R0B000000000000051',
      'url_canonical': 'https://example.test/$languagePath/report',
      'published_at': '2026-09-15T11:30:00.000Z',
      'source': sourceJson(id: sourceId, name: sourceName),
    },
    'captured_at': '2026-09-15T12:00:00.000Z',
    'highlight_ranges': <Object?>[
      <String, Object?>{'start': 0, 'end': 12, 'assertion_id': id},
    ],
    'rectified': null,
  },
  'epistemic_class': null,
  'epistemic_reason': null,
  'evidence_by_stance_for_assertion': null,
  'my_evaluation': null,
};

Map<String, Object?> positionListJson({
  String id = positionAId,
  int ordinal = 1,
  String title = 'La tasa se mantiene',
}) => <String, Object?>{
  'id': id,
  'ordinal': ordinal,
  'total': 2,
  'neutral_rank': ordinal,
  'title': title,
  'published_at': '2026-09-15T14:00:00.000Z',
  'assertion_count': 1,
  'formed_by_count': 1,
  'evidence_absence': null,
  'evidence_absence_reason': null,
};

Map<String, Object?> positionDetailJson({
  String id = positionAId,
  int ordinal = 1,
  String title = 'La tasa se mantiene',
}) => <String, Object?>{
  ...positionListJson(id: id, ordinal: ordinal, title: title),
  'source_count': 1,
  'assertions': <Object?>[assertionJson()],
  'formed_by': <Object?>[
    <String, Object?>{
      'relationship_id': '01K4W4M7R0B000000000000061',
      'declared_by_display': 'equipo editorial',
      'declared_at': '2026-09-15T13:00:00.000Z',
    },
  ],
};

Map<String, Object?> relationshipJson() => <String, Object?>{
  'id': '01K4W4M7R0B000000000000061',
  'rel_type': 'R01a',
  'scope': 'intra_event',
  'endpoints': <Object?>[
    <String, Object?>{
      'assertion_id': '01K4W4M7R0B000000000000031',
      'role': 'peer',
    },
    <String, Object?>{
      'assertion_id': '01K4W4M7R0B000000000000032',
      'role': 'peer',
    },
  ],
  'non_comparable_reason': null,
  'triggering_evidence_id': null,
  'rectified_by': null,
  'confirmed_at': '2026-09-15T13:00:00.000Z',
};

Map<String, Object?> contradictionJson() => <String, Object?>{
  'id': '01K4W4M7R0B000000000000071',
  'event_id': publishedEventId,
  'event_title': 'Central bank holds benchmark rate',
  'position_a': <String, Object?>{
    'id': positionAId,
    'ordinal': 1,
    'title': 'The rate remains unchanged',
  },
  'position_b': <String, Object?>{
    'id': positionBId,
    'ordinal': 2,
    'title': 'The decision changes effective conditions',
  },
  'ratio': <String, Object?>{'conflicting': 1, 'comparable': 2},
  'threshold_rule': 'published editorial rule',
  'confirmed_at': '2026-09-15T15:00:00.000Z',
  'needs_review': true,
};

Map<String, Object?> tombstoneJson() => <String, Object?>{
  'operation': 'merge',
  'successors': <Object?>[
    <String, Object?>{
      'type': 'Event',
      'id': publishedEventId,
      'title': 'Evento consolidado',
    },
  ],
  'occurred_at': '2026-09-15T16:00:00.000Z',
  'reason': 'Los registros describían el mismo evento.',
};

final EventCardDto pendingEventCard = EventCardDto.fromJson(eventCardJson());
final EventCardDto publishedEventCard = EventCardDto.fromJson(
  eventCardJson(
    id: publishedEventId,
    title: 'Central bank holds benchmark rate',
    category: 'internacional',
    analysisState: 'PUBLISHED',
    positionCount: 2,
  ),
);
final EventDetailDto pendingEventDetail = EventDetailDto.fromJson(
  eventDetailJson(),
);
final EventDetailDto publishedEventDetail = EventDetailDto.fromJson(
  eventDetailJson(
    id: publishedEventId,
    title: 'Central bank holds benchmark rate',
    analysisState: 'PUBLISHED',
    positionCount: 2,
  ),
);
final PublicAssertionDto pendingAssertion = PublicAssertionDto.fromJson(
  assertionJson(),
);
final PositionListItemDto positionA = PositionListItemDto.fromJson(
  positionListJson(),
);
final PositionListItemDto positionB = PositionListItemDto.fromJson(
  positionListJson(
    id: positionBId,
    ordinal: 2,
    title: 'La decisión cambia las condiciones efectivas',
  ),
);
final PositionDetailDto positionADetail = PositionDetailDto.fromJson(
  positionDetailJson(),
);
final RelationshipDto publicRelationship = RelationshipDto.fromJson(
  relationshipJson(),
);
final ContradictionDto publicContradiction = ContradictionDto.fromJson(
  contradictionJson(),
);

/// Human-authored, provider-free repository used only by tests and previews.
final class FakeConsumerRepository implements ConsumerRepository {
  FakeConsumerRepository({
    this.feedPages,
    EventDetailDto? event,
    this.positions = const <PositionListItemDto>[],
    this.assertions,
    this.relationships = const <RelationshipDto>[],
    this.positionDetails,
    this.source,
    this.feedFailure,
    this.eventFailure,
    this.delay = Duration.zero,
  }) : event = event ?? pendingEventDetail;

  final List<PublicPage<EventCardDto>>? feedPages;
  EventDetailDto event;
  List<PositionListItemDto> positions;
  List<PublicAssertionDto>? assertions;
  List<RelationshipDto> relationships;
  Map<String, PositionDetailDto>? positionDetails;
  SourceDto? source;
  PublicApiFailure? feedFailure;
  PublicApiFailure? eventFailure;
  Duration delay;
  int feedCalls = 0;
  int positionDetailCalls = 0;
  final List<String?> requestedCursors = <String?>[];
  final List<String?> requestedCategories = <String?>[];

  Future<void> _wait(PublicRequestToken? token) async {
    if (delay > Duration.zero) await Future<void>.delayed(delay);
    token?.throwIfCancelled();
  }

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async {
    await _wait(requestToken);
    if (eventFailure case final PublicApiFailure failure) throw failure;
    return event;
  }

  @override
  Future<PositionDetailDto> getPosition(
    String positionId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async {
    positionDetailCalls += 1;
    await _wait(requestToken);
    return positionDetails?[positionId] ?? positionADetail;
  }

  @override
  Future<SourceDto> getSource(
    String sourceId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async {
    await _wait(requestToken);
    return source ?? SourceDto.fromJson(sourceJson(id: sourceId));
  }

  @override
  Future<PublicPage<ContradictionDto>> listContradictions({
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async {
    await _wait(requestToken);
    return PublicPage<ContradictionDto>(
      items: <ContradictionDto>[publicContradiction],
      nextCursor: null,
    );
  }

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async {
    feedCalls += 1;
    requestedCursors.add(cursor);
    requestedCategories.add(category);
    await _wait(requestToken);
    if (feedFailure case final PublicApiFailure failure) throw failure;
    final List<PublicPage<EventCardDto>> pages =
        feedPages ??
        <PublicPage<EventCardDto>>[
          PublicPage<EventCardDto>(
            items: <EventCardDto>[pendingEventCard, publishedEventCard],
            nextCursor: null,
          ),
        ];
    return pages[(feedCalls - 1).clamp(0, pages.length - 1)];
  }

  @override
  Future<List<PositionListItemDto>> listEventPositions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async {
    await _wait(requestToken);
    return positions;
  }

  @override
  Future<List<RelationshipDto>> listEventRelationships(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async {
    await _wait(requestToken);
    return relationships;
  }

  @override
  Future<List<PublicAssertionDto>> listUnclusteredAssertions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async {
    await _wait(requestToken);
    return assertions ?? <PublicAssertionDto>[pendingAssertion];
  }
}
