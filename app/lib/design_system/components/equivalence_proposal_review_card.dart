import 'package:dialektik/design_system/components/dialektik_surface.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/foundations/spacing.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

enum EquivalenceProposalOutcome { acceptSubset, split }

enum ReviewProposalPhase { submitted, confirmed, refused }

@immutable
class EquivalenceProposalMember {
  const EquivalenceProposalMember({
    required this.assertionId,
    required this.sourceName,
    required this.quotedText,
    this.partitionOrdinal,
  });

  final String assertionId;
  final String sourceName;
  final String quotedText;
  final int? partitionOrdinal;
}

typedef RefuseEquivalenceProposal = void Function(String reason);

/// Internal editor review for one immutable moderator proposal.
///
/// Confirm and refuse callbacks express intent only. The widget cannot change
/// proposal payloads and does not decide identity, authority or currentness.
class EquivalenceProposalReviewCard extends StatefulWidget {
  const EquivalenceProposalReviewCard({
    required this.proposalId,
    required this.outcome,
    required this.phase,
    required this.proposerId,
    required this.members,
    this.onConfirm,
    this.onRefuse,
    super.key,
  });

  final String proposalId;
  final EquivalenceProposalOutcome outcome;
  final ReviewProposalPhase phase;
  final String proposerId;
  final List<EquivalenceProposalMember> members;
  final VoidCallback? onConfirm;
  final RefuseEquivalenceProposal? onRefuse;

  @override
  State<EquivalenceProposalReviewCard> createState() =>
      _EquivalenceProposalReviewCardState();
}

class _EquivalenceProposalReviewCardState
    extends State<EquivalenceProposalReviewCard> {
  static const double _actionWidth = 260;
  static const int _maximumReasonLength = 500;
  final TextEditingController _reasonController = TextEditingController();

  bool get _canRefuse =>
      widget.phase == ReviewProposalPhase.submitted &&
      widget.onRefuse != null &&
      _reasonController.text.trim().isNotEmpty;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String outcomeLabel = switch (widget.outcome) {
      EquivalenceProposalOutcome.acceptSubset => 'Accept-subset proposal',
      EquivalenceProposalOutcome.split => 'Split proposal',
    };
    final String phaseLabel = switch (widget.phase) {
      ReviewProposalPhase.submitted => 'Submitted for editor review',
      ReviewProposalPhase.confirmed => 'Confirmed by an editor',
      ReviewProposalPhase.refused => 'Refused by an editor',
    };

    return Theme(
      data: DialektikTheme.nocturne(loadInterFromDependency: false),
      child: Builder(
        builder: (BuildContext context) {
          return DialektikSurface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  outcomeLabel,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: DialektikSpacing.space2),
                Text(
                  'Proposal ${widget.proposalId} · $phaseLabel',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: context.surfaceColors.muted,
                  ),
                ),
                const SizedBox(height: DialektikSpacing.space2),
                Text('Proposed by ${widget.proposerId}'),
                const SizedBox(height: DialektikSpacing.space6),
                ..._buildMembers(context),
                if (widget.phase == ReviewProposalPhase.submitted &&
                    (widget.onConfirm != null ||
                        widget.onRefuse != null)) ...<Widget>[
                  const SizedBox(height: DialektikSpacing.space6),
                  _buildDecisionActions(),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  List<Widget> _buildMembers(BuildContext context) {
    if (widget.outcome == EquivalenceProposalOutcome.acceptSubset) {
      return <Widget>[
        Text(
          'Explicit selected subset',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: DialektikSpacing.space2),
        ...widget.members.map(_buildMember),
      ];
    }

    final List<int> ordinals =
        widget.members
            .map((EquivalenceProposalMember member) => member.partitionOrdinal)
            .whereType<int>()
            .toSet()
            .toList()
          ..sort();
    return ordinals
        .expand((int ordinal) {
          final Iterable<EquivalenceProposalMember> members = widget.members
              .where(
                (EquivalenceProposalMember member) =>
                    member.partitionOrdinal == ordinal,
              );
          return <Widget>[
            Text(
              'Partition ${ordinal + 1}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: DialektikSpacing.space2),
            ...members.map(_buildMember),
            const SizedBox(height: DialektikSpacing.space4),
          ];
        })
        .toList(growable: false);
  }

  Widget _buildMember(EquivalenceProposalMember member) {
    return Semantics(
      container: true,
      label: 'Selected assertion from ${member.sourceName}',
      child: Padding(
        padding: const EdgeInsets.only(bottom: DialektikSpacing.space3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(member.quotedText),
            Text('Source: ${member.sourceName}'),
            Text('Assertion: ${member.assertionId}'),
          ],
        ),
      ),
    );
  }

  Widget _buildDecisionActions() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (widget.onRefuse != null) ...<Widget>[
          TextField(
            controller: _reasonController,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              labelText: 'Reason for refusing this proposal',
            ),
            maxLength: _maximumReasonLength,
            minLines: 2,
            maxLines: 4,
            onChanged: (String value) => setState(() {}),
          ),
          const SizedBox(height: DialektikSpacing.space3),
        ],
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
                  onPressed: widget.phase == ReviewProposalPhase.submitted
                      ? widget.onConfirm
                      : null,
                  child: const Text('Confirm proposal'),
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
                  onPressed: _canRefuse
                      ? () => widget.onRefuse!(_reasonController.text.trim())
                      : null,
                  child: const Text('Refuse proposal'),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
