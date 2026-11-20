import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/presentation/youtube_player_sheet.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/story_comments.dart';
import 'package:flutter/material.dart';

/// Pantalla 3 — permanent page of one living event.
class LivingEventScreen extends StatefulWidget {
  const LivingEventScreen({
    required this.eventId,
    required this.store,
    this.title,
    super.key,
  });

  final String eventId;
  final ArenaStore store;
  final String? title;

  @override
  State<LivingEventScreen> createState() => _LivingEventScreenState();
}

class _LivingEventScreenState extends State<LivingEventScreen> {
  EventDetailDto? _event;
  Object? _error;
  int _tab = 0;
  bool _followBusy = false;

  /// When the reader last opened this followed case, captured before this
  /// visit is recorded, to highlight what is new since then.
  DateTime? _previousVisit;
  bool _visitRecorded = false;

  ArenaStore get store => widget.store;
  StoryFollowStore get stories => store.stories;

  /// The «Comentarios» thread of this story (C3).
  late final StoryCommentsController _comments = StoryCommentsController(
    store: store,
    eventId: widget.eventId,
  );

  static const int commentsTab = 3;

  @override
  void initState() {
    super.initState();
    _event = store.cachedDetail(widget.eventId);
    stories.addListener(_changed);
    _comments.addListener(_changed);
    // Comments only exist where Science is on for this account.
    if (store.scienceEnabled) unawaited(_comments.load());
    unawaited(_load());
  }

  @override
  void dispose() {
    stories.removeListener(_changed);
    _comments.removeListener(_changed);
    _comments.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _load({bool refresh = false}) async {
    try {
      final EventDetailDto event = await store.detail(
        widget.eventId,
        refresh: refresh,
      );
      if (!mounted) return;
      setState(() {
        _event = event;
        _error = null;
      });
      if (!_visitRecorded) {
        _visitRecorded = true;
        _previousVisit = stories.snapshot(event.id)?.seenAt;
        unawaited(stories.markSeen(event).catchError((Object _) {}));
      }
    } on Exception catch (failure) {
      if (mounted) setState(() => _error = failure);
    }
  }

  Future<void> _toggleFollow(EventDetailDto event) async {
    if (_followBusy) return;
    setState(() => _followBusy = true);
    try {
      await stories.setFollowing(event, following: !stories.contains(event.id));
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Inicia sesión para seguir este acontecimiento.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _followBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final EventDetailDto? event = _event;
    final bool commenting =
        store.scienceEnabled && _tab == commentsTab && event != null;
    final Color background = commenting
        ? SciColors.surface
        : ArenaColors.background;
    final int mediaCount = event == null
        ? 0
        : event.articles
              .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
              .toSet()
              .length;
    return Scaffold(
      backgroundColor: background,
      // Compact header: the case in one line, its topic and outlets, Seguir.
      appBar: AppBar(
        backgroundColor: background,
        surfaceTintColor: Colors.transparent,
        foregroundColor: SciColors.ink,
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              event?.arenaTitle ?? 'Acontecimiento',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontFamily: SciText.sans,
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: SciColors.ink,
              ),
            ),
            if (event != null)
              Text(
                '${arenaTopicOfEvent(event).label} · '
                '${mediaCountLabel(mediaCount)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: SciText.sans,
                  fontSize: 12,
                  color: SciColors.inkSecondary,
                ),
              ),
          ],
        ),
        actions: <Widget>[
          if (event != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: FilledButton(
                  key: const Key('arena-follow-story'),
                  onPressed: _followBusy ? null : () => _toggleFollow(event),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(44, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    backgroundColor: stories.contains(event.id)
                        ? ArenaColors.violetSoft
                        : SciColors.primary,
                    foregroundColor: stories.contains(event.id)
                        ? ArenaColors.violetDeep
                        : Colors.white,
                    shape: const StadiumBorder(),
                    textStyle: const TextStyle(
                      fontFamily: SciText.sans,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  child: Text(
                    stories.contains(event.id) ? 'Siguiendo' : 'Seguir',
                  ),
                ),
              ),
            ),
        ],
      ),
      bottomNavigationBar: commenting
          ? CommentComposer(controller: _comments, event: event)
          : null,
      body: event == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator(color: ArenaColors.violet)
                  : ArenaMessage(
                      'No se pudo cargar el acontecimiento.',
                      actionLabel: 'Reintentar',
                      onAction: () => unawaited(_load(refresh: true)),
                    ),
            )
          : RefreshIndicator(
              color: ArenaColors.violet,
              onRefresh: () => _load(refresh: true),
              child: _content(context, event),
            ),
    );
  }

  List<EventCoverageArticleDto> _chronological(EventDetailDto event) =>
      event.articles.toList()..sort(
        (EventCoverageArticleDto a, EventCoverageArticleDto b) =>
            a.publishedAt.compareTo(b.publishedAt),
      );

  /// A case is «en desarrollo» while it gets new coverage; after
  /// [quietAfter] without any, it says so instead of claiming to be live.
  static const Duration quietAfter = Duration(hours: 72);

  Widget _content(BuildContext context, EventDetailDto event) {
    final ArenaTopic topic = arenaTopicOfEvent(event);
    final List<EventCoverageArticleDto> timeline = _chronological(event);
    final String? videoId = arenaVideoIdOfEvent(event);
    final EventCoverageArticleDto? video = videoId == null
        ? null
        : event.articles.firstWhere(
            (EventCoverageArticleDto a) =>
                extractYouTubeVideoId(a.url.toString()) == videoId,
          );
    final bool science = store.scienceEnabled;
    final bool commenting = science && _tab == commentsTab;
    final bool quiet =
        timeline.isEmpty ||
        DateTime.now().difference(timeline.last.publishedAt) > quietAfter;
    final List<String> media =
        event.articles
            .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
            .toSet()
            .toList()
          ..sort(
            (String a, String b) => a.toLowerCase().compareTo(b.toLowerCase()),
          );
    final List<Widget> header = <Widget>[
      // The same compact hero on every tab but Comentarios: one status
      // pill, the case and when its coverage began.
      // Neutral, like the card of the day: a frame from one outlet's video
      // (with its logo or another person's face) would frame the story.
      ArenaCover(
        topic: topic,
        minHeight: 160,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              if (quiet)
                const ArenaBadge(
                  label: 'Sin novedades recientes',
                  background: Color(0xFFE2E8F0),
                  foreground: ArenaColors.ink,
                )
              else
                const ArenaBadge.live('En desarrollo'),
              const SizedBox(height: 24),
              Semantics(
                header: true,
                child: Text(
                  event.arenaTitle,
                  style: const TextStyle(
                    fontSize: 20,
                    height: 1.25,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${topic.label}'
                '${timeline.isEmpty ? '' : ' · desde el ${arenaDate(timeline.first.publishedAt)}'}',
                style: const TextStyle(fontSize: 13, color: Color(0xFFE2E8F0)),
              ),
            ],
          ),
        ),
      ),
      if (video != null)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: const Key('arena-event-video'),
            style: TextButton.styleFrom(
              foregroundColor: ArenaColors.violet,
              minimumSize: const Size(44, 44),
            ),
            onPressed: () => unawaited(
              openArenaPiece(
                context,
                store,
                video.url,
                title: video.title,
                channel: video.sourceName,
              ),
            ),
            icon: const Icon(Icons.play_circle_outline_rounded),
            label: Text(
              'Ver video de ${arenaSourceName(video.sourceName)}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        )
      else
        const SizedBox(height: 12),
      // Who covers the case, once.
      Text(
        '${mediaCountLabel(media.length)}'
        '${media.isEmpty ? '' : ' · ${media.join(', ')}'}',
        style: ArenaText.cardTitle,
      ),
      const SizedBox(height: 12),
    ];
    Widget padded(Widget child) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: child,
    );
    return ListView(
      key: const Key('arena-event-scroll'),
      padding: const EdgeInsets.only(top: 4, bottom: 28),
      children: <Widget>[
        if (!commenting) ...header.map(padded),
        StoryTabs(
          labels: <String>[
            'Resumen',
            'Cronología',
            'Citas',
            if (science) 'Comentarios ${_comments.total}',
          ],
          selected: _tab,
          onSelected: (int value) => setState(() => _tab = value),
        ),
        // Without Science, the case's community stays one tap away.
        if (!science) ...<Widget>[
          const SizedBox(height: 10),
          padded(
            OutlinedButton.icon(
              key: const Key('arena-open-community'),
              onPressed: () => openArenaCommunity(context, store, event),
              style: arenaSecondaryButtonStyle(),
              icon: const Icon(Icons.forum_outlined),
              label: const Text('Comunidad del caso'),
            ),
          ),
        ],
        if (commenting)
          ...storyCommentsChildren(context, _comments, event)
        else ...<Widget>[
          const SizedBox(height: 14),
          if (_tab == 0) ..._summary(context, event, timeline).map(padded),
          if (_tab == 1) ..._timeline(context, timeline).map(padded),
          if (_tab == 2) ..._quotes(context, event).map(padded),
        ],
      ],
    );
  }

  List<Widget> _summary(
    BuildContext context,
    EventDetailDto event,
    List<EventCoverageArticleDto> timeline,
  ) {
    final EventCoverageArticleDto? latest = timeline.lastOrNull;
    final ArenaDuel? duel = store.duelForEvent(event.id);
    final List<String> actors = arenaNamedActors(<String>[
      event.arenaTitle,
      for (final EventCoveragePositionDto p in event.coveragePositions)
        arenaPositionSummary(event, p),
      for (final EventCoverageArticleDto a in event.articles) a.title,
    ]);
    // Every statement is attributed to the outlet that made it, one line per
    // outlet in alphabetical order: Dialektik never states the facts itself.
    final List<EventCoveragePositionDto> positions =
        event.coveragePositions.toList()..sort(
          (EventCoveragePositionDto a, EventCoveragePositionDto b) =>
              ArenaDuel.nameOf(
                a,
              ).toLowerCase().compareTo(ArenaDuel.nameOf(b).toLowerCase()),
        );
    final int newPieces = _previousVisit == null
        ? 0
        : timeline
              .where(
                (EventCoverageArticleDto a) =>
                    a.publishedAt.isAfter(_previousVisit!),
              )
              .length;
    return <Widget>[
      if (newPieces > 0)
        ArenaCard(
          key: const Key('arena-since-last-visit'),
          borderColor: ArenaColors.amberBright,
          borderWidth: 1.5,
          onTap: () => setState(() => _tab = 1),
          child: Row(
            children: <Widget>[
              const Icon(
                Icons.fiber_new_outlined,
                color: ArenaColors.amberDeep,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Desde tu última visita: $newPieces '
                  '${newPieces == 1 ? 'publicación nueva' : 'publicaciones nuevas'}. '
                  'Ver en la cronología →',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: ArenaColors.amberDeep,
                  ),
                ),
              ),
            ],
          ),
        ),
      ArenaCard(
        key: const Key('arena-event-attributed'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Lo que dicen los medios', style: ArenaText.section),
            const SizedBox(height: 10),
            if (positions.isNotEmpty)
              for (final EventCoveragePositionDto position in positions)
                _AttributedLine(
                  name: ArenaDuel.nameOf(position),
                  text: arenaPositionSummary(event, position),
                )
            else if (timeline.isNotEmpty)
              for (final EventCoverageArticleDto article in timeline.take(3))
                _AttributedLine(
                  name: arenaSourceName(article.sourceName),
                  text: arenaHeadline(article.title),
                  verb: 'informó',
                )
            else
              const Text(
                'Todavía no hay publicaciones enlazadas a este caso.',
                style: ArenaText.body,
              ),
          ],
        ),
      ),
      if (latest != null)
        ArenaCard(
          key: const Key('arena-last-change'),
          borderColor: ArenaColors.amberBright,
          borderWidth: 1.5,
          onTap: () => unawaited(
            openArenaPiece(
              context,
              store,
              latest.url,
              title: latest.title,
              channel: latest.sourceName,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  // Neutral: orange is kept for corrections, not for news.
                  const Icon(
                    Icons.update_rounded,
                    size: 16,
                    color: ArenaColors.muted,
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      'Última cobertura · '
                      '${arenaAgo(arenaLastCoverage(timeline, fallback: latest.publishedAt))}',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: ArenaColors.muted,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${arenaSourceName(latest.sourceName)} sumó '
                '${extractYouTubeVideoId(latest.url.toString()) == null ? 'una publicación' : 'un video'} '
                'al caso:',
                style: ArenaText.meta,
              ),
              const SizedBox(height: 4),
              Text(arenaHeadline(latest.title), style: ArenaText.cardTitle),
            ],
          ),
        ),
      if (actors.isNotEmpty)
        ArenaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text('Quiénes aparecen', style: ArenaText.section),
              const SizedBox(height: 6),
              Text(actors.join(', '), style: ArenaText.body),
              const SizedBox(height: 4),
              const Text(
                'Nombres que aparecen en los titulares del caso.',
                style: ArenaText.meta,
              ),
            ],
          ),
        ),
      if (duel != null)
        ArenaPrimaryButton(
          key: const Key('arena-open-duel'),
          label: 'Ver duelo VS: ${duel.nameA} vs ${duel.nameB}',
          onPressed: () => openArenaDuel(context, store, duel),
        ),
    ];
  }

  /// The coverage in publication order, with milestones: the first day's
  /// coverage, each outlet that joins later, and what is new since the
  /// reader's last visit.
  List<Widget> _timeline(
    BuildContext context,
    List<EventCoverageArticleDto> timeline,
  ) {
    if (timeline.isEmpty) {
      return const <Widget>[
        ArenaMessage('Todavía no hay publicaciones enlazadas a este caso.'),
      ];
    }
    final DateTime firstDay = timeline.first.publishedAt.toLocal();
    bool sameDay(DateTime other) {
      final DateTime local = other.toLocal();
      return local.year == firstDay.year &&
          local.month == firstDay.month &&
          local.day == firstDay.day;
    }

    final Set<String> seen = <String>{};
    final List<Widget> children = <Widget>[
      const _Milestone('Primeras coberturas'),
    ];
    bool laterStarted = false;
    for (int i = 0; i < timeline.length; i++) {
      final EventCoverageArticleDto article = timeline[i];
      final String name = arenaSourceName(article.sourceName);
      if (!sameDay(article.publishedAt) && !laterStarted) {
        laterStarted = true;
        children.add(const _Milestone('Coberturas posteriores'));
      }
      if (laterStarted && !seen.contains(name)) {
        children.add(_Milestone('Se suma $name'));
      }
      seen.add(name);
      children.add(
        _TimelineEntry(
          article: article,
          isLast: i == timeline.length - 1,
          store: store,
          isNew:
              _previousVisit != null &&
              article.publishedAt.isAfter(_previousVisit!),
        ),
      );
    }
    return children;
  }

  List<Widget> _quotes(BuildContext context, EventDetailDto event) {
    final Map<String, EventCoverageArticleDto> byId =
        <String, EventCoverageArticleDto>{
          for (final EventCoverageArticleDto a in event.articles) a.id: a,
        };
    final List<EventCoverageAssertionDto> quotes = <EventCoverageAssertionDto>[
      for (final EventCoveragePositionDto p in event.coveragePositions)
        ...p.assertions.where(
          (EventCoverageAssertionDto a) => a.quotedText.trim().isNotEmpty,
        ),
    ];
    final Set<String> quoted = quotes
        .map((EventCoverageAssertionDto q) => arenaSourceName(q.sourceName))
        .toSet();
    final List<String> without =
        event.articles
            .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
            .toSet()
            .difference(quoted)
            .toList()
          ..sort();
    return <Widget>[
      if (quotes.isEmpty)
        const ArenaMessage(
          'Este caso todavía no tiene citas literales verificadas.',
        ),
      for (final EventCoverageAssertionDto quote in quotes)
        ArenaCard(
          onTap: byId[quote.articleId] == null
              ? null
              : () => unawaited(
                  openArenaPiece(
                    context,
                    store,
                    byId[quote.articleId]!.url,
                    title: byId[quote.articleId]!.title,
                    channel: quote.sourceName,
                  ),
                ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              MediaNameRow(
                name: quote.sourceName,
                emblemSize: 28,
                onTap: quote.sourceId == null
                    ? null
                    : () => openArenaMedia(context, store, quote.sourceId!),
              ),
              const SizedBox(height: 8),
              Text(
                arenaAssertionText(event, quote).literal
                    ? arenaQuote(quote.quotedText)
                    : arenaAssertionText(event, quote).text,
                style: arenaAssertionText(event, quote).literal
                    ? const TextStyle(
                        fontFamily: ArenaText.serif,
                        fontSize: 15,
                        height: 1.45,
                        color: ArenaColors.ink,
                      )
                    : ArenaText.body,
              ),
              const SizedBox(height: 8),
              Text(
                arenaAssertionText(event, quote).literal
                    ? arenaVerifiedQuoteLabel
                    : 'Titular de su publicación',
                style: ArenaText.meta,
              ),
            ],
          ),
        ),
      if (quotes.isNotEmpty && without.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            'Sin cita literal aún de ${_humanList(without)}.',
            style: ArenaText.meta,
          ),
        ),
    ];
  }

  static String _humanList(List<String> names) => names.length < 2
      ? names.join()
      : '${names.sublist(0, names.length - 1).join(', ')} y ${names.last}';
}

/// «Según Medio: …» with the outlet's emblem.
class _AttributedLine extends StatelessWidget {
  const _AttributedLine({
    required this.name,
    required this.text,
    this.verb = 'Según',
  });

  final String name;
  final String text;
  final String verb;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        MediaEmblem(name: name, size: 24),
        const SizedBox(width: 8),
        Expanded(
          child: Text.rich(
            TextSpan(
              children: <InlineSpan>[
                TextSpan(
                  text: verb == 'Según' ? 'Según $name: ' : '$name $verb: ',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                TextSpan(text: text),
              ],
            ),
            style: ArenaText.body,
          ),
        ),
      ],
    ),
  );
}

/// A milestone label inside the chronology.
class _Milestone extends StatelessWidget {
  const _Milestone(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10, top: 2),
    child: Text(
      label.toUpperCase(),
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.4,
        color: ArenaColors.muted,
      ),
    ),
  );
}

class _TimelineEntry extends StatelessWidget {
  const _TimelineEntry({
    required this.article,
    required this.isLast,
    required this.store,
    this.isNew = false,
  });

  final EventCoverageArticleDto article;
  final bool isLast;
  final ArenaStore store;

  /// Published after the reader's last visit; the highlight depends on the
  /// date only, never on the outlet.
  final bool isNew;

  @override
  Widget build(BuildContext context) {
    final String? videoId = extractYouTubeVideoId(article.url.toString());
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SizedBox(
            width: 22,
            child: Column(
              children: <Widget>[
                const SizedBox(height: 4),
                Container(
                  width: 12,
                  height: 12,
                  decoration: const BoxDecoration(
                    color: ArenaColors.violet,
                    shape: BoxShape.circle,
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(width: 2, color: ArenaColors.border),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Flexible(
                        child: Text(
                          arenaDateTime(article.publishedAt),
                          style: ArenaText.meta,
                        ),
                      ),
                      if (isNew) ...const <Widget>[
                        SizedBox(width: 8),
                        ArenaBadge(
                          label: 'Nuevo',
                          background: ArenaColors.amberSoft,
                          foreground: ArenaColors.amberDeep,
                        ),
                      ],
                    ],
                  ),
                  MediaNameRow(
                    name: article.sourceName,
                    emblemSize: 24,
                    maxLines: 1,
                    onTap: article.sourceId == null
                        ? null
                        : () =>
                              openArenaMedia(context, store, article.sourceId!),
                  ),
                  const SizedBox(height: 4),
                  Semantics(
                    button: true,
                    label: 'Abrir original: ${article.title}',
                    child: InkWell(
                      onTap: () => unawaited(
                        openArenaPiece(
                          context,
                          store,
                          article.url,
                          title: article.title,
                          channel: article.sourceName,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          // A compact thumbnail beside the title instead
                          // of a full-width frame in the middle of the line.
                          if (videoId != null)
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                SizedBox(
                                  width: 96,
                                  child: ArenaVideoFrame(
                                    videoId: videoId,
                                    radius: 8,
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    article.title,
                                    style: ArenaText.cardTitle,
                                  ),
                                ),
                              ],
                            )
                          else
                            Text(
                              arenaHeadline(article.title),
                              style: ArenaText.cardTitle,
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Violet numbered circle shared by rankings and version steps.
Widget arenaNumberCircle(int number) => SizedBox.square(
  dimension: 30,
  child: DecoratedBox(
    decoration: const BoxDecoration(
      color: ArenaColors.violet,
      shape: BoxShape.circle,
    ),
    child: Center(
      child: MediaQuery.withNoTextScaling(
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            '$number',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 14,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    ),
  ),
);
