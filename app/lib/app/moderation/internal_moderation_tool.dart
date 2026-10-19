import 'package:dialektik/design_system/components/dialektik_surface.dart';
import 'package:dialektik/design_system/components/equivalence_proposal_review_card.dart';
import 'package:dialektik/design_system/components/equivalence_queue_card.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/foundations/spacing.dart';
import 'package:dialektik/design_system/theme/dialektik_theme.dart';
import 'package:dialektik/design_system/theme/dialektik_theme_extensions.dart';
import 'package:flutter/material.dart';

// dialektik:epistemic-component

/// Commands that Core has advertised for the current response.
///
/// These values control presentation only. They are not authorization and
/// Core must authenticate and authorize every resulting command again.
enum VisibleModerationCommand {
  claim,
  release,
  escalate,
  submitProposal,
  confirmProposal,
  refuseProposal,
}

@immutable
class ModerationProposalPresentation {
  const ModerationProposalPresentation({
    required this.proposalId,
    required this.outcome,
    required this.phase,
    required this.proposerId,
    required this.members,
  });

  final String proposalId;
  final EquivalenceProposalOutcome outcome;
  final ReviewProposalPhase phase;
  final String proposerId;
  final List<EquivalenceProposalMember> members;
}

@immutable
class ModerationReviewPresentation {
  const ModerationReviewPresentation({
    required this.taskId,
    required this.candidateClassId,
    required this.eventTitle,
    required this.taskStateLabel,
    required this.isCurrentSnapshot,
    required this.assertions,
    required this.similarityMatrix,
    required this.proposals,
    required this.visibleCommands,
  });

  final String taskId;
  final String candidateClassId;
  final String eventTitle;
  final String taskStateLabel;
  final bool isCurrentSnapshot;
  final List<EquivalenceCandidateAssertion> assertions;
  final List<EquivalenceSimilarityPair> similarityMatrix;
  final List<ModerationProposalPresentation> proposals;
  final Set<VisibleModerationCommand> visibleCommands;
}

/// Transport-neutral command boundary owned by the application composition.
///
/// The UI deliberately supplies no role, bearer token, idempotency identity,
/// audit metadata or authoritative state. A Core adapter adds transport data;
/// Core remains the only authority for every command.
abstract interface class ModerationIntentSink {
  void claimTask(String taskId);

  void releaseTask(String taskId);

  void escalateTask(String taskId);

  void submitAcceptSubset(String taskId, Set<String> assertionIds);

  void submitSplit(String taskId, List<Set<String>> partitions);

  void confirmProposal(String taskId, String proposalId);

  void refuseProposal(String taskId, String proposalId, String reason);
}

/// Mountable Phase-6 internal interaction surface for a Core-provided task.
class InternalModerationTool extends StatelessWidget {
  const InternalModerationTool({
    required this.review,
    required this.intentSink,
    super.key,
  });

  final ModerationReviewPresentation review;
  final ModerationIntentSink intentSink;

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
              return SelectionArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(
                    vertical: DialektikSpacing.space6,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      _buildTaskHeader(context),
                      const SizedBox(height: DialektikSpacing.space6),
                      EquivalenceQueueCard(
                        candidateClassId: review.candidateClassId,
                        assertions: review.assertions,
                        similarityMatrix: review.similarityMatrix,
                        onAcceptSubset: (Set<String> assertionIds) {
                          intentSink.submitAcceptSubset(
                            review.taskId,
                            assertionIds,
                          );
                        },
                        onSplit: (List<Set<String>> partitions) {
                          intentSink.submitSplit(review.taskId, partitions);
                        },
                        submissionEnabled:
                            review.isCurrentSnapshot &&
                            review.visibleCommands.contains(
                              VisibleModerationCommand.submitProposal,
                            ),
                      ),
                      if (review.proposals.isNotEmpty) ...<Widget>[
                        const SizedBox(height: DialektikSpacing.space6),
                        ..._buildProposals(),
                      ],
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildTaskHeader(BuildContext context) {
    return DialektikSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Internal equivalence moderation',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: DialektikSpacing.space2),
          Text(review.eventTitle),
          Text(
            'Task ${review.taskId} · ${review.taskStateLabel}',
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: context.surfaceColors.muted),
          ),
          const SizedBox(height: DialektikSpacing.space4),
          Wrap(
            spacing: DialektikSpacing.space4,
            runSpacing: DialektikSpacing.space4,
            children: <Widget>[
              if (review.visibleCommands.contains(
                VisibleModerationCommand.claim,
              ))
                _taskButton(
                  label: 'Claim task',
                  onPressed: () => intentSink.claimTask(review.taskId),
                ),
              if (review.visibleCommands.contains(
                VisibleModerationCommand.release,
              ))
                _taskButton(
                  label: 'Release task',
                  onPressed: () => intentSink.releaseTask(review.taskId),
                ),
              if (review.visibleCommands.contains(
                VisibleModerationCommand.escalate,
              ))
                _taskButton(
                  label: 'Escalate task',
                  onPressed: () => intentSink.escalateTask(review.taskId),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Iterable<Widget> _buildProposals() sync* {
    for (final ModerationProposalPresentation proposal in review.proposals) {
      final bool isSubmitted = proposal.phase == ReviewProposalPhase.submitted;
      yield EquivalenceProposalReviewCard(
        proposalId: proposal.proposalId,
        outcome: proposal.outcome,
        phase: proposal.phase,
        proposerId: proposal.proposerId,
        members: proposal.members,
        onConfirm:
            isSubmitted &&
                review.visibleCommands.contains(
                  VisibleModerationCommand.confirmProposal,
                )
            ? () =>
                  intentSink.confirmProposal(review.taskId, proposal.proposalId)
            : null,
        onRefuse:
            isSubmitted &&
                review.visibleCommands.contains(
                  VisibleModerationCommand.refuseProposal,
                )
            ? (String reason) => intentSink.refuseProposal(
                review.taskId,
                proposal.proposalId,
                reason,
              )
            : null,
      );
      yield const SizedBox(height: DialektikSpacing.space6);
    }
  }

  Widget _taskButton({required String label, required VoidCallback onPressed}) {
    return ConstrainedBox(
      constraints: const BoxConstraints(
        minHeight: DialektikSizing.touchMinimum,
        minWidth: 160,
      ),
      child: OutlinedButton(onPressed: onPressed, child: Text(label)),
    );
  }
}
