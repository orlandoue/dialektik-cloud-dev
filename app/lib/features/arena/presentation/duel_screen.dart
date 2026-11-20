import 'dart:async';

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_navigation.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_face.dart';
import 'package:dialektik/features/arena/presentation/youtube_player_sheet.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/consumer/data/public_api_failure.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/widgets/share_synthesis.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/material.dart';

String? arenaVideoIdOfEvent(EventDetailDto event) {
  for (final EventCoverageArticleDto article in event.articles) {
    final String? id = extractYouTubeVideoId(article.url.toString());
    if (id != null) return id;
  }
  return null;
}

/// The three explicit classifications a published contrast can carry.
const List<({String kind, String label})> arenaDuelKinds =
    <({String kind, String label})>[
      (kind: 'CONTRADICTION', label: 'Contradicción'),
      (kind: 'DIFFERENT_FOCUS', label: 'Distinto enfoque'),
      (kind: 'COMPATIBLE', label: 'Compatible'),
    ];

String arenaKindLabel(String? kind) {
  for (final ({String kind, String label}) item in arenaDuelKinds) {
    if (item.kind == kind) return item.label;
  }
  return 'Contraste';
}

/// `[Emblema] Medio 1   VS   [Emblema] Medio 2`, always on one row.
class DuelFaceOff extends StatelessWidget {
  const DuelFaceOff({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  Widget _side(BuildContext context, String name, String? sourceId) {
    final String label = arenaSourceName(name);
    const TextStyle style = TextStyle(
      fontSize: 14,
      fontWeight: FontWeight.w700,
      color: ArenaColors.ink,
    );
    // A one-word or short name shrinks to fit instead of breaking inside a
    // word; a long name wraps at its spaces.
    final bool compact = !label.contains(' ') || label.length <= 14;
    return Expanded(
      child: Semantics(
        button: sourceId != null,
        label: 'Abrir perfil de $label',
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: sourceId == null
              ? null
              : () => openArenaMedia(context, store, sourceId),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: <Widget>[
                MediaEmblem(name: name, size: 30),
                const SizedBox(width: 8),
                Flexible(
                  child: compact
                      ? FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            label,
                            maxLines: 1,
                            softWrap: false,
                            style: style,
                          ),
                        )
                      : Text(
                          label,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: style,
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Row(
    children: <Widget>[
      _side(context, duel.nameA, ArenaDuel.sourceIdOf(duel.positionA)),
      const Padding(
        padding: EdgeInsets.symmetric(horizontal: 8),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: ArenaColors.violetSoft,
            borderRadius: BorderRadius.all(Radius.circular(999)),
          ),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            child: Text(
              'VS',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: ArenaColors.violet,
              ),
            ),
          ),
        ),
      ),
      _side(context, duel.nameB, ArenaDuel.sourceIdOf(duel.positionB)),
    ],
  );
}

/// Thermometer of a duel: support of each posture when Core serves
/// posture votes, otherwise the case-level support votes.
class DuelThermometer extends StatefulWidget {
  const DuelThermometer({required this.store, required this.duel, super.key});

  final ArenaStore store;
  final ArenaDuel duel;

  @override
  State<DuelThermometer> createState() => _DuelThermometerState();
}

class _DuelThermometerState extends State<DuelThermometer> {
  @override
  void initState() {
    super.initState();
    final ArenaStore store = widget.store;
    final String eventId = widget.duel.event.id;
    if (store.cachedPositionVotes(eventId) == null) {
      unawaited(store.positionVotes(eventId));
    }
    if (store.cachedSummary(eventId) == null) {
      unawaited(
        store.summary(eventId).then<void>((_) {}).catchError((Object _) {}),
      );
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.store,
    builder: (BuildContext context, _) =>
        arenaDuelThermometer(widget.store, widget.duel),
  );
}

Widget arenaDuelThermometer(ArenaStore store, ArenaDuel duel) {
  final PositionVotes? votes = store.cachedPositionVotes(duel.event.id);
  if (votes == null) {
    return EvidenceThermometer(summary: store.cachedSummary(duel.event.id));
  }
  return PostureThermometer(
    nameA: duel.nameA,
    nameB: duel.nameB,
    votesA: votes.votesFor(duel.idA),
    votesB: votes.votesFor(duel.idB),
    voted: votes.mine != null,
  );
}

/// Protagonist card of the Coliseo, as in the mockup: the kind, the case,
/// the two versions face to face with the VS bolt and, after the vote, the
/// community's split. Before the vote it is read blind («Versión A/B»), so
/// no outlet anchors the choice.
class DuelOfTheDayCard extends StatelessWidget {
  const DuelOfTheDayCard({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  void _readBlind(BuildContext context) {
    store.setBlind(duel.event.id, value: true);
    openArenaDuel(context, store, duel);
  }

  @override
  Widget build(BuildContext context) {
    final bool voted = store.cachedPositionVotes(duel.event.id)?.mine != null;
    final bool saved = store.saved.contains(duel.event.id);
    final ArenaTopic topic = arenaTopicOfEvent(duel.event);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const ArenaBadge.fire('DUELO DEL DÍA'),
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  topic.label.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                    color: ArenaColors.violet,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          KeyedSubtree(
            key: const Key('arena-duel-of-day-kind'),
            child: DuelKindBadge(kind: duel.kind),
          ),
          const SizedBox(height: 8),
          GestureDetector(
            onTap: () => openArenaDuel(context, store, duel),
            child: Text(
              duel.title,
              style: const TextStyle(
                fontFamily: ArenaText.serif,
                fontSize: 24,
                height: 1.25,
                fontWeight: FontWeight.w800,
                color: ArenaColors.ink,
              ),
            ),
          ),
          const SizedBox(height: 14),
          GestureDetector(
            onTap: voted
                ? () => openArenaDuel(context, store, duel)
                : () => _readBlind(context),
            child: DuelVersionsPanel(
              duel: duel,
              store: store,
              large: true,
              forceHidden: true,
            ),
          ),
          DuelSplitBar(duel: duel, store: store),
          const SizedBox(height: 14),
          Row(
            children: <Widget>[
              Expanded(
                child: FilledButton(
                  key: Key(
                    voted ? 'arena-duel-of-day-open' : 'arena-duel-of-day-read',
                  ),
                  onPressed: voted
                      ? () => openArenaDuel(context, store, duel)
                      : () => _readBlind(context),
                  style: FilledButton.styleFrom(
                    backgroundColor: duelColorA,
                    minimumSize: const Size(48, 52),
                    shape: const StadiumBorder(),
                  ),
                  child: Text(
                    voted
                        ? 'Ver notas originales y comunidad →'
                        : 'Votar a ciegas →',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Compartir duelo',
                color: ArenaColors.ink,
                onPressed: () => showSynthesisSharePreview(
                  context,
                  duel.event,
                  relation: duel.kind,
                ),
                icon: const Icon(Icons.ios_share),
              ),
              IconButton(
                tooltip: saved ? 'Quitar de guardados' : 'Guardar duelo',
                color: saved ? ArenaColors.violet : ArenaColors.ink,
                onPressed: () => store.toggleSaved(duel.event.id),
                icon: Icon(saved ? Icons.bookmark : Icons.bookmark_border),
              ),
            ],
          ),
          if (voted)
            Center(
              child: TextButton(
                key: const Key('arena-duel-of-day-change-vote'),
                onPressed: () => showArenaVoteSheet(context, store, duel.event),
                child: const Text(
                  'Cambiar mi voto',
                  style: TextStyle(decoration: TextDecoration.underline),
                ),
              ),
            )
          else
            Center(
              child: TextButton(
                key: const Key('arena-duel-of-day-with-outlets'),
                onPressed: () => openArenaDuel(context, store, duel),
                child: const Text('Ver con los medios'),
              ),
            ),
        ],
      ),
    );
  }
}

/// Swipeable carousel of the most recent duels with its page dots.
///
/// A `PageView` needs a fixed height, which clips cards under large system
/// text. Pages are laid out side by side at the viewport width inside a
/// paging scroll view instead, so the carousel is as tall as its tallest
/// card and still snaps page by page.
class DuelCarousel extends StatefulWidget {
  const DuelCarousel({required this.duels, required this.store, super.key});

  static const int maximumPages = 5;

  final List<ArenaDuel> duels;
  final ArenaStore store;

  @override
  State<DuelCarousel> createState() => _DuelCarouselState();
}

class _DuelCarouselState extends State<DuelCarousel> {
  final ScrollController _controller = ScrollController();
  int _page = 0;
  double _pageWidth = 1;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_scrolled);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _scrolled() {
    final int page = (_controller.offset / _pageWidth).round();
    if (page != _page && mounted) setState(() => _page = page);
  }

  void _goTo(int page) => unawaited(
    _controller.animateTo(
      page * _pageWidth,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final List<ArenaDuel> pages = widget.duels
        .take(DuelCarousel.maximumPages)
        .toList();
    final int current = _page.clamp(0, pages.length - 1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            _pageWidth = constraints.maxWidth;
            return SingleChildScrollView(
              key: const Key('arena-duel-carousel'),
              controller: _controller,
              scrollDirection: Axis.horizontal,
              physics: pages.length > 1
                  ? const PageScrollPhysics()
                  : const NeverScrollableScrollPhysics(),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (int i = 0; i < pages.length; i++)
                      SizedBox(
                        width: constraints.maxWidth,
                        child: DuelOfTheDayCard(
                          key: Key(
                            i == 0
                                ? 'arena-duel-of-the-day'
                                : 'arena-duel-page-$i',
                          ),
                          duel: pages[i],
                          store: widget.store,
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        ),
        if (pages.length > 1)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Semantics(
              label:
                  'Duelo ${current + 1} de ${pages.length}. Desliza para '
                  'ver más',
              child: Row(
                key: const Key('arena-duel-dots'),
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  for (int i = 0; i < pages.length; i++)
                    GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => _goTo(i),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 6,
                        ),
                        child: AnimatedContainer(
                          key: ValueKey<String>('arena-duel-dot-$i'),
                          duration: const Duration(milliseconds: 200),
                          width: i == current ? 18 : 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: i == current
                                ? ArenaColors.violet
                                : ArenaColors.track,
                            borderRadius: BorderRadius.circular(999),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 12),
      ],
    );
  }
}

/// Share, save and open actions of a duel card.
class DuelActions extends StatelessWidget {
  const DuelActions({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (BuildContext context, _) {
      final bool saved = store.saved.contains(duel.event.id);
      return Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.end,
        children: <Widget>[
          // The whole card opens the duel; these two are its only actions.
          IconButton(
            tooltip: 'Compartir duelo',
            color: ArenaColors.muted,
            onPressed: () => showSynthesisSharePreview(
              context,
              duel.event,
              relation: duel.kind,
            ),
            icon: const Icon(Icons.ios_share),
          ),
          IconButton(
            tooltip: saved ? 'Quitar de guardados' : 'Guardar duelo',
            color: saved ? ArenaColors.violet : ArenaColors.muted,
            onPressed: () => store.toggleSaved(duel.event.id),
            icon: Icon(saved ? Icons.bookmark : Icons.bookmark_border),
          ),
        ],
      );
    },
  );
}

/// Compact duel used in the VS tab and in media profiles.
class DuelListCard extends StatelessWidget {
  const DuelListCard({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) {
    final PositionVotes? votes = store.cachedPositionVotes(duel.event.id);
    final bool voted = votes?.mine != null;
    return ArenaCard(
      key: ValueKey<String>('arena-duel-${duel.contrast.id}'),
      onTap: () => openArenaDuel(context, store, duel),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  duelMetaLine(duel),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.3,
                    color: ArenaColors.muted,
                  ),
                ),
              ),
              if (voted) ...<Widget>[
                const DuelVotedBadge(),
                const SizedBox(width: 6),
              ],
              Flexible(child: DuelKindPill(kind: duel.kind)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            duel.title,
            style: const TextStyle(
              fontFamily: ArenaText.serif,
              fontSize: 19,
              height: 1.25,
              fontWeight: FontWeight.w800,
              color: ArenaColors.ink,
            ),
          ),
          const SizedBox(height: 12),
          DuelVersionsPanel(duel: duel, store: store),
          DuelSplitBar(duel: duel, store: store),
          const SizedBox(height: 8),
          const Divider(height: 1),
          DuelSocialRow(duel: duel, store: store),
        ],
      ),
    );
  }
}

/// The social row of a duel card: comments, share, save, and the next step
/// (vote blind, or the community once voted).
class DuelSocialRow extends StatelessWidget {
  const DuelSocialRow({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) {
    final bool voted = store.cachedPositionVotes(duel.event.id)?.mine != null;
    final bool saved = store.saved.contains(duel.event.id);
    final int? comments = store.commentCount(duel.event.id);
    return Row(
      children: <Widget>[
        TextButton.icon(
          key: const Key('arena-duel-comments'),
          onPressed: () => openArenaCommunity(context, store, duel.event),
          style: TextButton.styleFrom(
            foregroundColor: ArenaColors.ink,
            minimumSize: const Size(44, 44),
            padding: const EdgeInsets.symmetric(horizontal: 4),
          ),
          icon: const Icon(Icons.chat_bubble_outline, size: 20),
          label: Text(comments == null ? '' : '$comments'),
        ),
        IconButton(
          tooltip: 'Compartir duelo',
          color: ArenaColors.ink,
          constraints: const BoxConstraints.tightFor(width: 44, height: 44),
          padding: EdgeInsets.zero,
          onPressed: () => showSynthesisSharePreview(
            context,
            duel.event,
            relation: duel.kind,
          ),
          icon: const Icon(Icons.send_outlined, size: 20),
        ),
        IconButton(
          tooltip: saved ? 'Quitar de guardados' : 'Guardar duelo',
          color: saved ? ArenaColors.violet : ArenaColors.ink,
          constraints: const BoxConstraints.tightFor(width: 44, height: 44),
          padding: EdgeInsets.zero,
          onPressed: () => store.toggleSaved(duel.event.id),
          icon: Icon(saved ? Icons.bookmark : Icons.bookmark_border, size: 20),
        ),
        Expanded(
          child: Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: const Key('arena-duel-next'),
              onPressed: voted
                  ? () => openArenaCommunity(context, store, duel.event)
                  : () {
                      store.setBlind(duel.event.id, value: true);
                      openArenaDuel(context, store, duel);
                    },
              style: TextButton.styleFrom(
                foregroundColor: duelColorA,
                minimumSize: const Size(48, 44),
              ),
              child: Text(
                voted ? 'Ver comunidad →' : 'Votar a ciegas →',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Pantalla 2 — `VS · Duelo de Medios`.
class DuelScreen extends StatefulWidget {
  const DuelScreen({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  State<DuelScreen> createState() => _DuelScreenState();
}

class _DuelScreenState extends State<DuelScreen> {
  int _tab = 0;

  ArenaDuel get duel => widget.duel;
  ArenaStore get store => widget.store;

  @override
  void initState() {
    super.initState();
    unawaited(
      store.summary(duel.event.id).then<void>((_) {}).catchError((Object _) {}),
    );
    unawaited(store.positionVotes(duel.event.id));
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
          'VS · Duelo de Medios',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ),
      actions: <Widget>[
        IconButton(
          tooltip: 'Compartir duelo',
          onPressed: () => showSynthesisSharePreview(
            context,
            duel.event,
            relation: duel.kind,
          ),
          icon: const Icon(Icons.ios_share),
        ),
      ],
    ),
    bottomNavigationBar: SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: ArenaGradientButton(
        key: const Key('arena-vote-button'),
        icon: Icons.bolt,
        label: arenaVoteQuestion(duel.kind),
        onPressed: () => showArenaVoteSheet(context, store, duel.event),
      ),
    ),
    body: ListView(
      key: const Key('arena-duel-scroll'),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: <Widget>[
        Text(
          '${arenaTopicOfEvent(duel.event).label.toUpperCase()} · '
          '${arenaDate(duel.contrast.confirmedAt)}',
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.4,
            color: ArenaColors.violet,
          ),
        ),
        const SizedBox(height: 8),
        Semantics(
          header: true,
          child: Text(
            duel.title,
            style: const TextStyle(
              fontSize: 22,
              height: 1.25,
              fontWeight: FontWeight.w800,
              color: ArenaColors.ink,
            ),
          ),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: DuelKindBadge(kind: duel.kind),
        ),
        const SizedBox(height: 14),
        ListenableBuilder(
          listenable: store,
          builder: (BuildContext context, _) {
            final bool hidden = store.hidesOutlets(duel.event.id);
            final List<Widget> cards = <Widget>[
              _PostureCard(
                duel.event,
                duel.positionA,
                store,
                blindLabel: hidden ? 'Versión A' : null,
              ),
              _PostureCard(
                duel.event,
                duel.positionB,
                store,
                blindLabel: hidden ? 'Versión B' : null,
              ),
            ];
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                _BlindToggle(store: store, eventId: duel.event.id),
                const SizedBox(height: 8),
                // Side by side at normal sizes; one under the other, full
                // width, once the text is enlarged so neither is squeezed.
                if (MediaQuery.textScalerOf(context).scale(10) >=
                    13) ...<Widget>[
                  cards[0],
                  const SizedBox(height: 8),
                  cards[1],
                ] else
                  IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Expanded(child: cards[0]),
                        const SizedBox(width: 8),
                        Expanded(child: cards[1]),
                      ],
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 16),
        ArenaSubTabs(
          labels: const <String>['Notas originales', 'Qué significa'],
          selected: _tab,
          onSelected: (int value) => setState(() => _tab = value),
        ),
        const SizedBox(height: 14),
        if (_tab == 0) ..._notes(context),
        if (_tab == 1) ..._analysis(),
      ],
    ),
  );

  /// The original publications in the order they appeared, each one a link
  /// to its outlet, then the ways to go further.
  List<Widget> _notes(BuildContext context) {
    final EventDetailDto event = duel.event;
    final List<EventCoverageArticleDto> timeline = event.articles.toList()
      ..sort(
        (EventCoverageArticleDto a, EventCoverageArticleDto b) =>
            a.publishedAt.compareTo(b.publishedAt),
      );
    return <Widget>[
      for (final EventCoverageArticleDto article in timeline)
        KeyedSubtree(
          key: ValueKey<String>('arena-context-${article.id}'),
          child: _SourceLinkCard(
            article: article,
            onOpen: () => unawaited(
              openArenaPiece(
                context,
                store,
                article.url,
                title: article.title,
                channel: article.sourceName,
              ),
            ),
            onOpenSource: article.sourceId == null
                ? null
                : () => openArenaMedia(context, store, article.sourceId!),
          ),
        ),
      const SizedBox(height: 4),
      // The case's community is one tap away, not hidden in the vote sheet.
      OutlinedButton.icon(
        key: const Key('arena-open-community'),
        onPressed: () => openArenaCommunity(context, store, event),
        style: arenaSecondaryButtonStyle(),
        icon: const Icon(Icons.forum_outlined),
        label: const Text('Comunidad del caso'),
      ),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        key: const Key('arena-add-evidence'),
        onPressed: () => showArenaContributionSheet(context, store, event),
        style: arenaSecondaryButtonStyle(),
        icon: const Icon(Icons.add_link_rounded),
        label: const Text('Aportar una fuente'),
      ),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        key: const Key('arena-open-living-event'),
        onPressed: () => openArenaEvent(context, store, event.id),
        style: arenaSecondaryButtonStyle(),
        icon: const Icon(Icons.timeline_rounded),
        label: const Text('Ver el acontecimiento completo'),
      ),
    ];
  }

  /// Dialektik's own reading, visibly separate from what the outlets said.
  List<Widget> _analysis() {
    final String explanation = switch (duel.kind) {
      'CONTRADICTION' =>
        'Las dos citas describen el mismo hecho con afirmaciones que no '
            'pueden ser ciertas a la vez. Dialektik no declara cuál es la '
            'correcta: revisa las notas originales.',
      'DIFFERENT_FOCUS' =>
        'Ambos medios informan sobre el mismo acontecimiento, pero ponen el '
            'acento en aspectos distintos. Sus afirmaciones no se excluyen.',
      'COMPATIBLE' =>
        'Las citas de ambos medios son compatibles: describen el mismo '
            'acontecimiento sin afirmaciones que se opongan.',
      _ =>
        'Los dos medios cubren el mismo acontecimiento desde ángulos '
            'distintos. Revisa las citas y las notas originales.',
    };
    return <Widget>[
      const Padding(
        padding: EdgeInsets.only(bottom: 10),
        child: Text(
          'Esto lo escribe Dialektik. Lo que dijo cada medio está en sus '
          'citas y en Notas originales.',
          style: ArenaText.meta,
        ),
      ),
      ArenaInterpretationBox(
        key: const Key('arena-ai-analysis'),
        title: 'Por qué es ${arenaKindLabel(duel.kind).toLowerCase()}',
        body: explanation,
      ),
      const SizedBox(height: 12),
      for (final EventCoveragePositionDto? position
          in <EventCoveragePositionDto?>[duel.positionA, duel.positionB])
        ArenaAttributedQuote(event: duel.event, position: position),
    ];
  }
}

/// The one classification of this duel, labelled as Dialektik's own and
/// explained on tap. All kinds share one neutral style: a colour per kind
/// would read as a verdict on the outlets.
class DuelKindBadge extends StatelessWidget {
  const DuelKindBadge({required this.kind, super.key});

  final String kind;

  static ({IconData icon, String label, String explanation}) describe(
    String kind,
  ) => switch (kind) {
    'CONTRADICTION' => (
      icon: Icons.compare_arrows_rounded,
      label: 'Contradicción',
      explanation:
          'Dialektik encontró dos afirmaciones sobre el mismo hecho que no '
          'pueden ser ciertas a la vez. No indica cuál es la correcta.',
    ),
    'COMPATIBLE' => (
      icon: Icons.join_inner_rounded,
      label: 'Compatible',
      explanation:
          'Dialektik no encontró afirmaciones que se opongan: los medios '
          'describen el mismo acontecimiento de forma compatible.',
    ),
    _ => (
      icon: Icons.center_focus_weak_rounded,
      label: 'Distinto enfoque',
      explanation:
          'Los medios hablan del mismo acontecimiento pero ponen el acento '
          'en aspectos distintos. Sus afirmaciones no se excluyen.',
    ),
  };

  @override
  Widget build(BuildContext context) {
    final ({IconData icon, String label, String explanation}) style = describe(
      kind,
    );
    return Semantics(
      button: true,
      label:
          'Tipo de duelo según Dialektik: ${style.label}. Toca para saber '
          'qué significa',
      child: ExcludeSemantics(
        child: Material(
          color: ArenaColors.card,
          shape: const StadiumBorder(
            side: BorderSide(color: ArenaColors.border),
          ),
          child: InkWell(
            key: const Key('arena-duel-kind'),
            customBorder: const StadiumBorder(),
            onTap: () => showModalBottomSheet<void>(
              context: context,
              showDragHandle: true,
              backgroundColor: ArenaColors.card,
              builder: (BuildContext sheetContext) => SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Tipo de duelo: ${style.label}',
                        style: ArenaText.section,
                      ),
                      const SizedBox(height: 8),
                      Text(style.explanation, style: ArenaText.body),
                      const SizedBox(height: 8),
                      const Text(
                        'Es una clasificación de Dialektik, no de los medios.',
                        style: ArenaText.meta,
                      ),
                      const SizedBox(height: 12),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          style: TextButton.styleFrom(
                            minimumSize: const Size(64, 44),
                          ),
                          onPressed: () => Navigator.of(sheetContext).pop(),
                          child: const Text('Cerrar'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Icon(style.icon, size: 16, color: ArenaColors.muted),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text.rich(
                        TextSpan(
                          children: <InlineSpan>[
                            const TextSpan(
                              text: 'Tipo de duelo (Dialektik): ',
                              style: TextStyle(
                                fontWeight: FontWeight.w500,
                                color: ArenaColors.muted,
                              ),
                            ),
                            TextSpan(
                              text: style.label,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                color: ArenaColors.ink,
                              ),
                            ),
                          ],
                        ),
                        style: const TextStyle(fontSize: 13),
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Icon(
                      Icons.info_outline_rounded,
                      size: 16,
                      color: ArenaColors.muted,
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
}

class _PostureCard extends StatelessWidget {
  const _PostureCard(this.event, this.position, this.store, {this.blindLabel});

  final EventDetailDto event;
  final EventCoveragePositionDto? position;
  final ArenaStore store;

  /// «Versión A/B» while the reader reads blind; the outlet, its emblem and
  /// its link stay hidden until they vote.
  final String? blindLabel;

  /// The outlet's own publication in this case, to read the quote in context.
  EventCoverageArticleDto? get _article {
    final String? sourceId = ArenaDuel.sourceIdOf(position);
    if (sourceId == null) return null;
    for (final EventCoverageArticleDto article in event.articles) {
      if (article.sourceId == sourceId) return article;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final String? sourceId = ArenaDuel.sourceIdOf(position);
    final ({String text, bool literal}) posture = arenaPostureText(
      event,
      position,
    );
    final String quote = posture.literal ? arenaQuote(posture.text) : '';
    return DecoratedBox(
      decoration: arenaCardDecoration(),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            if (blindLabel != null)
              Text(
                blindLabel!,
                key: ValueKey<String>('arena-blind-$blindLabel'),
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: ArenaColors.ink,
                ),
              )
            else
              // A Wrap lets a long name drop under its emblem as a whole word
              // instead of breaking inside the narrow half-width card.
              Semantics(
                button: sourceId != null,
                label: 'Abrir perfil de ${ArenaDuel.nameOf(position)}',
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: sourceId == null
                      ? null
                      : () => openArenaMedia(context, store, sourceId),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: <Widget>[
                      MediaEmblem(name: ArenaDuel.nameOf(position), size: 30),
                      Text(
                        ArenaDuel.nameOf(position),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: ArenaColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 10),
            // Merriweather and quotation marks only for literal quotes; a
            // headline stand-in is set like any other Dialektik text.
            Text(
              quote.isNotEmpty ? quote : posture.text,
              style: quote.isNotEmpty
                  ? const TextStyle(
                      fontFamily: ArenaText.serif,
                      fontSize: 14,
                      height: 1.45,
                      color: ArenaColors.ink,
                    )
                  : ArenaText.body,
            ),
            const SizedBox(height: 8),
            Text(
              quote.isNotEmpty
                  ? arenaVerifiedQuoteLabel
                  : 'Titular de su publicación',
              style: ArenaText.meta,
            ),
            if (_article != null && blindLabel == null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  key: ValueKey<String>('arena-quote-context-${_article!.id}'),
                  style: TextButton.styleFrom(
                    foregroundColor: ArenaColors.violet,
                    minimumSize: const Size(44, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    tapTargetSize: MaterialTapTargetSize.padded,
                  ),
                  onPressed: () => unawaited(
                    openArenaPiece(
                      context,
                      store,
                      _article!.url,
                      title: _article!.title,
                      channel: _article!.sourceName,
                    ),
                  ),
                  child: const Text(
                    'Ver en contexto ↗',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// An original publication shown as an obvious, tappable web link.
class _SourceLinkCard extends StatelessWidget {
  const _SourceLinkCard({
    required this.article,
    required this.onOpen,
    required this.onOpenSource,
  });

  final EventCoverageArticleDto article;
  final VoidCallback onOpen;
  final VoidCallback? onOpenSource;

  @override
  Widget build(BuildContext context) {
    final String? videoId = extractYouTubeVideoId(article.url.toString());
    // The same card for a video and a written note: a 96-wide leading box
    // holds the video frame or the outlet's emblem, so a picture never
    // makes one version weigh more on screen than the other.
    return ArenaCard(
      key: ValueKey<String>('arena-source-link-${article.id}'),
      onTap: onOpen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              SizedBox(
                width: 96,
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: videoId != null
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: YouTubeThumbnail(
                            key: ValueKey<String>(
                              'arena-source-thumbnail-${article.id}',
                            ),
                            videoId: videoId,
                          ),
                        )
                      : DecoratedBox(
                          decoration: BoxDecoration(
                            color: const Color(0xFFEEF0F5),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Center(
                            child: Semantics(
                              button: onOpenSource != null,
                              label:
                                  'Abrir perfil de ${arenaSourceName(article.sourceName)}',
                              child: InkWell(
                                customBorder: const CircleBorder(),
                                onTap: onOpenSource,
                                child: MediaEmblem(
                                  name: article.sourceName,
                                  size: 34,
                                ),
                              ),
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
                      article.title,
                      style: const TextStyle(
                        fontSize: 14.5,
                        height: 1.3,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF1A1A1A),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${arenaDateTime(article.publishedAt)} · '
                      '${arenaSourceName(article.sourceName)}',
                      style: ArenaText.meta,
                    ),
                    const SizedBox(height: 6),
                    // The whole card opens the original; this row says so.
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            videoId != null
                                ? '▶ Ver video en la app'
                                : 'Leer en el medio',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: ArenaColors.violet,
                              decoration: TextDecoration.underline,
                              decorationColor: ArenaColors.violet,
                            ),
                          ),
                        ),
                        if (videoId == null) ...const <Widget>[
                          SizedBox(width: 4),
                          Icon(
                            Icons.open_in_new,
                            size: 16,
                            color: ArenaColors.violet,
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The vote question for each kind of duel. Only a contradiction asks which
/// version the reader believes: in a different focus or a compatible duel
/// both versions can be true at once.
String arenaVoteQuestion(String? kind) => switch (kind) {
  'DIFFERENT_FOCUS' => '¿Qué enfoque te ayuda más a entender el hecho?',
  'COMPATIBLE' => '¿Qué cobertura te parece más clara?',
  _ => '¿A qué versión le crees más?',
};

/// «Leer a ciegas»: hides the outlets until the reader votes, so the brand
/// does not anchor the choice. Both versions are revealed together.
class _BlindToggle extends StatelessWidget {
  const _BlindToggle({required this.store, required this.eventId});

  final ArenaStore store;
  final String eventId;

  @override
  Widget build(BuildContext context) {
    final bool blind = store.isBlind(eventId);
    final bool voted = store.cachedPositionVotes(eventId)?.mine != null;
    return Row(
      children: <Widget>[
        Expanded(
          child: Text(
            blind && voted
                ? 'Ya votaste: estos son los medios de cada versión.'
                : 'Lee sin saber qué medio dijo cada cita y descúbrelo al votar.',
            style: ArenaText.meta,
          ),
        ),
        const SizedBox(width: 8),
        Semantics(
          toggled: blind,
          label: 'Leer a ciegas',
          child: FilterChip(
            key: const Key('arena-blind-toggle'),
            label: const Text('Leer a ciegas'),
            selected: blind,
            showCheckmark: true,
            materialTapTargetSize: MaterialTapTargetSize.padded,
            selectedColor: ArenaColors.violetSoft,
            onSelected: voted && !blind
                ? null
                : (bool value) => store.setBlind(eventId, value: value),
          ),
        ),
      ],
    );
  }
}

/// Modal to contribute a link with a supporting note to the case.
Future<void> showArenaContributionSheet(
  BuildContext context,
  ArenaStore store,
  EventDetailDto event,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  backgroundColor: ArenaColors.card,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
  ),
  builder: (BuildContext sheetContext) =>
      _ContributionSheet(store: store, event: event, hostContext: context),
);

class _ContributionSheet extends StatefulWidget {
  const _ContributionSheet({
    required this.store,
    required this.event,
    required this.hostContext,
  });

  final ArenaStore store;
  final EventDetailDto event;
  final BuildContext hostContext;

  @override
  State<_ContributionSheet> createState() => _ContributionSheetState();
}

class _ContributionSheetState extends State<_ContributionSheet> {
  final TextEditingController _link = TextEditingController();
  final TextEditingController _note = TextEditingController();
  String? _error;
  bool _sending = false;

  /// The version the link is about: a position id, or the whole case.
  ({bool chosen, String? positionId}) _version = (
    chosen: false,
    positionId: null,
  );
  EntryStance? _stance;

  /// Versions as this reader sees them («Versión A» is drawn per reader).
  List<({String? id, String label})> get _versions {
    final ArenaDuel? duel = widget.store.duelForEvent(widget.event.id);
    final bool hidden =
        duel != null && widget.store.hidesOutlets(widget.event.id);
    return <({String? id, String label})>[
      if (duel != null) ...<({String? id, String label})>[
        (
          id: duel.idA,
          label: hidden ? 'Versión A' : 'Versión A · ${duel.nameA}',
        ),
        (
          id: duel.idB,
          label: hidden ? 'Versión B' : 'Versión B · ${duel.nameB}',
        ),
      ],
      (id: null, label: 'El caso en general'),
    ];
  }

  @override
  void dispose() {
    _link.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final Uri? uri = Uri.tryParse(_link.text.trim());
    final String note = _note.text.trim();
    if (uri == null ||
        (uri.scheme != 'https' && uri.scheme != 'http') ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      setState(
        () => _error = 'Pega un enlace completo que empiece con https://',
      );
      return;
    }
    if (!_version.chosen || _stance == null) {
      setState(
        () => _error = 'Elige a qué versión se refiere y qué hace el enlace.',
      );
      return;
    }
    if (note.isEmpty) {
      setState(() => _error = 'Explica en una línea qué respalda este enlace.');
      return;
    }
    final ArenaSocialRepository? arena = widget.store.arenaSocial;
    if (arena == null) {
      setState(() => _error = 'Inicia sesión para aportar evidencia.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final List<CommunityEntry> entries = await arena.addCommunityEntry(
        widget.event.id,
        channel: CommunityChannel.aporte,
        body: note,
        link: uri,
        alias: widget.store.alias,
        positionId: _version.positionId,
        stance: _stance,
      );
      widget.store.rememberCommunity(widget.event.id, entries);
      final bool inReview = entries
          .where((CommunityEntry e) => e.mine)
          .any((CommunityEntry e) => e.inReview && e.body == note);
      if (!mounted) return;
      Navigator.of(context).pop();
      if (widget.hostContext.mounted) {
        ScaffoldMessenger.of(widget.hostContext).showSnackBar(
          SnackBar(
            content: Text(
              inReview
                  ? 'Tu aporte quedó en revisión: se publica cuando un '
                        'moderador lo apruebe.'
                  : 'Tu aporte quedó publicado en la comunidad.',
            ),
            action: SnackBarAction(
              label: 'Ver',
              onPressed: () => openArenaCommunity(
                widget.hostContext,
                widget.store,
                widget.event,
              ),
            ),
          ),
        );
      }
    } on PublicApiFailure catch (failure) {
      if (mounted) {
        setState(
          () => _error = failure.kind == PublicFailureKind.rateLimited
              ? 'Llegaste a los 3 aportes con enlace de hoy. Vuelve mañana.'
              : 'El servidor todavía no acepta enlaces externos. Puedes '
                    'adjuntar una publicación del caso desde la comunidad.',
        );
      }
    } on Exception {
      if (mounted) {
        setState(
          () => _error =
              'El servidor todavía no acepta enlaces externos. Puedes '
              'adjuntar una publicación del caso desde la comunidad.',
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text('Aportar una fuente', style: ArenaText.section),
          const SizedBox(height: 4),
          const Text(
            'Suma un enlace que respalde o contradiga una de las versiones, '
            'o que dé contexto al caso.',
            style: ArenaText.meta,
          ),
          const SizedBox(height: 12),
          const Text('¿A qué se refiere?', style: ArenaText.cardTitle),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              for (final ({String? id, String label}) v in _versions)
                ArenaPill(
                  key: ValueKey<String>(
                    'arena-evidence-version-${v.id ?? 'case'}',
                  ),
                  label: v.label,
                  selected: _version.chosen && _version.positionId == v.id,
                  onTap: () => setState(
                    () => _version = (chosen: true, positionId: v.id),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          const Text('¿Qué hace el enlace?', style: ArenaText.cardTitle),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              for (final EntryStance stance in EntryStance.values)
                ArenaPill(
                  key: ValueKey<String>('arena-evidence-stance-${stance.wire}'),
                  label: stance.label,
                  selected: _stance == stance,
                  onTap: () => setState(() => _stance = stance),
                ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('arena-evidence-link'),
            controller: _link,
            keyboardType: TextInputType.url,
            decoration: InputDecoration(
              labelText: 'Enlace',
              hintText: 'https://…',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            key: const Key('arena-evidence-note'),
            controller: _note,
            minLines: 2,
            maxLines: 4,
            maxLength: 600,
            decoration: InputDecoration(
              labelText: 'Qué aporta esta fuente',
              hintText: '¿Qué demuestra este enlace?',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _error!,
                style: const TextStyle(color: ArenaColors.amberDeep),
              ),
            ),
          ArenaPrimaryButton(
            key: const Key('arena-evidence-send'),
            icon: Icons.add_link_rounded,
            label: 'Publicar aporte',
            onPressed: _sending ? null : _send,
          ),
        ],
      ),
    ),
  );
}

/// Bottom sheet where a signed-in reader rates the support of a case.
Future<void> showArenaVoteSheet(
  BuildContext context,
  ArenaStore store,
  EventDetailDto event,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  backgroundColor: ArenaColors.card,
  shape: const RoundedRectangleBorder(
    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
  ),
  builder: (BuildContext sheetContext) =>
      _VoteSheet(store: store, event: event, hostContext: context),
);

class _VoteSheet extends StatefulWidget {
  const _VoteSheet({
    required this.store,
    required this.event,
    required this.hostContext,
  });

  final ArenaStore store;
  final EventDetailDto event;
  final BuildContext hostContext;

  @override
  State<_VoteSheet> createState() => _VoteSheetState();
}

class _VoteSheetState extends State<_VoteSheet> {
  bool _busy = false;
  String? _error;

  ArenaDuel? get _duel => widget.store.duelForEvent(widget.event.id);

  @override
  void initState() {
    super.initState();
    unawaited(widget.store.positionVotes(widget.event.id, refresh: true));
  }

  Future<void> _votePosition(String positionId) async {
    final ArenaSocialRepository? social = widget.store.arenaSocial;
    if (social == null || _busy) return;
    final String? mine = widget.store
        .cachedPositionVotes(widget.event.id)
        ?.mine;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final PositionVotes updated = await social.votePosition(
        widget.event.id,
        mine == positionId ? null : positionId,
      );
      widget.store.rememberPositionVotes(widget.event.id, updated);
    } on Exception {
      if (mounted) setState(() => _error = 'No se pudo guardar tu voto.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _vote(String reaction) async {
    final SocialRepository? social = widget.store.social;
    if (social == null || _busy) return;
    final String? mine = widget.store.cachedSummary(widget.event.id)?.mine;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final SocialSummary updated = await social.setSocialReaction(
        widget.event.id,
        mine == reaction ? null : reaction,
      );
      widget.store.rememberSummary(widget.event.id, updated);
    } on Exception {
      if (mounted) setState(() => _error = 'No se pudo guardar tu voto.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        20 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: ListenableBuilder(
        listenable: widget.store,
        builder: (BuildContext context, _) {
          final SocialSummary? summary = widget.store.cachedSummary(
            widget.event.id,
          );
          final ArenaDuel? duel = _duel;
          final PositionVotes? votes = widget.store.cachedPositionVotes(
            widget.event.id,
          );
          if (duel != null && votes != null) {
            return _postureVote(context, duel, votes);
          }
          final bool canVote = widget.store.social != null;
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(
                '¿La cobertura te parece bien respaldada?',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: ArenaColors.ink,
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                'Tu voto se suma al de la comunidad y puedes cambiarlo '
                'cuando quieras.',
                style: ArenaText.body,
              ),
              const SizedBox(height: 14),
              EvidenceThermometer(summary: summary),
              const SizedBox(height: 14),
              for (final ({String key, String label}) option
                  in const <({String key, String label})>[
                    (key: 'SOLID', label: 'Tiene respaldo sólido'),
                    (key: 'BIASED', label: 'Le falta respaldo'),
                  ])
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: OutlinedButton(
                    key: ValueKey<String>('arena-vote-${option.key}'),
                    onPressed: canVote && !_busy
                        ? () => _vote(option.key)
                        : null,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      foregroundColor: summary?.mine == option.key
                          ? Colors.white
                          : ArenaColors.ink,
                      backgroundColor: summary?.mine == option.key
                          ? ArenaColors.violet
                          : ArenaColors.card,
                      side: const BorderSide(color: ArenaColors.violet),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: Text(
                      '${summary?.mine == option.key ? '✓ ' : ''}'
                      '${option.label}',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              if (!canVote)
                const Text(
                  'Inicia sesión para dar tu opinión.',
                  style: ArenaText.meta,
                ),
              if (_error != null)
                Text(
                  _error!,
                  style: const TextStyle(color: ArenaColors.amberDeep),
                ),
              ..._footer(context),
            ],
          );
        },
      ),
    ),
  );

  List<Widget> _footer(BuildContext context) => <Widget>[
    const Divider(height: 24, color: ArenaColors.border),
    TextButton.icon(
      style: TextButton.styleFrom(foregroundColor: ArenaColors.violet),
      onPressed: () {
        Navigator.of(context).pop();
        openArenaCommunity(widget.hostContext, widget.store, widget.event);
      },
      icon: const Icon(Icons.forum_outlined),
      label: const Text('Abrir comunidad del caso'),
    ),
    TextButton.icon(
      style: TextButton.styleFrom(foregroundColor: ArenaColors.violet),
      onPressed: () {
        Navigator.of(context).pop();
        unawaited(
          showSynthesisSharePreview(
            widget.hostContext,
            widget.event,
            relation: widget.event.synthesisRelation,
          ),
        );
      },
      icon: const Icon(Icons.ios_share),
      label: const Text('Crear tarjeta para X y WhatsApp'),
    ),
  ];

  /// One vote per reader between the two postures of the duel.
  Widget _postureVote(
    BuildContext context,
    ArenaDuel duel,
    PositionVotes votes,
  ) {
    final bool hidden = widget.store.hidesOutlets(duel.event.id);
    final List<({String id, String name, String title})> sides =
        <({String id, String name, String title})>[
          (
            id: duel.idA,
            name: hidden ? 'Versión A' : duel.nameA,
            title: arenaPostureText(duel.event, duel.positionA).text,
          ),
          (
            id: duel.idB,
            name: hidden ? 'Versión B' : duel.nameB,
            title: arenaPostureText(duel.event, duel.positionB).text,
          ),
        ];
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          arenaVoteQuestion(duel.kind),
          style: const TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w800,
            color: ArenaColors.ink,
          ),
        ),
        const SizedBox(height: 6),
        // The thermometer below already says the vote is an opinion.
        const Text(
          'Lee ambas citas y sus notas originales. Tienes un voto por caso y '
          'puedes cambiarlo.',
          style: ArenaText.body,
        ),
        const SizedBox(height: 14),
        arenaDuelThermometer(widget.store, duel),
        const SizedBox(height: 14),
        for (final ({String id, String name, String title}) side in sides)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              key: ValueKey<String>('arena-vote-position-${side.id}'),
              onPressed: _busy ? null : () => _votePosition(side.id),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(48, 48),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 12,
                ),
                foregroundColor: votes.mine == side.id
                    ? Colors.white
                    : ArenaColors.ink,
                backgroundColor: votes.mine == side.id
                    ? ArenaColors.violet
                    : ArenaColors.card,
                side: const BorderSide(color: ArenaColors.violet),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(
                    // Tallies follow the community block: never before the
                    // reader votes, never with too few opinions.
                    '${votes.mine == side.id ? '✓ ' : ''}${side.name}'
                    '${opinionVisibility(voted: votes.mine != null, total: votes.total) == OpinionVisibility.split ? ' · ${arenaOpinionCount(votes.votesFor(side.id))}' : ''}',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 2),
                  Text(side.title, style: const TextStyle(fontSize: 13)),
                ],
              ),
            ),
          ),
        if (_error != null)
          Text(_error!, style: const TextStyle(color: ArenaColors.amberDeep)),
        ..._footer(context),
      ],
    );
  }
}
