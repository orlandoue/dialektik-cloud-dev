// dialektik: epistemic-component
import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:flutter/material.dart';

final class AnalysisPendingPanel extends StatelessWidget {
  const AnalysisPendingPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return DialektikSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            strings.pendingAnalysis,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: DialektikSpacing.space3),
          Text(strings.pendingExplanation),
        ],
      ),
    );
  }
}
