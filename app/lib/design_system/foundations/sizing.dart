/// Sizing, grid, icon, breakpoint, and focus measurements.
abstract final class DialektikSizing {
  static const double touchMinimum = 44;
  static const double touchPreferred = 48;
  static const double maxReadingWidth = 680;

  static const double iconSmall = 16;
  static const double iconMedium = 24;
  static const double iconLarge = 32;

  static const double focusRingWidth = 2;
  static const double focusRingGap = 2;

  static const double baseViewport = 360;
  static const double wideBreakpoint = 768;
  static const double moderationMinimum = 1024;

  /// Reserved contract token; no Phase 0 primitive consumes it.
  ///
  /// PositionCard is deferred. Its fixed 72px header conflicts with the
  /// authoritative 200% dynamic-type rule and must be resolved before use.
  static const double positionHeader = 72;
}
