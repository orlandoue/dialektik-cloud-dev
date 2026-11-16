import 'package:dialektik/features/arena/data/arena_account.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/consumer/data/consumer_repository.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
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

/// Core with migration 085: posture votes and the three community channels.
class ArenaFullCore extends ArenaFakeCore implements ArenaSocialRepository {
  final Map<String, int> otherVotes = <String, int>{
    positionAId: 2,
    positionBId: 1,
  };
  String? myPosition;
  final List<String?> positionVoteCalls = <String?>[];
  final List<String?> aliases = <String?>[];
  int _nextId = 10;
  List<CommunityEntry> entries = <CommunityEntry>[
    CommunityEntry(
      id: 'e1',
      channel: CommunityChannel.debate,
      author: 'Lector-3F9A',
      body: 'Para mí ambos medios dicen cosas compatibles.',
      createdAt: DateTime.now().subtract(const Duration(days: 4)),
      upvotes: 2,
    ),
    CommunityEntry(
      id: 'e2',
      channel: CommunityChannel.aporte,
      author: 'Ana P.',
      body: 'Acta de la audiencia publicada por el Poder Judicial.',
      url: Uri.parse('https://www.pjud.cl/docs/acta-audiencia.pdf'),
      createdAt: DateTime.now().subtract(const Duration(hours: 3)),
      upvotes: 5,
      downvotes: 1,
    ),
    CommunityEntry(
      id: 'e3',
      channel: CommunityChannel.nota,
      author: 'Lector-77C2',
      body: 'El procedimiento abreviado exige aceptar los hechos.',
      articleId: 'art1',
      url: Uri.parse('https://latercera.com/nota/art1'),
      createdAt: DateTime.now().subtract(const Duration(hours: 1)),
    ),
  ];

  PositionVotes get _votes {
    final Map<String, int> counts = Map<String, int>.of(otherVotes);
    if (myPosition case final String mine) {
      counts[mine] = (counts[mine] ?? 0) + 1;
    }
    return PositionVotes(
      total: counts.values.fold<int>(0, (int a, int b) => a + b),
      mine: myPosition,
      byPosition: counts,
    );
  }

  @override
  Future<PositionVotes> positionVotes(String eventId) async => _votes;

  @override
  Future<PositionVotes> votePosition(String eventId, String? positionId) async {
    positionVoteCalls.add(positionId);
    myPosition = positionId;
    return _votes;
  }

  @override
  Future<List<CommunityEntry>> communityEntries(String eventId) async =>
      List<CommunityEntry>.of(entries);

  @override
  Future<List<CommunityEntry>> addCommunityEntry(
    String eventId, {
    required CommunityChannel channel,
    required String body,
    String? articleId,
    Uri? link,
    String? alias,
  }) async {
    aliases.add(alias);
    entries = <CommunityEntry>[
      CommunityEntry(
        id: 'e${_nextId++}',
        channel: channel,
        author: 'Lector-AB12',
        body: body,
        articleId: articleId,
        url:
            link ??
            (articleId == null
                ? null
                : Uri.parse('https://biobiochile.cl/nota/$articleId')),
        createdAt: DateTime.now(),
        mine: true,
      ),
      ...entries,
    ];
    return communityEntries(eventId);
  }

  @override
  Future<List<CommunityEntry>> voteCommunityEntry(
    String entryId,
    int? vote,
  ) async {
    entries = <CommunityEntry>[
      for (final CommunityEntry e in entries)
        if (e.id != entryId)
          e
        else
          CommunityEntry(
            id: e.id,
            channel: e.channel,
            author: e.author,
            body: e.body,
            articleId: e.articleId,
            url: e.url,
            createdAt: e.createdAt,
            mine: e.mine,
            myVote: vote,
            upvotes: e.upvotes - (e.myVote == 1 ? 1 : 0) + (vote == 1 ? 1 : 0),
            downvotes:
                e.downvotes - (e.myVote == -1 ? 1 : 0) + (vote == -1 ? 1 : 0),
          ),
    ];
    return communityEntries(duelEventId);
  }
}

const String steinertTitle =
    'El arte de caer parado: Steinert vuelve al Gobierno';
const String steinertHeadline =
    '"Trinidad Steinert vuelve al Gobierno": Su polémico paso por Seguridad '
    'y nuevo cargo en Paraguay';
const LiveSourceDto terceraVideo = LiveSourceDto(
  id: '01K4W4M7R0B000000000000034',
  name: 'La Tercera (YouTube)',
  sourceType: 'video',
  canonicalDomain: 'youtube.com',
);

/// A duel exactly as Core serves it: prefixed title, lowercase relation
/// and a two-word quote extracted before the minimum length existed.
final EventDetailDto steinertEvent = EventDetailDto.fromJson(<String, Object?>{
  ...eventDetailJson(
    id: duelEventId,
    title: steinertTitle,
    analysisState: 'PUBLISHED',
    positionCount: 2,
    withPrimaryFact: false,
  ),
  'category': 'pais',
  'source_count': 2,
  'positions': <Object?>[
    <String, Object?>{
      'id': positionAId,
      'title': 'Steinert regresa al Ejecutivo tras su salida de Seguridad',
      'assertions': <Object?>[
        _assertion(
          'as1',
          'La exsubsecretaria regresa al Ejecutivo meses después de su salida',
          'art1',
          biobio,
        ),
      ],
    },
    <String, Object?>{
      'id': positionBId,
      'title': 'nuevo cargo',
      'assertions': <Object?>[
        <String, Object?>{
          ..._assertion('as2', 'nuevo cargo', 'art2', t13),
          'assertion_text': 'nuevo cargo',
        },
      ],
    },
  ],
  'articles': <Object?>[
    _article(
      'art1',
      'Steinert vuelve al Gobierno como agregada en Paraguay',
      biobio,
      '2026-11-08T12:00:00.000Z',
    ),
    _article('art2', steinertHeadline, t13, '2026-11-09T09:30:00.000Z'),
  ],
  'contrasts': <Object?>[
    <String, Object?>{
      'id': 'c1',
      'position_a_id': positionAId,
      'position_b_id': positionBId,
      'kind': 'contrast',
    },
  ],
});

class ArenaServedCore extends ArenaFakeCore {
  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) async => PublicPage<EventCardDto>(
    items: <EventCardDto>[storyEvent, steinertEvent],
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
        'event_title': 'Contraste de enfoques: $steinertTitle',
        'threshold_rule': 'v1:editorial_focus_contrast',
        'confirmed_at': '2026-11-09T10:00:00.000Z',
        'position_b': <String, Object?>{
          'id': positionBId,
          'ordinal': 2,
          'title': 'nuevo cargo',
        },
      }),
    ],
    nextCursor: null,
  );

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    dynamic requestToken,
  }) async => eventId == duelEventId ? steinertEvent : storyEvent;

  @override
  Future<List<LiveSourceDto>> listLiveSources({
    bool refresh = false,
    dynamic requestToken,
  }) async => const <LiveSourceDto>[tercera, biobio, t13, terceraVideo];
}

/// Core with several published duels, to exercise the carousel.
class ArenaManyDuelsCore extends ArenaFullCore {
  static const int count = 7;
  static String idOf(int i) =>
      '01K4W4M7R0B0000000000001${i.toString().padLeft(2, '0')}';
  static String titleOf(int i) => 'Duelo número ${i + 1} sobre el presupuesto';

  EventDetailDto _event(int i) => EventDetailDto.fromJson(<String, Object?>{
    ...eventDetailJson(
      id: idOf(i),
      title: titleOf(i),
      analysisState: 'PUBLISHED',
      positionCount: 2,
      withPrimaryFact: false,
    ),
    'category': 'economia',
    'source_count': 2,
    'positions': <Object?>[
      <String, Object?>{
        'id': positionAId,
        'title': 'El presupuesto crece según el Ejecutivo',
        'assertions': <Object?>[
          _assertion(
            'a$i',
            'El gasto público crecerá el próximo año según Hacienda',
            'x$i',
            tercera,
          ),
        ],
      },
      <String, Object?>{
        'id': positionBId,
        'title': 'El presupuesto se contrae en términos reales',
        'assertions': <Object?>[
          _assertion(
            'b$i',
            'En términos reales el presupuesto se contrae, dicen economistas',
            'y$i',
            biobio,
          ),
        ],
      },
    ],
    'articles': <Object?>[
      _article(
        'x$i',
        'Hacienda presenta el presupuesto',
        tercera,
        '2026-11-0${i + 1}T12:00:00.000Z',
      ),
      _article(
        'y$i',
        'Economistas cuestionan el presupuesto',
        biobio,
        '2026-11-0${i + 1}T15:00:00.000Z',
      ),
    ],
    'contrasts': <Object?>[
      <String, Object?>{
        'id': 'c$i',
        'position_a_id': positionAId,
        'position_b_id': positionBId,
        'kind': i.isEven ? 'contradiction' : 'contrast',
      },
    ],
  });

  @override
  Future<PublicPage<EventCardDto>> listFeed({
    String? category,
    String? topic,
    String? cursor,
    int limit = 20,
    bool refresh = false,
    dynamic requestToken,
  }) async => PublicPage<EventCardDto>(
    items: <EventCardDto>[for (int i = 0; i < count; i++) _event(i)],
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
      for (int i = 0; i < count; i++)
        ContradictionDto.fromJson(<String, Object?>{
          ...contradictionJson(),
          'id': '01K4W4M7R0B0000000000002${i.toString().padLeft(2, '0')}',
          'event_id': idOf(i),
          'event_title': titleOf(i),
          // The first duel is the most recent one.
          'confirmed_at':
              '2026-11-${(20 - i).toString().padLeft(2, '0')}T10:00:00.000Z',
        }),
    ],
    nextCursor: null,
  );

  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    dynamic requestToken,
  }) async => _event(int.parse(eventId.substring(eventId.length - 2)));
}

/// A signed-in reader for tests.
class FakeArenaAccount extends ArenaAccount {
  FakeArenaAccount({this.alias = 'Ana P.', this.email = 'ana@example.test'});

  @override
  String alias;
  @override
  final String? email;
  int signOuts = 0;

  @override
  Future<void> updateAlias(String value) async {
    alias = value;
    notifyListeners();
  }

  @override
  Future<void> signOut() async => signOuts++;
}

/// Mounts the Arena on a phone-sized surface with the requested text scale.
Future<List<Uri>> pumpArena(
  WidgetTester tester,
  ArenaFakeCore core, {
  double textScale = 1,
  Size size = const Size(390, 844),
  ArenaTab initialTab = ArenaTab.inicio,
  List<Widget> extraActions = const <Widget>[],
  ArenaAccount? account,
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
        account: account,
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
