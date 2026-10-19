import 'dart:async';

import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/live/data/candidate_source_registry.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_test/flutter_test.dart';

import '../live/live_fixtures.dart';
import '../support/public_api_fixtures.dart';

Future<void> _tap(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

final class _ControlledLiveNewsRepository extends Fake
    implements LiveNewsRepository {
  _ControlledLiveNewsRepository(this._delegate);

  final LiveNewsRepository _delegate;
  final List<Completer<List<LiveSourceDto>>> pendingSourceLoads =
      <Completer<List<LiveSourceDto>>>[];
  int _sourceLoadCount = 0;

  List<LiveSourceDto> get _fixtureSources => <LiveSourceDto>[
    LiveSourceDto.fromJson(liveTestSource()),
  ];

  void completeSourceLoad(int index) {
    pendingSourceLoads[index].complete(_fixtureSources);
  }

  @override
  Future<List<LiveSourceDto>> listLiveSources({
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) {
    if (_sourceLoadCount++ < 2) {
      final Completer<List<LiveSourceDto>> pending =
          Completer<List<LiveSourceDto>>();
      pendingSourceLoads.add(pending);
      return pending.future;
    }
    return Future<List<LiveSourceDto>>.value(_fixtureSources);
  }

  @override
  Future<LiveNewsPageDto> listLiveNews({
    String? cursor,
    int limit = 25,
    String? query,
    String? sourceId,
    DateTime? publishedFrom,
    DateTime? publishedTo,
    bool refresh = false,
    PublicRequestToken? requestToken,
  }) => _delegate.listLiveNews(
    cursor: cursor,
    limit: limit,
    query: query,
    sourceId: sourceId,
    publishedFrom: publishedFrom,
    publishedTo: publishedTo,
    refresh: refresh,
    requestToken: requestToken,
  );
}

Future<void> _tapAndResolveSources(
  WidgetTester tester,
  _ControlledLiveNewsRepository repository,
) async {
  final Finder target = find.text('Fuentes');
  await tester.ensureVisible(target);
  await tester.tap(target);

  // Fuentes deliberately shows an indeterminate loader while /live/sources
  // resolves. Keep that async boundary explicit instead of asking
  // pumpAndSettle to wait for a ticker that cannot settle during loading.
  await tester.pump();
  await tester.pump();
  expect(repository.pendingSourceLoads, hasLength(2));
  expect(find.text('Cargando fuentes…'), findsOneWidget);

  repository.completeSourceLoad(1);
  await tester.pump();
  expect(find.text('Fuentes operativas · 1'), findsOneWidget);
  expect(find.text('Candidatas · 50'), findsOneWidget);
  expect(find.text('Editorial de pruebas · sintético'), findsOneWidget);
  expect(find.text('Cargando fuentes…'), findsNothing);
  expect(find.text('Cargando catálogo de fuentes…'), findsNothing);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Acontecimientos remains the consumer root in personal mode', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      DialektikApp(
        environment: AppEnvironment.test,
        loadInterFromDependency: false,
        consumerRepository: FakeConsumerRepository(
          feedPages: <PublicPage<EventCardDto>>[
            const PublicPage<EventCardDto>(
              items: <EventCardDto>[],
              nextCursor: null,
            ),
          ],
        ),
        liveNewsRepository: liveTestClient(),
        personalOwnerModeEnabled: true,
        initialRoute: ConsumerRoutes.feed,
        locale: const Locale('es'),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('No hay eventos públicos disponibles por ahora.'),
      findsOneWidget,
    );
    expect(find.text('Administración · estado local'), findsNothing);
  });

  testWidgets(
    'personal mode can open the consumer reader and reach administration separately',
    (WidgetTester tester) async {
      Future<List<CandidateSourceInfo>>? firstRegistryLoad;
      Future<List<CandidateSourceInfo>>? secondRegistryLoad;
      final List<CandidateSourceInfo>? candidates = await tester.runAsync(() {
        firstRegistryLoad = CandidateSourceRegistry.load();
        secondRegistryLoad = CandidateSourceRegistry.load();
        return firstRegistryLoad!;
      });
      expect(identical(firstRegistryLoad, secondRegistryLoad), isTrue);
      expect(candidates, hasLength(50));
      final _ControlledLiveNewsRepository liveRepository =
          _ControlledLiveNewsRepository(liveTestClient());
      await tester.pumpWidget(
        DialektikApp(
          environment: AppEnvironment.test,
          loadInterFromDependency: false,
          consumerRepository: FakeConsumerRepository(
            feedPages: <PublicPage<EventCardDto>>[
              const PublicPage<EventCardDto>(
                items: <EventCardDto>[],
                nextCursor: null,
              ),
            ],
          ),
          liveNewsRepository: liveRepository,
          personalOwnerModeEnabled: true,
          initialRoute: ConsumerRoutes.liveNews,
          locale: const Locale('es'),
        ),
      );
      await tester.pumpAndSettle();
      expect(liveRepository.pendingSourceLoads, hasLength(1));
      liveRepository.completeSourceLoad(0);
      await tester.pump();

      expect(
        find.text('Noticia escrita para pruebas: océano & atmósfera — señales'),
        findsOneWidget,
      );
      expect(find.text('Administración · estado local'), findsNothing);
      expect(find.text('Administración'), findsNothing);
      expect(find.byTooltip('Más opciones'), findsOneWidget);

      await _tap(tester, find.text('Acontecimientos'));
      expect(
        find.text('No hay eventos públicos disponibles por ahora.'),
        findsOneWidget,
      );
      await _tapAndResolveSources(tester, liveRepository);
      await _tap(tester, find.byTooltip('Más opciones'));
      await _tap(tester, find.text('Contradicciones'));
      expect(find.text('Contradicciones publicadas'), findsOneWidget);
      await _tap(tester, find.text('Actualidad'));
      expect(
        find.text('Noticia escrita para pruebas: océano & atmósfera — señales'),
        findsOneWidget,
      );

      await _tap(tester, find.byTooltip('Más opciones'));
      await _tap(tester, find.text('Administración'));
      expect(find.text('Administración · estado local'), findsOneWidget);

      await _tap(tester, find.byTooltip('Volver a Actualidad'));
      expect(find.text('Administración · estado local'), findsNothing);
      expect(
        find.text('Noticia escrita para pruebas: océano & atmósfera — señales'),
        findsOneWidget,
      );
    },
  );
}
