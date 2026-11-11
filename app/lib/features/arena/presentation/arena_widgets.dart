import 'dart:math' as math;

import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/social/data/social_repository.dart';
import 'package:flutter/material.dart';

/// Typographic identity of a medium. No third-party logo is reproduced.
({String label, Color background, Color foreground}) arenaEmblemOf(
  String sourceName,
) {
  final String name = arenaSourceName(sourceName);
  final String lower = name.toLowerCase();
  const Color white = Color(0xFFFFFFFF);
  ({String label, Color background, Color foreground}) brand(
    String label,
    int color,
  ) => (label: label, background: Color(color), foreground: white);
  if (lower.contains('la tercera')) return brand('LT', 0xFF1E2430);
  if (lower.contains('biobio') || lower.contains('bío bío')) {
    return brand('RBB', 0xFF15578E);
  }
  if (lower.contains('el mostrador')) return brand('EM', 0xFF111827);
  if (lower.contains('ciper')) return brand('CiPER', 0xFFB2272A);
  if (lower.contains('cooperativa')) return brand('COOP', 0xFF16488A);
  if (lower.contains('24 horas')) return brand('24H', 0xFFC21F2B);
  if (lower.contains('adn')) return brand('ADN', 0xFF203A79);
  if (lower.contains('cnn')) return brand('CNN', 0xFFC21F2B);
  if (lower.contains('t13')) return brand('T13', 0xFFE2571C);
  if (lower.contains('mega')) return brand('MEGA', 0xFF0E4DA4);
  if (lower.contains('chv')) return brand('CHV', 0xFFB91C1C);
  if (lower.contains('sin filtros')) return brand('SF', 0xFFC21F2B);
  if (lower.contains('vía x') || lower.contains('via x')) {
    return brand('VX', 0xFFBA2132);
  }
  if (lower.contains('fast check')) return brand('FC', 0xFF0F766E);
  const List<int> palette = <int>[
    0xFF7C2D12,
    0xFF173B70,
    0xFF29354C,
    0xFF6E3F79,
    0xFF1B695F,
    0xFF4C1D95,
  ];
  final String initials = name
      .split(RegExp(r'\s+'))
      .where((String word) => word.isNotEmpty)
      .take(3)
      .map((String word) => word.characters.first.toUpperCase())
      .join();
  final int hash = name.codeUnits.fold<int>(0, (int sum, int c) => sum + c);
  return brand(
    initials.isEmpty ? '?' : initials,
    palette[hash % palette.length],
  );
}

/// Circular emblem (`LT`, `RBB`, `CiPER`, `24H`…) that never overflows.
class MediaEmblem extends StatelessWidget {
  const MediaEmblem({required this.name, this.size = 36, this.ring, super.key});

  final String name;
  final double size;
  final Color? ring;

  @override
  Widget build(BuildContext context) {
    final ({String label, Color background, Color foreground}) emblem =
        arenaEmblemOf(name);
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: size,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: emblem.background,
            shape: BoxShape.circle,
            border: ring == null
                ? null
                : Border.all(color: ring!, width: size * 0.06),
          ),
          child: Padding(
            padding: EdgeInsets.all(size * 0.14),
            child: MediaQuery.withNoTextScaling(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  emblem.label,
                  maxLines: 1,
                  softWrap: false,
                  style: TextStyle(
                    color: emblem.foreground,
                    fontSize: size * 0.36,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.2,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Emblem + name row; tapping opens the public profile of the medium.
class MediaNameRow extends StatelessWidget {
  const MediaNameRow({
    required this.name,
    this.onTap,
    this.emblemSize = 32,
    this.alignEnd = false,
    this.maxLines = 2,
    super.key,
  });

  final String name;
  final VoidCallback? onTap;
  final double emblemSize;
  final bool alignEnd;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final Widget label = Flexible(
      child: Text(
        arenaSourceName(name),
        maxLines: maxLines,
        overflow: TextOverflow.ellipsis,
        textAlign: alignEnd ? TextAlign.end : TextAlign.start,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w700,
          color: ArenaColors.ink,
        ),
      ),
    );
    final Widget emblem = MediaEmblem(name: name, size: emblemSize);
    return Semantics(
      button: onTap != null,
      label: onTap == null ? null : 'Abrir perfil de ${arenaSourceName(name)}',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: alignEnd
                ? MainAxisAlignment.end
                : MainAxisAlignment.start,
            children: alignEnd
                ? <Widget>[label, const SizedBox(width: 8), emblem]
                : <Widget>[emblem, const SizedBox(width: 8), label],
          ),
        ),
      ),
    );
  }
}

/// Rounded selectable pill used for top filters.
class ArenaPill extends StatelessWidget {
  const ArenaPill({
    required this.label,
    required this.selected,
    this.onTap,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: onTap != null,
    selected: selected,
    child: Material(
      color: selected ? ArenaColors.violet : ArenaColors.card,
      shape: StadiumBorder(
        side: BorderSide(
          color: selected ? ArenaColors.violet : ArenaColors.border,
        ),
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Center(
              widthFactor: 1,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  label,
                  maxLines: 1,
                  softWrap: false,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: selected ? Colors.white : ArenaColors.ink,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Compact dropdown pill (`🇨🇱 Chile ▾`, `Tema ▾`) that opens a sheet.
class ArenaDropdownPill extends StatelessWidget {
  const ArenaDropdownPill({
    required this.label,
    required this.onTap,
    this.leading,
    this.active = false,
    this.semanticsLabel,
    super.key,
  });

  final String label;
  final Widget? leading;
  final bool active;
  final VoidCallback onTap;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final Color foreground = active ? ArenaColors.violetDeep : ArenaColors.ink;
    // A compact control: large system text is capped here so the dropdown
    // does not squeeze the logo or the section pills beside it.
    return Semantics(
      button: true,
      label: semanticsLabel ?? label,
      child: ExcludeSemantics(
        child: MediaQuery.withClampedTextScaling(
          maxScaleFactor: 1.1,
          child: Material(
            color: active ? ArenaColors.violetSoft : ArenaColors.card,
            shape: StadiumBorder(
              side: BorderSide(
                color: active
                    ? ArenaColors.violetSoft
                    : const Color(0xFFE2E2EC),
              ),
            ),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: onTap,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 40),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        if (leading != null) ...<Widget>[
                          IconTheme(
                            data: IconThemeData(color: foreground, size: 16),
                            child: leading!,
                          ),
                          const SizedBox(width: 5),
                        ],
                        Text(
                          label,
                          maxLines: 1,
                          softWrap: false,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: foreground,
                          ),
                        ),
                        Icon(
                          Icons.arrow_drop_down,
                          size: 18,
                          color: foreground,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Row of pills that never wraps or overflows.
///
/// Up to three pills share the width so all stay visible with large text;
/// longer sets scroll horizontally.
class ArenaPillBar extends StatelessWidget {
  const ArenaPillBar({
    required this.labels,
    required this.selected,
    required this.onSelected,
    this.padding = const EdgeInsets.symmetric(horizontal: 16),
    super.key,
  });

  final List<String> labels;
  final int selected;
  final ValueChanged<int> onSelected;
  final EdgeInsets padding;

  Widget _pill(int i) => ArenaPill(
    key: ValueKey<String>('arena-pill-${labels[i]}'),
    label: labels[i],
    selected: i == selected,
    onTap: () => onSelected(i),
  );

  @override
  Widget build(BuildContext context) {
    if (labels.length <= 3) {
      return Padding(
        padding: padding,
        child: Row(
          children: <Widget>[
            for (int i = 0; i < labels.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: 8),
              Expanded(child: _pill(i)),
            ],
          ],
        ),
      );
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: padding,
      child: Row(
        children: <Widget>[
          for (int i = 0; i < labels.length; i++)
            Padding(
              padding: EdgeInsets.only(right: i == labels.length - 1 ? 0 : 8),
              child: _pill(i),
            ),
        ],
      ),
    );
  }
}

/// Underlined sub-tabs rendered inside a scrolling page.
///
/// Every tab stays on screen: they share the width and a long label shrinks
/// instead of pushing the last tab out of view.
class ArenaSubTabs extends StatelessWidget {
  const ArenaSubTabs({
    required this.labels,
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final List<String> labels;
  final int selected;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: ArenaColors.border)),
    ),
    child: Row(
      children: <Widget>[
        for (int i = 0; i < labels.length; i++)
          Expanded(
            child: Semantics(
              button: true,
              selected: i == selected,
              child: InkWell(
                key: ValueKey<String>('arena-subtab-${labels[i]}'),
                onTap: () => onSelected(i),
                child: Container(
                  constraints: const BoxConstraints(minHeight: 46),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 10,
                  ),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        width: 3,
                        color: i == selected
                            ? ArenaColors.violet
                            : Colors.transparent,
                      ),
                    ),
                  ),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      labels[i],
                      maxLines: 1,
                      softWrap: false,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: i == selected
                            ? ArenaColors.violet
                            : ArenaColors.muted,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

/// Small status badge such as `🔥 DUELO DEL DÍA` or `● EN DESARROLLO`.
class ArenaBadge extends StatelessWidget {
  const ArenaBadge({
    required this.label,
    required this.background,
    required this.foreground,
    super.key,
  });

  const ArenaBadge.live(String label, {Key? key})
    : this(
        label: '● $label',
        background: ArenaColors.emeraldSoft,
        foreground: ArenaColors.emeraldDeep,
        key: key,
      );

  const ArenaBadge.fire(String label, {Key? key})
    : this(
        label: '🔥 $label',
        background: ArenaColors.amberBright,
        foreground: ArenaColors.inkDeep,
        key: key,
      );

  final String label;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.3,
          color: foreground,
        ),
      ),
    ),
  );
}

class ArenaSectionTitle extends StatelessWidget {
  const ArenaSectionTitle(this.title, {this.trailing, super.key});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 10),
    child: Row(
      children: <Widget>[
        Expanded(
          child: Semantics(
            header: true,
            child: Text(title, style: ArenaText.section),
          ),
        ),
        ?trailing,
      ],
    ),
  );
}

class ArenaCard extends StatelessWidget {
  const ArenaCard({
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(14),
    this.borderColor,
    this.borderWidth = 1,
    this.margin = const EdgeInsets.only(bottom: 12),
    super.key,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final Color? borderColor;
  final double borderWidth;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) => Padding(
    padding: margin,
    child: Material(
      color: ArenaColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: borderColor ?? ArenaColors.border,
          width: borderWidth,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    ),
  );
}

class ArenaMessage extends StatelessWidget {
  const ArenaMessage(this.text, {this.actionLabel, this.onAction, super.key});

  final String text;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 8),
    child: Column(
      children: <Widget>[
        Text(text, textAlign: TextAlign.center, style: ArenaText.body),
        if (actionLabel != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(foregroundColor: ArenaColors.violet),
            child: Text(actionLabel!),
          ),
      ],
    ),
  );
}

Color _topicTone(ArenaTopic topic) => switch (topic) {
  ArenaTopic.politica => const Color(0xFF312E81),
  ArenaTopic.justicia => const Color(0xFF3B1D5E),
  ArenaTopic.economia => const Color(0xFF134E4A),
  ArenaTopic.seguridad => const Color(0xFF1E3A8A),
  ArenaTopic.medioambiente => const Color(0xFF14532D),
  ArenaTopic.ciencia => const Color(0xFF0C4A6E),
  ArenaTopic.deportes => const Color(0xFF7C2D12),
  ArenaTopic.sociedad => const Color(0xFF831843),
  ArenaTopic.otros => const Color(0xFF1E293B),
};

IconData arenaTopicIcon(ArenaTopic topic) => switch (topic) {
  ArenaTopic.politica => Icons.account_balance_outlined,
  ArenaTopic.justicia => Icons.gavel_outlined,
  ArenaTopic.economia => Icons.show_chart,
  ArenaTopic.seguridad => Icons.shield_outlined,
  ArenaTopic.medioambiente => Icons.eco_outlined,
  ArenaTopic.ciencia => Icons.science_outlined,
  ArenaTopic.deportes => Icons.sports_soccer,
  ArenaTopic.sociedad => Icons.groups_outlined,
  ArenaTopic.otros => Icons.public,
};

/// Dark photographic cover: YouTube artwork when the case has a video,
/// otherwise a topic-tinted backdrop. Height grows with its content.
class ArenaCover extends StatelessWidget {
  const ArenaCover({
    required this.topic,
    required this.child,
    this.videoId,
    this.minHeight = 190,
    this.radius = 16,
    this.showPlay = false,
    super.key,
  });

  final ArenaTopic topic;
  final Widget child;
  final String? videoId;
  final double minHeight;
  final double radius;
  final bool showPlay;

  @override
  Widget build(BuildContext context) {
    final Color tone = _topicTone(topic);
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Stack(
        children: <Widget>[
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: <Color>[tone, ArenaColors.inkDeep],
                ),
              ),
            ),
          ),
          if (videoId != null)
            Positioned.fill(
              child: Image.network(
                youTubeThumbnailUrl(videoId!),
                fit: BoxFit.cover,
                excludeFromSemantics: true,
                errorBuilder: (_, _, _) => const SizedBox.shrink(),
              ),
            )
          else
            Positioned(
              right: -18,
              bottom: -22,
              child: Icon(
                arenaTopicIcon(topic),
                size: 150,
                color: const Color(0x1FFFFFFF),
              ),
            ),
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  // The lower third is almost opaque so the white title wins over
                  // any text burned into a YouTube thumbnail.
                  stops: <double>[0, 0.45, 1],
                  colors: <Color>[
                    Color(0x59000000),
                    Color(0x99000000),
                    Color(0xD1000000),
                  ],
                ),
              ),
            ),
          ),
          if (showPlay)
            const Positioned(
              top: 10,
              right: 12,
              child: Icon(
                Icons.play_circle_fill,
                size: 44,
                color: Color(0xE6FFFFFF),
              ),
            ),
          ConstrainedBox(
            constraints: BoxConstraints(
              minHeight: minHeight,
              minWidth: double.infinity,
            ),
            child: child,
          ),
        ],
      ),
    );
  }
}

/// Community rating of an event's coverage, read from Core reactions.
class EvidenceThermometer extends StatelessWidget {
  const EvidenceThermometer({required this.summary, super.key});

  final SocialSummary? summary;

  @override
  Widget build(BuildContext context) {
    final int solid = summary?.solid ?? 0;
    final int total = solid + (summary?.biased ?? 0);
    final double share = total == 0 ? 0 : solid / total;
    final String caption = total == 0
        ? 'Sin votos todavía'
        : '${(share * 100).round()}% de respaldo · $total '
              '${total == 1 ? 'voto' : 'votos'}';
    return Semantics(
      label: 'Termómetro de evidencia. $caption',
      child: ExcludeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              'Termómetro de evidencia',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: ArenaColors.muted,
              ),
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: share,
                minHeight: 10,
                backgroundColor: ArenaColors.track,
                valueColor: const AlwaysStoppedAnimation<Color>(
                  ArenaColors.violet,
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              caption,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: ArenaColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Share of support of the two postures of a duel, as voted in Core.
class PostureThermometer extends StatelessWidget {
  const PostureThermometer({
    required this.nameA,
    required this.nameB,
    required this.votesA,
    required this.votesB,
    super.key,
  });

  final String nameA;
  final String nameB;
  final int votesA;
  final int votesB;

  @override
  Widget build(BuildContext context) {
    final int total = votesA + votesB;
    final int shareA = total == 0 ? 0 : (votesA * 100 / total).round();
    final String caption = total == 0
        ? 'Sin votos todavía'
        : '$nameA $shareA% · $nameB ${100 - shareA}% · $total '
              '${total == 1 ? 'voto' : 'votos'}';
    return Semantics(
      label: 'Termómetro de evidencia. $caption',
      child: ExcludeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              'Termómetro de evidencia',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: ArenaColors.muted,
              ),
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: SizedBox(
                height: 10,
                child: total == 0
                    ? const ColoredBox(
                        color: ArenaColors.track,
                        child: SizedBox.expand(),
                      )
                    : Row(
                        children: <Widget>[
                          if (votesA > 0)
                            Expanded(
                              flex: votesA,
                              child: const ColoredBox(
                                color: ArenaColors.violet,
                                child: SizedBox.expand(),
                              ),
                            ),
                          if (votesB > 0)
                            Expanded(
                              flex: votesB,
                              child: const ColoredBox(
                                color: ArenaColors.amberBright,
                                child: SizedBox.expand(),
                              ),
                            ),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              caption,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: ArenaColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A YouTube publication with its 16:9 frame and ▶ button.
class ArenaVideoCard extends StatelessWidget {
  const ArenaVideoCard({
    required this.item,
    required this.onOpen,
    this.onOpenSource,
    super.key,
  });

  final LiveNewsItemDto item;
  final VoidCallback onOpen;
  final VoidCallback? onOpenSource;

  @override
  Widget build(BuildContext context) {
    final String? videoId = extractYouTubeVideoId(item.canonicalUrl.toString());
    return ArenaCard(
      padding: EdgeInsets.zero,
      onTap: onOpen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (videoId != null) ArenaVideoFrame(videoId: videoId),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(item.headline, style: ArenaText.cardTitle),
                const SizedBox(height: 8),
                Row(
                  children: <Widget>[
                    Flexible(
                      child: MediaNameRow(
                        name: item.source.name,
                        emblemSize: 24,
                        maxLines: 1,
                        onTap: onOpenSource,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(arenaAgo(item.publishedAt), style: ArenaText.meta),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ArenaVideoFrame extends StatelessWidget {
  const ArenaVideoFrame({required this.videoId, this.radius = 0, super.key});

  final String videoId;
  final double radius;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(radius),
    child: AspectRatio(
      aspectRatio: 16 / 9,
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          const ColoredBox(color: ArenaColors.inkDeep),
          Image.network(
            youTubeThumbnailUrl(videoId),
            fit: BoxFit.cover,
            excludeFromSemantics: true,
            errorBuilder: (_, _, _) => const SizedBox.shrink(),
          ),
          const Center(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Color(0xCC0F172A),
                shape: BoxShape.circle,
              ),
              child: Padding(
                padding: EdgeInsets.all(8),
                child: Icon(
                  Icons.play_arrow_rounded,
                  color: Colors.white,
                  size: 32,
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

/// One slice of the coverage ring.
typedef DonutSlice = ({String label, int value, Color color});

const List<Color> arenaDonutColors = <Color>[
  Color(0xFF5B3DF5),
  Color(0xFF059669),
  Color(0xFFD97706),
  Color(0xFFDB2777),
  Color(0xFF0284C7),
  Color(0xFF94A3B8),
];

/// Ring chart on the left, percentage legend on the right.
class CoverageDonut extends StatelessWidget {
  const CoverageDonut({required this.slices, super.key});

  final List<DonutSlice> slices;

  @override
  Widget build(BuildContext context) {
    final int total = slices.fold<int>(
      0,
      (int sum, DonutSlice s) => sum + s.value,
    );
    if (total == 0) {
      return const Text(
        'Sin publicaciones registradas en el último mes.',
        style: ArenaText.body,
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: <Widget>[
        Semantics(
          label: 'Gráfico de anillo de cobertura por tema',
          child: SizedBox(
            width: 108,
            height: 108,
            child: CustomPaint(
              painter: _DonutPainter(slices, total),
              child: Center(
                child: MediaQuery.withNoTextScaling(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Padding(
                      padding: const EdgeInsets.all(30),
                      child: Text(
                        '$total',
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: ArenaColors.ink,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              for (final DonutSlice slice in slices)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: <Widget>[
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: slice.color,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(child: Text(slice.label, style: ArenaText.body)),
                      Text(
                        '${(slice.value * 100 / total).round()}%',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: ArenaColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _DonutPainter extends CustomPainter {
  _DonutPainter(this.slices, this.total);

  final List<DonutSlice> slices;
  final int total;

  @override
  void paint(Canvas canvas, Size size) {
    final double stroke = size.shortestSide * 0.17;
    final Rect rect = Rect.fromCircle(
      center: size.center(Offset.zero),
      radius: (size.shortestSide - stroke) / 2,
    );
    double start = -math.pi / 2;
    for (final DonutSlice slice in slices) {
      if (slice.value == 0) continue;
      final double sweep = 2 * math.pi * slice.value / total;
      canvas.drawArc(
        rect,
        start,
        sweep,
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = stroke
          ..color = slice.color,
      );
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(_DonutPainter oldDelegate) =>
      oldDelegate.slices != slices || oldDelegate.total != total;
}

/// Full-width violet call to action whose height follows its text.
class ArenaPrimaryButton extends StatelessWidget {
  const ArenaPrimaryButton({
    required this.label,
    required this.onPressed,
    this.icon,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => FilledButton(
    onPressed: onPressed,
    style: FilledButton.styleFrom(
      backgroundColor: ArenaColors.violet,
      foregroundColor: Colors.white,
      minimumSize: const Size(48, 48),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (icon != null) ...<Widget>[
          Icon(icon, size: 18),
          const SizedBox(width: 8),
        ],
        Flexible(
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );
}
