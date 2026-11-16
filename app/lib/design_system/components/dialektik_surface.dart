import 'package:dialektik/design_system/foundations/borders.dart';
import 'package:dialektik/design_system/foundations/radii.dart';
import 'package:dialektik/design_system/foundations/spacing.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/material.dart';

/// Token-backed content ground with no semantic meaning of its own.
class DialektikSurface extends StatelessWidget {
  const DialektikSurface({
    required this.child,
    this.padding = const EdgeInsets.all(DialektikSpacing.space6),
    this.raised = false,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final bool raised;

  @override
  Widget build(BuildContext context) {
    final DialektikSurfaceColors colors = context.surfaceColors;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: raised ? colors.raised : colors.base,
        border: Border.all(
          color: colors.divider,
          width: DialektikBorders.hairlineWidth,
        ),
        borderRadius: DialektikRadii.mediumBorderRadius,
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}
