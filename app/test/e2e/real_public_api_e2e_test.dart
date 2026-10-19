import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/loopback_socket_client.dart';

const String _baseUrl = String.fromEnvironment('DIALEKTIK_E2E_BASE_URL');
const String _eventId = String.fromEnvironment('DIALEKTIK_E2E_EVENT_ID');

void main() {
  testWidgets(
    'real PostgreSQL fixture renders through Core public API and Flutter',
    (WidgetTester tester) async {
      final LoopbackSocketClient transport = LoopbackSocketClient();
      final PublicApiClient client = PublicApiClient(
        configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
        httpClient: transport,
      );
      late final PublicPage<EventCardDto> feed;
      late final EventDetailDto event;
      late final List<PublicAssertionDto> assertions;
      late final List<RelationshipDto> relationships;
      await tester.runAsync<void>(() async {
        feed = await client.listFeed();
        event = await client.getEvent(_eventId);
        assertions = await client.listUnclusteredAssertions(_eventId);
        relationships = await client.listEventRelationships(_eventId);
      });
      client.close();
      transport.close();

      expect(feed.items.single.id, _eventId);
      expect(event.analysisState, AnalysisState.analysisPending);
      expect(assertions, isNotEmpty);
      final _CapturedRepository repository = _CapturedRepository(
        feed: feed,
        event: event,
        assertions: assertions,
        relationships: relationships,
      );
      await tester.pumpWidget(
        DialektikApp(
          environment: AppEnvironment.test,
          loadInterFromDependency: false,
          consumerRepository: repository,
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Provider-free moderation fixture'), findsOneWidget);
      await tester.tap(find.text('Provider-free moderation fixture'));
      await tester.pumpAndSettle();

      expect(find.text('Analysis in progress'), findsOneWidget);
      expect(find.textContaining('no published Positions'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.textContaining('Rates were reduced.').first,
        250,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.textContaining('Rates were reduced.'), findsWidgets);
      expect(find.textContaining('CandidateClass'), findsNothing);
      expect(find.textContaining('R01b'), findsNothing);
      expect(find.textContaining('SimilarityScore'), findsNothing);
    },
    skip: _baseUrl.isEmpty || _eventId.isEmpty,
  );
}

final class _CapturedRepository implements ConsumerRepository {
  const _CapturedRepository({
    required this.feed,
    required this.event,
    required this.assertions,
    required this.relationships,
  });

  final PublicPage<EventCardDto> feed;
  final EventDetailDto event;
  final List<PublicAssertionDto> assertions;
  final List<RelationshipDto> relationships;

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async => event;

  @override
  Future<List<PublicAssertionDto>> listUnclusteredAssertions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async => assertions;

  @override
  Future<List<RelationshipDto>> listEventRelationships(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async => relationships;

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) async => feed;

  @override
  Future<PublicPage<ContradictionDto>> listContradictions({
    String? cursor,
    int limit = 20,
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
  Future<List<PositionListItemDto>> listEventPositions(
    String eventId, {
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => throw UnimplementedError();
}
