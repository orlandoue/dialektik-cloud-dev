import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/data/story_follow_store.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
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

  ArenaStore get store => widget.store;
  StoryFollowStore get stories => store.stories;

  @override
  void initState() {
    super.initState();
    _event = store.cachedDetail(widget.eventId);
    stories.addListener(_changed);
    unawaited(_load());
  }

  @override
  void dispose() {
    stories.removeListener(_changed);
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
    return Scaffold(
      backgroundColor: ArenaColors.background,
      appBar: AppBar(
        backgroundColor: ArenaColors.background,
        surfaceTintColor: Colors.transparent,
        foregroundColor: ArenaColors.ink,
        titleSpacing: 0,
        title: const FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            'Acontecimiento vivo',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
        ),
      ),
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
    final bool followingStory = stories.contains(event.id);
    return ListView(
      key: const Key('arena-event-scroll'),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
      children: <Widget>[
        Semantics(
          button: video != null,
          label: video == null ? null : 'Abrir video del acontecimiento',
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: video == null
                ? null
                : () => unawaited(store.openLink(video.url)),
            child: ArenaCover(
              topic: topic,
              videoId: videoId,
              showPlay: video != null,
              minHeight: 200,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    const ArenaBadge.live('ACONTECIMIENTO VIVO'),
                    const SizedBox(height: 56),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Semantics(
                          header: true,
                          child: Text(
                            event.titleDescriptive,
                            style: const TextStyle(
                              fontFamily: ArenaText.serif,
                              fontSize: 20,
                              height: 1.25,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '${topic.label} · desde el '
                          '${arenaDate(event.window.from)}',
                          style: const TextStyle(
                            fontSize: 13,
                            color: Color(0xFFE2E8F0),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          alignment: WrapAlignment.spaceBetween,
          children: <Widget>[
            Text(
              '📚 ${event.sourceCount} '
              '${event.sourceCount == 1 ? 'fuente' : 'fuentes'}',
              style: ArenaText.cardTitle,
            ),
            Text(
              followingStory ? '👥 Siguiendo' : '👥 Sin seguir',
              style: ArenaText.cardTitle,
            ),
            FilledButton.icon(
              key: const Key('arena-follow-story'),
              onPressed: _followBusy ? null : () => _toggleFollow(event),
              style: FilledButton.styleFrom(
                backgroundColor: followingStory
                    ? ArenaColors.violetSoft
                    : ArenaColors.violet,
                foregroundColor: followingStory
                    ? ArenaColors.violetDeep
                    : Colors.white,
                minimumSize: const Size(48, 44),
              ),
              icon: Icon(
                followingStory
                    ? Icons.notifications_active
                    : Icons.notifications_none,
                size: 18,
              ),
              label: Text(followingStory ? 'Siguiendo' : 'Seguir'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ArenaSubTabs(
          labels: const <String>[
            'Resumen',
            'Cronología',
            'Versiones',
            'Evidencia',
          ],
          selected: _tab,
          onSelected: (int value) => setState(() => _tab = value),
        ),
        const SizedBox(height: 14),
        if (_tab == 0) ..._summary(context, event, timeline),
        if (_tab == 1) ..._timeline(context, timeline),
        if (_tab == 2) ..._versions(event, timeline),
        if (_tab == 3) ..._evidence(context, event),
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
      event.titleDescriptive,
      for (final EventCoveragePositionDto p in event.coveragePositions) p.title,
      for (final EventCoverageArticleDto a in event.articles) a.title,
    ]);
    final Set<String> media = event.articles
        .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
        .toSet();
    return <Widget>[
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Wrap(
              spacing: 10,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                Text('Estado actual', style: ArenaText.section),
                ArenaBadge.live('En desarrollo'),
              ],
            ),
            const SizedBox(height: 8),
            if (event.primaryFact != null)
              Text(event.primaryFact!.statement, style: ArenaText.body)
            else if (event.coveragePositions.isEmpty)
              Text(event.titleDescriptive, style: ArenaText.body)
            else
              for (final EventCoveragePositionDto position
                  in event.coveragePositions)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text('• ${position.title}', style: ArenaText.body),
                ),
            const SizedBox(height: 8),
            Text(
              '${event.sourceCount} '
              '${event.sourceCount == 1 ? 'fuente ha' : 'fuentes han'} '
              'publicado ${event.articles.length} '
              '${event.articles.length == 1 ? 'pieza' : 'piezas'} sobre este '
              'caso'
              '${switch (event.coveragePositions.length) {
                0 => '',
                1 => ' y se registra 1 postura con cita literal',
                final int count => ' y se registran $count posturas con cita literal',
              }}.',
              style: ArenaText.meta,
            ),
          ],
        ),
      ),
      if (latest != null)
        ArenaCard(
          key: const Key('arena-last-change'),
          borderColor: ArenaColors.amberBright,
          borderWidth: 1.5,
          onTap: () => unawaited(store.openLink(latest.url)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                '⚡ Último cambio · ${arenaAgo(latest.publishedAt)}',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: ArenaColors.amberDeep,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${arenaSourceName(latest.sourceName)} sumó '
                '${extractYouTubeVideoId(latest.url.toString()) == null ? 'una publicación' : 'un video'} '
                'al caso:',
                style: ArenaText.meta,
              ),
              const SizedBox(height: 4),
              Text(latest.title, style: ArenaText.cardTitle),
            ],
          ),
        ),
      ArenaCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text('Claves del caso', style: ArenaText.section),
            _Key(
              label: 'Qué pasó',
              text: event.primaryFact?.statement ?? event.titleDescriptive,
            ),
            _Key(
              label: 'Quiénes están involucrados',
              text: actors.isEmpty
                  ? 'La cobertura aún no permite identificar nombres.'
                  : '${actors.join(', ')}. Nombres mencionados en los '
                        'titulares de la cobertura.',
            ),
            _Key(
              label: 'Impacto',
              text:
                  'Tema: ${arenaTopicOfEvent(event).label}. Lo cubren '
                  '${media.length} medios: ${media.join(', ')}.',
            ),
            if (duel != null) ...<Widget>[
              const SizedBox(height: 12),
              ArenaPrimaryButton(
                key: const Key('arena-open-duel'),
                label: 'Ver duelo VS: ${duel.nameA} vs ${duel.nameB}',
                onPressed: () => openArenaDuel(context, store, duel),
              ),
            ],
          ],
        ),
      ),
    ];
  }

  List<Widget> _timeline(
    BuildContext context,
    List<EventCoverageArticleDto> timeline,
  ) {
    if (timeline.isEmpty) {
      return const <Widget>[
        ArenaMessage('Todavía no hay publicaciones enlazadas a este caso.'),
      ];
    }
    return <Widget>[
      for (int i = 0; i < timeline.length; i++)
        _TimelineEntry(
          article: timeline[i],
          isLast: i == timeline.length - 1,
          store: store,
        ),
    ];
  }

  List<Widget> _versions(
    EventDetailDto event,
    List<EventCoverageArticleDto> timeline,
  ) {
    if (timeline.isEmpty) {
      return const <Widget>[
        ArenaMessage('Este caso todavía no registra versiones.'),
      ];
    }
    final DateTime firstDay = timeline.first.publishedAt.toLocal();
    bool sameDay(DateTime other) {
      final DateTime local = other.toLocal();
      return local.year == firstDay.year &&
          local.month == firstDay.month &&
          local.day == firstDay.day;
    }

    final List<EventCoverageArticleDto> opening = timeline
        .where((EventCoverageArticleDto a) => sameDay(a.publishedAt))
        .toList();
    final Set<String> openingSources = opening
        .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
        .toSet();
    final List<EventCoverageArticleDto> later = timeline
        .where((EventCoverageArticleDto a) => !sameDay(a.publishedAt))
        .toList();
    final Set<String> joined = later
        .map((EventCoverageArticleDto a) => arenaSourceName(a.sourceName))
        .toSet()
        .difference(openingSources);
    final StorySnapshot? snapshot = stories.snapshot(event.id);
    final int newSources = snapshot == null
        ? 0
        : event.sourceCount - snapshot.sourceCount;
    return <Widget>[
      const Padding(
        padding: EdgeInsets.only(bottom: 10),
        child: Text(
          'Las versiones tienen memoria',
          style: TextStyle(
            fontFamily: ArenaText.serif,
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: ArenaColors.ink,
          ),
        ),
      ),
      _VersionStep(
        number: 1,
        title: 'Anuncio / Primeras coberturas',
        date: arenaDate(timeline.first.publishedAt),
        body:
            '${opening.length} '
            '${opening.length == 1 ? 'publicación' : 'publicaciones'} de '
            '${openingSources.join(', ')}.',
        quote: timeline.first.title,
      ),
      _VersionStep(
        number: 2,
        title: 'Nuevos ángulos / fuentes sumadas',
        date: later.isEmpty ? 'Sin cambios' : arenaDate(later.last.publishedAt),
        body: later.isEmpty
            ? 'No se han sumado publicaciones después del primer día.'
            : '${later.length} '
                  '${later.length == 1 ? 'publicación posterior' : 'publicaciones posteriores'}'
                  '${joined.isEmpty ? ' de las mismas fuentes' : '. Se sumaron: ${joined.join(', ')}'}.',
        quote: later.lastOrNull?.title,
      ),
      _VersionStep(
        number: 3,
        title: 'Síntesis vigente',
        date: arenaDate(timeline.last.publishedAt),
        body:
            '${event.sourceCount} fuentes y ${event.articles.length} '
            'publicaciones. '
            '${event.coveragePositions.isEmpty ? 'Aún sin posturas con cita literal.' : 'Posturas registradas: ${event.coveragePositions.map((EventCoveragePositionDto p) => p.title).join(' · ')}.'}'
            '${snapshot == null
                ? ''
                : newSources > 0
                ? ' Desde tu última visita se sumaron $newSources fuentes.'
                : ' Sin fuentes nuevas desde tu última visita.'}',
        isLast: true,
      ),
    ];
  }

  List<Widget> _evidence(BuildContext context, EventDetailDto event) {
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
    return <Widget>[
      if (quotes.isEmpty)
        const ArenaMessage(
          'Este caso todavía no tiene citas literales verificadas.',
        ),
      for (final EventCoverageAssertionDto quote in quotes)
        ArenaCard(
          onTap: byId[quote.articleId] == null
              ? null
              : () => unawaited(store.openLink(byId[quote.articleId]!.url)),
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
                arenaQuote(quote.quotedText),
                style: const TextStyle(
                  fontFamily: ArenaText.serif,
                  fontSize: 15,
                  height: 1.4,
                  color: ArenaColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              const Row(
                children: <Widget>[
                  Icon(
                    Icons.check_circle,
                    size: 16,
                    color: ArenaColors.emerald,
                  ),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Cita literal verificada contra el original',
                      style: ArenaText.meta,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      const SizedBox(height: 4),
      ArenaPrimaryButton(
        key: const Key('arena-open-community'),
        icon: Icons.forum_outlined,
        label: 'Comunidad del caso',
        onPressed: () => openArenaCommunity(context, store, event),
      ),
    ];
  }
}

class _Key extends StatelessWidget {
  const _Key({required this.label, required this.text});

  final String label;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 10),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: ArenaColors.violetDeep,
          ),
        ),
        const SizedBox(height: 2),
        Text(text, style: ArenaText.body),
      ],
    ),
  );
}

class _TimelineEntry extends StatelessWidget {
  const _TimelineEntry({
    required this.article,
    required this.isLast,
    required this.store,
  });

  final EventCoverageArticleDto article;
  final bool isLast;
  final ArenaStore store;

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
                  Text(
                    arenaDateTime(article.publishedAt),
                    style: ArenaText.meta,
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
                      onTap: () => unawaited(store.openLink(article.url)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          if (videoId != null) ...<Widget>[
                            ArenaVideoFrame(videoId: videoId, radius: 12),
                            const SizedBox(height: 8),
                          ],
                          Text(article.title, style: ArenaText.cardTitle),
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

class _VersionStep extends StatelessWidget {
  const _VersionStep({
    required this.number,
    required this.title,
    required this.date,
    required this.body,
    this.quote,
    this.isLast = false,
  });

  final int number;
  final String title;
  final String date;
  final String body;
  final String? quote;
  final bool isLast;

  @override
  Widget build(BuildContext context) => ArenaCard(
    borderColor: isLast ? ArenaColors.violet : null,
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        _NumberCircle(number),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title, style: ArenaText.cardTitle),
              Text(date, style: ArenaText.meta),
              const SizedBox(height: 6),
              Text(body, style: ArenaText.body),
              if (quote != null) ...<Widget>[
                const SizedBox(height: 6),
                Text(
                  '«$quote»',
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.35,
                    fontStyle: FontStyle.italic,
                    color: ArenaColors.muted,
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

class _NumberCircle extends StatelessWidget {
  const _NumberCircle(this.number);

  final int number;

  @override
  Widget build(BuildContext context) => arenaNumberCircle(number);
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
