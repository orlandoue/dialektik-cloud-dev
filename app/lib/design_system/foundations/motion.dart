import 'package:flutter/animation.dart';

/// Functional motion tokens. None dramatizes epistemic content.
abstract final class DialektikMotion {
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration base = Duration(milliseconds: 200);
  static const Duration realtimeEntry = Duration(milliseconds: 260);
  static const Curve standardCurve = Curves.easeOut;

  static Duration accessibleDuration({
    required Duration duration,
    required bool disableAnimations,
  }) {
    return disableAnimations ? Duration.zero : duration;
  }
}
