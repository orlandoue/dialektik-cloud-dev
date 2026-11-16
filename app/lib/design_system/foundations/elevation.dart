import 'package:dialektik/design_system/foundations/colors.dart';
import 'package:flutter/widgets.dart';

/// Nocturne elevation recipes.
///
/// Epistemic components must not use differential elevation. These recipes
/// are for operational overlays and identity-surface containers.
abstract final class DialektikElevation {
  static const List<BoxShadow> none = <BoxShadow>[];

  static const List<BoxShadow> small = <BoxShadow>[
    BoxShadow(color: Color(0xFF3F424D), spreadRadius: 1),
  ];

  static const List<BoxShadow> medium = <BoxShadow>[
    BoxShadow(color: Color(0xFF595D6C), spreadRadius: 1),
    BoxShadow(color: Color(0x8C000000), blurRadius: 18, offset: Offset(0, 6)),
  ];

  static const List<BoxShadow> large = <BoxShadow>[
    BoxShadow(color: DialektikColors.nocturneMuted, spreadRadius: 1),
    BoxShadow(color: Color(0xA6000000), blurRadius: 40, offset: Offset(0, 16)),
  ];
}
