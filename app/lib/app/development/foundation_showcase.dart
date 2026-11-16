import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/design_system/components/dialektik_divider.dart';
import 'package:dialektik/design_system/components/dialektik_surface.dart';
import 'package:dialektik/design_system/components/operational_notice.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/foundations/spacing.dart';
import 'package:flutter/material.dart';

/// Development-only proof that the Phase 0 application shell mounts.
///
/// This is not a product screen and contains no domain data or behavior.
class FoundationShowcase extends StatelessWidget {
  const FoundationShowcase({required this.environment, super.key});

  final AppEnvironment environment;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SelectionArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(DialektikSpacing.space6),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                  maxWidth: DialektikSizing.maxReadingWidth,
                ),
                child: DialektikSurface(
                  raised: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Dialektik',
                        style: Theme.of(context).textTheme.displaySmall,
                      ),
                      const SizedBox(height: DialektikSpacing.space4),
                      Text(
                        'Phase 0 foundation · ${environment.name}',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: DialektikSpacing.space4),
                      const Text(
                        'This development-only surface verifies application '
                        'bootstrap, typography, accessible scaling, and the '
                        'operational/epistemic design boundary. It is not a '
                        'product screen.',
                      ),
                      const SizedBox(height: DialektikSpacing.space6),
                      const DialektikDivider(),
                      const SizedBox(height: DialektikSpacing.space6),
                      const OperationalNotice(
                        kind: OperationalNoticeKind.info,
                        message: 'The Phase 0 foundation is running.',
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
