import 'package:flutter/widgets.dart';

/// The two allowed radii for Dialektik interface content.
///
/// A full/pill radius is intentionally absent: pill-shaped epistemic labels
/// would read as status badges.
abstract final class DialektikRadii {
  static const double small = 4;
  static const double medium = 8;

  static const BorderRadius smallBorderRadius = BorderRadius.all(
    Radius.circular(small),
  );
  static const BorderRadius mediumBorderRadius = BorderRadius.all(
    Radius.circular(medium),
  );
}
