import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';

const String terceraId = '01K4W4M7R0B000000000000031';
const String biobioId = '01K4W4M7R0B000000000000032';
const String t13Id = '01K4W4M7R0B000000000000033';
const String duelEventId = '01K4W4M7R0B000000000000041';
const String storyEventId = '01K4W4M7R0B000000000000042';
const String duelTitle = 'Caso Hermosilla: ¿hubo acuerdo con la fiscalía?';
const String storyTitle = 'Despidos en Codelco tras el ajuste de Chuquicamata';

const LiveSourceDto tercera = LiveSourceDto(
  id: terceraId,
  name: 'La Tercera',
  sourceType: 'newspaper',
  canonicalDomain: 'latercera.com',
  category: 'Prensa nacional',
);
const LiveSourceDto biobio = LiveSourceDto(
  id: biobioId,
  name: 'BioBioChile',
  sourceType: 'newspaper',
  canonicalDomain: 'biobiochile.cl',
);
const LiveSourceDto t13 = LiveSourceDto(
  id: t13Id,
  name: 'T13 (YouTube)',
  sourceType: 'video',
  canonicalDomain: 'youtube.com',
);

LiveNewsItemDto newsItem(
  String id,
  String headline,
  LiveSourceDto source, {
  String? video,
}) => LiveNewsItemDto(
  id: id,
  headline: headline,
  canonicalUrl: Uri.parse(
    video == null
        ? 'https://${source.canonicalDomain}/nota/$id'
        : 'https://www.youtube.com/watch?v=$video',
  ),
  publishedAt: DateTime.now().subtract(const Duration(hours: 5)),
  firstSeenAt: DateTime.now().subtract(const Duration(hours: 5)),
  source: source,
  versionCount: 1,
);

Map<String, Object?> _article(
  String id,
  String title,
  LiveSourceDto source,
  String publishedAt, {
  String? video,
}) => <String, Object?>{
  'id': id,
  'title': title,
  'source_name': source.name,
  'source_id': source.id,
  'published_at': publishedAt,
  'url': video == null
      ? 'https://${source.canonicalDomain}/nota/$id'
      : 'https://www.youtube.com/watch?v=$video',
};

Map<String, Object?> _assertion(
  String id,
  String quote,
  String articleId,
  LiveSourceDto source,
) => <String, Object?>{
  'id': id,
  'assertion_text': 'Según ${source.name}: $quote',
  'quoted_text': quote,
  'article_id': articleId,
  'source_name': source.name,
  'source_id': source.id,
};

final EventDetailDto duelEvent = EventDetailDto.fromJson(<String, Object?>{
  ...eventDetailJson(
    id: duelEventId,
    title: duelTitle,
    analysisState: 'PUBLISHED',
    positionCount: 2,
    withPrimaryFact: false,
  ),
  'category': 'justicia',
  'source_count': 2,
  'synthesis_relation': 'DIFFERENT_FOCUS',
  'positions': <Object?>[
    <String, Object?>{
      'id': positionAId,
      'title': 'La defensa negocia un procedimiento abreviado',
      'assertions': <Object?>[
        _assertion(
          'as1',
          'La defensa confirmó conversaciones con el Ministerio Público',
          'art1',
          tercera,
        ),
      ],
    },
    <String, Object?>{
      'id': positionBId,
      'title': 'La fiscalía descarta cualquier acuerdo',
      'assertions': <Object?>[
        _assertion(
          'as2',
          'no existe ni existirá un acuerdo con el imputado',
          'art2',
          biobio,
        ),
      ],
    },
  ],
  'articles': <Object?>[
    _article(
      'art1',
      'Defensa de Hermosilla confirma conversaciones con fiscalía',
      tercera,
      '2026-11-08T12:00:00.000Z',
    ),
    _article(
      'art2',
      'Fiscalía descarta acuerdo en el caso Audios',
      biobio,
      '2026-11-09T09:30:00.000Z',
    ),
  ],
  'contrasts': <Object?>[
    <String, Object?>{
      'id': 'c1',
      'position_a_id': positionAId,
      'position_b_id': positionBId,
      'kind': 'DIFFERENT_FOCUS',
    },
  ],
});

final EventDetailDto storyEvent = EventDetailDto.fromJson(<String, Object?>{
  ...eventDetailJson(
    id: storyEventId,
    title: storyTitle,
    analysisState: 'PUBLISHED',
    positionCount: 1,
    withPrimaryFact: false,
  ),
  'category': 'economia',
  'source_count': 3,
  'positions': <Object?>[
    <String, Object?>{
      'id': 'p9',
      'title': 'Codelco confirma desvinculaciones',
      'assertions': <Object?>[
        _assertion(
          'as9',
          'La estatal confirmó la desvinculación de 300 trabajadores',
          'art3',
          tercera,
        ),
      ],
    },
  ],
  'articles': <Object?>[
    _article(
      'art3',
      'Codelco confirma 300 despidos en Chuquicamata',
      tercera,
      '2026-11-07T10:00:00.000Z',
    ),
    _article(
      'art4',
      'Sindicatos de Codelco anuncian movilización',
      biobio,
      '2026-11-08T15:00:00.000Z',
    ),
    _article(
      'art5',
      'Ministra Williams responde por los despidos en Codelco',
      t13,
      '2026-11-09T20:00:00.000Z',
      video: 'dQw4w9WgXcQ',
    ),
  ],
});

/// One in-memory Core used by every Arena widget test.
class ArenaFakeCore extends Fake
    implements
        ConsumerRepository,
        LiveNewsRepository,
        FollowingRepository,
        ScopedLiveNewsRepository,
        SocialRepository {
  final Set<String> followed = <String>{terceraId};
  final ValueNotifier<int> _changes = ValueNotifier<int>(0);
  final List<String> reactions = <String>[];
  final List<(String, String)> postedComments = <(String, String)>[];
  SocialSummary summary = SocialSummary(
    solid: 2,
    biased: 1,
    comments: <SocialComment>[
      SocialComment(
        body: 'El acta del tribunal respalda esta versión.',
        url: Uri.parse('https://latercera.com/nota/art1'),
        articleId: 'art1',
      ),
    ],
  );

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) async => PublicPage<EventCardDto>(
    items: <EventCardDto>[storyEvent, duelEvent],
    nextCursor: null,
  );

  @override
  Future<PublicPage<ContradictionDto>> listContradictions({
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) async => PublicPage<ContradictionDto>(
    items: <ContradictionDto>[
      ContradictionDto.fromJson(<String, Object?>{
        ...contradictionJson(),
        'event_id': duelEventId,
        'event_title': duelTitle,
        'confirmed_at': '2026-11-09T10:00:00.000Z',
      }),
    ],
    nextCursor: null,
  );

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    dynamic requestToken,
  }) async => eventId == duelEventId ? duelEvent : storyEvent;

  @override
  Future<List<LiveSourceDto>> listLiveSources({
    bool refresh = false,
    dynamic requestToken,
  }) async => const <LiveSourceDto>[tercera, biobio, t13];

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
  }) async {
    if (format == 'videos') {
      return LiveNewsPageDto(
        items: <LiveNewsItemDto>[
          newsItem(
            'v1',
            'Debate presidencial: el cruce por pensiones',
            t13,
            video: 'dQw4w9WgXcQ',
          ),
        ],
      );
    }
    return LiveNewsPageDto(
      items: <LiveNewsItemDto>[
        newsItem('n1', 'Gobierno presenta reforma al Congreso', tercera),
        newsItem('n2', 'Fiscal pide condena por fraude tributario', tercera),
        newsItem('n3', 'Colo Colo gana el campeonato de fútbol', tercera),
      ],
    );
  }

  @override
  Future<LiveNewsPageDto> listScopedLiveNews({
    required String scope,
    String? cursor,
    String? format,
    String? topic,
    String? query,
    String? sourceId,
    DateTime? publishedFrom,
    DateTime? publishedTo,
    bool refresh = false,
    dynamic requestToken,
  }) async => LiveNewsPageDto(
    items: <LiveNewsItemDto>[
      if (scope == 'outside')
        newsItem('o1', 'Investigación revela contratos sin licitación', biobio)
      else
        newsItem('f1', 'La Tercera: balance económico del trimestre', tercera),
    ],
  );

  @override
  bool get followingAvailable => true;

  @override
  Listenable get followingChanges => _changes;

  @override
  Future<Set<String>> listFollowedSources() async => Set<String>.of(followed);

  @override
  Future<void> setFollowing(String sourceId, {required bool following}) async {
    if (following) {
      followed.add(sourceId);
    } else {
      followed.remove(sourceId);
    }
  }

  @override
  Future<BlindspotsResult> listBlindspots() async => BlindspotsResult(
    items: <EventCardDto>[storyEvent],
    total: 1,
    followedSourceCount: followed.length,
  );

  @override
  Future<SocialSummary> socialSummary({
    String? eventId,
    String? sourceId,
  }) async => sourceId != null
      ? const SocialSummary(solid: 0, biased: 0, followers: 12)
      : summary;

  @override
  Future<SocialSummary> setSocialReaction(
    String eventId,
    String? reaction,
  ) async {
    reactions.add(reaction ?? 'none');
    return summary = SocialSummary(
      solid: reaction == 'SOLID' ? 3 : 2,
      biased: 1,
      mine: reaction,
      comments: summary.comments,
    );
  }

  @override
  Future<SocialSummary> addSocialComment(
    String eventId,
    String articleId,
    String body,
  ) async {
    postedComments.add((articleId, body));
    return summary = SocialSummary(
      solid: summary.solid,
      biased: summary.biased,
      mine: summary.mine,
      comments: <SocialComment>[
        SocialComment(
          body: body,
          url: Uri.parse('https://biobiochile.cl/nota/$articleId'),
          articleId: articleId,
        ),
        ...summary.comments,
      ],
    );
  }
}

/// Mounts the Arena on a phone-sized surface with the requested text scale.
Future<List<Uri>> pumpArena(
  WidgetTester tester,
  ArenaFakeCore core, {
  double textScale = 1,
  Size size = const Size(390, 844),
  ArenaTab initialTab = ArenaTab.inicio,
  List<Widget> extraActions = const <Widget>[],
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final List<Uri> opened = <Uri>[];
  await tester.pumpWidget(
    MaterialApp(
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: ArenaShell(
        consumer: core,
        live: core,
        initialTab: initialTab,
        extraActions: extraActions,
        offerWelcomeRadar: false,
        externalLinkOpener: (Uri uri) async {
          opened.add(uri);
          return true;
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
  return opened;
}

/// Scrolls [finder] into view inside the scrollable keyed [scrollKey].
Future<void> reveal(
  WidgetTester tester,
  Finder finder,
  String scrollKey,
) async {
  await tester.scrollUntilVisible(
    finder,
    220,
    scrollable: find
        .descendant(
          of: find.byKey(Key(scrollKey)),
          matching: find.byType(Scrollable),
        )
        .first,
  );
  await tester.pumpAndSettle();
}
