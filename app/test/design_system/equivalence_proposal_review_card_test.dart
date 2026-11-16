import 'package:dialektik/design_system/components/equivalence_proposal_review_card.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_app.dart';

const List<EquivalenceProposalMember> members = <EquivalenceProposalMember>[
  EquivalenceProposalMember(
    assertionId: 'assertion-a',
    sourceName: 'Source Alpha',
    quotedText: 'The reference rate fell.',
    partitionOrdinal: 0,
  ),
  EquivalenceProposalMember(
    assertionId: 'assertion-b',
    sourceName: 'Source Beta',
    quotedText: 'The central bank lowered its reference rate.',
    partitionOrdinal: 1,
  ),
];

Widget fixture({
  required EquivalenceProposalOutcome outcome,
  required ReviewProposalPhase phase,
  VoidCallback? onConfirm,
  RefuseEquivalenceProposal? onRefuse,
  double textScale = 1,
}) {
  return testApp(
    textScale: textScale,
    child: SingleChildScrollView(
      child: EquivalenceProposalReviewCard(
        proposalId: 'proposal-1',
        outcome: outcome,
        phase: phase,
        proposerId: 'moderator-1',
        members: members,
        onConfirm: onConfirm,
        onRefuse: onRefuse,
      ),
    ),
  );
}

void main() {
  testWidgets('renders exact split groups without implying equivalence', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      fixture(
        outcome: EquivalenceProposalOutcome.split,
        phase: ReviewProposalPhase.submitted,
      ),
    );

    expect(find.text('Partition 1'), findsOneWidget);
    expect(find.text('Partition 2'), findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp('Selected assertion from Source Alpha')),
      findsOneWidget,
    );
    expect(find.textContaining('equivalent'), findsNothing);
    expect(find.textContaining('Reject'), findsNothing);
    semantics.dispose();
  });

  testWidgets('confirm and refuse express immutable proposal intents', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var confirmationCount = 0;
    String? refusalReason;
    await tester.pumpWidget(
      fixture(
        outcome: EquivalenceProposalOutcome.acceptSubset,
        phase: ReviewProposalPhase.submitted,
        onConfirm: () => confirmationCount += 1,
        onRefuse: (String reason) => refusalReason = reason,
      ),
    );

    final Finder confirmButton = find.widgetWithText(
      OutlinedButton,
      'Confirm proposal',
    );
    final Finder refuseButton = find.widgetWithText(
      OutlinedButton,
      'Refuse proposal',
    );
    expect(tester.widget<OutlinedButton>(confirmButton).onPressed, isNotNull);
    expect(tester.widget<OutlinedButton>(refuseButton).onPressed, isNull);
    expect(tester.getSize(confirmButton), tester.getSize(refuseButton));
    expect(
      tester.getSize(confirmButton).height,
      greaterThanOrEqualTo(DialektikSizing.touchMinimum),
    );

    await tester.tap(confirmButton);
    expect(confirmationCount, 1);
    await tester.enterText(find.byType(TextField), '  Needs another review  ');
    await tester.pump();
    await tester.tap(refuseButton);
    expect(refusalReason, 'Needs another review');
  });

  testWidgets('terminal proposal is read-only and survives 200 percent text', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      fixture(
        outcome: EquivalenceProposalOutcome.acceptSubset,
        phase: ReviewProposalPhase.confirmed,
        onConfirm: () {},
        onRefuse: (String reason) {},
        textScale: 2,
      ),
    );

    expect(find.textContaining('Confirmed by an editor'), findsOneWidget);
    expect(find.text('Confirm proposal'), findsNothing);
    expect(find.text('Refuse proposal'), findsNothing);
    expect(find.byType(TextField), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
