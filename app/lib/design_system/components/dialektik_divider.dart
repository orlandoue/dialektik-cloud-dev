import 'package:dialektik/design_system/foundations/borders.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/widgets.dart';

/// A token-backed divider with Nocturne's 48px end fade when space permits.
class DialektikDivider extends StatelessWidget {
  const DialektikDivider({super.key});

  @override
  Widget build(BuildContext context) {
    final Color color = context.surfaceColors.divider;
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double availableWidth = constraints.maxWidth;
        final bool canFade =
            availableWidth.isFinite &&
            availableWidth >= DialektikBorders.fadingRuleExtent * 2;
        return SizedBox(
          height: DialektikBorders.hairlineWidth,
          width: double.infinity,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: canFade ? null : color,
              gradient: canFade
                  ? LinearGradient(
                      colors: <Color>[
                        color.withAlpha(0),
                        color,
                        color,
                        color.withAlpha(0),
                      ],
                      stops: <double>[
                        0,
                        DialektikBorders.fadingRuleExtent / availableWidth,
                        1 - DialektikBorders.fadingRuleExtent / availableWidth,
                        1,
                      ],
                    )
                  : null,
            ),
          ),
        );
      },
    );
  }
}
