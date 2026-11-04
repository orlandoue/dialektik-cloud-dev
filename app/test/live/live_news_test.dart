import 'dart:async';
import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_client.dart';
import 'package:dialektik/features/live/data/candidate_source_registry.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/presentation/live_components.dart';
import 'package:dialektik/features/live/presentation/live_news_screens.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'live_fixtures.dart';

Future<void> mountLive(
  WidgetTester tester,
  PublicApiClient client, {
  String route = '/live/news',
  Future<bool> Function(Uri)? opener,
}) async {
  await tester.pumpWidget(
    DialektikApp(
      key: UniqueKey(),
      environment: AppEnvironment.test,
      loadInterFromDependency: false,
      consumerRepository: client,
      liveNewsRepository: client,
      initialRoute: route,
      locale: const Locale('es'),
      externalLinkOpener: opener ?? (Uri uri) async => true,
    ),
  );
  // The source screen loads its local candidate registry asynchronously and
  // displays an indeterminate progress indicator while it does so. Advance a
  // bounded number of frames instead of waiting for that animation to settle.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump();
}

Future<void> tapLive(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  test(
    'the bundled 50-source catalogue fails closed for every candidate',
    () async {
      final candidates = await CandidateSourceRegistry.load();
      expect(candidates, hasLength(50));
      expect(
        candidates.map((candidate) => candidate.domain).toSet(),
        hasLength(50),
      );
      expect(
        candidates.map((candidate) => candidate.id).toSet(),
        hasLength(50),
      );
      expect(
        candidates
            .firstWhere((candidate) => candidate.name == 'BioBioChile')
            .rightsState,
        'NO ACREDITADO',
      );
      expect(
        candidates.every(
          (candidate) => candidate.operationalState == 'NOT_VALIDATED',
        ),
        isTrue,
      );
      expect(
        candidates.every(
          (candidate) =>
              candidate.currentTechnicalState == 'NOT_RECHECKED' &&
              candidate.currentRightsOperations.length == 8 &&
              candidate.acquisitionAuthorizationState == 'NOT_AUTHORIZED',
        ),
        isTrue,
      );
    },
  );

  test(
    'Chile beta display excludes GOV.UK publisher from news and sources',
    () {
      const LiveSourceDto chile = LiveSourceDto(
        id: 'chile-test',
        name: 'BiobioChile',
        sourceType: 'radio',
        canonicalDomain: 'biobiochile.cl',
      );
      const LiveSourceDto uk = LiveSourceDto(
        id: 'uk-test',
        name: 'GOV.UK',
        sourceType: 'official_statistics',
        canonicalDomain: 'gov.uk',
      );
      const LiveSourceDto elDia = LiveSourceDto(
        id: 'eldia-test',
        name: 'Diario El Día',
        sourceType: 'news',
        canonicalDomain: 'diarioeldia.cl',
      );
      const LiveSourceDto elDiaWww = LiveSourceDto(
        id: 'eldia-www-test',
        name: 'Diario El Día',
        sourceType: 'news',
        canonicalDomain: 'www.diarioeldia.cl',
      );
      const LiveSourceDto unknown = LiveSourceDto(
        id: 'unknown-test',
        name: 'Synthetic',
        sourceType: 'other',
        canonicalDomain: 'news.dialektik.invalid',
      );
      expect(isChileBetaPublisher(chile), isTrue);
      expect(isChileBetaPublisher(elDia), isTrue);
      expect(isChileBetaPublisher(elDiaWww), isTrue);
      expect(isChileBetaPublisher(uk), isFalse);
      expect(isChileBetaPublisher(unknown), isFalse);
    },
  );

  test(
    'live contracts reject fixture/UNKNOWN, prohibited semantics and unauthorized body',
    () {
      final Map<String, Object?> article = liveTestArticle();
      expect(LiveNewsItemDto.fromJson(article).headline, article['headline']);
      expect(
        LiveNewsItemDto.fromJson(<String, Object?>{
          ...article,
          'semantic_assignment': 'EVENT_LINKED',
        }).headline,
        article['headline'],
      );
      expect(
        LiveNewsPageDto.fromJson(<String, Object?>{
          ...liveTestPage(),
          'semantic_mode': 'mixed',
          'items': <Object?>[
            article,
            <String, Object?>{
              ...article,
              'semantic_assignment': 'EVENT_LINKED',
            },
          ],
        }).items,
        hasLength(2),
      );
      expect(
        () => LiveNewsItemDto.fromJson(<String, Object?>{
          ...article,
          'origin': 'FIXTURE',
        }),
        throwsFormatException,
      );
      expect(
        () => LiveNewsItemDto.fromJson(<String, Object?>{
          ...article,
          'semantic_assignment': 'UNKNOWN',
        }),
        throwsFormatException,
      );
      expect(
        () => LiveNewsItemDto.fromJson(<String, Object?>{
          ...article,
          'event_id': 'invented',
        }),
        throwsFormatException,
      );
      expect(
        () => LiveNewsItemDto.fromJson(<String, Object?>{
          ...article,
          'published_at': '2026-10-03T02:00:00',
        }),
        throwsFormatException,
      );
      expect(
        () => LiveContentDto.fromJson(<String, Object?>{
          'representation': 'feed_excerpt',
          'storage_policy': 'METADATA_ONLY',
          'body': null,
          'text': 'not permitted',
        }),
        throwsFormatException,
      );
      expect(
        () => LiveContentDto.fromJson(<String, Object?>{
          'representation': 'feed_excerpt',
          'storage_policy': 'METADATA_AND_FEED_EXCERPT',
          'body': 'not permitted',
          'text': null,
        }),
        throwsFormatException,
      );
      expect(
        () => LiveNewsPageDto.fromJson(<String, Object?>{
          ...liveTestPage(),
          'semantic_mode': 'fixture',
        }),
        throwsFormatException,
      );
      expect(
        () => LiveProvenanceDto.fromJson(<String, Object?>{
          ...liveTestProvenance(),
          'receipt_count': 0,
        }),
        throwsFormatException,
      );
      final LiveProvenanceDto provenance = LiveProvenanceDto.fromJson(
        liveTestProvenance(),
      );
      expect(provenance.originalPublishedAt, 'Fri, 02 Oct 2026 23:00:00 -0300');
      expect(provenance.publishedAt, DateTime.utc(2026, 10, 3, 2));
    },
  );
  test(
    'date filters use local calendar days and exclusive UTC upper boundary',
    () {
      final DateTime now = DateTime(2026, 10, 3, 16);
      final (DateTime?, DateTime?) today = liveDateBounds(
        LiveDateFilter.today,
        now,
      );
      final (DateTime?, DateTime?) yesterday = liveDateBounds(
        LiveDateFilter.yesterday,
        now,
      );
      final (DateTime?, DateTime?) week = liveDateBounds(
        LiveDateFilter.week,
        now,
      );
      expect(today.$1, DateTime(2026, 10, 3).toUtc());
      expect(today.$2, DateTime(2026, 10, 4).toUtc());
      expect(yesterday.$2, today.$1);
      expect(week.$1, DateTime(2026, 9, 27).toUtc());
      expect(liveDateBounds(LiveDateFilter.all, now), (null, null));
    },
  );
  test(
    'typed live transport keeps filter scope, cursor and UTC boundaries',
    () async {
      final List<Uri> calls = <Uri>[];
      final PublicApiClient client = liveTestClient(calls: calls);
      final DateTime from = DateTime.utc(2026, 10, 3);
      final DateTime to = DateTime.utc(2026, 10, 4);
      await client.listLiveNews(
        query: 'océano & aire',
        sourceId: liveTestSourceId,
        cursor: 'page-2',
        publishedFrom: from,
        publishedTo: to,
      );
      expect(calls.single.path, '/live/news');
      expect(calls.single.queryParameters, <String, String>{
        'limit': '25',
        'cursor': 'page-2',
        'q': 'océano & aire',
        'source_id': liveTestSourceId,
        'published_from': from.toIso8601String(),
        'published_to': to.toIso8601String(),
      });
    },
  );

  testWidgets(
    'collection 404 remains a service error while a 200 empty response is an empty state',
    (WidgetTester tester) async {
      final PublicApiClient missingRoutes = liveTestClient(
        responder: (http.Request request) async =>
            liveJsonResponse(<String, Object?>{'statusCode': 404}, 404),
      );
      await mountLive(tester, missingRoutes);
      expect(
        find.text('El servicio de noticias no está disponible.'),
        findsOneWidget,
      );
      expect(
        find.text('Todavía no hay noticias recientes disponibles.'),
        findsNothing,
      );

      await mountLive(tester, missingRoutes, route: '/live/sources');
      expect(
        find.text('El servicio de fuentes no está disponible.'),
        findsOneWidget,
      );
      expect(find.text('Todavía no hay fuentes disponibles.'), findsNothing);

      final PublicApiClient emptyReader = liveTestClient(
        responder: (http.Request request) async =>
            request.url.path == '/live/news'
            ? liveJsonResponse(liveTestPage(items: <Object?>[]))
            : liveJsonResponse(<String, Object?>{'items': <Object?>[]}),
      );
      await mountLive(tester, emptyReader);
      expect(
        find.text('Todavía no hay noticias recientes disponibles.'),
        findsOneWidget,
      );
      expect(
        find.text('El servicio de noticias no está disponible.'),
        findsNothing,
      );

      await mountLive(tester, emptyReader, route: '/live/sources');
      expect(find.text('Todavía no hay fuentes operativas.'), findsOneWidget);
      expect(
        find.text('El servicio de fuentes no está disponible.'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'native development readers follow platform accessibility activation without refetching',
    (WidgetTester tester) async {
      final List<Uri> calls = <Uri>[];
      final PublicApiClient client = liveTestClient(calls: calls);
      await tester.pumpWidget(
        DialektikApp(
          environment: AppEnvironment.development,
          loadInterFromDependency: false,
          consumerRepository: client,
          liveNewsRepository: client,
          initialRoute: '/live/news',
          locale: const Locale('es'),
          externalLinkOpener: (Uri uri) async => true,
        ),
      );
      await tester.pumpAndSettle();
      final bool semanticsBefore = SemanticsBinding.instance.semanticsEnabled;
      final List<Uri> initialCalls = List<Uri>.of(calls);
      expect(
        initialCalls.map((Uri uri) => uri.path),
        unorderedEquals(<String>[
          '/live/news',
          '/live/sources',
          '/v1/feed',
        ]),
      );
      final SemanticsHandle semantics = tester.ensureSemantics();
      try {
        await tester.pump();
        expect(SemanticsBinding.instance.semanticsEnabled, isTrue);
        expect(
          find.bySemanticsLabel(
            RegExp('^(Ver noticia:|Abrir noticia más reciente:)'),
          ),
          findsOneWidget,
        );
        expect(calls, initialCalls);
      } finally {
        semantics.dispose();
      }
      await tester.pump();
      expect(SemanticsBinding.instance.semanticsEnabled, semanticsBefore);
      expect(calls, initialCalls);
      expect(tester.takeException(), isNull);
    },
    semanticsEnabled: false,
  );
  testWidgets(
    'live list, Article, Source, provenance and canonical keyboard action are honest',
    (WidgetTester tester) async {
      final List<Uri> calls = <Uri>[];
      final List<Uri> external = <Uri>[];
      final PublicApiClient client = liveTestClient(calls: calls);
      await mountLive(
        tester,
        client,
        opener: (Uri uri) async {
          external.add(uri);
          return true;
        },
      );
      expect(find.text('LIVE · SHADOW'), findsNothing);
      expect(find.text('DEMO'), findsNothing);
      expect(find.text('STRESS'), findsNothing);
      expect(
        calls.map((Uri uri) => uri.path),
        unorderedEquals(<String>[
          '/live/news',
          '/live/sources',
          '/v1/feed',
        ]),
      );
      await tapLive(
        tester,
        find.bySemanticsLabel(
          RegExp('^(Ver noticia:|Abrir noticia más reciente:)'),
        ),
      );
      expect(find.text('Historia aún no determinada'), findsOneWidget);
      expect(find.text('UNKNOWN'), findsNothing);
      expect(find.text('Dónde encaja esta noticia'), findsNothing);
      expect(find.text('Extracto de la fuente'), findsOneWidget);
      expect(find.text(liveTestDetail()['headline'] as String), findsOneWidget);
      expect(
        find.text(
          'Un extracto de prueba con acentos y “comillas”.\nUna segunda línea.',
        ),
        findsOneWidget,
      );
      final Finder externalTarget = find
          .descendant(
            of: find.byType(LiveExternalAction).first,
            matching: find.byType(FocusableActionDetector),
          )
          .first;
      tester
          .widget<FocusableActionDetector>(externalTarget)
          .focusNode!
          .requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(
        external.single,
        Uri.parse(liveTestArticle()['canonical_url'] as String),
      );
      await tapLive(
        tester,
        find.bySemanticsLabel(
          'Consultar fuente: Editorial de pruebas · sintético',
        ),
      );
      expect(find.text('Editorial de pruebas · sintético'), findsOneWidget);
      expect(find.text('diarioeldia.cl'), findsOneWidget);
      expect(find.text('LIVE · SHADOW'), findsNothing);
      await tapLive(tester, find.bySemanticsLabel('Volver'));
      await tapLive(tester, find.text('Consultar procedencia'));
      expect(find.text('Publicación y adquisición'), findsOneWidget);
      expect(find.text('RSS / Atom'), findsOneWidget);
      await tapLive(tester, find.text('Detalles técnicos'));
      expect(find.text('Fri, 02 Oct 2026 23:00:00 -0300'), findsOneWidget);
      expect(find.text('2026-10-03T02:00:00.000Z (UTC)'), findsOneWidget);
      expect(
        find.text('PRODUCT_LIVE_SHADOW_EXCLUDED_FROM_FINAL_V2'),
        findsOneWidget,
      );
      expect(
        calls.where((Uri uri) => uri.path.startsWith('/semantic/')),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'live provenance exposes field and value to assistive reading without empty text fields',
    (WidgetTester tester) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      try {
        final Map<String, Object?> responses = liveTestResponses();
        responses['/live/news/$liveTestArticleId/provenance'] =
            <String, Object?>{
              ...liveTestProvenance(),
              'original_modified_at': null,
            };
        await mountLive(
          tester,
          liveTestClient(responses: responses),
          route: '/live/news/$liveTestArticleId/provenance',
        );
        Future<void> expectSpoken(String label, String value) async {
          await tester.ensureVisible(find.text(value));
          await tester.pumpAndSettle();
          final String spoken = '$label: $value';
          final Finder target = find.bySemanticsLabel(spoken);
          expect(target, findsOneWidget);
          final SemanticsData data = tester
              .getSemantics(target)
              .getSemanticsData();
          expect(data.label, spoken);
          expect(data.flagsCollection.isTextField, isFalse);
          expect(find.text(value), findsOneWidget);
        }

        await expectSpoken(
          'Publicado por la fuente',
          liveLocalDate(DateTime.utc(2026, 10, 3, 2)),
        );
        await expectSpoken(
          'Visto por primera vez en Dialektik',
          liveLocalDate(DateTime.utc(2026, 10, 3, 4)),
        );
        await expectSpoken('Canal de adquisición', 'RSS / Atom');
        await tapLive(tester, find.text('Detalles técnicos'));
        await expectSpoken(
          'Publicación exacta',
          '2026-10-03T02:00:00.000Z (UTC)',
        );
        await expectSpoken(
          'Fecha original de publicación',
          'Fri, 02 Oct 2026 23:00:00 -0300',
        );
        await expectSpoken(
          'Fecha original de actualización',
          'No indicado por la fuente',
        );
        await expectSpoken(
          'URL canónica',
          'https://news.dialektik.invalid/news/$liveTestArticleId',
        );
        expect(tester.takeException(), isNull);
      } finally {
        semantics.dispose();
      }
    },
  );
  testWidgets(
    'metadata-only detail neither invents excerpt nor reports a full reader',
    (WidgetTester tester) async {
      final Map<String, Object?> responses = liveTestResponses();
      final Map<String, Object?> detail = <String, Object?>{
        ...liveTestDetail(),
        'excerpt': null,
        'author': null,
        'content': <String, Object?>{
          'representation': 'feed_excerpt',
          'text': null,
          'body': null,
          'storage_policy': 'METADATA_ONLY',
        },
      };
      responses['/live/news/$liveTestArticleId'] = detail;
      await mountLive(
        tester,
        liveTestClient(responses: responses),
        route: '/live/news/$liveTestArticleId',
      );
      expect(find.text('El contenido se lee en la fuente.'), findsOneWidget);
      expect(find.text('Extracto de la fuente'), findsNothing);
      expect(find.text('Historia aún no determinada'), findsOneWidget);
      expect(find.text('Leer texto completo'), findsNothing);
    },
  );

  testWidgets('source index renders the publishers returned by Core', (
    WidgetTester tester,
  ) async {
    final List<Uri> calls = <Uri>[];
    await tester.runAsync(() async {
      await CandidateSourceRegistry.load();
    });
    await mountLive(
      tester,
      liveTestClient(calls: calls),
      route: '/live/sources',
    );
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pump();

    expect(calls.any((Uri uri) => uri.path == '/live/sources'), isTrue);
    expect(find.text('Fuentes'), findsWidgets);
    await tester.drag(find.byKey(const Key('radar-scroll')),const Offset(0,-350));
    await tester.pumpAndSettle();
    expect(find.text('Editorial de pruebas · sintético'), findsOneWidget);
    expect(find.textContaining('Tu mezcla: 0 fuentes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'external launch failure preserves the reader and offers copyable canonical URL',
    (WidgetTester tester) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      try {
        await mountLive(
          tester,
          liveTestClient(),
          route: '/live/news/$liveTestArticleId',
          opener: (Uri uri) async => false,
        );
        await tapLive(tester, find.bySemanticsLabel('Abrir en la fuente'));
        expect(
          find.text(
            'No se pudo abrir el enlace. Puedes copiar esta dirección:',
          ),
          findsOneWidget,
        );
        expect(
          find.text(liveTestArticle()['canonical_url'] as String),
          findsOneWidget,
        );
        final String canonicalUrl =
            liveTestArticle()['canonical_url'] as String;
        await tester.ensureVisible(find.text(canonicalUrl));
        await tester.pumpAndSettle();
        final Finder accessibleUrl = find.bySemanticsLabel(
          'Dirección original: $canonicalUrl',
        );
        expect(accessibleUrl, findsOneWidget);
        expect(
          tester.getSemantics(accessibleUrl).getSemanticsData().label,
          'Dirección original: $canonicalUrl',
        );
        expect(find.text('Historia aún no determinada'), findsOneWidget);
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets(
    'search/publisher/date filters use Core metadata and preserve query on Back',
    (WidgetTester tester) async {
      final List<Uri> calls = <Uri>[];
      await mountLive(tester, liveTestClient(calls: calls));
      await tapLive(tester, find.text('Filtros'));
      await tester.enterText(find.byType(TextField), 'océano');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(calls.last.queryParameters['q'], 'océano');
      final Finder sourceStrip = find.byKey(
        const Key('live-source-filter-scroll'),
      );
      await tester.ensureVisible(sourceStrip);
      await tester.pumpAndSettle();
      await tester.drag(sourceStrip, const Offset(-400, 0));
      await tester.pumpAndSettle();
      await tester.tapAt(tester.getRect(sourceStrip).center);
      await tester.pumpAndSettle();
      expect(calls.last.queryParameters['source_id'], liveTestSourceId);
      await tapLive(tester, find.widgetWithText(ChoiceChip, 'Hoy'));
      expect(calls.last.queryParameters.containsKey('published_from'), isTrue);
      expect(calls.last.queryParameters.containsKey('published_to'), isTrue);
      await tapLive(
        tester,
        find.bySemanticsLabel(
          RegExp('^(Ver noticia:|Abrir noticia más reciente:)'),
        ),
      );
      await tapLive(tester, find.bySemanticsLabel('Volver'));
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'océano',
      );
      expect(
        find.text('Todavía no hay noticias recientes disponibles.'),
        findsNothing,
      );
      expect(find.byTooltip('Actualizar noticias'), findsOneWidget);
      await tapLive(tester, find.text('Limpiar filtros'));
      expect(
        calls.last.queryParameters.keys,
        unorderedEquals(<String>['limit']),
      );
    },
  );

  testWidgets('format filters show press and YouTube items from one feed', (
    WidgetTester tester,
  ) async {
    final List<Uri> calls = <Uri>[];
    final Map<String, Object?> responses = liveTestResponses();
    final Map<String, Object?> video = <String, Object?>{
      ...liveTestArticle(id: liveTestArticleId2),
      'headline': 'Video verificado de seguridad en Meganoticias',
      'canonical_url': 'https://www.youtube.com/watch?v=video-test-1',
      'source': <String, Object?>{
        ...liveTestSource(),
        'id': '01K6MYH0000000000000000011',
        'name': 'Meganoticias',
        'source_type': 'tv',
        'canonical_domain': 'youtube.com',
      },
    };
    responses['/live/news'] = liveTestPage(
      items: <Object?>[
        liveTestArticle(),
        video,
      ],
    );
    await mountLive(tester, liveTestClient(responses: responses, calls: calls));

    expect(
      find.text('Noticia escrita para pruebas: océano & atmósfera — señales'),
      findsOneWidget,
    );
    expect(find.text('Video verificado de seguridad en Meganoticias'), findsOneWidget);

    await tapLive(tester, find.text('Filtros'));
    await tapLive(tester, find.text('Prensa'));
    expect(calls.last.queryParameters['format'], 'press');
    expect(
      find.text('Noticia escrita para pruebas: océano & atmósfera — señales'),
      findsOneWidget,
    );
    expect(find.text('Video verificado de seguridad en Meganoticias'), findsNothing);

    await tapLive(tester, find.text('Videos'));
    expect(calls.last.queryParameters['format'], 'videos');
    expect(find.text('Noticia escrita para pruebas: océano & atmósfera — señales'), findsNothing);
    expect(find.text('Video verificado de seguridad en Meganoticias'), findsOneWidget);
    await tapLive(tester, find.text('Seguridad'));
    expect(calls.last.queryParameters['format'], 'videos');
    expect(calls.last.queryParameters['topic'], 'seguridad');
    expect(find.text('Video verificado de seguridad en Meganoticias'), findsOneWidget);
  });

  testWidgets('tapping a video title opens the original YouTube URL', (tester) async {
    final responses=liveTestResponses();
    final video=<String,Object?>{...liveTestArticle(),
      'headline':'Video de prueba', 'canonical_url':'https://youtu.be/aB3_deF-123',
      'source':<String,Object?>{...liveTestSource(),'canonical_domain':'youtube.com'}};
    responses['/live/news']=liveTestPage(items:<Object?>[video]);
    Uri? opened;
    await mountLive(tester,liveTestClient(responses:responses),opener:(uri) async {opened=uri;return true;});
    await tester.ensureVisible(find.text('Video de prueba'));
    await tester.tap(find.text('Video de prueba'));
    await tester.pump();
    expect(opened.toString(),'https://youtu.be/aB3_deF-123');
  });

  testWidgets('mobile news filters open on request and retain exact filters', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final List<Uri> calls = <Uri>[];
    await mountLive(tester, liveTestClient(calls: calls));

    expect(find.byKey(const Key('live-search-filters-panel')), findsNothing);
    await tapLive(tester, find.text('Filtros'));
    expect(find.byKey(const Key('live-search-filters-panel')), findsOneWidget);
    final Finder sourceStrip = find.byKey(
      const Key('live-source-filter-scroll'),
    );
    await tester.drag(sourceStrip, const Offset(-400, 0));
    await tester.pumpAndSettle();
    final Rect sourceViewport = tester.getRect(sourceStrip);
    await tester.tapAt(sourceViewport.center);
    await tester.pumpAndSettle();
    expect(calls.last.queryParameters['source_id'], liveTestSourceId);
  });

  testWidgets(
    'paged news append retains filters and distinguishes visible count',
    (WidgetTester tester) async {
      final List<Uri> calls = <Uri>[];
      final Map<String, Object?> bodies = liveTestResponses();
      final PublicApiClient client = liveTestClient(
        calls: calls,
        responder: (http.Request request) async {
          if (request.url.path == '/live/news') {
            return liveJsonResponse(
              request.url.queryParameters['cursor'] == null
                  ? liveTestPage(cursor: liveTestArticleId)
                  : liveTestPage(
                      items: <Object?>[liveTestArticle(id: liveTestArticleId2)],
                    ),
            );
          }
          return liveJsonResponse(bodies[request.url.path]);
        },
      );
      await mountLive(tester, client);
      await tapLive(tester, find.text('Filtros'));
      await tester.enterText(find.byType(TextField), 'océano');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      await tapLive(tester, find.text('Ver más noticias'));
      expect(find.byType(LiveLeadCard), findsOneWidget);
      expect(find.byType(LiveNewsCard), findsOneWidget);
      expect(find.text('2 noticias visibles'), findsOneWidget);
      expect(calls.last.queryParameters['q'], 'océano');
      expect(calls.last.queryParameters['cursor'], liveTestArticleId);
    },
  );

  testWidgets(
    'obsolete search result cannot replace the newer query response',
    (WidgetTester tester) async {
      final Completer<http.Response> oldQuery = Completer<http.Response>();
      final Map<String, Object?> bodies = liveTestResponses();
      final PublicApiClient client = liveTestClient(
        responder: (http.Request request) async {
          if (request.url.queryParameters['q'] == 'anterior') {
            return oldQuery.future;
          }
          return liveJsonResponse(bodies[request.url.path]);
        },
      );
      await mountLive(tester, client);
      await tapLive(tester, find.text('Filtros'));
      await tester.enterText(find.byType(TextField), 'anterior');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'actual');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      oldQuery.complete(liveJsonResponse(liveTestPage(items: <Object?>[])));
      await tester.pumpAndSettle();
      expect(find.byType(LiveLeadCard), findsOneWidget);
      expect(find.text('No hay noticias con estos filtros.'), findsNothing);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'actual',
      );
    },
  );

  testWidgets(
    'a source-filter error does not hide existing live news and is retryable',
    (WidgetTester tester) async {
      final Map<String, Object?> bodies = liveTestResponses();
      int sourceCalls = 0;
      final PublicApiClient client = liveTestClient(
        responder: (http.Request request) async {
          if (request.url.path == '/live/sources' && sourceCalls++ == 0) {
            return liveJsonResponse(<String, Object?>{}, 503);
          }
          return liveJsonResponse(bodies[request.url.path]);
        },
      );
      await mountLive(tester, client);
      expect(find.byType(LiveLeadCard), findsOneWidget);
      await tapLive(tester, find.text('Reintentar la lista de fuentes'));
      expect(find.text('Reintentar la lista de fuentes'), findsNothing);
    },
  );

  testWidgets(
    'long live metadata remains usable at responsive widths and 200 percent',
    (WidgetTester tester) async {
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      for (final double width in <double>[360, 390, 768, 1440]) {
        tester.view.physicalSize = Size(width, width < 768 ? 844 : 1000);
        for (final double scale in <double>[1, 2]) {
          tester.platformDispatcher.textScaleFactorTestValue = scale;
          for (final String route in <String>[
            '/live/news',
            '/live/news?source_id=$liveTestSourceId',
            '/live/news/$liveTestArticleId',
            '/live/sources/$liveTestSourceId',
            '/live/news/$liveTestArticleId/provenance',
          ]) {
            await mountLive(
              tester,
              liveTestClient(longText: true),
              route: route,
            );
            expect(
              tester.takeException(),
              isNull,
              reason: '$route at $width/$scale',
            );
            expect(find.text('LIVE · SHADOW'), findsNothing);
            await tester.drag(
              find.byType(Scrollbar).first,
              const Offset(0, -700),
            );
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
          }
        }
      }
    },
  );
}
