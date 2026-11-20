import 'dart:async';
import 'dart:math' as math;

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:flutter/material.dart';

/// Colours of the two places of a duel. They belong to the place (A is
/// always blue, B always orange), never to an outlet: which outlet is A is
/// drawn per reader, so no outlet becomes «the orange one».
const Color duelColorA = Color(0xFF2D3480);
const Color duelColorB = Color(0xFFB9531B);
const Color duelVotedGreen = Color(0xFF1E8A4C);

/// The face-off of a duel: the two versions side by side, the VS bolt
/// between them and, once the reader voted and enough people did, the
/// share of each version.
class DuelVersionsPanel extends StatefulWidget {
  const DuelVersionsPanel({
    required this.duel,
    required this.store,
    this.large = false,
    this.forceHidden = false,
    super.key,
  });

  final ArenaDuel duel;
  final ArenaStore store;

  /// The card of the day: taller boxes with emblems and big quote marks.
  final bool large;

  /// Hide the outlets even outside «Leer siempre a ciegas» (the card of the
  /// day before the vote).
  final bool forceHidden;

  @override
  State<DuelVersionsPanel> createState() => _DuelVersionsPanelState();
}

class _DuelVersionsPanelState extends State<DuelVersionsPanel> {
  ArenaDuel get duel => widget.duel;
  ArenaStore get store => widget.store;
  bool get large => widget.large;
  bool get forceHidden => widget.forceHidden;

  @override
  void initState() {
    super.initState();
    // The card needs the reader's vote and the split; fetched once.
    final String eventId = widget.duel.event.id;
    if (widget.store.cachedPositionVotes(eventId) == null) {
      unawaited(widget.store.positionVotes(eventId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final String eventId = duel.event.id;
    final PositionVotes? votes = store.cachedPositionVotes(eventId);
    final String? mine = votes?.mine;
    final bool voted = mine != null;
    final bool hidden = !voted && (forceHidden || store.hidesOutlets(eventId));
    final int total = votes?.total ?? 0;
    final bool split = voted && total >= minimumOpinionsForSplit;
    final int shareA = split
        ? (votes!.votesFor(duel.idA) * 100 / math.max(1, total)).round()
        : 0;
    Widget box(String id, bool first) => DuelVersionBox(
      key: ValueKey<String>('arena-version-${first ? 'a' : 'b'}-$eventId'),
      first: first,
      hidden: hidden,
      outlet: first ? duel.nameA : duel.nameB,
      posture: arenaPostureText(
        duel.event,
        first ? duel.positionA : duel.positionB,
      ),
      percent: split ? (first ? shareA : 100 - shareA) : null,
      mine: mine == id,
      large: large,
    );
    return Stack(
      alignment: Alignment.center,
      children: <Widget>[
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Expanded(child: box(duel.idA, true)),
              SizedBox(width: large ? 14 : 10),
              Expanded(child: box(duel.idB, false)),
            ],
          ),
        ),
        ExcludeSemantics(
          child: VsBolt(
            compatible: duel.kind == 'COMPATIBLE',
            size: large ? 64 : 46,
          ),
        ),
      ],
    );
  }
}

/// One version: a coloured header (the outlet, or «VERSIÓN A» when read
/// blind), the literal quote, and after the vote «Tu voto» and its share.
class DuelVersionBox extends StatelessWidget {
  const DuelVersionBox({
    required this.first,
    required this.hidden,
    required this.outlet,
    required this.posture,
    required this.mine,
    this.percent,
    this.large = false,
    super.key,
  });

  final bool first;
  final bool hidden;
  final String outlet;
  final ({String text, bool literal}) posture;
  final bool mine;
  final int? percent;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final Color color = first ? duelColorA : duelColorB;
    final String version = first ? 'VERSIÓN A' : 'VERSIÓN B';
    final String quote = posture.literal
        ? arenaQuote(posture.text)
        : posture.text;
    final Widget youVoted = DecoratedBox(
      key: const Key('arena-version-mine'),
      decoration: BoxDecoration(
        color: duelVotedGreen,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        child: Text(
          large ? '✓ Tu voto' : 'Tu voto',
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
      ),
    );
    return Semantics(
      label:
          '${hidden ? (first ? 'Versión A' : 'Versión B') : outlet}: $quote'
          '${mine ? '. Tu voto' : ''}'
          '${percent == null ? '' : '. $percent por ciento'}',
      child: ExcludeSemantics(
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(large ? 18 : 14),
            border: Border.all(color: color.withValues(alpha: 0.28)),
            boxShadow: large
                ? const <BoxShadow>[
                    BoxShadow(
                      color: Color(0x14000000),
                      blurRadius: 12,
                      offset: Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(large ? 17 : 13),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                ColoredBox(
                  color: color,
                  child: Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: large ? 10 : 7,
                    ),
                    child: Row(
                      mainAxisAlignment: hidden
                          ? MainAxisAlignment.center
                          : MainAxisAlignment.start,
                      children: <Widget>[
                        if (hidden) ...<Widget>[
                          const Icon(
                            Icons.visibility_off_outlined,
                            size: 14,
                            color: Colors.white,
                          ),
                          const SizedBox(width: 6),
                        ] else if (large) ...<Widget>[
                          MediaEmblem(name: outlet, size: 22),
                          const SizedBox(width: 6),
                        ],
                        Flexible(
                          child: Text(
                            hidden ? version : arenaSourceName(outlet),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: large ? 15 : 12.5,
                              fontWeight: FontWeight.w800,
                              letterSpacing: hidden ? 0.4 : 0,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: Stack(
                    children: <Widget>[
                      if (large) ...<Widget>[
                        Positioned(
                          left: 8,
                          top: 0,
                          child: Text(
                            '“',
                            style: TextStyle(
                              fontFamily: ArenaText.serif,
                              fontSize: 56,
                              height: 1,
                              color: color.withValues(alpha: 0.12),
                            ),
                          ),
                        ),
                        Positioned(
                          right: 8,
                          bottom: 18,
                          child: Text(
                            '”',
                            style: TextStyle(
                              fontFamily: ArenaText.serif,
                              fontSize: 56,
                              height: 1,
                              color: color.withValues(alpha: 0.12),
                            ),
                          ),
                        ),
                      ],
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          10,
                          large ? (mine ? 34 : 22) : 10,
                          10,
                          (mine && !large) || percent != null ? 34 : 12,
                        ),
                        child: Center(
                          child: Text(
                            quote,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontFamily: ArenaText.serif,
                              fontSize: large ? 17 : 14,
                              height: 1.35,
                              color: ArenaColors.ink,
                            ),
                          ),
                        ),
                      ),
                      if (mine)
                        Positioned(
                          top: large ? 8 : null,
                          bottom: large ? null : 8,
                          left: large || !first ? null : 8,
                          right: large || !first ? 8 : null,
                          child: youVoted,
                        ),
                      if (percent != null)
                        Positioned(
                          bottom: 0,
                          right: first ? 0 : null,
                          left: first ? null : 0,
                          child: DecoratedBox(
                            key: const Key('arena-version-percent'),
                            decoration: BoxDecoration(
                              color: color,
                              borderRadius: BorderRadius.only(
                                topLeft: Radius.circular(first ? 12 : 0),
                                topRight: Radius.circular(first ? 0 : 12),
                              ),
                            ),
                            child: Padding(
                              padding: EdgeInsets.symmetric(
                                horizontal: large ? 14 : 10,
                                vertical: large ? 6 : 4,
                              ),
                              child: Text(
                                '$percent%',
                                style: TextStyle(
                                  fontSize: large ? 20 : 16,
                                  fontWeight: FontWeight.w900,
                                  color: Colors.white,
                                ),
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
    );
  }
}

/// The VS between two versions: a violet lightning bolt with «VS». A
/// compatible duel, where the outlets do not oppose each other, gets a calm
/// «≈» instead of a fight.
class VsBolt extends StatelessWidget {
  const VsBolt({this.compatible = false, this.size = 46, super.key});

  final bool compatible;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (compatible) {
      return Container(
        key: const Key('arena-vs-compatible'),
        width: size * 0.7,
        height: size * 0.7,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: ArenaColors.violet, width: 2),
        ),
        child: Text(
          '≈',
          style: TextStyle(
            fontSize: size * 0.4,
            fontWeight: FontWeight.w900,
            color: ArenaColors.violet,
          ),
        ),
      );
    }
    final TextStyle vs = TextStyle(
      fontSize: size * 0.42,
      fontWeight: FontWeight.w900,
      fontStyle: FontStyle.italic,
      letterSpacing: -1,
      height: 1,
    );
    return SizedBox(
      key: const Key('arena-vs-bolt'),
      width: size,
      height: size * 1.3,
      child: Stack(
        alignment: Alignment.center,
        children: <Widget>[
          CustomPaint(size: Size(size, size * 1.3), painter: _BoltPainter()),
          Text(
            'VS',
            style: vs.copyWith(
              foreground: Paint()
                ..style = PaintingStyle.stroke
                ..strokeWidth = 3
                ..color = Colors.white,
            ),
          ),
          Text('VS', style: vs.copyWith(color: const Color(0xFF3B1FA8))),
        ],
      ),
    );
  }
}

class _BoltPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final double w = size.width;
    final double h = size.height;
    final Path bolt = Path()
      ..moveTo(w * 0.58, 0)
      ..lineTo(w * 0.16, h * 0.54)
      ..lineTo(w * 0.44, h * 0.54)
      ..lineTo(w * 0.26, h)
      ..lineTo(w * 0.86, h * 0.40)
      ..lineTo(w * 0.56, h * 0.40)
      ..lineTo(w * 0.74, 0)
      ..close();
    canvas.drawPath(
      bolt.shift(const Offset(1.5, 2)),
      Paint()..color = const Color(0x33000000),
    );
    canvas.drawPath(
      bolt,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: <Color>[Color(0xFF8B6CFF), Color(0xFF4C2BD9)],
        ).createShader(Offset.zero & size),
    );
    canvas.drawPath(
      bolt,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = Colors.white,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// After the vote: the community's split as a bar, or why it is not shown
/// yet. Before the vote nothing, so nobody follows the crowd.
class DuelSplitBar extends StatelessWidget {
  const DuelSplitBar({required this.duel, required this.store, super.key});

  final ArenaDuel duel;
  final ArenaStore store;

  @override
  Widget build(BuildContext context) {
    final PositionVotes? votes = store.cachedPositionVotes(duel.event.id);
    if (votes?.mine == null) return const SizedBox.shrink();
    final int total = votes!.total;
    if (total < minimumOpinionsForSplit) {
      return Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Text(
          'Aún hay pocas opiniones (${arenaOpinionCount(total)}). El reparto '
          'se muestra desde $minimumOpinionsForSplit.',
          textAlign: TextAlign.center,
          style: ArenaText.meta,
        ),
      );
    }
    final int shareA = (votes.votesFor(duel.idA) * 100 / total).round();
    Widget part(int share, Color color) => Expanded(
      flex: math.max(1, share),
      child: ColoredBox(
        color: color,
        child: Center(
          child: Text(
            '$share%',
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
        ),
      ),
    );
    return Padding(
      key: const Key('arena-split-bar'),
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        children: <Widget>[
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: SizedBox(
              height: 22,
              child: Row(
                children: <Widget>[
                  part(shareA, duelColorA),
                  part(100 - shareA, duelColorB),
                ],
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Opinión de la comunidad · $total ${total == 1 ? 'voto' : 'votos'} '
            '(no indica qué versión es correcta)',
            textAlign: TextAlign.center,
            style: ArenaText.meta,
          ),
        ],
      ),
    );
  }
}

/// «DISTINTO ENFOQUE»-style pill of the kind of duel, on lavender.
class DuelKindPill extends StatelessWidget {
  const DuelKindPill({required this.kind, super.key});

  final String kind;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: ArenaColors.violetSoft,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      child: Text(
        arenaKindLabel(kind),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: ArenaColors.inkDeep,
        ),
      ),
    ),
  );
}

/// Green «✓ Votado» of a duel the reader voted on.
class DuelVotedBadge extends StatelessWidget {
  const DuelVotedBadge({super.key});

  @override
  Widget build(BuildContext context) => DecoratedBox(
    key: const Key('arena-duel-voted'),
    decoration: BoxDecoration(
      color: duelVotedGreen,
      borderRadius: BorderRadius.circular(999),
    ),
    child: const Padding(
      padding: EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      child: Text(
        '✓ Votado',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          color: Colors.white,
        ),
      ),
    ),
  );
}

/// The topic and date line of a duel card, in grey caps.
String duelMetaLine(ArenaDuel duel, {DateTime? now}) {
  final DateTime at = duel.contrast.confirmedAt.toLocal();
  final String date = at.year == (now ?? DateTime.now()).year
      ? arenaDate(at).replaceFirst(RegExp(r'\s+\d{4}$'), '')
      : arenaDate(at);
  return '${arenaTopicOfEvent(duel.event).label.toUpperCase()} · $date';
}
