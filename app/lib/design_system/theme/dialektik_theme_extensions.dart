import 'package:flutter/material.dart';

/// Colors describing the active surface and its functional interaction ink.
@immutable
class DialektikSurfaceColors extends ThemeExtension<DialektikSurfaceColors> {
  const DialektikSurfaceColors({
    required this.base,
    required this.raised,
    required this.foreground,
    required this.muted,
    required this.divider,
    required this.interactionAccent,
  });

  final Color base;
  final Color raised;
  final Color foreground;
  final Color muted;
  final Color divider;
  final Color interactionAccent;

  @override
  DialektikSurfaceColors copyWith({
    Color? base,
    Color? raised,
    Color? foreground,
    Color? muted,
    Color? divider,
    Color? interactionAccent,
  }) {
    return DialektikSurfaceColors(
      base: base ?? this.base,
      raised: raised ?? this.raised,
      foreground: foreground ?? this.foreground,
      muted: muted ?? this.muted,
      divider: divider ?? this.divider,
      interactionAccent: interactionAccent ?? this.interactionAccent,
    );
  }

  @override
  DialektikSurfaceColors lerp(
    covariant DialektikSurfaceColors? other,
    double t,
  ) {
    if (other == null) {
      return this;
    }
    return DialektikSurfaceColors(
      base: Color.lerp(base, other.base, t)!,
      raised: Color.lerp(raised, other.raised, t)!,
      foreground: Color.lerp(foreground, other.foreground, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      divider: Color.lerp(divider, other.divider, t)!,
      interactionAccent: Color.lerp(
        interactionAccent,
        other.interactionAccent,
        t,
      )!,
    );
  }
}

/// Shared colors available to epistemic components.
///
/// There is intentionally no per-class color lookup. Every epistemic role sees
/// the same four presentation colors.
@immutable
class DialektikEpistemicColors
    extends ThemeExtension<DialektikEpistemicColors> {
  const DialektikEpistemicColors({
    required this.ink,
    required this.muted,
    required this.line,
    required this.mark,
  });

  final Color ink;
  final Color muted;
  final Color line;
  final Color mark;

  @override
  DialektikEpistemicColors copyWith({
    Color? ink,
    Color? muted,
    Color? line,
    Color? mark,
  }) {
    return DialektikEpistemicColors(
      ink: ink ?? this.ink,
      muted: muted ?? this.muted,
      line: line ?? this.line,
      mark: mark ?? this.mark,
    );
  }

  @override
  DialektikEpistemicColors lerp(
    covariant DialektikEpistemicColors? other,
    double t,
  ) {
    if (other == null) {
      return this;
    }
    return DialektikEpistemicColors(
      ink: Color.lerp(ink, other.ink, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      line: Color.lerp(line, other.line, t)!,
      mark: Color.lerp(mark, other.mark, t)!,
    );
  }
}

/// Software-state colors, isolated from epistemic presentation.
@immutable
class DialektikOperationalColors
    extends ThemeExtension<DialektikOperationalColors> {
  const DialektikOperationalColors({
    required this.success,
    required this.warning,
    required this.error,
    required this.info,
  });

  final Color success;
  final Color warning;
  final Color error;
  final Color info;

  @override
  DialektikOperationalColors copyWith({
    Color? success,
    Color? warning,
    Color? error,
    Color? info,
  }) {
    return DialektikOperationalColors(
      success: success ?? this.success,
      warning: warning ?? this.warning,
      error: error ?? this.error,
      info: info ?? this.info,
    );
  }

  @override
  DialektikOperationalColors lerp(
    covariant DialektikOperationalColors? other,
    double t,
  ) {
    if (other == null) {
      return this;
    }
    return DialektikOperationalColors(
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      error: Color.lerp(error, other.error, t)!,
      info: Color.lerp(info, other.info, t)!,
    );
  }
}

extension DialektikThemeAccess on BuildContext {
  DialektikSurfaceColors get surfaceColors {
    return Theme.of(this).extension<DialektikSurfaceColors>()!;
  }

  DialektikEpistemicColors get epistemicColors {
    return Theme.of(this).extension<DialektikEpistemicColors>()!;
  }

  DialektikOperationalColors get operationalColors {
    return Theme.of(this).extension<DialektikOperationalColors>()!;
  }
}
