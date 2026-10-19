import 'package:dialektik/app/moderation/internal_moderation_tool.dart';
import 'package:dialektik/design_system/components/equivalence_proposal_review_card.dart';
import 'package:dialektik/design_system/components/equivalence_queue_card.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_app.dart';

class RecordingIntentSink implements ModerationIntentSink {
  String? claimedTaskId;
  ({String taskId, Set<String> assertionIds})? acceptedSubset;
  ({String taskId, String proposalId})? confirmedProposal;
  ({String taskId, String proposalId, String reason})? refusedProposal;

  @override
  void claimTask(String taskId) {
    claimedTaskId = taskId;
  }

  @override
  void confirmProposal(String taskId, String proposalId) {
    confirmedProposal = (taskId: taskId, proposalId: proposalId);
  }

  @override
  void escalateTask(String taskId) {}

  @override
  void refuseProposal(String taskId, String proposalId, String reason) {
    refusedProposal = (taskId: taskId, proposalId: proposalId, reason: reason);
  }

  @override
  void releaseTask(String taskId) {}

  @override
  void submitAcceptSubset(String taskId, Set<String> assertionIds) {
    acceptedSubset = (taskId: taskId, assertionIds: assertionIds);
  }

  @override
  void submitSplit(String taskId, List<Set<String>> partitions) {}
}

const List<EquivalenceCandidateAssertion> assertions =
    <EquivalenceCandidateAssertion>[
      EquivalenceCandidateAssertion(
        id: 'assertion-a',
        sourceName: 'Source Alpha',
        quotedText: 'The reference rate fell.',
        normalizedInterpretation: 'reference rate decreased',
        comparisonBase: 'annual rate',
        attributionChain: <String>['Central bank'],
      ),
      EquivalenceCandidateAssertion(
        id: 'assertion-b',
        sourceName: 'Source Beta',
        quotedText: 'The central bank lowered its reference rate.',
        normalizedInterpretation: 'reference rate decreased',
        comparisonBase: 'annual rate',
        attributionChain: <String>[],
      ),
      EquivalenceCandidateAssertion(
        id: 'assertion-c',
        sourceName: 'Source Gamma',
        quotedText: 'The monthly lending rate fell.',
        normalizedInterpretation: 'lending rate decreased',
        comparisonBase: 'monthly rate',
        attributionChain: <String>[],
      ),
    ];

ModerationReviewPresentation review({
  Set<VisibleModerationCommand> visibleCommands =
      const <VisibleModerationCommand>{
        VisibleModerationCommand.claim,
        VisibleModerationCommand.submitProposal,
        VisibleModerationCommand.confirmProposal,
        VisibleModerationCommand.refuseProposal,
      },
}) {
  return ModerationReviewPresentation(
    taskId: 'task-1',
    candidateClassId: 'candidate-1',
    eventTitle: 'Central bank rate decision',
    taskStateLabel: 'pending',
    isCurrentSnapshot: true,
    assertions: assertions,
    similarityMatrix: const <EquivalenceSimilarityPair>[
      EquivalenceSimilarityPair(
        assertionAId: 'assertion-a',
        assertionBId: 'assertion-b',
        similarity: 0.97,
      ),
    ],
    proposals: const <ModerationProposalPresentation>[
      ModerationProposalPresentation(
        proposalId: 'proposal-1',
        outcome: EquivalenceProposalOutcome.acceptSubset,
        phase: ReviewProposalPhase.submitted,
        proposerId: 'moderator-1',
        members: <EquivalenceProposalMember>[
          EquivalenceProposalMember(
            assertionId: 'assertion-a',
            sourceName: 'Source Alpha',
            quotedText: 'The reference rate fell.',
          ),
          EquivalenceProposalMember(
            assertionId: 'assertion-b',
            sourceName: 'Source Beta',
            quotedText: 'The central bank lowered its reference rate.',
          ),
        ],
      ),
    ],
    visibleCommands: visibleCommands,
  );
}

Widget fixture(
  RecordingIntentSink sink, {
  Set<VisibleModerationCommand>? visibleCommands,
  double textScale = 1,
}) {
  return testApp(
    textScale: textScale,
    child: InternalModerationTool(
      review: review(
        visibleCommands:
            visibleCommands ??
            const <VisibleModerationCommand>{
              VisibleModerationCommand.claim,
              VisibleModerationCommand.submitProposal,
              VisibleModerationCommand.confirmProposal,
              VisibleModerationCommand.refuseProposal,
            },
      ),
      intentSink: sink,
    ),
  );
}

void main() {
  testWidgets('mounts the dual-control workflow and delegates only intents', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 1800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final RecordingIntentSink sink = RecordingIntentSink();
    await tester.pumpWidget(fixture(sink));

    await tester.tap(find.widgetWithText(OutlinedButton, 'Claim task'));
    expect(sink.claimedTaskId, 'task-1');

    await tester.tap(find.byType(Checkbox).at(0));
    await tester.tap(find.byType(Checkbox).at(1));
    await tester.pump();
    await tester.tap(
      find.widgetWithText(OutlinedButton, 'Propose accept-subset'),
    );
    expect(sink.acceptedSubset?.taskId, 'task-1');
    expect(sink.acceptedSubset?.assertionIds, <String>{
      'assertion-a',
      'assertion-b',
    });

    await tester.tap(find.widgetWithText(OutlinedButton, 'Confirm proposal'));
    expect(sink.confirmedProposal?.proposalId, 'proposal-1');

    await tester.enterText(find.byType(TextField), 'Requires correction');
    await tester.pump();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Refuse proposal'));
    expect(sink.refusedProposal?.reason, 'Requires correction');
    expect(find.textContaining('Reject'), findsNothing);
  });

  testWidgets('visible commands never invent client-side authority', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final RecordingIntentSink sink = RecordingIntentSink();
    await tester.pumpWidget(
      fixture(sink, visibleCommands: const <VisibleModerationCommand>{}),
    );

    expect(find.text('Claim task'), findsNothing);
    expect(find.text('Release task'), findsNothing);
    expect(find.text('Escalate task'), findsNothing);
    expect(find.byType(Checkbox), findsNWidgets(3));
    expect(
      tester.widget<Checkbox>(find.byType(Checkbox).first).onChanged,
      isNull,
    );
    expect(find.text('Confirm proposal'), findsNothing);
    expect(find.text('Refuse proposal'), findsNothing);
  });

  testWidgets('guards narrow widths and survives 200 percent text', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(900, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final RecordingIntentSink sink = RecordingIntentSink();
    await tester.pumpWidget(fixture(sink));
    expect(find.textContaining('Available on desktop widths'), findsOneWidget);

    await tester.binding.setSurfaceSize(const Size(1200, 2400));
    await tester.pumpWidget(fixture(sink, textScale: 2));
    expect(find.text('Internal equivalence moderation'), findsOneWidget);
    expect(tester.takeException(), isNull);
    expect(
      tester.getSize(find.widgetWithText(OutlinedButton, 'Claim task')).height,
      greaterThanOrEqualTo(DialektikSizing.touchMinimum),
    );
  });
}
