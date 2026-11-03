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
    // Never label source-less, incomplete beta Events as verified publications.
    final bool hasGroundedPublishedAnalysis =
        event.analysisState == AnalysisState.published &&
        event.sourceCount > 0 &&
        (event.positionCount ?? 0) > 0;
    final String state = hasGroundedPublishedAnalysis
        ? strings.publishedAnalysis
        : strings.pendingAnalysis;
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
              if (event.isFollowedSourceMatch) const Text('En tus fuentes'),
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
              if (hasGroundedPublishedAnalysis)
                Text(strings.positionCount(event.positionCount!)),
            ],
          ),
        ),
      ),
    );
  }
}
