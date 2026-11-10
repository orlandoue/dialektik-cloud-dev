import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/presentation/living_event_screen.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:dialektik/features/live/data/chile_seismic_observations.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/live/presentation/chile_seismic_observations_panel.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Pestaña `Inicio`: Coliseo, Explorar y Siguiendo kept alive in memory.
class ArenaHomeTab extends StatefulWidget {
  const ArenaHomeTab({
    required this.store,
    required this.onOpenMedia,
    super.key,
  });

  final ArenaStore store;

  /// Switches to the `Medios` tab so the reader can choose sources.
  final VoidCallback onOpenMedia;

  @override
  State<ArenaHomeTab> createState() => _ArenaHomeTabState();
}

class _ArenaHomeTabState extends State<ArenaHomeTab> {
  static const List<String> _pills = <String>[
    'Coliseo',
    'Explorar',
    'Siguiendo',
  ];
  final Set<int> _built = <int>{0};
  int _pill = 0;

  ArenaStore get store => widget.store;

  void _openAlerts() => unawaited(
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: ArenaColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (BuildContext sheetContext) =>
          _AlertsSheet(store: store, hostContext: context),
    ),
  );

  @override
  Widget build(BuildContext context) => SafeArea(
    bottom: false,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 6, 2),
          child: Row(
            children: <Widget>[
              const Expanded(
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text('Dialektik', style: ArenaText.brand),
                  ),
                ),
              ),
              IconButton(
                key: const Key('arena-search'),
                tooltip: 'Buscar',
                color: ArenaColors.ink,
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ArenaSearchScreen(store: store),
                  ),
                ),
                icon: const Icon(Icons.search),
              ),
              IconButton(
                key: const Key('arena-alerts'),
                tooltip: 'Alertas de giros',
                color: ArenaColors.ink,
                onPressed: _openAlerts,
                icon: const Icon(Icons.notifications_none),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: ArenaPillBar(
            labels: _pills,
            selected: _pill,
            onSelected: (int value) => setState(() {
              _built.add(value);
              _pill = value;
            }),
          ),
        ),
        Expanded(
          child: IndexedStack(
            index: _pill,
            children: <Widget>[
              _Coliseo(store: store),
              if (_built.contains(1))
                _Explore(store: store)
              else
                const SizedBox.shrink(),
              if (_built.contains(2))
                _FollowingFeed(store: store, onOpenMedia: widget.onOpenMedia)
              else
                const SizedBox.shrink(),
            ],
          ),
        ),
      ],
    ),
  );
}

/// Pantalla 1 — panorama of the day.
class _Coliseo extends StatelessWidget {
  const _Coliseo({required this.store});

  final ArenaStore store;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (BuildContext context, _) {
      final List<EventCardDto> developing = store.developing.isEmpty
          ? store.events
          : store.developing;
      return RefreshIndicator(
        color: ArenaColors.violet,
        onRefresh: () => store.load(refresh: true),
        child: ListView(
          key: const Key('arena-coliseo-scroll'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: <Widget>[
            if (store.loading && !store.loaded)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(
                  child: CircularProgressIndicator(color: ArenaColors.violet),
                ),
              )
            else if (store.error != null && store.events.isEmpty)
              ArenaMessage(
                'No se pudo cargar el Coliseo.',
                actionLabel: 'Reintentar',
                onAction: () => unawaited(store.load(refresh: true)),
              )
            else ...<Widget>[
              if (store.duels.isNotEmpty)
                DuelOfTheDayCard(duel: store.duels.first, store: store)
              else
                const ArenaMessage('Hoy todavía no hay duelos publicados.'),
              if (developing.isNotEmpty) ...<Widget>[
                const Padding(
                  padding: EdgeInsets.only(top: 12, bottom: 10),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: ArenaBadge.live('EN DESARROLLO'),
                  ),
                ),
                for (final EventCardDto event in developing.take(5))
                  DevelopingEventCard(event: event, store: store),
              ],
              if (store.videos.isNotEmpty) ...<Widget>[
                const ArenaSectionTitle('Videos'),
                for (final LiveNewsItemDto video in store.videos)
                  ArenaVideoCard(
                    item: video,
                    onOpen: () => unawaited(store.openLink(video.canonicalUrl)),
                    onOpenSource: () =>
                        openArenaMedia(context, store, video.source.id),
                  ),
              ],
            ],
          ],
        ),
      );
    },
  );
}

/// `● EN DESARROLLO` row: thumbnail, title, sources and last update.
class DevelopingEventCard extends StatefulWidget {
  const DevelopingEventCard({
    required this.event,
    required this.store,
    this.note,
    super.key,
  });

  final EventCardDto event;
  final ArenaStore store;
  final String? note;

  @override
  State<DevelopingEventCard> createState() => _DevelopingEventCardState();
}

class _DevelopingEventCardState extends State<DevelopingEventCard> {
  EventDetailDto? _detail;

  @override
  void initState() {
    super.initState();
    _detail = widget.store.cachedDetail(widget.event.id);
    if (_detail == null) unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final EventDetailDto detail = await widget.store.detail(widget.event.id);
      if (mounted) setState(() => _detail = detail);
    } on Exception {
      /* The card keeps the feed data. */
    }
  }

  @override
  Widget build(BuildContext context) {
    final EventCardDto event = widget.event;
    final EventDetailDto? detail = _detail;
    DateTime updated = event.detectedAt;
    for (final EventCoverageArticleDto a
        in detail?.articles ?? const <EventCoverageArticleDto>[]) {
      if (a.publishedAt.isAfter(updated)) updated = a.publishedAt;
    }
    final ArenaTopic topic = arenaTopicOfEvent(event);
    return ArenaCard(
      key: ValueKey<String>('arena-event-${event.id}'),
      padding: const EdgeInsets.all(12),
      onTap: () => openArenaEvent(context, widget.store, event.id),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 84,
            child: AspectRatio(
              aspectRatio: 1,
              child: ArenaCover(
                topic: topic,
                videoId: detail == null ? null : arenaVideoIdOfEvent(detail),
                minHeight: 0,
                radius: 12,
                child: Center(
                  child: Icon(
                    arenaTopicIcon(topic),
                    color: const Color(0xCCFFFFFF),
                    size: 28,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  topic.label.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                    color: ArenaColors.emerald,
                  ),
                ),
                const SizedBox(height: 4),
                Text(event.titleDescriptive, style: ArenaText.cardTitle),
                const SizedBox(height: 6),
                Text(
                  '${event.sourceCount} '
                  '${event.sourceCount == 1 ? 'fuente' : 'fuentes'} · '
                  'Actualizada ${arenaAgo(updated)}',
                  style: ArenaText.meta,
                ),
                if (widget.note != null) ...<Widget>[
                  const SizedBox(height: 6),
                  Text(
                    widget.note!,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: ArenaColors.amberDeep,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Pantalla 6 — discovery outside the reader's usual media.
class _Explore extends StatelessWidget {
  const _Explore({required this.store});

  final ArenaStore store;

  static const List<ArenaTopic> _topics = <ArenaTopic>[
    ArenaTopic.politica,
    ArenaTopic.justicia,
    ArenaTopic.economia,
    ArenaTopic.medioambiente,
    ArenaTopic.ciencia,
    ArenaTopic.deportes,
    ArenaTopic.sociedad,
  ];

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (BuildContext context, _) {
      final List<EventCardDto> trending = store.events.toList()
        ..sort(
          (EventCardDto a, EventCardDto b) =>
              b.sourceCount.compareTo(a.sourceCount),
        );
      final SeismicObservationRepository? seismic = store.seismic;
      return ListView(
        key: const Key('arena-explore-scroll'),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: <Widget>[
          Semantics(
            button: true,
            child: Material(
              color: Colors.transparent,
              borderRadius: BorderRadius.circular(16),
              clipBehavior: Clip.antiAlias,
              child: Ink(
                decoration: const BoxDecoration(
                  gradient: ArenaColors.violetGradient,
                ),
                child: InkWell(
                  key: const Key('arena-blindspot-banner'),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => BlindspotScreen(store: store),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(
                          PhosphorIcons.binoculars(),
                          color: Colors.white,
                          size: 34,
                        ),
                        const SizedBox(width: 14),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                'Lo que no viste hoy',
                                style: TextStyle(
                                  fontFamily: ArenaText.serif,
                                  fontSize: 20,
                                  fontWeight: FontWeight.w700,
                                  color: Colors.white,
                                ),
                              ),
                              SizedBox(height: 6),
                              Text(
                                'Ángulos y datos que no aparecen en tus '
                                'medios habituales →',
                                style: TextStyle(
                                  fontSize: 14,
                                  height: 1.35,
                                  color: Color(0xFFEDE9FE),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          const ArenaSectionTitle('Tendencias en Dialektik'),
          if (trending.isEmpty)
            const ArenaMessage('Todavía no hay acontecimientos publicados.'),
          for (int i = 0; i < trending.length && i < 5; i++)
            ArenaCard(
              key: ValueKey<String>('arena-trend-${i + 1}'),
              padding: const EdgeInsets.all(12),
              onTap: () => openArenaEvent(context, store, trending[i].id),
              child: Row(
                children: <Widget>[
                  arenaNumberCircle(i + 1),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          trending[i].titleDescriptive,
                          style: ArenaText.cardTitle,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '🔥 ${trending[i].sourceCount} '
                          '${trending[i].sourceCount == 1 ? 'fuente' : 'fuentes'}',
                          style: ArenaText.meta,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.trending_up, color: ArenaColors.violet),
                ],
              ),
            ),
          const ArenaSectionTitle('Temas'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              for (final ArenaTopic topic in _topics)
                ArenaPill(
                  key: ValueKey<String>('arena-topic-${topic.name}'),
                  label: topic.label,
                  selected: false,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => TopicScreen(topic: topic, store: store),
                    ),
                  ),
                ),
            ],
          ),
          if (seismic != null) ...<Widget>[
            const SizedBox(height: 16),
            DecoratedBox(
              decoration: arenaCardDecoration(),
              child: Theme(
                data: Theme.of(
                  context,
                ).copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  key: const Key('arena-seismic'),
                  shape: const Border(),
                  iconColor: ArenaColors.violet,
                  collapsedIconColor: ArenaColors.muted,
                  leading: const Icon(Icons.sensors, color: ArenaColors.violet),
                  title: const Text(
                    'Actividad sísmica · USGS',
                    style: ArenaText.cardTitle,
                  ),
                  childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                  children: <Widget>[
                    ChileSeismicObservationsPanel(repository: seismic),
                  ],
                ),
              ),
            ),
          ],
        ],
      );
    },
  );
}

String _outsideReason(LiveNewsItemDto item) {
  if (extractYouTubeVideoId(item.canonicalUrl.toString()) != null) {
    return 'Video de un canal que no sigues';
  }
  final String category = (item.source.category ?? '').toLowerCase();
  if (category.contains('investig')) {
    return 'Cobertura de investigación de una fuente que no sigues';
  }
  if (category.contains('regional')) {
    return 'Cobertura regional de una fuente que no sigues';
  }
  return 'Cobertura de un medio que no sigues';
}

/// A press or video publication with its source and an optional reason.
class ArenaNewsCard extends StatelessWidget {
  const ArenaNewsCard({
    required this.item,
    required this.store,
    this.reason,
    this.trailing,
    super.key,
  });

  final LiveNewsItemDto item;
  final ArenaStore store;
  final String? reason;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final String? videoId = extractYouTubeVideoId(item.canonicalUrl.toString());
    return ArenaCard(
      padding: EdgeInsets.zero,
      onTap: () => unawaited(store.openLink(item.canonicalUrl)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (videoId != null) ArenaVideoFrame(videoId: videoId),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (reason != null) ...<Widget>[
                  ArenaBadge(
                    label: reason!,
                    background: ArenaColors.violetSoft,
                    foreground: ArenaColors.violetDeep,
                  ),
                  const SizedBox(height: 8),
                ],
                Text(item.headline, style: ArenaText.cardTitle),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    MediaNameRow(
                      name: item.source.name,
                      emblemSize: 24,
                      maxLines: 1,
                      onTap: () =>
                          openArenaMedia(context, store, item.source.id),
                    ),
                    Text(arenaAgo(item.publishedAt), style: ArenaText.meta),
                  ],
                ),
                ?trailing,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// «Lo que no viste hoy»: the Espejo engine for sources the reader skips.
class BlindspotScreen extends StatefulWidget {
  const BlindspotScreen({required this.store, super.key});

  final ArenaStore store;

  @override
  State<BlindspotScreen> createState() => _BlindspotScreenState();
}

class _BlindspotScreenState extends State<BlindspotScreen> {
  List<EventCardDto> _events = const <EventCardDto>[];
  List<LiveNewsItemDto> _news = const <LiveNewsItemDto>[];
  bool _loading = true;
  bool _unavailable = false;

  ArenaStore get store => widget.store;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final FollowingRepository? following = store.following;
    final ScopedLiveNewsRepository? scoped = store.scoped;
    if (following == null || scoped == null) {
      setState(() {
        _loading = false;
        _unavailable = true;
      });
      return;
    }
    List<EventCardDto> events = const <EventCardDto>[];
    List<LiveNewsItemDto> news = const <LiveNewsItemDto>[];
    try {
      events = (await following.listBlindspots()).items;
    } on Exception {
      /* Publications below still explain what was missed. */
    }
    try {
      news = (await scoped.listScopedLiveNews(scope: 'outside')).items;
    } on Exception {
      /* Events above remain available. */
    }
    if (!mounted) return;
    setState(() {
      _events = events;
      _news = news
          .where((LiveNewsItemDto n) => !store.followed.contains(n.source.id))
          .toList();
      _loading = false;
    });
  }

  Future<void> _follow(String sourceId) async {
    try {
      await store.setFollowing(sourceId, value: true);
      if (mounted) setState(() {});
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo seguir esta fuente.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: ArenaColors.background,
    appBar: AppBar(
      backgroundColor: ArenaColors.background,
      surfaceTintColor: Colors.transparent,
      foregroundColor: ArenaColors.ink,
      titleSpacing: 0,
      title: const FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          'Lo que no viste hoy',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ),
    ),
    body: _loading
        ? const Center(
            child: CircularProgressIndicator(color: ArenaColors.violet),
          )
        : ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
            children: <Widget>[
              if (_unavailable)
                const ArenaMessage(
                  'Inicia sesión y sigue al menos dos medios para que '
                  'Dialektik te muestre lo que queda fuera de tu radar.',
                )
              else if (_events.isEmpty && _news.isEmpty)
                const ArenaMessage(
                  'Hoy tus medios habituales cubrieron todo lo publicado.',
                ),
              if (_events.isNotEmpty)
                const ArenaSectionTitle('Acontecimientos fuera de tus medios'),
              for (final EventCardDto event in _events)
                DevelopingEventCard(
                  event: event,
                  store: store,
                  note: 'Ninguno de tus medios seguidos lo ha cubierto',
                ),
              if (_news.isNotEmpty)
                const ArenaSectionTitle('Publicaciones con otra mirada'),
              for (final LiveNewsItemDto item in _news)
                ArenaNewsCard(
                  item: item,
                  store: store,
                  reason: _outsideReason(item),
                  trailing: store.followed.contains(item.source.id)
                      ? null
                      : Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(
                            style: TextButton.styleFrom(
                              foregroundColor: ArenaColors.violet,
                              padding: EdgeInsets.zero,
                            ),
                            onPressed: () => _follow(item.source.id),
                            icon: const Icon(Icons.add, size: 18),
                            label: const Text('Seguir medio'),
                          ),
                        ),
                ),
            ],
          ),
  );
}

/// Events and publications of one discovery topic.
class TopicScreen extends StatefulWidget {
  const TopicScreen({required this.topic, required this.store, super.key});

  final ArenaTopic topic;
  final ArenaStore store;

  @override
  State<TopicScreen> createState() => _TopicScreenState();
}

class _TopicScreenState extends State<TopicScreen> {
  late final Future<List<LiveNewsItemDto>> _news = _load();

  Future<List<LiveNewsItemDto>> _load() async {
    final ArenaTopic topic = widget.topic;
    final LiveNewsPageDto page = await widget.store.live.listLiveNews(
      topic: topic.serverKey,
      query: topic.serverKey == null ? topic.label : null,
      limit: 25,
    );
    return page.items;
  }

  @override
  Widget build(BuildContext context) {
    final ArenaStore store = widget.store;
    final List<EventCardDto> events = store.events
        .where((EventCardDto e) => arenaTopicOfEvent(e) == widget.topic)
        .toList();
    return Scaffold(
      backgroundColor: ArenaColors.background,
      appBar: AppBar(
        backgroundColor: ArenaColors.background,
        surfaceTintColor: Colors.transparent,
        foregroundColor: ArenaColors.ink,
        titleSpacing: 0,
        title: FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            widget.topic.label,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: <Widget>[
          if (events.isNotEmpty) const ArenaSectionTitle('Acontecimientos'),
          for (final EventCardDto event in events)
            DevelopingEventCard(event: event, store: store),
          const ArenaSectionTitle('Publicaciones'),
          FutureBuilder<List<LiveNewsItemDto>>(
            future: _news,
            builder:
                (
                  BuildContext context,
                  AsyncSnapshot<List<LiveNewsItemDto>> snapshot,
                ) {
                  if (snapshot.hasError) {
                    return const ArenaMessage(
                      'No se pudieron cargar las publicaciones.',
                    );
                  }
                  final List<LiveNewsItemDto>? items = snapshot.data;
                  if (items == null) {
                    return const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(
                        child: CircularProgressIndicator(
                          color: ArenaColors.violet,
                        ),
                      ),
                    );
                  }
                  if (items.isEmpty) {
                    return const ArenaMessage(
                      'No hay publicaciones recientes en este tema.',
                    );
                  }
                  return Column(
                    children: <Widget>[
                      for (final LiveNewsItemDto item in items)
                        ArenaNewsCard(item: item, store: store),
                    ],
                  );
                },
          ),
        ],
      ),
    );
  }
}

/// Píldora `Siguiendo`: publications and stories of followed sources.
class _FollowingFeed extends StatefulWidget {
  const _FollowingFeed({required this.store, required this.onOpenMedia});

  final ArenaStore store;
  final VoidCallback onOpenMedia;

  @override
  State<_FollowingFeed> createState() => _FollowingFeedState();
}

class _FollowingFeedState extends State<_FollowingFeed> {
  List<LiveNewsItemDto> _items = const <LiveNewsItemDto>[];
  bool _loading = true;
  bool _failed = false;
  String _signature = '';

  ArenaStore get store => widget.store;

  @override
  void initState() {
    super.initState();
    store.addListener(_changed);
    unawaited(_load());
  }

  @override
  void dispose() {
    store.removeListener(_changed);
    super.dispose();
  }

  String get _currentSignature => (store.followed.toList()..sort()).join(',');

  void _changed() {
    if (_currentSignature != _signature) unawaited(_load());
  }

  Future<void> _load() async {
    final ScopedLiveNewsRepository? scoped = store.scoped;
    _signature = _currentSignature;
    if (scoped == null || store.following == null) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    try {
      final LiveNewsPageDto page = await scoped.listScopedLiveNews(
        scope: 'following',
        refresh: true,
      );
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _loading = false;
        _failed = false;
      });
    } on Exception {
      if (mounted) {
        setState(() {
          _loading = false;
          _failed = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final StoryFollowStore stories = store.stories;
    final List<EventCardDto> followedStories = store.events
        .where((EventCardDto e) => stories.contains(e.id))
        .toList();
    return RefreshIndicator(
      color: ArenaColors.violet,
      onRefresh: _load,
      child: ListView(
        key: const Key('arena-following-scroll'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: <Widget>[
          if (store.following == null)
            const ArenaMessage(
              'Inicia sesión para seguir medios y ver aquí su cobertura.',
            )
          else if (store.followed.isEmpty)
            ArenaMessage(
              'Todavía no sigues medios. Elige tus fuentes para armar esta '
              'vista.',
              actionLabel: 'Elegir medios',
              onAction: widget.onOpenMedia,
            )
          else if (_loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(
                child: CircularProgressIndicator(color: ArenaColors.violet),
              ),
            )
          else if (_failed)
            ArenaMessage(
              'No se pudo cargar la cobertura de tus medios.',
              actionLabel: 'Reintentar',
              onAction: () => unawaited(_load()),
            )
          else ...<Widget>[
            if (followedStories.isNotEmpty) ...<Widget>[
              const ArenaSectionTitle('Historias que sigues'),
              for (final EventCardDto event in followedStories)
                DevelopingEventCard(event: event, store: store),
            ],
            ArenaSectionTitle('De tus ${store.followed.length} medios'),
            if (_items.isEmpty)
              const ArenaMessage('Tus medios no tienen publicaciones nuevas.'),
            for (final LiveNewsItemDto item in _items)
              ArenaNewsCard(item: item, store: store),
          ],
        ],
      ),
    );
  }
}

class _AlertsSheet extends StatelessWidget {
  const _AlertsSheet({required this.store, required this.hostContext});

  final ArenaStore store;
  final BuildContext hostContext;

  @override
  Widget build(BuildContext context) {
    final StoryFollowStore stories = store.stories;
    final List<(EventCardDto, int)> changes = <(EventCardDto, int)>[
      for (final EventCardDto event in store.events)
        if (stories.snapshot(event.id) case final StorySnapshot snapshot)
          if (event.sourceCount > snapshot.sourceCount)
            (event, event.sourceCount - snapshot.sourceCount),
    ];
    return SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(20),
        children: <Widget>[
          const Text('Alertas de giros', style: ArenaText.section),
          const SizedBox(height: 8),
          if (changes.isEmpty)
            Text(
              stories.followedIds.isEmpty
                  ? 'Sigue un acontecimiento con 🔔 Seguir para recibir aquí '
                        'sus giros.'
                  : 'Sin giros nuevos en las historias que sigues.',
              style: ArenaText.body,
            ),
          for (final (EventCardDto event, int added) in changes)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.bolt, color: ArenaColors.amber),
              title: Text(event.titleDescriptive, style: ArenaText.cardTitle),
              subtitle: Text(
                '$added ${added == 1 ? 'fuente nueva' : 'fuentes nuevas'} '
                'desde tu última visita',
                style: ArenaText.meta,
              ),
              onTap: () {
                Navigator.of(context).pop();
                unawaited(openArenaEvent(hostContext, store, event.id));
              },
            ),
        ],
      ),
    );
  }
}

/// Search across published events and registered publications.
class ArenaSearchScreen extends StatefulWidget {
  const ArenaSearchScreen({required this.store, super.key});

  final ArenaStore store;

  @override
  State<ArenaSearchScreen> createState() => _ArenaSearchScreenState();
}

class _ArenaSearchScreenState extends State<ArenaSearchScreen> {
  final TextEditingController _input = TextEditingController();
  List<LiveNewsItemDto> _news = const <LiveNewsItemDto>[];
  String _query = '';
  bool _loading = false;
  int _run = 0;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _search(String value) async {
    final String query = value.trim();
    final int run = ++_run;
    setState(() {
      _query = query;
      _loading = query.isNotEmpty;
      if (query.isEmpty) _news = const <LiveNewsItemDto>[];
    });
    if (query.isEmpty) return;
    try {
      final LiveNewsPageDto page = await widget.store.live.listLiveNews(
        query: query,
        limit: 25,
      );
      if (mounted && run == _run) setState(() => _news = page.items);
    } on Exception {
      if (mounted && run == _run) {
        setState(() => _news = const <LiveNewsItemDto>[]);
      }
    } finally {
      if (mounted && run == _run) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ArenaStore store = widget.store;
    final String needle = _query.toLowerCase();
    final List<EventCardDto> events = needle.isEmpty
        ? const <EventCardDto>[]
        : store.events
              .where(
                (EventCardDto e) =>
                    e.titleDescriptive.toLowerCase().contains(needle),
              )
              .toList();
    return Scaffold(
      backgroundColor: ArenaColors.background,
      appBar: AppBar(
        backgroundColor: ArenaColors.background,
        surfaceTintColor: Colors.transparent,
        foregroundColor: ArenaColors.ink,
        titleSpacing: 0,
        title: TextField(
          key: const Key('arena-search-input'),
          controller: _input,
          autofocus: true,
          textInputAction: TextInputAction.search,
          onSubmitted: _search,
          decoration: const InputDecoration(
            hintText: 'Buscar casos, medios o temas',
            border: InputBorder.none,
          ),
        ),
        actions: <Widget>[
          IconButton(
            tooltip: 'Buscar',
            onPressed: () => _search(_input.text),
            icon: const Icon(Icons.search),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: <Widget>[
          if (_query.isEmpty)
            const ArenaMessage(
              'Escribe un tema, un nombre o un medio y presiona buscar.',
            ),
          if (events.isNotEmpty) const ArenaSectionTitle('Acontecimientos'),
          for (final EventCardDto event in events)
            DevelopingEventCard(event: event, store: store),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                child: CircularProgressIndicator(color: ArenaColors.violet),
              ),
            ),
          if (_news.isNotEmpty) const ArenaSectionTitle('Publicaciones'),
          for (final LiveNewsItemDto item in _news)
            ArenaNewsCard(item: item, store: store),
          if (_query.isNotEmpty && !_loading && events.isEmpty && _news.isEmpty)
            const ArenaMessage('Sin resultados para esta búsqueda.'),
        ],
      ),
    );
  }
}
