import 'package:dialektik/design_system/components/dialektik_surface.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/foundations/spacing.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

@immutable
class EquivalenceCandidateAssertion {
  const EquivalenceCandidateAssertion({
    required this.id,
    required this.sourceName,
    required this.quotedText,
    required this.normalizedInterpretation,
    required this.comparisonBase,
    required this.attributionChain,
  });

  final String id;
  final String sourceName;
  final String quotedText;
  final String? normalizedInterpretation;
  final String? comparisonBase;
  final List<String> attributionChain;
}

@immutable
class EquivalenceSimilarityPair {
  const EquivalenceSimilarityPair({
    required this.assertionAId,
    required this.assertionBId,
    required this.similarity,
  }) : assert(similarity >= 0 && similarity <= 1);

  final String assertionAId;
  final String assertionBId;
  final double similarity;
}

typedef AcceptEquivalenceSubset = void Function(Set<String> assertionIds);
typedef SplitEquivalenceClass = void Function(List<Set<String>> classes);

/// Internal desktop proposal composer.
///
/// Callbacks express moderator intent only. Core independently authenticates,
/// authorizes, checks currentness and persists an immutable proposal.
class EquivalenceQueueCard extends StatefulWidget {
  const EquivalenceQueueCard({
    required this.candidateClassId,
    required this.assertions,
    required this.similarityMatrix,
    required this.onAcceptSubset,
    required this.onSplit,
    this.submissionEnabled = true,
    super.key,
  }) : assert(assertions.length >= 2);

  final String candidateClassId;
  final List<EquivalenceCandidateAssertion> assertions;
  final List<EquivalenceSimilarityPair> similarityMatrix;
  final AcceptEquivalenceSubset onAcceptSubset;
  final SplitEquivalenceClass onSplit;

  /// A server-derived presentation hint, never an authorization decision.
  final bool submissionEnabled;

  @override
  State<EquivalenceQueueCard> createState() => _EquivalenceQueueCardState();
}

class _EquivalenceQueueCardState extends State<EquivalenceQueueCard> {
  static const double _actionWidth = 260;
  final Set<String> _selectedAssertionIds = <String>{};

  bool get _canAccept =>
      widget.submissionEnabled && _selectedAssertionIds.length >= 2;
  bool get _canSplit =>
      widget.submissionEnabled &&
      _selectedAssertionIds.isNotEmpty &&
      _selectedAssertionIds.length < widget.assertions.length;

  @override
  void didUpdateWidget(covariant EquivalenceQueueCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final Set<String> availableIds = widget.assertions
        .map((EquivalenceCandidateAssertion assertion) => assertion.id)
        .toSet();
    _selectedAssertionIds.removeWhere(
      (String assertionId) => !availableIds.contains(assertionId),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (constraints.maxWidth < DialektikSizing.moderationMinimum) {
          return Semantics(
            container: true,
            label: 'Moderation tool requires a desktop viewport.',
            child: const Center(
              child: Text(
                'Available on desktop widths of 1024 pixels or more.',
              ),
            ),
          );
        }

        return Theme(
          data: DialektikTheme.nocturne(loadInterFromDependency: false),
          child: Builder(
            builder: (BuildContext context) {
              return DialektikSurface(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      'Equivalence review',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: DialektikSpacing.space2),
                    Text(
                      'Candidate ${widget.candidateClassId}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: context.surfaceColors.muted,
                      ),
                    ),
                    const SizedBox(height: DialektikSpacing.space6),
                    ...widget.assertions.map(_buildAssertion),
                    const SizedBox(height: DialektikSpacing.space6),
                    _buildSimilarityMatrix(context),
                    const SizedBox(height: DialektikSpacing.space6),
                    _buildDecisionActions(),
                  ],
                ),
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildAssertion(EquivalenceCandidateAssertion assertion) {
    final String comparisonBase = assertion.comparisonBase ?? 'not specified';
    final String attribution = assertion.attributionChain.isEmpty
        ? 'none recorded'
        : assertion.attributionChain.join(' → ');
    return Semantics(
      container: true,
      label:
          'Assertion from ${assertion.sourceName}; comparison base $comparisonBase',
      child: CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        value: _selectedAssertionIds.contains(assertion.id),
        onChanged: widget.submissionEnabled
            ? (bool? selected) {
                setState(() {
                  if (selected ?? false) {
                    _selectedAssertionIds.add(assertion.id);
                  } else {
                    _selectedAssertionIds.remove(assertion.id);
                  }
                });
              }
            : null,
        title: Text(assertion.quotedText),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: DialektikSpacing.space2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('Source: ${assertion.sourceName}'),
              Text('Comparison base: $comparisonBase'),
              Text('Attribution: $attribution'),
              Text(
                'Interpretation (not a source quote): '
                '${assertion.normalizedInterpretation ?? 'not available'}',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSimilarityMatrix(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          'Internal R01b similarity matrix',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: DialektikSpacing.space2),
        ...widget.similarityMatrix.map(
          (EquivalenceSimilarityPair pair) => Text(
            '${pair.assertionAId} ↔ ${pair.assertionBId}: '
            '${pair.similarity.toStringAsFixed(3)}',
          ),
        ),
      ],
    );
  }

  Widget _buildDecisionActions() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text(
          'A split uses the selected members as one partition and every '
          'remaining member as the other partition.',
        ),
        const SizedBox(height: DialektikSpacing.space3),
        Wrap(
          spacing: DialektikSpacing.space4,
          runSpacing: DialektikSpacing.space4,
          children: <Widget>[
            SizedBox(
              width: _actionWidth,
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                  minHeight: DialektikSizing.touchMinimum,
                ),
                child: OutlinedButton(
                  onPressed: _canAccept
                      ? () => widget.onAcceptSubset(
                          Set<String>.unmodifiable(_selectedAssertionIds),
                        )
                      : null,
                  child: const Text('Propose accept-subset'),
                ),
              ),
            ),
            SizedBox(
              width: _actionWidth,
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                  minHeight: DialektikSizing.touchMinimum,
                ),
                child: OutlinedButton(
                  onPressed: _canSplit
                      ? () {
                          final Set<String> remaining = widget.assertions
                              .map(
                                (EquivalenceCandidateAssertion assertion) =>
                                    assertion.id,
                              )
                              .where(
                                (String assertionId) => !_selectedAssertionIds
                                    .contains(assertionId),
                              )
                              .toSet();
                          widget.onSplit(
                            List<Set<String>>.unmodifiable(<Set<String>>[
                              Set<String>.unmodifiable(_selectedAssertionIds),
                              Set<String>.unmodifiable(remaining),
                            ]),
                          );
                        }
                      : null,
                  child: const Text('Propose split'),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
