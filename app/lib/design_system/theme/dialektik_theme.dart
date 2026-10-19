import 'package:dialektik/design_system/foundations/colors.dart';
import 'package:dialektik/design_system/foundations/radii.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/foundations/typography.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/material.dart';

/// Builds the three function-bound Dialektik themes.
///
/// They are not user-selectable light/dark preferences: each theme represents
/// an authoritative surface domain.
abstract final class DialektikTheme {
  static ThemeData offWhite({bool loadInterFromDependency = true}) {
    return _build(
      brightness: Brightness.light,
      surface: const DialektikSurfaceColors(
        base: DialektikColors.offWhite,
        raised: DialektikColors.raisedReading,
        foreground: DialektikColors.inkBlack,
        muted: DialektikColors.correctedCoolGray,
        divider: DialektikColors.readingLine,
        interactionAccent: DialektikColors.electricViolet,
      ),
      epistemic: const DialektikEpistemicColors(
        ink: DialektikColors.inkBlack,
        muted: DialektikColors.correctedCoolGray,
        line: DialektikColors.readingLine,
        mark: DialektikColors.epistemicMark,
      ),
      loadInterFromDependency: loadInterFromDependency,
    );
  }

  static ThemeData nocturne({bool loadInterFromDependency = true}) {
    return _build(
      brightness: Brightness.dark,
      surface: const DialektikSurfaceColors(
        base: DialektikColors.nocturne,
        raised: DialektikColors.nocturneRaised,
        foreground: DialektikColors.nocturneText,
        muted: DialektikColors.nocturneMuted,
        divider: DialektikColors.nocturneDivider,
        interactionAccent: DialektikColors.nocturneAccent,
      ),
      epistemic: const DialektikEpistemicColors(
        ink: DialektikColors.nocturneText,
        muted: DialektikColors.nocturneMuted,
        line: DialektikColors.nocturneDivider,
        mark: DialektikColors.nocturneAccentMark,
      ),
      loadInterFromDependency: loadInterFromDependency,
    );
  }

  static ThemeData inkBlack({bool loadInterFromDependency = true}) {
    return _build(
      brightness: Brightness.dark,
      surface: const DialektikSurfaceColors(
        base: DialektikColors.inkBlack,
        raised: DialektikColors.nocturne,
        foreground: DialektikColors.offWhite,
        muted: DialektikColors.coolGray,
        divider: DialektikColors.nocturneDivider,
        interactionAccent: DialektikColors.offWhite,
      ),
      epistemic: const DialektikEpistemicColors(
        ink: DialektikColors.offWhite,
        muted: DialektikColors.coolGray,
        line: DialektikColors.nocturneDivider,
        mark: DialektikColors.nocturneAccentMark,
      ),
      loadInterFromDependency: loadInterFromDependency,
    );
  }

  static ThemeData _build({
    required Brightness brightness,
    required DialektikSurfaceColors surface,
    required DialektikEpistemicColors epistemic,
    required bool loadInterFromDependency,
  }) {
    const DialektikOperationalColors operational = DialektikOperationalColors(
      success: DialektikOperationalStateColors.success,
      warning: DialektikOperationalStateColors.warning,
      error: DialektikOperationalStateColors.error,
      info: DialektikOperationalStateColors.info,
    );
    final TextTheme textTheme = DialektikTypography.textTheme(
      foreground: surface.foreground,
      muted: surface.muted,
      loadInterFromDependency: loadInterFromDependency,
    );
    final ColorScheme colorScheme =
        ColorScheme.fromSeed(
          seedColor: surface.interactionAccent,
          brightness: brightness,
        ).copyWith(
          primary: surface.interactionAccent,
          onPrimary: surface.base,
          error: operational.error,
          onError: DialektikColors.raisedReading,
          surface: surface.base,
          onSurface: surface.foreground,
          outline: surface.divider,
        );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: surface.base,
      canvasColor: surface.base,
      focusColor: surface.interactionAccent,
      dividerColor: surface.divider,
      textTheme: textTheme,
      cardTheme: CardThemeData(
        color: surface.raised,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: DialektikRadii.mediumBorderRadius,
          side: BorderSide(color: surface.divider),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: surface.divider,
        space: 1,
        thickness: 1,
      ),
      iconTheme: IconThemeData(
        color: surface.foreground,
        size: DialektikSizing.iconMedium,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: surface.interactionAccent,
          foregroundColor: surface.base,
          minimumSize: const Size(
            DialektikSizing.touchMinimum,
            DialektikSizing.touchMinimum,
          ),
          shape: const RoundedRectangleBorder(
            borderRadius: DialektikRadii.mediumBorderRadius,
          ),
          textStyle: textTheme.labelLarge,
        ),
      ),
      extensions: <ThemeExtension<dynamic>>[surface, epistemic, operational],
    );
  }
}
