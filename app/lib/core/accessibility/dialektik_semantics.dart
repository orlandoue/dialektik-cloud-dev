import 'package:flutter/widgets.dart';

/// Makes the accessible name mandatory for a grouped primitive.
class DialektikSemanticLabel extends StatelessWidget {
  const DialektikSemanticLabel({
    required this.label,
    required this.child,
    this.button = false,
    this.header = false,
    this.liveRegion = false,
    super.key,
  }) : assert(label != '');

  final String label;
  final Widget child;
  final bool button;
  final bool header;
  final bool liveRegion;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: button,
      container: true,
      excludeSemantics: true,
      header: header,
      label: label,
      liveRegion: liveRegion,
      child: child,
    );
  }
}
