import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/material.dart';

/// Real publications and case participation of one registered medium.
final class MediaCoverage {
  const MediaCoverage({required this.items, required this.events});

  final List<LiveNewsItemDto> items;
  final List<EventDetailDto> events;

  int get videoCount => items
      .where(
        (LiveNewsItemDto item) =>
            extractYouTubeVideoId(item.canonicalUrl.toString()) != null,
      )
      .length;

  /// Topic shares for the ring, computed over the loaded publications.
  List<DonutSlice> get slices {
    const List<ArenaTopic> shown = <ArenaTopic>[
      ArenaTopic.politica,
      ArenaTopic.economia,
      ArenaTopic.justicia,
      ArenaTopic.sociedad,
      ArenaTopic.deportes,
    ];
    final Map<ArenaTopic, int> counts = <ArenaTopic, int>{};
    for (final LiveNewsItemDto item in items) {
      final ArenaTopic topic = arenaTopicOfText(
        '${item.headline} ${item.excerpt ?? ''}',
      );
      final ArenaTopic bucket = shown.contains(topic)
          ? topic
          : ArenaTopic.otros;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return <DonutSlice>[
      for (int i = 0; i < shown.length; i++)
        (
          label: shown[i].label,
          value: counts[shown[i]] ?? 0,
          color: arenaDonutColors[i],
        ),
      (
        label: 'Otros',
        value: counts[ArenaTopic.otros] ?? 0,
        color: arenaDonutColors.last,
      ),
    ];
  }
}

bool _covers(EventDetailDto event, LiveSourceDto source) {
  final String name = arenaSourceName(source.name).toLowerCase();
  return event.articles.any(
    (EventCoverageArticleDto a) =>
        a.sourceId == source.id ||
        (a.sourceId == null &&
            arenaSourceName(a.sourceName).toLowerCase() == name),
  );
}

Future<MediaCoverage> loadMediaCoverage(
  ArenaStore store,
  LiveSourceDto source,
) async {
  final DateTime monthAgo = DateTime.now().subtract(const Duration(days: 30));
  final List<LiveNewsItemDto> items = <LiveNewsItemDto>[];
  String? cursor;
  var pages = 0;
  do {
    final LiveNewsPageDto page = await store.live.listLiveNews(
      sourceId: source.id,
      limit: 50,
      cursor: cursor,
      publishedFrom: monthAgo,
    );
    items.addAll(page.items);
    cursor = page.nextCursor == cursor ? null : page.nextCursor;
  } while (cursor != null && ++pages < 3);
  final List<EventDetailDto?> details = await Future.wait(
    store.events.map((EventCardDto event) async {
      try {
        return await store.detail(event.id);
      } on Exception {
        return null;
      }
    }),
  );
  return MediaCoverage(
    items: items,
    events: details
        .whereType<EventDetailDto>()
        .where((EventDetailDto event) => _covers(event, source))
        .toList(),
  );
}

String arenaMediaKind(LiveSourceDto source) {
  final bool video =
      source.name.toLowerCase().contains('youtube') ||
      source.canonicalDomain.contains('youtube');
  final String? category = source.category;
  return '${video ? 'Canal de video' : 'Prensa escrita'}'
      '${category == null || category.isEmpty ? '' : ' · $category'}';
}

/// Pantalla 4 — public profile of a medium with its «Radiografía».
class MediaProfileScreen extends StatefulWidget {
  const MediaProfileScreen({
    required this.source,
    required this.store,
    super.key,
  });

  final LiveSourceDto source;
  final ArenaStore store;

  @override
  State<MediaProfileScreen> createState() => _MediaProfileScreenState();
}

class _MediaProfileScreenState extends State<MediaProfileScreen> {
  MediaCoverage? _coverage;
  Object? _error;
  int _tab = 0;
  int? _followers;
  bool _busy = false;

  ArenaStore get store => widget.store;
  LiveSourceDto get source => widget.source;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    unawaited(_loadFollowers());
  }

  Future<void> _load() async {
    try {
      final MediaCoverage coverage = await loadMediaCoverage(store, source);
      if (mounted) setState(() => _coverage = coverage);
    } on Exception catch (failure) {
      if (mounted) setState(() => _error = failure);
    }
  }

  Future<void> _loadFollowers() async {
    try {
      final SocialSummary? summary = await store.social?.socialSummary(
        sourceId: source.id,
      );
      if (mounted && summary != null) {
        setState(() => _followers = summary.followers);
      }
    } on Exception {
      /* The profile stays readable without the follower count. */
    }
  }

  Future<void> _toggleFollow() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await store.setFollowing(
        source.id,
        value: !store.followed.contains(source.id),
      );
      unawaited(_loadFollowers());
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No se pudo actualizar el seguimiento.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _compare() async {
    final LiveSourceDto? other = await showModalBottomSheet<LiveSourceDto>(
      context: context,
      isScrollControlled: true,
      backgroundColor: ArenaColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (BuildContext sheetContext) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        builder: (BuildContext context, ScrollController controller) =>
            ListView(
              controller: controller,
              padding: const EdgeInsets.all(16),
              children: <Widget>[
                Text(
                  'Comparar ${arenaSourceName(source.name)} con…',
                  style: ArenaText.section,
                ),
                const SizedBox(height: 8),
                for (final LiveSourceDto item in store.sources)
                  if (item.id != source.id)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: MediaEmblem(name: item.name, size: 34),
                      title: Text(
                        arenaSourceName(item.name),
                        style: ArenaText.cardTitle,
                      ),
                      subtitle: Text(
                        arenaMediaKind(item),
                        style: ArenaText.meta,
                      ),
                      onTap: () => Navigator.of(sheetContext).pop(item),
                    ),
              ],
            ),
      ),
    );
    if (other == null || !mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            MediaCompareScreen(first: source, second: other, store: store),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final Color tone = arenaEmblemOf(source.name).background;
    return Scaffold(
      backgroundColor: ArenaColors.background,
      body: ListenableBuilder(
        listenable: store,
        builder: (BuildContext context, _) {
          final bool following = store.followed.contains(source.id);
          return ListView(
            key: const Key('arena-media-scroll'),
            padding: EdgeInsets.zero,
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: <Color>[tone, ArenaColors.inkDeep],
                  ),
                ),
                child: SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(8, 4, 16, 20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        IconButton(
                          tooltip: 'Volver',
                          color: Colors.white,
                          onPressed: () => Navigator.of(context).maybePop(),
                          icon: const Icon(Icons.arrow_back),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(left: 8),
                          child: Row(
                            children: <Widget>[
                              MediaEmblem(
                                name: source.name,
                                size: 76,
                                ring: Colors.white,
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Text.rich(
                                      TextSpan(
                                        text: arenaSourceName(source.name),
                                        children: const <InlineSpan>[
                                          WidgetSpan(
                                            alignment:
                                                PlaceholderAlignment.middle,
                                            child: Padding(
                                              padding: EdgeInsets.only(left: 6),
                                              child: Icon(
                                                Icons.verified,
                                                size: 18,
                                                color: Color(0xFFA5B4FC),
                                                semanticLabel:
                                                    'Fuente registrada',
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                      style: const TextStyle(
                                        fontSize: 21,
                                        fontWeight: FontWeight.w800,
                                        color: Colors.white,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${arenaMediaKind(source)}'
                                      '${_followers == null ? '' : ' · $_followers ${_followers == 1 ? 'seguidor' : 'seguidores'}'}',
                                      style: const TextStyle(
                                        fontSize: 13,
                                        color: Color(0xFFE2E8F0),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        Padding(
                          padding: const EdgeInsets.only(left: 8),
                          child: Row(
                            children: <Widget>[
                              Expanded(
                                child: ArenaPrimaryButton(
                                  key: const Key('arena-media-follow'),
                                  label: following ? '✓ Siguiendo' : '+ Seguir',
                                  onPressed: store.following == null || _busy
                                      ? null
                                      : _toggleFollow,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: OutlinedButton(
                                  key: const Key('arena-media-compare'),
                                  onPressed: _compare,
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: Colors.white,
                                    side: const BorderSide(color: Colors.white),
                                    minimumSize: const Size(48, 48),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 12,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(14),
                                    ),
                                  ),
                                  child: const Text(
                                    '⇄ Comparar',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
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
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    ArenaSubTabs(
                      labels: const <String>[
                        'Radiografía',
                        'Cobertura',
                        'Historial',
                      ],
                      selected: _tab,
                      onSelected: (int value) => setState(() => _tab = value),
                    ),
                    const SizedBox(height: 14),
                    if (_coverage == null)
                      _error == null
                          ? const Padding(
                              padding: EdgeInsets.all(24),
                              child: Center(
                                child: CircularProgressIndicator(
                                  color: ArenaColors.violet,
                                ),
                              ),
                            )
                          : ArenaMessage(
                              'No se pudo cargar el perfil.',
                              actionLabel: 'Reintentar',
                              onAction: () {
                                setState(() => _error = null);
                                unawaited(_load());
                              },
                            )
                    else if (_tab == 0)
                      ..._radiography(_coverage!)
                    else if (_tab == 1)
                      ..._publications(context, _coverage!)
                    else
                      ..._history(context, _coverage!),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  List<ArenaDuel> _duels() => store.duels
      .where((ArenaDuel duel) => _covers(duel.event, source))
      .toList();

  List<Widget> _radiography(MediaCoverage coverage) {
    final int total = coverage.items.length;
    final int videos = coverage.videoCount;
    final List<ArenaDuel> duels = _duels();
    final String mine = arenaSourceName(source.name).toLowerCase();
    final Map<String, int> rivals = <String, int>{};
    for (final ArenaDuel duel in duels) {
      for (final String name in <String>{duel.nameA, duel.nameB}) {
        if (name.toLowerCase() != mine && name != 'Medio no disponible') {
          rivals[name] = (rivals[name] ?? 0) + 1;
        }
      }
    }
    final List<MapEntry<String, int>> ranked = rivals.entries.toList()
      ..sort(
        (MapEntry<String, int> a, MapEntry<String, int> b) =>
            b.value.compareTo(a.value),
      );
    int quotes = 0;
    for (final EventDetailDto event in coverage.events) {
      for (final EventCoveragePositionDto p in event.coveragePositions) {
        quotes += p.assertions
            .where(
              (EventCoverageAssertionDto a) =>
                  a.sourceId == source.id ||
                  arenaSourceName(a.sourceName).toLowerCase() == mine,
            )
            .length;
      }
    }
    return <Widget>[
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Perfil editorial / Formato', style: ArenaText.section),
            const SizedBox(height: 10),
            if (total == 0)
              const Text(
                'Sin publicaciones registradas en el último mes.',
                style: ArenaText.body,
              )
            else ...<Widget>[
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                  value: videos / total,
                  minHeight: 10,
                  backgroundColor: ArenaColors.emerald,
                  valueColor: const AlwaysStoppedAnimation<Color>(
                    ArenaColors.violet,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Video ${(videos * 100 / total).round()}% · '
                'Texto ${((total - videos) * 100 / total).round()}%',
                style: ArenaText.cardTitle,
              ),
            ],
            const SizedBox(height: 8),
            const Text(
              'Transparencia metodológica: Dialektik no asigna etiquetas '
              'ideológicas a los medios. Esta radiografía se calcula solo '
              'con las publicaciones registradas de la fuente.',
              style: ArenaText.meta,
            ),
          ],
        ),
      ),
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Cobertura del último mes', style: ArenaText.section),
            const SizedBox(height: 12),
            CoverageDonut(
              key: const Key('arena-coverage-donut'),
              slices: coverage.slices,
            ),
          ],
        ),
      ),
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              'Precisión, trazabilidad y duelos VS',
              style: ArenaText.section,
            ),
            const SizedBox(height: 8),
            _Metric('${coverage.events.length}', 'historias cubiertas'),
            _Metric('${duels.length}', 'duelos VS en los que participa'),
            _Metric(
              '$quotes',
              'citas literales verificadas contra el original',
            ),
            _Metric('$total', 'publicaciones con enlace a la fuente original'),
            const SizedBox(height: 6),
            Text(
              ranked.isEmpty
                  ? 'Todavía no registra contrastes con otros medios.'
                  : 'Contrasta más con: '
                        '${ranked.take(3).map((MapEntry<String, int> e) => '${e.key} (${e.value})').join(', ')}.',
              style: ArenaText.body,
            ),
          ],
        ),
      ),
    ];
  }

  List<Widget> _publications(BuildContext context, MediaCoverage coverage) {
    if (coverage.items.isEmpty) {
      return const <Widget>[
        ArenaMessage('No hay publicaciones en el último mes.'),
      ];
    }
    return <Widget>[
      for (final LiveNewsItemDto item in coverage.items)
        if (extractYouTubeVideoId(item.canonicalUrl.toString()) != null)
          ArenaVideoCard(
            item: item,
            onOpen: () => unawaited(store.openLink(item.canonicalUrl)),
          )
        else
          ArenaCard(
            onTap: () => unawaited(store.openLink(item.canonicalUrl)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(item.headline, style: ArenaText.cardTitle),
                const SizedBox(height: 4),
                Text(
                  '${arenaAgo(item.publishedAt)} · Abrir original',
                  style: ArenaText.meta,
                ),
              ],
            ),
          ),
    ];
  }

  List<Widget> _history(BuildContext context, MediaCoverage coverage) {
    final List<ArenaDuel> duels = _duels();
    if (coverage.events.isEmpty && duels.isEmpty) {
      return const <Widget>[
        ArenaMessage(
          'Este medio todavía no participa en acontecimientos publicados.',
        ),
      ];
    }
    return <Widget>[
      for (final ArenaDuel duel in duels)
        DuelListCard(duel: duel, store: store),
      for (final EventDetailDto event in coverage.events)
        ArenaCard(
          onTap: () => openArenaEvent(context, store, event.id),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const ArenaBadge.live('ACONTECIMIENTO VIVO'),
              const SizedBox(height: 8),
              Text(event.titleDescriptive, style: ArenaText.cardTitle),
              const SizedBox(height: 4),
              Text(
                '${event.sourceCount} fuentes · '
                '${arenaAgo(event.detectedAt)}',
                style: ArenaText.meta,
              ),
            ],
          ),
        ),
    ];
  }
}

class _Metric extends StatelessWidget {
  const _Metric(this.value, this.label);

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Text.rich(
      TextSpan(
        text: '$value ',
        style: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w800,
          color: ArenaColors.violet,
        ),
        children: <InlineSpan>[TextSpan(text: label, style: ArenaText.body)],
      ),
    ),
  );
}

/// Side-by-side coverage of two media over the same loaded month.
class MediaCompareScreen extends StatefulWidget {
  const MediaCompareScreen({
    required this.first,
    required this.second,
    required this.store,
    super.key,
  });

  final LiveSourceDto first;
  final LiveSourceDto second;
  final ArenaStore store;

  @override
  State<MediaCompareScreen> createState() => _MediaCompareScreenState();
}

class _MediaCompareScreenState extends State<MediaCompareScreen> {
  late final Future<List<MediaCoverage>> _load =
      Future.wait(<Future<MediaCoverage>>[
        loadMediaCoverage(widget.store, widget.first),
        loadMediaCoverage(widget.store, widget.second),
      ]);

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
          'Comparar cobertura',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ),
    ),
    body: FutureBuilder<List<MediaCoverage>>(
      future: _load,
      builder:
          (BuildContext context, AsyncSnapshot<List<MediaCoverage>> snapshot) {
            if (snapshot.hasError) {
              return const Center(
                child: ArenaMessage('No se pudo cargar la comparación.'),
              );
            }
            final List<MediaCoverage>? data = snapshot.data;
            if (data == null) {
              return const Center(
                child: CircularProgressIndicator(color: ArenaColors.violet),
              );
            }
            final Set<String> firstIds = data[0].events
                .map((EventDetailDto e) => e.id)
                .toSet();
            final List<EventDetailDto> shared = data[1].events
                .where((EventDetailDto e) => firstIds.contains(e.id))
                .toList();
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
              children: <Widget>[
                for (final (LiveSourceDto source, MediaCoverage coverage)
                    in <(LiveSourceDto, MediaCoverage)>[
                      (widget.first, data[0]),
                      (widget.second, data[1]),
                    ])
                  ArenaCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        MediaNameRow(name: source.name),
                        const SizedBox(height: 4),
                        Text(
                          '${coverage.items.length} publicaciones en el '
                          'último mes · ${coverage.events.length} historias',
                          style: ArenaText.meta,
                        ),
                        const SizedBox(height: 12),
                        CoverageDonut(slices: coverage.slices),
                      ],
                    ),
                  ),
                ArenaSectionTitle(
                  'Historias que cubren ambos (${shared.length})',
                ),
                if (shared.isEmpty)
                  const ArenaMessage(
                    'Todavía no coinciden en un acontecimiento publicado.',
                  ),
                for (final EventDetailDto event in shared)
                  ArenaCard(
                    onTap: () =>
                        openArenaEvent(context, widget.store, event.id),
                    child: Text(
                      event.titleDescriptive,
                      style: ArenaText.cardTitle,
                    ),
                  ),
              ],
            );
          },
    ),
  );
}
