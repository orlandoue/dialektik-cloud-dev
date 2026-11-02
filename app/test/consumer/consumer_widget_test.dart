import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/consumer/presentation/widgets/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';

void main() {
  testWidgets(
    'feed exposes loading, loaded, pagination and filter-empty states',
    (WidgetTester tester) async {
      final FakeConsumerRepository repository = FakeConsumerRepository(
        delay: const Duration(milliseconds: 30),
        feedPages: <PublicPage<EventCardDto>>[
          PublicPage<EventCardDto>(
            items: <EventCardDto>[pendingEventCard],
            nextCursor: 'opaque-next',
          ),
          PublicPage<EventCardDto>(
            items: <EventCardDto>[pendingEventCard, publishedEventCard],
            nextCursor: null,
          ),
          const PublicPage<EventCardDto>(
            items: <EventCardDto>[],
            nextCursor: null,
          ),
        ],
      );
      await tester.pumpWidget(_app(repository));
      await tester.pump();
      expect(find.text('Cargando eventos'), findsOneWidget);

      await tester.pump(const Duration(milliseconds: 40));
      await tester.pumpAndSettle();
      expect(
        find.text('Banco central publica decisión de tasas'),
        findsOneWidget,
      );
      expect(find.text('Cargar más eventos'), findsOneWidget);

      await tester.ensureVisible(find.text('Cargar más eventos'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cargar más eventos'));
      await tester.pump(const Duration(milliseconds: 40));
      await tester.pumpAndSettle();
      expect(find.text('Central bank holds benchmark rate'), findsOneWidget);
      expect(repository.requestedCursors, <String?>[null, 'opaque-next']);

      final Finder economyFilter = find.widgetWithText(ChoiceChip, 'Economía');
      await tester.ensureVisible(economyFilter);
      await tester.pumpAndSettle();
      expect(economyFilter.hitTestable(), findsOneWidget);
      await tester.tap(economyFilter);
      await tester.pump(const Duration(milliseconds: 40));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('No hay eventos para este filtro'),
        findsOneWidget,
      );
      expect(repository.requestedCategories.last, 'economia');
    },
  );

  testWidgets('feed shows safe recoverable network errors', (
    WidgetTester tester,
  ) async {
    final FakeConsumerRepository repository = FakeConsumerRepository(
      feedFailure: const PublicApiFailure(kind: PublicFailureKind.network),
    );
    await tester.pumpWidget(_app(repository));
    await tester.pumpAndSettle();

    expect(find.textContaining('No se pudo conectar'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
    expect(find.textContaining('requestId'), findsNothing);
  });

  testWidgets('pending Event keeps provenance without manufacturing analysis', (
    WidgetTester tester,
  ) async {
    var externalCalls = 0;
    await tester.pumpWidget(
      _app(
        FakeConsumerRepository(
          event: pendingEventDetail,
          assertions: <PublicAssertionDto>[pendingAssertion],
        ),
        initialRoute: ConsumerRoutes.event(pendingEventId),
        externalLinkOpener: (Uri uri) async {
          externalCalls += 1;
          expect(uri, Uri.parse('https://example.test/decision'));
          return true;
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Las posturas aún no están disponibles.'), findsOneWidget);
    expect(find.text('Análisis en curso'), findsNothing);
    expect(find.text('Posición 1 de 2'), findsNothing);
    expect(find.text('El banco central publicó su decisión.'), findsOneWidget);

    await tester.tap(find.text('Abrir publicación original').first);
    await tester.pump();
    expect(externalCalls, 1);

    await tester.scrollUntilVisible(
      find.textContaining('La tasa de referencia'),
      250,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.textContaining('La tasa de referencia'), findsOneWidget);
    expect(find.textContaining('ClaimInterpretation'), findsNothing);
  });

  testWidgets('published positions show their sources and literal quotes', (WidgetTester tester) async {
    final repository = FakeConsumerRepository(
      event: publishedEventDetail,
      positions: <PositionListItemDto>[positionA, positionB],
      relationships: <RelationshipDto>[publicRelationship],
    );
    await tester.pumpWidget(_app(repository, initialRoute: ConsumerRoutes.event(publishedEventId)));
    await tester.pumpAndSettle();
    expect(repository.positionDetailCalls, 2);
    expect(find.text('Posturas por medio'), findsOneWidget);
    expect(find.text('La tasa se mantiene'), findsOneWidget);
    expect(find.textContaining('La tasa de referencia'), findsWidgets);
    expect(find.text('Noticias originales'), findsOneWidget);
    expect(find.text('Análisis en curso'), findsNothing);
  });

  testWidgets('published event displays its editorial contrast', (WidgetTester tester) async {
    final event = EventDetailDto.fromJson({
      ...eventDetailJson(id: publishedEventId, analysisState: 'PUBLISHED', positionCount: 2),
      'positions': <Object?>[], 'articles': <Object?>[],
      'contrasts': <Object?>[{'id': 'contrast', 'position_a_id': positionAId, 'position_b_id': positionBId, 'kind': 'contrast'}],
    });
    await tester.pumpWidget(_app(FakeConsumerRepository(event: event, positions: [positionA, positionB]),
      initialRoute: ConsumerRoutes.event(publishedEventId)));
    await tester.pumpAndSettle();
    expect(find.text('Contraste de enfoques'), findsOneWidget);
  });

  testWidgets('gone Event offers only its API-provided current successor', (
    WidgetTester tester,
  ) async {
    final FakeConsumerRepository repository = FakeConsumerRepository(
      eventFailure: PublicApiFailure(
        kind: PublicFailureKind.gone,
        tombstone: TombstoneDto.fromJson(tombstoneJson()),
      ),
    );
    await tester.pumpWidget(
      _app(repository, initialRoute: ConsumerRoutes.event(pendingEventId)),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Este identificador fue reemplazado'),
      findsOneWidget,
    );
    expect(find.text('Abrir evento vigente'), findsOneWidget);
    repository
      ..eventFailure = null
      ..event = publishedEventDetail
      ..positions = <PositionListItemDto>[positionA];
    await tester.tap(find.text('Abrir evento vigente'));
    await tester.pumpAndSettle();

    expect(find.text('Central bank holds benchmark rate'), findsOneWidget);
    expect(find.textContaining('identificador fue reemplazado'), findsNothing);
  });

  testWidgets('source identity and published contradictions stay neutral', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _app(
        FakeConsumerRepository(),
        initialRoute: ConsumerRoutes.source(sourceAId),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Agencia Uno'), findsOneWidget);
    expect(find.textContaining('Agencia de noticias'), findsOneWidget);
    expect(find.textContaining('credibilidad'), findsNothing);

    await tester.pumpWidget(
      _app(
        FakeConsumerRepository(),
        initialRoute: ConsumerRoutes.contradictions,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Central bank holds benchmark rate'), findsOneWidget);
    expect(find.text('Estado editorial: requiere revisión'), findsNothing);
    expect(find.textContaining('Agencia Uno:'), findsWidgets);
    expect(find.textContaining('probablemente'), findsNothing);
  });

  testWidgets('ES and EN shell labels preserve Spanish source content', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _app(FakeConsumerRepository(), locale: const Locale('en')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Events'), findsOneWidget);
    expect(find.text('Analysis in progress'), findsOneWidget);
    expect(
      find.text('Banco central publica decisión de tasas'),
      findsOneWidget,
    );
  });

  testWidgets(
    'consumer surface has semantic Event action, 44px target and 200% text',
    (WidgetTester tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final SemanticsHandle semantics = tester.ensureSemantics();
      await tester.pumpWidget(_app(FakeConsumerRepository()));
      await tester.pumpAndSettle();

      final Finder firstCard = find.byType(EventCard).first;
      expect(tester.getSize(firstCard).height, greaterThanOrEqualTo(44));
      expect(
        find.bySemanticsLabel(
          RegExp('Evento: Banco central publica decisión de tasas'),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      semantics.dispose();
    },
  );
}

Widget _app(
  FakeConsumerRepository repository, {
  String initialRoute = ConsumerRoutes.feed,
  Locale locale = const Locale('es'),
  Future<bool> Function(Uri uri)? externalLinkOpener,
}) => DialektikApp(
  key: UniqueKey(),
  environment: AppEnvironment.test,
  loadInterFromDependency: false,
  consumerRepository: repository,
  initialRoute: initialRoute,
  locale: locale,
  externalLinkOpener: externalLinkOpener ?? (Uri uri) async => true,
);
