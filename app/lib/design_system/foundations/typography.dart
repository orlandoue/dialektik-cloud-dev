import 'package:flutter/material.dart';

/// Editorial Merriweather heads paired with Inter 400 and 500 body typography.
abstract final class DialektikTypography {
  static const double publicBodyMinimum = 16;

  /// A publication-style face for brand and news headlines only.
  ///
  /// Merriweather is locally bundled for consistent web and Android rendering.
  /// Semantic evidence and analytical labels continue to use the Inter system.
  static TextStyle editorialHeading({required Color color, double size = 32}) =>
      TextStyle(
        color: color,
        fontFamily: 'Merriweather',
        fontSize: size,
        fontWeight: FontWeight.w400,
        height: 1.12,
        letterSpacing: -0.55,
      );

  static TextStyle editorialBrand({required Color color, double size = 30}) =>
      TextStyle(
        color: color,
        fontFamily: 'Merriweather',
        fontSize: size,
        fontWeight: FontWeight.w400,
        height: 1.1,
        letterSpacing: -0.65,
      );

  static TextTheme textTheme({
    required Color foreground,
    required Color muted,
    bool loadInterFromDependency = true,
  }) {
    final TextStyle display = _heading(
      color: foreground,
      size: 33,
      height: 1.11,
      letterSpacing: -1.155,
    );
    final TextStyle headline = _heading(
      color: foreground,
      size: 24,
      height: 1.2,
      letterSpacing: -0.672,
    );
    final TextStyle titleLarge = _heading(
      color: foreground,
      size: 18,
      height: 1.3,
      letterSpacing: -0.36,
    );
    final TextStyle title = _heading(
      color: foreground,
      size: 16,
      height: 1.32,
      letterSpacing: -0.256,
    );
    final TextStyle body = _body(color: foreground);
    final TextStyle chrome = _chrome(color: muted);
    final TextTheme base = TextTheme(
      displayLarge: display,
      displayMedium: display,
      displaySmall: display,
      headlineLarge: headline,
      headlineMedium: headline,
      headlineSmall: headline,
      titleLarge: titleLarge,
      titleMedium: title,
      titleSmall: title,
      bodyLarge: body,
      bodyMedium: body,
      bodySmall: chrome,
      labelLarge: body,
      labelMedium: chrome,
      labelSmall: chrome,
    );

    // Inter 400/500 is bundled; typography remains available without network.
    // The parameter stays source-compatible with existing test/app callers.
    return base;
  }

  static TextStyle _body({required Color color}) {
    return TextStyle(
      color: color,
      fontFamily: 'Inter',
      fontSize: publicBodyMinimum,
      fontWeight: FontWeight.w400,
      height: 1.5,
    );
  }

  static TextStyle _chrome({required Color color}) {
    return TextStyle(
      color: color,
      fontFamily: 'Inter',
      fontSize: 12,
      fontWeight: FontWeight.w400,
      height: 1.4,
    );
  }

  static TextStyle _heading({
    required Color color,
    required double size,
    required double height,
    required double letterSpacing,
  }) {
    return TextStyle(
      color: color,
      fontFamily: 'Inter',
      fontSize: size,
      fontWeight: FontWeight.w500,
      height: height,
      letterSpacing: letterSpacing,
    );
  }
}
