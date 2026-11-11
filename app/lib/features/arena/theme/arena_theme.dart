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
