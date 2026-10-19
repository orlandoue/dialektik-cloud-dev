// dialektik: epistemic-component
import 'package:dialektik/design_system/design_system.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/localization/consumer_strings.dart';
import 'package:flutter/material.dart';

final class ClaimRow extends StatelessWidget {
  const ClaimRow({
    required this.assertion,
    required this.onOpenArticle,
    required this.onOpenSource,
    super.key,
  });

  final PublicAssertionDto assertion;
  final ValueChanged<Uri> onOpenArticle;
  final ValueChanged<String> onOpenSource;

  @override
  Widget build(BuildContext context) {
    final ConsumerStrings strings = ConsumerStrings.of(context);
    final ClaimSpanDto span = assertion.span;
    final String semanticLabel =
        '${strings.assertionIndex(assertion.ordinalInSpan)}. '
        '${strings.quotationFrom} ${span.article.source.name}. '
        '${span.quotedText}';
    return Semantics(
      container: true,
      label: semanticLabel,
      child: DialektikSurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              strings.assertionIndex(assertion.ordinalInSpan),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: DialektikSpacing.space3),
            Text('${strings.quotationFrom} ${span.article.source.name}'),
            const SizedBox(height: DialektikSpacing.space2),
            SelectableText.rich(
              TextSpan(children: _quoteSpans(context, assertion)),
              semanticsLabel: span.quotedText,
            ),
            if (span.attributionChain.isNotEmpty) ...<Widget>[
              const SizedBox(height: DialektikSpacing.space4),
              Text(strings.attribution),
              for (final AttributionDto attribution in span.attributionChain)
                Text(
                  '${attribution.order}. ${attribution.attributor} · '
                  '${attribution.attributorType}',
                ),
            ],
            if (assertion.isNotEvaluable) ...<Widget>[
              const SizedBox(height: DialektikSpacing.space4),
              Text(assertion.epistemicReason ?? strings.notEvaluable),
            ],
            const SizedBox(height: DialektikSpacing.space4),
            Text(strings.published(span.article.publishedAt)),
            Text(strings.provenanceExplanation),
            const SizedBox(height: DialektikSpacing.space3),
            Wrap(
              spacing: DialektikSpacing.space3,
              runSpacing: DialektikSpacing.space2,
              children: <Widget>[
                TextButton.icon(
                  onPressed: () => onOpenArticle(span.article.urlCanonical),
                  icon: const DialektikIcon(
                    icon: DialektikFunctionalIcon.externalLink,
                    size: DialektikIconSize.small,
                  ),
                  label: Text(strings.openOriginal),
                ),
                TextButton(
                  onPressed: () => onOpenSource(span.article.source.id),
                  child: Text('${strings.source}: ${span.article.source.name}'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  List<InlineSpan> _quoteSpans(
    BuildContext context,
    PublicAssertionDto assertion,
  ) {
    final String text = assertion.span.quotedText;
    final List<HighlightRangeDto> ranges =
        assertion.span.highlightRanges
            .where(
              (HighlightRangeDto range) =>
                  range.assertionId == assertion.id &&
                  range.start < text.length &&
                  range.end <= text.length,
            )
            .toList()
          ..sort(
            (HighlightRangeDto left, HighlightRangeDto right) =>
                left.start.compareTo(right.start),
          );
    if (ranges.isEmpty) return <InlineSpan>[TextSpan(text: '“$text”')];
    final List<InlineSpan> spans = <InlineSpan>[const TextSpan(text: '“')];
    var cursor = 0;
    for (final HighlightRangeDto range in ranges) {
      if (range.start < cursor) continue;
      if (range.start > cursor) {
        spans.add(TextSpan(text: text.substring(cursor, range.start)));
      }
      spans.add(
        TextSpan(
          text: text.substring(range.start, range.end),
          style: TextStyle(backgroundColor: context.epistemicColors.mark),
        ),
      );
      cursor = range.end;
    }
    if (cursor < text.length) spans.add(TextSpan(text: text.substring(cursor)));
    spans.add(const TextSpan(text: '”'));
    return spans;
  }
}
