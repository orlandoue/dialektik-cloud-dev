import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:dialektik/features/social/presentation/dialektik_stories_bar.dart';
import 'package:dialektik/features/social/presentation/media_public_profile.dart';
import 'package:dialektik/features/social/presentation/social_contrast_post.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../support/public_api_fixtures.dart';

class _StoriesRepo extends Fake implements ConsumerRepository {
  _StoriesRepo(this.event);
  final EventDetailDto event;
  @override
  Future<PublicPage<ContradictionDto>> listContradictions({
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) async => PublicPage(
    items: [
      ContradictionDto.fromJson({
        ...contradictionJson(),
        'position_a': {'id': 'a', 'ordinal': 1, 'title': 'Postura A'},
        'position_b': {'id': 'b', 'ordinal': 2, 'title': 'Postura B'},
      }),
    ],
    nextCursor: null,
  );
  @override
  Future<EventDetailDto> getEvent(
    String id, {
    bool refresh = false,
    dynamic requestToken,
  }) async => event;
}

class _LiveRepo extends Fake implements LiveNewsRepository {
  @override
  Future<LiveNewsPageDto> listLiveNews({
    String? cursor,
    int limit = 25,
    String? query,
    String? sourceId,
    String? format,
    String? topic,
    DateTime? publishedFrom,
    DateTime? publishedTo,
    bool refresh = false,
    dynamic requestToken,
  }) async => const LiveNewsPageDto(items: []);
}

class _SocialRepo extends _LiveRepo implements SocialRepository {
  SocialSummary current = const SocialSummary(solid: 2, biased: 1);
  @override
  Future<SocialSummary> socialSummary({
    String? eventId,
    String? sourceId,
  }) async => current;
  @override
  Future<SocialSummary> setSocialReaction(
    String eventId,
    String? reaction,
  ) async => current = SocialSummary(solid: 3, biased: 1, mine: reaction);
  @override
  Future<SocialSummary> addSocialComment(
    String eventId,
    String articleId,
    String body,
  ) async => current = SocialSummary(
    solid: 3,
    biased: 1,
    mine: 'SOLID',
    comments: [
      SocialComment(body: body, url: Uri.parse('https://example.cl/nota')),
    ],
  );
}

void main() {
  final event = EventDetailDto.fromJson({
    ...eventDetailJson(
      id: publishedEventId,
      analysisState: 'PUBLISHED',
      positionCount: 2,
    ),
    'positions': [
      {
        'id': 'a',
        'title': 'Postura A',
        'assertions': [
          {
            'id': 'aa',
            'assertion_text': 'A',
            'quoted_text': 'Cita literal A',
            'article_id': '1',
            'source_name': 'Medio A',
          },
        ],
      },
      {
        'id': 'b',
        'title': 'Postura B',
        'assertions': [
          {
            'id': 'bb',
            'assertion_text': 'B',
            'quoted_text': 'Cita literal B',
            'article_id': '2',
            'source_name': 'Medio B',
          },
        ],
      },
    ],
    'articles': <Object?>[],
    'contrasts': <Object?>[],
  });
  for (final scale in [1.0, 1.45]) {
    testWidgets('stories y visor con escala $scale', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(
              size: const Size(390, 844),
              textScaler: TextScaler.linear(scale),
            ),
            child: Scaffold(
              body: DialektikStoriesBar(repository: _StoriesRepo(event)),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('VS'), findsOneWidget);
      await tester.tap(find.text('VS'));
      await tester.pumpAndSettle();
      expect(find.text('“Cita literal A”'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
    testWidgets('post, reacciones y carrusel con escala $scale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(
              size: const Size(390, 844),
              textScaler: TextScaler.linear(scale),
            ),
            child: Scaffold(
              body: SingleChildScrollView(
                child: SocialContrastPost(
                  event: event,
                  positions: event.coveragePositions,
                  onOpenEvent: () {},
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('1/3 · Desliza'), findsOneWidget);
      expect(find.text('✓ Sólido'), findsOneWidget);
      await tester.ensureVisible(find.text('💬 Debate'));
      await tester.tap(find.text('💬 Debate'));
      await tester.pumpAndSettle();
      expect(find.textContaining('2/3 · Desliza'), findsOneWidget);
      expect(find.text('“Cita literal A”'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
    testWidgets('perfil de medio con escala $scale', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      const source = LiveSourceDto(
        id: 'one',
        name: 'Medio A',
        sourceType: 'rss',
        canonicalDomain: 'example.cl',
      );
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(
              size: const Size(390, 844),
              textScaler: TextScaler.linear(scale),
            ),
            child: MediaPublicProfileScreen(
              source: source,
              repository: _LiveRepo(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Medio A'), findsOneWidget);
      expect(find.text('Radiografía de la comunidad'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('reacciones usan recuentos compartidos de la API', (
    tester,
  ) async {
    final repository = _SocialRepo();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SocialContrastPost(
              event: event,
              positions: event.coveragePositions,
              onOpenEvent: () {},
              sourcesRepository: repository,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('✓ Sólido 2'), findsOneWidget);
    await tester.ensureVisible(find.text('✓ Sólido 2'));
    await tester.tap(find.text('✓ Sólido 2'));
    await tester.pumpAndSettle();
    expect(find.text('✓ Sólido 3'), findsOneWidget);
    expect(repository.current.mine, 'SOLID');
  });
  testWidgets('un aporte compartido conserva el enlace a la noticia', (
    tester,
  ) async {
    final repository = _SocialRepo();
    final withArticle = EventDetailDto.fromJson({
      ...eventDetailJson(
        id: publishedEventId,
        analysisState: 'PUBLISHED',
        positionCount: 2,
      ),
      'positions': <Object?>[],
      'articles': [
        {
          'id': 'article1',
          'title': 'Noticia original',
          'source_name': 'Medio A',
          'published_at': '2026-11-06T10:00:00Z',
          'url': 'https://example.cl/nota',
        },
      ],
      'contrasts': <Object?>[],
    });
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SocialContrastPost(
              event: withArticle,
              positions: const [],
              onOpenEvent: () {},
              sourcesRepository: repository,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('💬 Debate 0'));
    await tester.tap(find.text('💬 Debate 0'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Contexto de la noticia');
    await tester.tap(find.text('Publicar'));
    await tester.pumpAndSettle();
    expect(find.text('Contexto de la noticia'), findsOneWidget);
    expect(find.text('Ver evidencia ↗'), findsOneWidget);
  });
}
