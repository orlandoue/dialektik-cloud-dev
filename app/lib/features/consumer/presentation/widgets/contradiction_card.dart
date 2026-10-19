// dialektik: epistemic-component
import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:flutter/material.dart';

final class ContradictionCard extends StatelessWidget {
  const ContradictionCard({
    required this.contradiction,
    required this.onOpenEvent,
    super.key,
  });

  final ContradictionDto contradiction;
  final VoidCallback onOpenEvent;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return DialektikSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            contradiction.eventTitle,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: DialektikSpacing.space3),
          Text(
            '${strings.positionIndex(contradiction.positionA.ordinal, 2)} · '
            '${contradiction.positionA.title}',
          ),
          Text(
            '${strings.positionIndex(contradiction.positionB.ordinal, 2)} · '
            '${contradiction.positionB.title}',
          ),
          const SizedBox(height: DialektikSpacing.space3),
          Text(
            contradiction.needsReview
                ? strings.needsReview
                : strings.currentPublication,
          ),
          const SizedBox(height: DialektikSpacing.space3),
          TextButton(
            onPressed: onOpenEvent,
            child: Text(strings.openSuccessor),
          ),
        ],
      ),
    );
  }
}
