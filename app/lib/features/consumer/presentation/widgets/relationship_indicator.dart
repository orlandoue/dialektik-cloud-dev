// dialektik: epistemic-component
import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:flutter/material.dart';

final class RelationshipIndicator extends StatelessWidget {
  const RelationshipIndicator({required this.relationship, super.key});

  final RelationshipDto relationship;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    final String type = strings.relationshipType(relationship.type.name);
    final String scope = strings.relationshipScope(relationship.scope.name);
    return Semantics(
      container: true,
      label: '$type. $scope. ${relationship.nonComparableReason ?? ''}',
      child: DialektikSurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(type, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: DialektikSpacing.space2),
            Text(scope),
            if (relationship.type == RelationshipType.r05) ...<Widget>[
              const SizedBox(height: DialektikSpacing.space3),
              Text(strings.partialConflict),
            ],
            for (
              var index = 0;
              index < relationship.endpoints.length;
              index += 1
            )
              Text(
                '${strings.assertionIndex(index + 1)} · '
                '${relationship.endpoints[index].role.name}',
              ),
            if (relationship.nonComparableReason
                case final String reason) ...<Widget>[
              const SizedBox(height: DialektikSpacing.space3),
              Text(reason),
            ],
          ],
        ),
      ),
    );
  }
}
