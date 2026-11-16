// dialektik: epistemic-component
import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:dialektik/features/consumer/presentation/widgets/claim_row.dart';
import 'package:flutter/material.dart';

final class PositionCard extends StatelessWidget {
  const PositionCard({
    required this.position,
    required this.expanded,
    required this.loading,
    required this.failed,
    required this.detail,
    required this.onToggle,
    required this.onRetry,
    required this.onOpenArticle,
    required this.onOpenSource,
    super.key,
  });

  final PositionListItemDto position;
  final bool expanded;
  final bool loading;
  final bool failed;
  final PositionDetailDto? detail;
  final VoidCallback onToggle;
  final VoidCallback onRetry;
  final ValueChanged<Uri> onOpenArticle;
  final ValueChanged<String> onOpenSource;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return DialektikSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(strings.positionIndex(position.ordinal, position.total)),
          const SizedBox(height: DialektikSpacing.space2),
          Text(position.title, style: Theme.of(context).textTheme.titleLarge),
          if (position.evidenceAbsence
              case final EvidenceAbsence absence) ...<Widget>[
            const SizedBox(height: DialektikSpacing.space3),
            Text(
              absence == EvidenceAbsence.noEvidenceYet
                  ? strings.noEvidenceYet
                  : strings.evidenceInconclusive,
            ),
            if (position.evidenceAbsenceReason case final String reason)
              Text(reason),
          ],
          const SizedBox(height: DialektikSpacing.space3),
          TextButton(
            onPressed: onToggle,
            child: Text(
              expanded ? strings.collapsePosition : strings.expandPosition,
            ),
          ),
          if (expanded) ...<Widget>[
            const SizedBox(height: DialektikSpacing.space4),
            if (loading)
              const Center(child: CircularProgressIndicator(strokeWidth: 2))
            else if (failed)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(strings.positionDetailError),
                  TextButton(onPressed: onRetry, child: Text(strings.retry)),
                ],
              )
            else if (detail != null)
              _PositionDetail(
                detail: detail!,
                onOpenArticle: onOpenArticle,
                onOpenSource: onOpenSource,
              ),
          ],
        ],
      ),
    );
  }
}

final class _PositionDetail extends StatelessWidget {
  const _PositionDetail({
    required this.detail,
    required this.onOpenArticle,
    required this.onOpenSource,
  });

  final PositionDetailDto detail;
  final ValueChanged<Uri> onOpenArticle;
  final ValueChanged<String> onOpenSource;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          strings.assertions,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: DialektikSpacing.space3),
        for (
          var index = 0;
          index < detail.assertions.length;
          index += 1
        ) ...<Widget>[
          ClaimRow(
            assertion: detail.assertions[index],
            onOpenArticle: onOpenArticle,
            onOpenSource: onOpenSource,
          ),
          if (index < detail.assertions.length - 1)
            const SizedBox(height: DialektikSpacing.evidenceItemGap),
        ],
      ],
    );
  }
}
