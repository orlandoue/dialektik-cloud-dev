import 'package:dialektik/design_system/design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

final class HorizontalChoiceOption<T> {
  const HorizontalChoiceOption({required this.value, required this.label});

  final T value;
  final String label;
}

/// A discovery filter strip with a pinned reset choice and scrollable options.
///
/// A short set wraps on wide layouts. Narrow layouts never wrap or overflow;
/// selecting an off-screen option brings it into view and a soft edge fade
/// appears only while more options remain to the right.
final class HorizontalChoiceStrip<T> extends StatefulWidget {
  const HorizontalChoiceStrip({
    required this.semanticsLabel,
    required this.allLabel,
    required this.selectedValue,
    required this.options,
    required this.onSelected,
    this.keyPrefix = 'choice-strip',
    this.scrollHint,
    super.key,
  });

  final String semanticsLabel;
  final String allLabel;
  final T? selectedValue;
  final List<HorizontalChoiceOption<T>> options;
  final ValueChanged<T?> onSelected;
  final String keyPrefix;
  final String? scrollHint;

  @override
  State<HorizontalChoiceStrip<T>> createState() =>
      _HorizontalChoiceStripState<T>();
}

final class _HorizontalChoiceStripState<T>
    extends State<HorizontalChoiceStrip<T>> {
  final ScrollController _controller = ScrollController();
  final Map<T, GlobalKey> _optionKeys = <T, GlobalKey>{};
  bool _canScrollBackward = false;
  bool _canScrollForward = false;
  bool _hasKeyboardFocus = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_updateOverflow);
  }

  @override
  void didUpdateWidget(HorizontalChoiceStrip<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedValue != widget.selectedValue) {
      WidgetsBinding.instance.addPostFrameCallback((Duration _) {
        _revealSelection();
      });
    }
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_updateOverflow)
      ..dispose();
    super.dispose();
  }

  void _updateOverflow() {
    if (!_controller.hasClients) return;
    final ScrollPosition position = _controller.position;
    final bool canScrollBackward = position.pixels > 2;
    final bool canScrollForward =
        position.maxScrollExtent - position.pixels > 2;
    if ((canScrollBackward != _canScrollBackward ||
            canScrollForward != _canScrollForward) &&
        mounted) {
      setState(() {
        _canScrollBackward = canScrollBackward;
        _canScrollForward = canScrollForward;
      });
    }
  }

  KeyEventResult _handleArrowKeys(FocusNode _, KeyEvent event) {
    if (event is! KeyDownEvent || !_controller.hasClients) {
      return KeyEventResult.ignored;
    }
    final bool backward = event.logicalKey == LogicalKeyboardKey.arrowLeft;
    final bool forward = event.logicalKey == LogicalKeyboardKey.arrowRight;
    if (!backward && !forward) return KeyEventResult.ignored;

    final ScrollPosition position = _controller.position;
    final double distance = position.viewportDimension * 0.75;
    final double target = (position.pixels + (forward ? distance : -distance))
        .clamp(0.0, position.maxScrollExtent)
        .toDouble();
    if (target == position.pixels) return KeyEventResult.handled;
    final Duration duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 220);
    _controller.animateTo(
      target,
      duration: duration,
      curve: Curves.easeOutCubic,
    );
    return KeyEventResult.handled;
  }

  void _revealSelection() {
    final T? selected = widget.selectedValue;
    if (selected == null) return;
    final GlobalKey? key = _optionKeys[selected];
    final BuildContext? itemContext = key?.currentContext;
    if (itemContext == null) return;
    final Duration duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 180);
    Scrollable.ensureVisible(
      itemContext,
      alignment: 0.5,
      duration: duration,
      curve: Curves.easeOut,
    );
  }

  GlobalKey _keyFor(HorizontalChoiceOption<T> option) =>
      _optionKeys.putIfAbsent(
        option.value,
        () => GlobalKey(debugLabel: '${widget.keyPrefix}-${option.label}'),
      );

  Widget _choice(String label, bool selected, VoidCallback onTap, {Key? key}) =>
      ConstrainedBox(
        key: key,
        constraints: const BoxConstraints(minHeight: 44),
        child: ChoiceChip(
          label: Text(
            label,
            maxLines: 1,
            softWrap: false,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: selected
                  ? DialektikColors.offWhite
                  : DialektikColors.inkBlack,
            ),
          ),
          selected: selected,
          showCheckmark: false,
          selectedColor: DialektikColors.nocturne,
          backgroundColor: DialektikColors.raisedReading,
          side: BorderSide(
            color: selected
                ? DialektikColors.nocturne
                : DialektikColors.readingLine,
          ),
          shape: const StadiumBorder(),
          onSelected: (_) => onTap(),
        ),
      );

  @override
  Widget build(BuildContext context) => Semantics(
    key: Key('${widget.keyPrefix}-semantics'),
    container: true,
    label: widget.semanticsLabel,
    hint:
        widget.scrollHint ??
        'Desliza horizontalmente o usa las flechas para ver más opciones.',
    child: LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final List<Widget> choices = <Widget>[
          _choice(
            widget.allLabel,
            widget.selectedValue == null,
            () => widget.onSelected(null),
            key: const ValueKey<String>('choice-strip-all'),
          ),
          for (final HorizontalChoiceOption<T> option
              in widget.options) ...<Widget>[
            const SizedBox(width: DialektikSpacing.space2),
            _choice(
              option.label,
              widget.selectedValue == option.value,
              () => widget.onSelected(option.value),
              key: _keyFor(option),
            ),
          ],
        ];
        if (constraints.maxWidth >= 720 && widget.options.length <= 8) {
          return Wrap(
            spacing: DialektikSpacing.space2,
            runSpacing: DialektikSpacing.space2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: choices
                .where((Widget child) => child is! SizedBox)
                .toList(),
          );
        }
        return Row(
          children: <Widget>[
            choices.first,
            const SizedBox(width: DialektikSpacing.space2),
            Expanded(
              child: ClipRect(
                child: NotificationListener<ScrollMetricsNotification>(
                  onNotification: (_) {
                    WidgetsBinding.instance.addPostFrameCallback((Duration _) {
                      _updateOverflow();
                    });
                    return false;
                  },
                  child: Stack(
                    children: <Widget>[
                      Focus(
                        key: Key('${widget.keyPrefix}-keyboard-focus'),
                        canRequestFocus: true,
                        skipTraversal: false,
                        onFocusChange: (bool focused) {
                          if (_hasKeyboardFocus != focused && mounted) {
                            setState(() => _hasKeyboardFocus = focused);
                          }
                        },
                        onKeyEvent: _handleArrowKeys,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            border: _hasKeyboardFocus
                                ? Border.all(
                                    color: DialektikColors.nocturne,
                                    width: DialektikSizing.focusRingWidth,
                                  )
                                : null,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: SingleChildScrollView(
                            key: Key('${widget.keyPrefix}-scroll'),
                            controller: _controller,
                            scrollDirection: Axis.horizontal,
                            child: Row(children: choices.skip(1).toList()),
                          ),
                        ),
                      ),
                      if (_canScrollBackward)
                        Positioned(
                          key: Key('${widget.keyPrefix}-more-left-indicator'),
                          top: 0,
                          bottom: 0,
                          left: 0,
                          width: 28,
                          child: _scrollEdge(backward: true),
                        ),
                      if (_canScrollForward)
                        Positioned(
                          key: Key('${widget.keyPrefix}-more-right-indicator'),
                          top: 0,
                          bottom: 0,
                          right: 0,
                          width: 28,
                          child: _scrollEdge(backward: false),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        );
      },
    ),
  );

  Widget _scrollEdge({required bool backward}) => IgnorePointer(
    child: ExcludeSemantics(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: backward
                ? <Color>[
                    DialektikColors.offWhite,
                    DialektikColors.offWhite.withValues(alpha: 0),
                  ]
                : <Color>[
                    DialektikColors.offWhite.withValues(alpha: 0),
                    DialektikColors.offWhite,
                  ],
          ),
        ),
        child: Align(
          alignment: backward ? Alignment.centerLeft : Alignment.centerRight,
          child: Icon(
            backward ? Icons.chevron_left : Icons.chevron_right,
            size: 18,
            color: DialektikColors.correctedCoolGray,
          ),
        ),
      ),
    ),
  );
}
