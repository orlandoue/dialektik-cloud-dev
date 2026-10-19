import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:flutter/widgets.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Functional icons exposed by the public design-system API.
///
/// Epistemic verdict, badge, trophy, shield, and filled variants are absent by
/// construction.
enum DialektikFunctionalIcon {
  back,
  close,
  search,
  share,
  externalLink,
  retry,
  menu,
  info,
}

enum DialektikIconSize {
  small(DialektikSizing.iconSmall),
  medium(DialektikSizing.iconMedium),
  large(DialektikSizing.iconLarge);

  const DialektikIconSize(this.pixels);

  final double pixels;
}

/// Phosphor-Regular icon wrapper with an intentionally narrow catalog.
class DialektikIcon extends StatelessWidget {
  const DialektikIcon({
    required this.icon,
    this.color,
    this.semanticLabel,
    this.size = DialektikIconSize.medium,
    super.key,
  });

  final DialektikFunctionalIcon icon;
  final Color? color;
  final String? semanticLabel;
  final DialektikIconSize size;

  @override
  Widget build(BuildContext context) {
    return PhosphorIcon(
      _iconData(icon),
      color: color,
      semanticLabel: semanticLabel,
      size: size.pixels,
    );
  }

  static IconData _iconData(DialektikFunctionalIcon icon) {
    return switch (icon) {
      DialektikFunctionalIcon.back => PhosphorIcons.arrowLeft(),
      DialektikFunctionalIcon.close => PhosphorIcons.x(),
      DialektikFunctionalIcon.search => PhosphorIcons.magnifyingGlass(),
      DialektikFunctionalIcon.share => PhosphorIcons.shareNetwork(),
      DialektikFunctionalIcon.externalLink => PhosphorIcons.arrowSquareOut(),
      DialektikFunctionalIcon.retry => PhosphorIcons.arrowClockwise(),
      DialektikFunctionalIcon.menu => PhosphorIcons.list(),
      DialektikFunctionalIcon.info => PhosphorIcons.info(),
    };
  }
}
