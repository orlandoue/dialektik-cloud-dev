import 'package:flutter/widgets.dart';

/// Installed only by the development LIVE route factory.
final class SemanticShadowAccess extends InheritedWidget {
  const SemanticShadowAccess({
    required this.openInspector,
    required super.child,
    super.key,
  });
  final VoidCallback openInspector;
  static SemanticShadowAccess? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<SemanticShadowAccess>();
  @override
  bool updateShouldNotify(SemanticShadowAccess oldWidget) =>
      openInspector != oldWidget.openInspector;
}
