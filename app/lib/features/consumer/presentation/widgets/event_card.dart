import 'package:dialektik/core/accessibility/accessible_action.dart';
import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:flutter/material.dart';

final class EventCard extends StatelessWidget {
  const EventCard({required this.event, required this.onOpen, super.key});

  final EventCardDto event;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    final String state = event.analysisState == AnalysisState.analysisPending
        ? strings.pendingAnalysis
        : strings.publishedAnalysis;
    return AccessibleAction(
      semanticLabel: strings.eventSemantics(event.titleDescriptive, state),
      onActivate: onOpen,
      child: DialektikSurface(
        padding: const EdgeInsets.all(DialektikSpacing.space6),
        child: Align(
          alignment: AlignmentDirectional.centerStart,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                strings.categoryName(event.category),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: DialektikSpacing.space2),
              Text(
                event.titleDescriptive,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: DialektikSpacing.space4),
              Text(state),
              const SizedBox(height: DialektikSpacing.space2),
              Text(strings.detected(event.detectedAt)),
              Text(strings.sourceCount(event.sourceCount)),
              if (event.positionCount case final int count)
                Text(strings.positionCount(count)),
            ],
          ),
        ),
      ),
    );
  }
}
