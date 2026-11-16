import 'package:flutter/painting.dart';

/// Computes the WCAG contrast ratio for two opaque colors.
double contrastRatio(Color first, Color second) {
  final double firstLuminance = first.computeLuminance();
  final double secondLuminance = second.computeLuminance();
  final double lighter = firstLuminance > secondLuminance
      ? firstLuminance
      : secondLuminance;
  final double darker = firstLuminance > secondLuminance
      ? secondLuminance
      : firstLuminance;
  return (lighter + 0.05) / (darker + 0.05);
}

/// WCAG AA thresholds used by the Dialektik specifications.
abstract final class DialektikContrastThreshold {
  static const double bodyText = 4.5;
  static const double largeTextAndChrome = 3;
}
