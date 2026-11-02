import 'dart:async';

import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/state/event_controller.dart';
import 'package:dialektik/features/consumer/presentation/state/feed_controller.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';

void main() {
  group('FeedController', () {
    test(
      'appends opaque pages, removes duplicate Events, and exhausts',
      () async {
        final FakeConsumerRepository repository = FakeConsumerRepository(
          feedPages: <PublicPage<EventCardDto>>[
            PublicPage<EventCardDto>(
              items: <EventCardDto>[pendingEventCard],
              nextCursor: 'opaque-page-2',
            ),
            PublicPage<EventCardDto>(
              items: <EventCardDto>[pendingEventCard, publishedEventCard],
              nextCursor: null,
            ),
          ],
        );
        final FeedController controller = FeedController(
          repository: repository,
        );

        await controller.loadInitial();
        await controller.loadNext();

        expect(controller.items.map((EventCardDto event) => event.id), <String>[
          pendingEventId,
          publishedEventId,
        ]);
        expect(controller.nextCursor, isNull);
        expect(repository.requestedCursors, <String?>[null, 'opaque-page-2']);
      },
    );

    test('does not reuse a cursor returned by the same page', () async {
      final FakeConsumerRepository repository = FakeConsumerRepository(
        feedPages: <PublicPage<EventCardDto>>[
          PublicPage<EventCardDto>(
            items: <EventCardDto>[pendingEventCard],
            nextCursor: 'loop',
          ),
          PublicPage<EventCardDto>(
            items: <EventCardDto>[publishedEventCard],
            nextCursor: 'loop',
          ),
        ],
      );
      final FeedController controller = FeedController(repository: repository);
      await controller.loadInitial();
      await controller.loadNext();

      expect(controller.nextCursor, isNull);
      expect(controller.items, hasLength(2));
    });

    test('retains content when a refresh fails offline', () async {
      final FakeConsumerRepository repository = FakeConsumerRepository();
      final FeedController controller = FeedController(repository: repository);
      await controller.loadInitial();
      repository.feedFailure = const PublicApiFailure(
        kind: PublicFailureKind.network,
      );

      await controller.refresh();

      expect(controller.phase, FeedPhase.content);
      expect(controller.items, hasLength(2));
      expect(controller.transientFailure?.kind, PublicFailureKind.network);
    });

    test('ignores a stale filter response that completes last', () async {
      final _ControlledFeedRepository repository = _ControlledFeedRepository();
      final FeedController controller = FeedController(repository: repository);
      final Future<void> first = controller.loadInitial();
      repository.completeNext(<EventCardDto>[pendingEventCard]);
      await first;

      final Future<void> economy = controller.setCategory('economia');
      final Future<void> science = controller.setCategory('ciencia');
      repository.completeAt(1, <EventCardDto>[publishedEventCard]);
      await science;
      repository.completeAt(0, <EventCardDto>[pendingEventCard]);
      await economy;

      expect(controller.category, 'ciencia');
      expect(controller.items.single.id, publishedEventId);
    });
  });

  group('EventController', () {
    test(
      'loads source-grounded assertions without fabricating Positions',
      () async {
        final EventController controller = EventController(
          eventId: pendingEventId,
          repository: FakeConsumerRepository(
            assertions: <PublicAssertionDto>[pendingAssertion],
          ),
        );

        await controller.load();

        expect(controller.phase, EventPhase.content);
        expect(controller.event?.analysisState, AnalysisState.analysisPending);
        expect(controller.assertions.single.span.quotedText, contains('tasa'));
        expect(controller.positions, isEmpty);
      },
    );

    test('published positions without evidence remain unavailable, not rendered', () async {
      final EventController controller = EventController(
        eventId: publishedEventId,
        repository: FakeConsumerRepository(
          event: publishedEventDetail,
          positionsFailure: const PublicApiFailure(
            kind: PublicFailureKind.invalidResponse,
          ),
        ),
      );
      await controller.load();
      expect(controller.phase, EventPhase.content);
      expect(controller.event?.analysisState, AnalysisState.published);
      expect(controller.analysisUnavailable, isTrue);
      expect(controller.positions, isEmpty);
    });

    test('loads Position details for the published event', () async {
      final FakeConsumerRepository repository = FakeConsumerRepository(
        event: publishedEventDetail,
        positions: <PositionListItemDto>[positionA, positionB],
        relationships: <RelationshipDto>[publicRelationship],
      );
      final EventController controller = EventController(
        eventId: publishedEventId,
        repository: repository,
      );

      await controller.load();
      expect(repository.positionDetailCalls, 2);
      await controller.togglePosition(positionAId);

      expect(repository.positionDetailCalls, 2);
      expect(controller.positionDetails[positionAId], isNotNull);
      expect(controller.expandedPositionId, positionAId);
    });

    test(
      'represents 410 as historical state with API successor only',
      () async {
        final EventController controller = EventController(
          eventId: pendingEventId,
          repository: FakeConsumerRepository(
            eventFailure: PublicApiFailure(
              kind: PublicFailureKind.gone,
              tombstone: TombstoneDto.fromJson(tombstoneJson()),
            ),
          ),
        );

        await controller.load();

        expect(controller.phase, EventPhase.gone);
        expect(controller.event, isNull);
        expect(controller.tombstone?.successors.single.id, publishedEventId);
      },
    );
  });
}

final class _ControlledFeedRepository implements ConsumerRepository {
  final List<Completer<PublicPage<EventCardDto>>> _pending =
      <Completer<PublicPage<EventCardDto>>>[];

  void completeNext(List<EventCardDto> items) => completeAt(0, items);

  void completeAt(int index, List<EventCardDto> items) {
    _pending[index].complete(
      PublicPage<EventCardDto>(items: items, nextCursor: null),
    );
    _pending.removeAt(index);
  }

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) {
    final Completer<PublicPage<EventCardDto>> completer =
        Completer<PublicPage<EventCardDto>>();
    _pending.add(completer);
    return completer.future;
  }

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => throw UnimplementedError();

  @override
  Future<PositionDetailDto> getPosition(
    String positionId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => throw UnimplementedError();

  @override
  Future<SourceDto> getSource(
    String sourceId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => throw UnimplementedError();

  @override
  Future<PublicPage<ContradictionDto>> listContradictions({
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => throw UnimplementedError();

  @override
  Future<List<PositionListItemDto>> listEventPositions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => throw UnimplementedError();

  @override
  Future<List<RelationshipDto>> listEventRelationships(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => throw UnimplementedError();

  @override
  Future<List<PublicAssertionDto>> listUnclusteredAssertions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => throw UnimplementedError();
}
