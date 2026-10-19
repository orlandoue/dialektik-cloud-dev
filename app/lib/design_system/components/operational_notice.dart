import 'package:dialektik/design_system/foundations/borders.dart';
import 'package:dialektik/design_system/foundations/radii.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/foundations/spacing.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Software states only. This must never describe content or evidence.
enum OperationalNoticeKind { success, warning, error, info }

/// Text-and-icon operational feedback that never relies on color alone.
class OperationalNotice extends StatelessWidget {
  const OperationalNotice({
    required this.kind,
    required this.message,
    super.key,
  });

  final OperationalNoticeKind kind;
  final String message;

  @override
  Widget build(BuildContext context) {
    final DialektikOperationalColors colors = context.operationalColors;
    final Color stateColor = switch (kind) {
      OperationalNoticeKind.success => colors.success,
      OperationalNoticeKind.warning => colors.warning,
      OperationalNoticeKind.error => colors.error,
      OperationalNoticeKind.info => colors.info,
    };
    final IconData icon = switch (kind) {
      OperationalNoticeKind.success => PhosphorIcons.checkCircle(),
      OperationalNoticeKind.warning => PhosphorIcons.warning(),
      OperationalNoticeKind.error => PhosphorIcons.xCircle(),
      OperationalNoticeKind.info => PhosphorIcons.info(),
    };
    final String kindLabel = switch (kind) {
      OperationalNoticeKind.success => 'Success',
      OperationalNoticeKind.warning => 'Warning',
      OperationalNoticeKind.error => 'Error',
      OperationalNoticeKind.info => 'Information',
    };

    return Semantics(
      container: true,
      excludeSemantics: true,
      label: '$kindLabel: $message',
      liveRegion: kind == OperationalNoticeKind.error,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.all(
            color: stateColor,
            width: DialektikBorders.hairlineWidth,
          ),
          borderRadius: DialektikRadii.mediumBorderRadius,
        ),
        child: Padding(
          padding: const EdgeInsets.all(DialektikSpacing.space4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              PhosphorIcon(
                icon,
                color: stateColor,
                size: DialektikSizing.iconMedium,
              ),
              const SizedBox(width: DialektikSpacing.space3),
              Expanded(child: Text('$kindLabel · $message')),
            ],
          ),
        ),
      ),
    );
  }
}
