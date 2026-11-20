import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:flutter/material.dart';

/// Line icons of the Science mode (Material outlined/rounded set, the closest
/// bundled match to a 2 pt rounded stroke).
abstract final class SciIcons {
  static const IconData flask = Icons.science_outlined;
  static const IconData general = Icons.newspaper_outlined;
  static const IconData link = Icons.link_rounded;
  static const IconData reply = Icons.chat_bubble_outline_rounded;
  static const IconData useful = Icons.thumb_up_alt_outlined;
  static const IconData usefulActive = Icons.thumb_up_alt_rounded;
  static const IconData pertinent = Icons.check_rounded;
  static const IconData pertinentActive = Icons.check_circle_rounded;
  static const IconData chevronDown = Icons.keyboard_arrow_down_rounded;
  static const IconData chevronRight = Icons.chevron_right_rounded;
  static const IconData external = Icons.open_in_new_rounded;
  static const IconData send = Icons.send_rounded;
  static const IconData search = Icons.search_rounded;
}

String modeLabel(ArenaMode mode) =>
    mode == ArenaMode.ciencia ? 'Ciencia' : 'General';

IconData modeIcon(ArenaMode mode) =>
    mode == ArenaMode.ciencia ? SciIcons.flask : SciIcons.general;

/// Header pill that switches between General and Ciencia.
class ModeButton extends StatelessWidget {
  const ModeButton({required this.mode, required this.onTap, super.key});

  final ArenaMode mode;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Cambiar de modo, modo actual: ${modeLabel(mode)}',
    excludeSemantics: true,
    child: Material(
      color: SciColors.surface,
      shape: const StadiumBorder(
        side: BorderSide(color: SciColors.borderControl),
      ),
      child: InkWell(
        key: const Key('sci-mode-button'),
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(modeIcon(mode), size: 18, color: SciColors.primary),
                const SizedBox(width: 6),
                Text(
                  modeLabel(mode),
                  maxLines: 1,
                  style: const TextStyle(
                    fontFamily: SciText.sans,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: SciColors.ink,
                  ),
                ),
                const SizedBox(width: 6),
                const Icon(
                  SciIcons.chevronDown,
                  size: 16,
                  color: SciColors.inkSecondary,
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

/// The 36×4 handle at the top of every Science sheet.
class SheetHandle extends StatelessWidget {
  const SheetHandle({super.key});

  @override
  Widget build(BuildContext context) => const Center(
    child: SizedBox(
      width: 36,
      height: 4,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: SciColors.borderControl,
          borderRadius: BorderRadius.all(Radius.circular(2)),
        ),
      ),
    ),
  );
}

/// «Modo»: General or Ciencia, the active one checked.
Future<ArenaMode?> showModeSheet(BuildContext context, ArenaMode current) =>
    showModalBottomSheet<ArenaMode>(
      context: context,
      backgroundColor: SciColors.surface,
      barrierColor: SciColors.scrim,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(SciRadius.sheet),
        ),
      ),
      builder: (BuildContext sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const SheetHandle(),
              const SizedBox(height: 12),
              const Text(
                'Modo',
                style: TextStyle(
                  fontFamily: SciText.sans,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: SciColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              for (final ArenaMode mode in ArenaMode.values)
                Semantics(
                  selected: mode == current,
                  inMutuallyExclusiveGroup: true,
                  button: true,
                  child: InkWell(
                    key: ValueKey<String>('sci-mode-${mode.name}'),
                    onTap: () => Navigator.of(sheetContext).pop(mode),
                    child: SizedBox(
                      height: 56,
                      child: Row(
                        children: <Widget>[
                          Icon(modeIcon(mode), size: 22, color: SciColors.ink),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(modeLabel(mode), style: SciText.body),
                          ),
                          if (mode == current)
                            const Icon(
                              Icons.check_rounded,
                              size: 22,
                              color: SciColors.primary,
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );

/// Selectable chip: ink when on, outlined when off. Same scheme for filters
/// and for the four relation options of C2.
class SelectChip extends StatelessWidget {
  const SelectChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.fontSize = 14,
    this.radius = SciRadius.pill,
    this.expand = false,
    this.radio = false,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final double fontSize;
  final double radius;

  /// Fills its cell (relation grid) instead of hugging the label.
  final bool expand;

  /// Announced as a radio option (relation group) instead of a chip.
  final bool radio;

  @override
  Widget build(BuildContext context) {
    final bool reduce = MediaQuery.disableAnimationsOf(context);
    // Closed (no onTap): greyed, like any disabled control.
    final bool enabled = onTap != null;
    return Semantics(
      button: !radio,
      enabled: enabled,
      selected: selected,
      checked: radio ? selected : null,
      inMutuallyExclusiveGroup: radio,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: reduce ? Duration.zero : const Duration(milliseconds: 150),
          curve: Curves.easeOut,
          constraints: const BoxConstraints(minHeight: 44),
          padding: EdgeInsets.symmetric(horizontal: expand ? 4 : 14),
          // Hugs its label unless it fills a grid cell.
          alignment: expand ? Alignment.center : null,
          decoration: BoxDecoration(
            // The same violet as every other selected chip of the app.
            color: selected
                ? SciColors.primary
                : enabled
                ? SciColors.surface
                : SciColors.bgApp,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(
              color: selected
                  ? SciColors.primary
                  : enabled
                  ? SciColors.borderControl
                  : SciColors.borderCard,
            ),
          ),
          child: Center(
            widthFactor: expand ? null : 1,
            child: _maybeFit(
              expand,
              Text(
                label,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.visible,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: SciText.sans,
                  fontSize: fontSize,
                  fontWeight: FontWeight.w600,
                  color: selected
                      ? Colors.white
                      : enabled
                      ? SciColors.ink
                      : SciColors.inkSecondary,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A label in a narrow grid cell shrinks instead of breaking a word.
Widget _maybeFit(bool fit, Widget child) =>
    fit ? FittedBox(fit: BoxFit.scaleDown, child: child) : child;

/// One study attribute. Every value shares this neutral style: no value has
/// a colour of its own.
class StudyTag extends StatelessWidget {
  const StudyTag(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: SciColors.tagBg,
      borderRadius: BorderRadius.all(Radius.circular(6)),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Text(
        label,
        style: const TextStyle(
          fontFamily: SciText.sans,
          fontSize: 12,
          height: 16 / 12,
          fontWeight: FontWeight.w500,
          color: SciColors.tagText,
        ),
      ),
    ),
  );
}

class StudyTags extends StatelessWidget {
  const StudyTags(this.labels, {super.key});

  final List<String> labels;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 6,
    runSpacing: 6,
    children: <Widget>[for (final String label in labels) StudyTag(label)],
  );
}

/// Initials on a neutral circle: 34 (comment), 28 (lists), 26 (reply).
class Monogram extends StatelessWidget {
  const Monogram(this.name, {this.size = 34, super.key});

  final String name;
  final double size;

  static String initialsOf(String name) {
    final List<String> words = name
        .replaceAll('@', '')
        .split(RegExp(r'[\s_.\-]+'))
        .where((String w) => w.isNotEmpty)
        .toList();
    if (words.isEmpty) return '?';
    if (words.length == 1) {
      return words.first.characters.take(2).toString().toUpperCase();
    }
    return '${words[0].characters.first}${words[1].characters.first}'
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox.square(
      dimension: size,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: SciColors.borderCard,
          shape: BoxShape.circle,
        ),
        child: Center(
          child: MediaQuery.withNoTextScaling(
            child: Text(
              initialsOf(name),
              style: TextStyle(
                fontFamily: SciText.sans,
                fontSize: size >= 34
                    ? 12
                    : size >= 28
                    ? 11
                    : 10,
                fontWeight: FontWeight.w700,
                color: SciColors.ink,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// «Responder», «Útil · N», «Pertinente · N». No celebratory animation: the
/// number simply changes.
class ReactionButton extends StatelessWidget {
  const ReactionButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.activeIcon,
    this.active = false,
    this.semanticsLabel,
    super.key,
  });

  final IconData icon;
  final IconData? activeIcon;
  final String label;
  final bool active;
  final VoidCallback? onTap;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    toggled: activeIcon == null ? null : active,
    label: semanticsLabel ?? label,
    excludeSemantics: true,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(SciRadius.pill),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 44, minWidth: 44),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                active ? (activeIcon ?? icon) : icon,
                size: 16,
                color: active ? SciColors.ink : SciColors.inkSecondary,
              ),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontFamily: SciText.sans,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: active ? SciColors.ink : SciColors.inkSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// The app's bottom bar, the same in General and Ciencia:
/// Inicio · Duelos · En desarrollo · Medios · Tú. Labels are capped at 1.3×
/// and shrink to fit, so they stay visible at 200 %.
class ArenaBottomBar extends StatelessWidget {
  const ArenaBottomBar({
    required this.current,
    required this.onSelected,
    super.key,
  });

  final int current;
  final ValueChanged<int> onSelected;

  static const List<(IconData, IconData, String)> items =
      <(IconData, IconData, String)>[
        (Icons.home_outlined, Icons.home_rounded, 'Inicio'),
        (Icons.compare_arrows_rounded, Icons.compare_arrows_rounded, 'Duelos'),
        (Icons.timeline_rounded, Icons.timeline_rounded, 'En desarrollo'),
        (Icons.cell_tower_rounded, Icons.cell_tower_rounded, 'Medios'),
        (Icons.person_outline_rounded, Icons.person_rounded, 'Perfil'),
      ];

  @override
  Widget build(BuildContext context) {
    // Labels always show: capped at 1.3× and shrunk to fit, even at 200 %.
    const bool showLabels = true;
    return Material(
      key: const Key('arena-bottom-navigation'),
      color: SciColors.surface,
      child: SafeArea(
        top: false,
        child: DecoratedBox(
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: SciColors.borderCard)),
          ),
          child: SizedBox(
            height: 68,
            child: Row(
              children: <Widget>[
                for (int i = 0; i < items.length; i++)
                  Expanded(
                    child: Semantics(
                      button: true,
                      selected: i == current,
                      label: items[i].$3,
                      excludeSemantics: true,
                      child: InkWell(
                        key: ValueKey<String>('arena-tab-${items[i].$3}'),
                        onTap: () => onSelected(i),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: <Widget>[
                            Icon(
                              i == current ? items[i].$2 : items[i].$1,
                              size: 22,
                              color: i == current
                                  ? SciColors.primary
                                  : SciColors.inkSecondary,
                            ),
                            if (showLabels) ...<Widget>[
                              const SizedBox(height: 3),
                              MediaQuery.withClampedTextScaling(
                                maxScaleFactor: 1.3,
                                // «En desarrollo» shrinks instead of cutting.
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 2,
                                    ),
                                    child: Text(
                                      items[i].$3,
                                      maxLines: 1,
                                      style: TextStyle(
                                        fontFamily: SciText.sans,
                                        fontSize: 11,
                                        height: 14 / 11,
                                        fontWeight: i == current
                                            ? FontWeight.w600
                                            : FontWeight.w500,
                                        color: i == current
                                            ? SciColors.primary
                                            : SciColors.inkSecondary,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
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
