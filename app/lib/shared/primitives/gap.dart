import 'package:flutter/widgets.dart';

/// Direction-explicit spacing primitive for token values.
class Gap extends StatelessWidget {
  const Gap.horizontal(this.extent, {super.key}) : axis = Axis.horizontal;

  const Gap.vertical(this.extent, {super.key}) : axis = Axis.vertical;

  final Axis axis;
  final double extent;

  @override
  Widget build(BuildContext context) {
    return axis == Axis.horizontal
        ? SizedBox(width: extent)
        : SizedBox(height: extent);
  }
}
