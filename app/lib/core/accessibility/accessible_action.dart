import 'package:dialektik/design_system/foundations/colors.dart';
import 'package:dialektik/design_system/foundations/motion.dart';
import 'package:dialektik/design_system/foundations/opacity.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Keyboard, focus, semantics, and minimum-target wrapper for custom actions.
class AccessibleAction extends StatefulWidget {
  const AccessibleAction({
    required this.semanticLabel,
    required this.onActivate,
    required this.child,
    this.enabled = true,
    this.minimumTarget = DialektikSizing.touchMinimum,
    super.key,
  }) : assert(semanticLabel != ''),
       assert(minimumTarget >= DialektikSizing.touchMinimum);

  final String semanticLabel;
  final VoidCallback onActivate;
  final Widget child;
  final bool enabled;
  final double minimumTarget;

  @override
  State<AccessibleAction> createState() => _AccessibleActionState();
}

class _AccessibleActionState extends State<AccessibleAction> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final bool disableAnimations =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final Color focusColor = context.surfaceColors.interactionAccent;

    return FocusableActionDetector(
      enabled: widget.enabled,
      mouseCursor: widget.enabled
          ? SystemMouseCursors.click
          : SystemMouseCursors.forbidden,
      onShowFocusHighlight: (bool value) {
        setState(() => _focused = value);
      },
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
      },
      actions: <Type, Action<Intent>>{
        ActivateIntent: CallbackAction<ActivateIntent>(
          onInvoke: (ActivateIntent intent) {
            if (widget.enabled) {
              widget.onActivate();
            }
            return null;
          },
        ),
      },
      child: Semantics(
        button: true,
        enabled: widget.enabled,
        excludeSemantics: true,
        label: widget.semanticLabel,
        onTap: widget.enabled ? widget.onActivate : null,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.enabled ? widget.onActivate : null,
          child: AnimatedOpacity(
            duration: DialektikMotion.accessibleDuration(
              duration: DialektikMotion.fast,
              disableAnimations: disableAnimations,
            ),
            opacity: widget.enabled
                ? DialektikOpacity.full
                : DialektikOpacity.disabled,
            child: AnimatedContainer(
              duration: DialektikMotion.accessibleDuration(
                duration: DialektikMotion.fast,
                disableAnimations: disableAnimations,
              ),
              decoration: BoxDecoration(
                border: Border.all(
                  color: _focused ? focusColor : DialektikColors.transparent,
                  width: DialektikSizing.focusRingWidth,
                ),
              ),
              padding: const EdgeInsets.all(DialektikSizing.focusRingGap),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: widget.minimumTarget,
                  minWidth: widget.minimumTarget,
                ),
                child: Center(child: widget.child),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
