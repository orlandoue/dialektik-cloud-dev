import 'dart:async';

import 'package:dialektik/core/infrastructure/usage_analytics.dart';
import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/data/story_groups.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/presentation/story_group_card.dart';
import 'package:dialektik/features/arena/presentation/youtube_player_sheet.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/following_repository.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/live_news_repository.dart';
import 'package:dialektik/features/live/data/publisher_market_selection.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/science/presentation/science_feed.dart';
import 'package:dialektik/features/science/presentation/science_widgets.dart';
import 'package:flutter/material.dart';

/// The catalog countries; only the active ones can be chosen. Lives in
/// Perfil › Edición: while Chile is the only edition it costs no header space.
Future<void> showArenaCountrySheet(
  BuildContext context,
  ArenaStore store,
) async {
  final String? chosen = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: ArenaColors.card,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (BuildContext sheetContext) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.only(bottom: 16),
        children: <Widget>[
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text('Edición', style: ArenaText.section),
          ),
          for (final CatalogCountry country
              in PublisherMarketSelection.catalogCountries)
            ListTile(
              key: ValueKey<String>('arena-country-option-${country.code}'),
              minTileHeight: 56,
              leading: Text(country.flag, style: const TextStyle(fontSize: 22)),
              title: Text(country.name, style: ArenaText.cardTitle),
              subtitle: PublisherMarketSelection.isActiveCountry(country.code)
                  ? null
                  : const Text(
                      'Pronto',
                      style: TextStyle(color: Color(0xFF6B7280)),
                    ),
              enabled: PublisherMarketSelection.isActiveCountry(country.code),
              trailing: country.code == store.country
                  ? const Icon(Icons.check, color: ArenaColors.violet)
                  : null,
              onTap: () => Navigator.of(sheetContext).pop(country.code),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
            child: Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                style: TextButton.styleFrom(minimumSize: const Size(64, 44)),
                onPressed: () => Navigator.of(sheetContext).pop(),
                child: const Text('Cerrar'),
              ),
            ),
          ),
        ],
      ),
    ),
  );
  if (chosen != null && context.mounted) store.chooseCountry(chosen);
}

/// Pestaña `Inicio`: one feed. The duel of the day, what the reader did not
/// see, the latest from their media, the stories in development and videos.
class ArenaHomeTab extends StatefulWidget {
  const ArenaHomeTab({
    required this.store,
    required this.onOpenMedia,
    this.onOpenStories,
    super.key,
  });

  final ArenaStore store;

  /// Switches to the `Medios` tab so the reader can choose sources.
  final VoidCallback onOpenMedia;

  /// Switches to the `Historias` tab.
  final VoidCallback? onOpenStories;

  @override
  State<ArenaHomeTab> createState() => _ArenaHomeTabState();
}

class _ArenaHomeTabState extends State<ArenaHomeTab> {
  ArenaStore get store => widget.store;

  void _openAlerts() => unawaited(
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: ArenaColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (BuildContext sheetContext) => _AlertsSheet(
        store: store,
        hostContext: context,
        onOpenStories: widget.onOpenStories,
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => SafeArea(
    bottom: false,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // Logo, mode and search. The mode takes the place of the country.
        ListenableBuilder(
          listenable: store,
          builder: (BuildContext context, _) => Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 16, 6),
            child: Row(
              children: <Widget>[
                // The logo shrinks first: the mode keeps its whole name.
                Expanded(
                  child: LayoutBuilder(
                    builder: (BuildContext context, BoxConstraints box) => Row(
                      children: <Widget>[
                        const Flexible(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(
                              'Dialektik',
                              style: TextStyle(
                                fontFamily: SciText.serif,
                                fontSize: 24,
                                fontWeight: FontWeight.w700,
                                color: SciColors.ink,
                              ),
                            ),
                          ),
                        ),
                        if (store.scienceEnabled) ...<Widget>[
                          const SizedBox(width: 10),
                          ConstrainedBox(
                            constraints: BoxConstraints(
                              maxWidth: box.maxWidth * 0.66,
                            ),
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerLeft,
                              child: ModeButton(
                                mode: store.mode,
                                onTap: () async {
                                  final ArenaMode? chosen = await showModeSheet(
                                    context,
                                    store.mode,
                                  );
                                  if (chosen != null) store.setMode(chosen);
                                },
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                IconButton(
                  key: const Key('arena-search'),
                  tooltip: 'Buscar',
                  color: SciColors.ink,
                  constraints: const BoxConstraints.tightFor(
                    width: 44,
                    height: 44,
                  ),
                  padding: EdgeInsets.zero,
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => ArenaSearchScreen(store: store),
                    ),
                  ),
                  icon: const Icon(SciIcons.search, size: 22),
                ),
                // Alerts of what the reader follows, in both modes.
                IconButton(
                  key: const Key('arena-alerts'),
                  tooltip: 'Novedades de lo que sigues',
                  color: SciColors.ink,
                  constraints: const BoxConstraints.tightFor(
                    width: 44,
                    height: 44,
                  ),
                  padding: EdgeInsets.zero,
                  onPressed: _openAlerts,
                  icon: const Icon(Icons.notifications_none, size: 22),
                ),
              ],
            ),
          ),
        ),
        Expanded(
          child: ListenableBuilder(
            listenable: store,
            builder: (BuildContext context, _) =>
                store.mode == ArenaMode.ciencia
                ? ScienceFeed(store: store)
                : _Coliseo(
                    store: store,
                    onOpenMedia: widget.onOpenMedia,
                    onOpenStories: widget.onOpenStories,
                  ),
          ),
        ),
      ],
    ),
  );
}

/// Pantalla 1 — panorama of the day, in one scroll.
class _Coliseo extends StatelessWidget {
  const _Coliseo({
    required this.store,
    required this.onOpenMedia,
    required this.onOpenStories,
  });

  final ArenaStore store;
  final VoidCallback onOpenMedia;
  final VoidCallback? onOpenStories;

  /// Stories shown in Inicio; the rest live in `Historias`.
  static const int storiesInHome = 2;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (BuildContext context, _) {
      final List<EventCardDto> developing = store.developing.isEmpty
          ? store.events
          : store.developing;
      final List<ArenaDuel> duels = store.duels;
      final List<LiveNewsItemDto> videos = store.videos;
      return RefreshIndicator(
        color: ArenaColors.violet,
        onRefresh: () => store.load(refresh: true),
        child: ListView(
          key: const Key('arena-coliseo-scroll'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: <Widget>[
            if (store.loading && !store.loaded)
              // The shape of Inicio while it loads, not a lone spinner.
              const ArenaSkeleton(key: Key('arena-coliseo-skeleton'))
            else if (store.error != null && store.events.isEmpty)
              ArenaMessage(
                'No se pudo cargar el Coliseo.',
                actionLabel: 'Reintentar',
                onAction: () => unawaited(store.load(refresh: true)),
              )
            else ...<Widget>[
              if (duels.isNotEmpty)
                DuelCarousel(duels: duels, store: store)
              else if (store.duelsLoading)
                const Padding(
                  key: Key('arena-duels-loading'),
                  padding: EdgeInsets.all(24),
                  child: Center(
                    child: CircularProgressIndicator(color: ArenaColors.violet),
                  ),
                )
              else
                ArenaMessage(
                  'Hoy no hay duelos nuevos.',
                  actionLabel: onOpenStories == null
                      ? null
                      : 'Ver En desarrollo',
                  onAction: onOpenStories,
                ),
              const SizedBox(height: 16),
              _BlindspotBanner(store: store),
              _FollowingFeed(
                store: store,
                onOpenMedia: onOpenMedia,
                preview: true,
              ),
              if (developing.isNotEmpty) ...<Widget>[
                const ArenaSectionTitle('En desarrollo'),
                for (final EventCardDto event in developing.take(storiesInHome))
                  DevelopingEventCard(event: event, store: store),
              ],
              if (videos.isNotEmpty) ...<Widget>[
                const ArenaSectionTitle('Videos'),
                for (final LiveNewsItemDto video in videos)
                  ArenaVideoCard(
                    item: video,
                    onOpen: () => unawaited(
                      openArenaPiece(
                        context,
                        store,
                        video.canonicalUrl,
                        title: video.headline,
                        channel: video.source.name,
                      ),
                    ),
                    onOpenSource: () =>
                        openArenaMedia(context, store, video.source.id),
                  ),
              ],
              // The feed ends instead of trailing off.
              Padding(
                key: const Key('arena-feed-end'),
                padding: const EdgeInsets.only(top: 16),
                child: Column(
                  children: <Widget>[
                    const Text(
                      'Ya estás al día',
                      textAlign: TextAlign.center,
                      style: ArenaText.cardTitle,
                    ),
                    if (onOpenStories != null)
                      TextButton(
                        style: TextButton.styleFrom(
                          foregroundColor: ArenaColors.violet,
                          minimumSize: const Size(44, 44),
                        ),
                        onPressed: onOpenStories,
                        child: const Text(
                          'Ver todo En desarrollo →',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      );
    },
  );
}

/// «Lo que no viste hoy»: the most distinctive door of the app, in Inicio.
class _BlindspotBanner extends StatelessWidget {
  const _BlindspotBanner({required this.store});

  final ArenaStore store;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Semantics(
      button: true,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        clipBehavior: Clip.antiAlias,
        child: Ink(
          decoration: const BoxDecoration(gradient: ArenaColors.violetGradient),
          child: InkWell(
            key: const Key('arena-blindspot-banner'),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => BlindspotScreen(store: store),
              ),
            ),
            child: const Padding(
              padding: EdgeInsets.all(18),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.travel_explore, color: Colors.white, size: 32),
                  SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Lo que no viste hoy',
                          style: TextStyle(
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
  );
}

/// `● EN DESARROLLO` row: thumbnail, title, sources and last update.
class DevelopingEventCard extends StatefulWidget {
  const DevelopingEventCard({
    required this.event,
    required this.store,
    this.note,
    this.duel,
    super.key,
  });

  final EventCardDto event;
  final ArenaStore store;
  final String? note;

  /// The case's published duel, linked straight from the card.
  final ArenaDuel? duel;

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

  /// The emblems of the outlets that cover the case on a light tile. Never
  /// a frame of one outlet's video: it favoured that outlet and could show
  /// someone else (a Trump frame on a story about Kast).
  Widget _thumbnail(ArenaTopic topic, EventDetailDto? detail) {
    final List<String> outlets =
        (detail?.articles ?? const <EventCoverageArticleDto>[])
            .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
            .toSet()
            .take(3)
            .toList();
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFEEF0F5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Center(
        child: outlets.isEmpty
            ? Icon(arenaTopicIcon(topic), color: ArenaColors.muted, size: 28)
            : Wrap(
                spacing: 4,
                runSpacing: 4,
                alignment: WrapAlignment.center,
                children: <Widget>[
                  for (final String name in outlets)
                    MediaEmblem(
                      name: name,
                      size: outlets.length == 1 ? 40 : 30,
                    ),
                ],
              ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final EventCardDto event = widget.event;
    final EventDetailDto? detail = _detail;
    // The same clock as the story itself: its newest coverage.
    final DateTime updated = arenaLastCoverage(
      detail?.articles ?? const <EventCoverageArticleDto>[],
      fallback: event.detectedAt,
    );
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
              child: _thumbnail(topic, detail),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                // Categories are navigation, not a signal: plain grey caps.
                Text(
                  topic.label.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                    color: ArenaColors.muted,
                  ),
                ),
                const SizedBox(height: 4),
                Text(event.arenaTitle, style: ArenaText.cardTitle),
                const SizedBox(height: 6),
                Text(
                  '${event.sourceCount} '
                  '${event.sourceCount == 1 ? 'medio' : 'medios'} · '
                  '${DateTime.now().difference(updated) > const Duration(hours: 72) ? 'Sin novedades recientes' : 'Última cobertura ${arenaAgo(updated)}'}',
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
                if (widget.duel != null)
                  TextButton(
                    key: ValueKey<String>('arena-event-duel-${event.id}'),
                    style: TextButton.styleFrom(
                      foregroundColor: ArenaColors.violet,
                      minimumSize: const Size(44, 44),
                      padding: EdgeInsets.zero,
                      alignment: Alignment.centerLeft,
                    ),
                    onPressed: () =>
                        openArenaDuel(context, widget.store, widget.duel!),
                    child: const Text(
                      'Ver su duelo VS →',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
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
      onTap: () => unawaited(
        openArenaPiece(
          context,
          store,
          item.canonicalUrl,
          title: item.headline,
          channel: item.source.name,
        ),
      ),
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
                Text(
                  arenaWithoutSourcePrefix(item.headline, item.source.name),
                  style: ArenaText.cardTitle,
                ),
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
                if (item.publishedEventId case final String eventId)
                  AlsoCoveredLine(eventId: eventId, store: store),
                ?trailing,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// «También lo cubren N medios · Comparar →» under a note of a followed
/// medium whose case is published: the same fact, told by others. Counts
/// the whole story when the case belongs to one.
class AlsoCoveredLine extends StatelessWidget {
  const AlsoCoveredLine({
    required this.eventId,
    required this.store,
    super.key,
  });

  final String eventId;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) {
    final StoryGroup? story = store.storyOf(eventId);
    EventCardDto? event;
    for (final EventCardDto candidate in store.events) {
      if (candidate.id == eventId) event = candidate;
    }
    final int outlets = story?.sourceCount ?? event?.sourceCount ?? 0;
    final int others = outlets - 1;
    final bool inDuel = store.duelForEvent(eventId) != null;
    final String label = others >= 1
        ? 'También lo ${others == 1 ? 'cubre 1 medio' : 'cubren $others medios'}'
              ' · Comparar →'
        : 'Ver cómo lo cubren otros medios →';
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: InkWell(
        key: ValueKey<String>('arena-also-covered-$eventId'),
        borderRadius: BorderRadius.circular(8),
        onTap: () {
          logUsage('also_covered_tap', <String, Object>{
            'story': story == null ? 0 : 1,
          });
          if (story != null) {
            final List<EventCardDto> members = store.events
                .where((EventCardDto e) => story.eventIds.contains(e.id))
                .toList();
            if (members.isNotEmpty) {
              unawaited(
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => StoryGroupScreen(
                      story: story,
                      members: members,
                      store: store,
                    ),
                  ),
                ),
              );
              return;
            }
          }
          unawaited(openArenaEvent(context, store, eventId));
        },
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Row(
            children: <Widget>[
              if (inDuel) ...<Widget>[
                const ArenaBadge(
                  label: 'En duelo',
                  background: ArenaColors.violetSoft,
                  foreground: ArenaColors.violetDeep,
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: ArenaColors.violet,
                  ),
                ),
              ),
            ],
          ),
        ),
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
      // An event whose story was covered by a medium the reader follows was
      // not missed: the story, not the pair of notes, is what one sees.
      _events = events.where((EventCardDto e) {
        final List<String> covered =
            store.storyOf(e.id)?.sourceIds ?? const <String>[];
        return !covered.any(store.followed.contains);
      }).toList();
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

/// Publications and stories of followed sources: a three-item section in
/// Inicio ([preview]) or the full list behind «Ver todo».
class _FollowingFeed extends StatefulWidget {
  const _FollowingFeed({
    required this.store,
    required this.onOpenMedia,
    this.preview = false,
  });

  final ArenaStore store;
  final VoidCallback onOpenMedia;
  final bool preview;

  /// Publications shown in Inicio.
  static const int previewCount = 3;

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

  String _fromYourMedia() {
    final int count = store
        .brands(store.sources)
        .where(store.followsBrand)
        .length;
    return count == 1 ? 'De tu medio' : 'De tus $count medios';
  }

  @override
  Widget build(BuildContext context) {
    if (widget.preview) return _previewSection(context);
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
              const ArenaSectionTitle('Lo que sigues'),
              for (final EventCardDto event in followedStories)
                DevelopingEventCard(event: event, store: store),
            ],
            ArenaSectionTitle(_fromYourMedia()),
            if (_items.isEmpty)
              const ArenaMessage('Tus medios no tienen publicaciones nuevas.'),
            for (final LiveNewsItemDto item in arenaInterleaveByOutlet(
              _items,
              (LiveNewsItemDto item) => item.source.id,
            ))
              ArenaNewsCard(item: item, store: store),
          ],
        ],
      ),
    );
  }

  Widget _previewSection(BuildContext context) {
    if (store.following == null) return const SizedBox.shrink();
    if (store.followed.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: ArenaCard(
          key: const Key('arena-choose-media'),
          onTap: widget.onOpenMedia,
          child: const Row(
            children: <Widget>[
              Icon(Icons.cell_tower, color: ArenaColors.violet),
              SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Elige tus medios para ver aquí lo último que publican →',
                  style: ArenaText.cardTitle,
                ),
              ),
            ],
          ),
        ),
      );
    }
    // Interleaved by outlet: one prolific outlet does not fill the preview.
    final List<LiveNewsItemDto> items = arenaInterleaveByOutlet(
      _items,
      (LiveNewsItemDto item) => item.source.id,
    ).take(_FollowingFeed.previewCount).toList();
    return Column(
      key: const Key('arena-following-preview'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(child: ArenaSectionTitle(_fromYourMedia())),
            TextButton(
              key: const Key('arena-following-all'),
              style: TextButton.styleFrom(
                foregroundColor: ArenaColors.violet,
                minimumSize: const Size(44, 44),
              ),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => Scaffold(
                    backgroundColor: ArenaColors.background,
                    appBar: AppBar(
                      backgroundColor: ArenaColors.background,
                      surfaceTintColor: Colors.transparent,
                      foregroundColor: ArenaColors.ink,
                      title: const Text(
                        'Lo último de tus medios',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    body: _FollowingFeed(
                      store: store,
                      onOpenMedia: widget.onOpenMedia,
                    ),
                  ),
                ),
              ),
              child: const Text(
                'Ver todo',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(16),
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
        else if (items.isEmpty)
          const ArenaMessage('Tus medios no tienen publicaciones nuevas.')
        else
          for (final LiveNewsItemDto item in items)
            ArenaNewsCard(item: item, store: store),
      ],
    );
  }
}

class _AlertsSheet extends StatelessWidget {
  const _AlertsSheet({
    required this.store,
    required this.hostContext,
    this.onOpenStories,
  });

  final ArenaStore store;
  final BuildContext hostContext;
  final VoidCallback? onOpenStories;

  @override
  Widget build(BuildContext context) {
    final StoryFollowStore stories = store.stories;
    final List<(EventCardDto, int)> changes = <(EventCardDto, int)>[
      for (final EventCardDto event in store.events)
        if (stories.snapshot(event.id) case final StorySnapshot snapshot)
          if (event.sourceCount > snapshot.sourceCount)
            (event, event.sourceCount - snapshot.sourceCount),
    ];
    // Two stories the reader could follow with one tap.
    final List<EventCardDto> suggestions =
        (store.developing.isEmpty ? store.events : store.developing)
            .where((EventCardDto e) => !stories.contains(e.id))
            .take(2)
            .toList();
    return SafeArea(
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        children: <Widget>[
          const Text('Novedades de lo que sigues', style: ArenaText.section),
          const SizedBox(height: 8),
          if (changes.isEmpty) ...<Widget>[
            Text(
              stories.followedIds.isEmpty
                  ? 'Sigue un acontecimiento y aquí verás cuando un medio '
                        'nuevo publique sobre él.'
                  : 'Sin novedades en lo que sigues.',
              style: ArenaText.body,
            ),
            if (suggestions.isNotEmpty) ...<Widget>[
              const SizedBox(height: 12),
              const Text('Para empezar', style: ArenaText.meta),
              for (final EventCardDto event in suggestions)
                ListTile(
                  key: ValueKey<String>('arena-alert-suggestion-${event.id}'),
                  contentPadding: EdgeInsets.zero,
                  minTileHeight: 56,
                  title: Text(event.arenaTitle, style: ArenaText.cardTitle),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.of(context).pop();
                    unawaited(openArenaEvent(hostContext, store, event.id));
                  },
                ),
            ],
            if (onOpenStories != null) ...<Widget>[
              const SizedBox(height: 8),
              OutlinedButton(
                key: const Key('arena-alerts-open-stories'),
                style: arenaSecondaryButtonStyle(),
                onPressed: () {
                  Navigator.of(context).pop();
                  onOpenStories!();
                },
                child: const Text('Ver En desarrollo'),
              ),
            ],
          ],
          for (final (EventCardDto event, int added) in changes)
            ListTile(
              contentPadding: EdgeInsets.zero,
              minTileHeight: 56,
              leading: const Icon(
                Icons.update_rounded,
                color: ArenaColors.amberDeep,
              ),
              title: Text(event.arenaTitle, style: ArenaText.cardTitle),
              subtitle: Text(
                '$added ${added == 1 ? 'medio nuevo' : 'medios nuevos'} '
                'desde tu última visita',
                style: ArenaText.meta,
              ),
              onTap: () {
                Navigator.of(context).pop();
                unawaited(openArenaEvent(hostContext, store, event.id));
              },
            ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              style: TextButton.styleFrom(minimumSize: const Size(64, 44)),
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cerrar'),
            ),
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

/// Searches typed in this session, newest first.
final List<String> _recentSearches = <String>[];

class _ArenaSearchScreenState extends State<ArenaSearchScreen> {
  final TextEditingController _input = TextEditingController();
  List<LiveNewsItemDto> _news = const <LiveNewsItemDto>[];
  String _query = '';
  bool _loading = false;
  int _run = 0;
  Timer? _debounce;

  /// Results appear while typing from this many characters.
  static const int instantFrom = 3;

  @override
  void dispose() {
    _debounce?.cancel();
    _input.dispose();
    super.dispose();
  }

  void _typed(String value) {
    _debounce?.cancel();
    if (value.trim().length < instantFrom) {
      if (_query.isNotEmpty) unawaited(_search(''));
      return;
    }
    _debounce = Timer(
      const Duration(milliseconds: 350),
      () => unawaited(_search(value)),
    );
  }

  void _pick(String value) {
    _input.text = value;
    unawaited(_search(value));
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
    _recentSearches
      ..remove(query)
      ..insert(0, query);
    if (_recentSearches.length > 5) _recentSearches.removeLast();
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
                (EventCardDto e) => e.arenaTitle.toLowerCase().contains(needle),
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
          onChanged: _typed,
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
          if (_query.isEmpty) ...<Widget>[
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'Escribe un tema, un nombre o un medio.',
                style: ArenaText.body,
              ),
            ),
            if (_recentSearches.isNotEmpty) ...<Widget>[
              const ArenaSectionTitle('Recientes'),
              for (final String recent in _recentSearches)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  minTileHeight: 48,
                  leading: const Icon(Icons.history, color: ArenaColors.muted),
                  title: Text(recent, style: ArenaText.body),
                  onTap: () => _pick(recent),
                ),
            ],
            const ArenaSectionTitle('Temas'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                for (final ArenaTopic topic in const <ArenaTopic>[
                  ArenaTopic.politica,
                  ArenaTopic.justicia,
                  ArenaTopic.economia,
                  ArenaTopic.seguridad,
                  ArenaTopic.deportes,
                  ArenaTopic.sociedad,
                ])
                  ArenaPill(
                    key: ValueKey<String>('arena-search-topic-${topic.name}'),
                    label: topic.label,
                    selected: false,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) =>
                            TopicScreen(topic: topic, store: widget.store),
                      ),
                    ),
                  ),
              ],
            ),
          ],
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
            const ArenaMessage(
              'Sin resultados. Prueba con un tema, como «Codelco», o con el '
              'nombre de un medio.',
            ),
        ],
      ),
    );
  }
}
