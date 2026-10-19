import 'package:flutter/material.dart';

/// Authoritative Dialektik color constants.
///
/// Operational state colors are intentionally kept in a separate type from
/// epistemic presentation colors so an epistemic component cannot receive a
/// success/error semantic by ordinary dependency injection.
abstract final class DialektikColors {
  static const Color offWhite = Color(0xFFF8F5EF);
  static const Color inkBlack = Color(0xFF070B18);
  static const Color electricViolet = Color(0xFF5B3BFF);
  static const Color correctedCoolGray = Color(0xFF667085);
  static const Color coolGray = Color(0xFF8A93A7);
  static const Color readingLine = Color(0xFFD6DAE4);
  static const Color epistemicMark = Color(0xFFE4E0FF);
  static const Color raisedReading = Color(0xFFFFFFFF);

  static const Color nocturne = Color(0xFF13243A);
  static const Color nocturneRaised = Color(0xFF203750);
  static const Color nocturneText = Color(0xFFE9E9ED);
  static const Color nocturneMuted = Color(0xFF9397AB);
  static const Color nocturneAccent = Color(0xFFD2CEFD);
  static const Color nocturneAccentMark = Color(0x1FD2CEFD);
  static const Color nocturneDivider = Color(0x29E9E9ED);

  static const Color transparent = Color(0x00000000);
}

/// The software-state palette. These colors never describe knowledge.
abstract final class DialektikOperationalStateColors {
  static const Color success = Color(0xFF3E7D5A);
  static const Color warning = Color(0xFF8A6A2F);
  static const Color error = Color(0xFF8C3B3B);
  static const Color info = Color(0xFF5D5294);
}
