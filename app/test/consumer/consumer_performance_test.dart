import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/consumer/presentation/state/feed_controller.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';

void main() {
  testWidgets(
    'cold shell and feed meaningful render remain within local budgets',
    (WidgetTester tester) async {
      final Stopwatch shell = Stopwatch()..start();
      await tester.pumpWidget(_app(FakeConsumerRepository()));
      await tester.pump();
      shell.stop();
      expect(shell.elapsedMilliseconds, lessThan(5000));

      final Stopwatch feed = Stopwatch()..start();
      await tester.pumpAndSettle();
      feed.stop();
      expect(
        find.text('Banco central publica decisión de tasas'),
        findsOneWidget,
      );
      expect(feed.elapsedMilliseconds, lessThan(250));
      debugPrint(
        'PHASE8_PERF shell=${shell.elapsedMilliseconds}ms '
        'feed=${feed.elapsedMilliseconds}ms',
      );
    },
  );

  testWidgets(
    'large pending provenance remains renderable within local budget',
    (WidgetTester tester) async {
      final List<PublicAssertionDto> assertions =
          List<PublicAssertionDto>.generate(
            50,
            (int index) => PublicAssertionDto.fromJson(
              assertionJson(
                id: '01K4W4M7R0B0000000000${(1000 + index).toString()}',
                text: 'Provider-free quoted statement number ${index + 1}.',
                languagePath: index.isEven ? 'es' : 'en',
              ),
            ),
          );
      final Stopwatch detail = Stopwatch()..start();
      await tester.pumpWidget(
        _app(
          FakeConsumerRepository(assertions: assertions),
          initialRoute: ConsumerRoutes.event(pendingEventId),
        ),
      );
      await tester.pumpAndSettle();
      detail.stop();
      expect(detail.elapsedMilliseconds, lessThan(5000));
      expect(tester.takeException(), isNull);
      await tester.fling(
        find.byKey(const Key('event-detail-list')),
        const Offset(0, -3000),
        3000,
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      debugPrint('PHASE8_PERF provenance50=${detail.elapsedMilliseconds}ms');
    },
  );

  test('pagination append remains within local state budget', () async {
    final FakeConsumerRepository repository = FakeConsumerRepository(
      feedPages: <PublicPage<EventCardDto>>[
        PublicPage<EventCardDto>(
          items: <EventCardDto>[pendingEventCard],
          nextCursor: 'page-2',
        ),
        PublicPage<EventCardDto>(
          items: List<EventCardDto>.generate(
            50,
            (int index) => EventCardDto.fromJson(
              eventCardJson(
                id: '01K4W4M7R0B0000000001${(1000 + index).toString()}',
                title: 'Provider-free Event ${index + 1}',
              ),
            ),
          ),
          nextCursor: null,
        ),
      ],
    );
    final FeedController controller = FeedController(repository: repository);
    await controller.loadInitial();
    final Stopwatch append = Stopwatch()..start();
    await controller.loadNext();
    append.stop();
    expect(append.elapsedMilliseconds, lessThan(250));
    expect(controller.items, hasLength(51));
    debugPrint('PHASE8_PERF append50=${append.elapsedMilliseconds}ms');
  });
}

Widget _app(
  FakeConsumerRepository repository, {
  String initialRoute = ConsumerRoutes.feed,
}) => DialektikApp(
  environment: AppEnvironment.test,
  loadInterFromDependency: false,
  consumerRepository: repository,
  initialRoute: initialRoute,
);
