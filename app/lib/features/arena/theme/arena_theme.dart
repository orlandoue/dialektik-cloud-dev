import 'package:flutter/material.dart';

/// Official palette of «Dialektik Arena: El Coliseo de los Medios».
abstract final class ArenaColors {
  static const Color background = Color(0xFFF6F6F9);
  static const Color card = Color(0xFFFFFFFF);
  static const Color border = Color(0xFFE6E6F0);
  static const Color ink = Color(0xFF0F172A);
  static const Color inkDeep = Color(0xFF1A1830);
  static const Color muted = Color(0xFF5B6478);
  static const Color violet = Color(0xFF5B3DF5);
  static const Color violetSoft = Color(0xFFEDE9FE);
  static const Color violetDeep = Color(0xFF4C1D95);
  static const Color amber = Color(0xFFD97706);
  static const Color amberBright = Color(0xFFF59E0B);
  static const Color amberSoft = Color(0xFFFEF3C7);
  static const Color amberDeep = Color(0xFF92400E);
  static const Color emerald = Color(0xFF059669);
  static const Color emeraldSoft = Color(0xFFD1FAE5);
  static const Color emeraldDeep = Color(0xFF065F46);
  static const Color track = Color(0xFFE5E7F0);
  static const LinearGradient violetGradient = LinearGradient(
    colors: <Color>[Color(0xFF6D28D9), Color(0xFF4F46E5)],
  );
}

abstract final class ArenaText {
  static const String serif = 'Merriweather';

  static const TextStyle brand = TextStyle(
    fontFamily: serif,
    fontSize: 24,
    fontWeight: FontWeight.w700,
    color: ArenaColors.ink,
  );
  static const TextStyle section = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w800,
    color: ArenaColors.ink,
  );
  static const TextStyle cardTitle = TextStyle(
    fontSize: 15,
    height: 1.3,
    fontWeight: FontWeight.w700,
    color: ArenaColors.ink,
  );
  static const TextStyle body = TextStyle(
    fontSize: 14,
    height: 1.4,
    color: ArenaColors.ink,
  );
  static const TextStyle meta = TextStyle(
    fontSize: 12,
    height: 1.3,
    color: ArenaColors.muted,
  );
}

/// Card surface shared by every Arena screen: white, soft border, radius 16.
BoxDecoration arenaCardDecoration({
  Color? borderColor,
  double borderWidth = 1,
}) => BoxDecoration(
  color: ArenaColors.card,
  borderRadius: BorderRadius.circular(16),
  border: Border.all(
    color: borderColor ?? ArenaColors.border,
    width: borderWidth,
  ),
);

/// Tokens of the Science mode and story comments (C1–C4). Kept apart from
/// [ArenaColors]: `primary` and `ink` differ slightly from the Arena values.
abstract final class SciColors {
  static const Color primary = Color(0xFF5B3FF5);
  static const Color primaryText = Color(0xFF4C33D9);
  static const Color bgApp = Color(0xFFF6F6F9);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color ink = Color(0xFF111827);

  /// Never lighter than this for text.
  static const Color inkSecondary = Color(0xFF4B5563);
  static const Color borderCard = Color(0xFFE5E7EB);

  /// Control borders: ≥3:1 on white (3.35) and on bgApp (3.10), WCAG 1.4.11.
  static const Color borderControl = Color(0xFF858D9A);
  static const Color divider = Color(0xFFF1F2F4);
  static const Color tagBg = Color(0xFFF1F2F4);
  static const Color tagText = Color(0xFF374151);

  /// Reserved; not used in story comments.
  static const Color communityBand = Color(0xFFEEF2F7);
  static const Color scrim = Color(0x80111827);
}

/// Inter scale of the Science mode; Merriweather only for literal quotes
/// and study titles inside study labels.
abstract final class SciText {
  static const String serif = 'Merriweather';
  static const String sans = 'Inter';

  static const TextStyle h1 = TextStyle(
    fontFamily: sans,
    fontSize: 20,
    height: 26 / 20,
    fontWeight: FontWeight.w600,
    color: SciColors.ink,
  );
  static const TextStyle cardTitle = TextStyle(
    fontFamily: sans,
    fontSize: 16,
    height: 22 / 16,
    fontWeight: FontWeight.w600,
    color: SciColors.ink,
  );
  static const TextStyle body = TextStyle(
    fontFamily: sans,
    fontSize: 15,
    height: 22 / 15,
    color: SciColors.ink,
  );
  static const TextStyle secondary = TextStyle(
    fontFamily: sans,
    fontSize: 14,
    height: 20 / 14,
    color: SciColors.inkSecondary,
  );
  static const TextStyle meta = TextStyle(
    fontFamily: sans,
    fontSize: 13,
    height: 18 / 13,
    color: SciColors.inkSecondary,
  );
  static const TextStyle label = TextStyle(
    fontFamily: sans,
    fontSize: 12,
    height: 16 / 12,
    color: SciColors.inkSecondary,
  );
  static const TextStyle micro = TextStyle(
    fontFamily: sans,
    fontSize: 11,
    height: 14 / 11,
    color: SciColors.inkSecondary,
  );
  static const TextStyle quote = TextStyle(
    fontFamily: serif,
    fontSize: 14,
    height: 20 / 14,
    color: SciColors.ink,
  );
}

/// Radii of the Science mode.
abstract final class SciRadius {
  static const double card = 16;
  static const double fullButton = 14;
  static const double rowButton = 12;
  static const double pill = 22;
  static const double studyLabel = 4;
  static const double sheet = 20;
}
