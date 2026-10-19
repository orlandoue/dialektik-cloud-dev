import 'package:dialektik/design_system/components/equivalence_queue_card.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_app.dart';

const List<EquivalenceCandidateAssertion> assertions =
    <EquivalenceCandidateAssertion>[
      EquivalenceCandidateAssertion(
        id: 'assertion-a',
        sourceName: 'Source Alpha',
        quotedText: 'The reference rate fell.',
        normalizedInterpretation: 'reference rate decreased',
        comparisonBase: 'annual rate',
        attributionChain: <String>['Source Alpha', 'Central bank'],
      ),
      EquivalenceCandidateAssertion(
        id: 'assertion-b',
        sourceName: 'Source Beta',
        quotedText: 'The central bank lowered its reference rate.',
        normalizedInterpretation: 'reference rate decreased',
        comparisonBase: 'annual rate',
        attributionChain: <String>['Source Beta'],
      ),
      EquivalenceCandidateAssertion(
        id: 'assertion-c',
        sourceName: 'Source Gamma',
        quotedText: 'A monthly lending rate fell.',
        normalizedInterpretation: 'lending rate decreased',
        comparisonBase: 'monthly rate',
        attributionChain: <String>[],
      ),
    ];

const List<EquivalenceSimilarityPair> matrix = <EquivalenceSimilarityPair>[
  EquivalenceSimilarityPair(
    assertionAId: 'assertion-a',
    assertionBId: 'assertion-b',
    similarity: 0.97,
  ),
  EquivalenceSimilarityPair(
    assertionAId: 'assertion-a',
    assertionBId: 'assertion-c',
    similarity: 0.71,
  ),
];

Widget fixture({
  required AcceptEquivalenceSubset onAccept,
  required SplitEquivalenceClass onSplit,
  bool submissionEnabled = true,
  double textScale = 1,
}) {
  return testApp(
    textScale: textScale,
    child: SingleChildScrollView(
      child: EquivalenceQueueCard(
        candidateClassId: 'candidate-1',
        assertions: assertions,
        similarityMatrix: matrix,
        onAcceptSubset: onAccept,
        onSplit: onSplit,
        submissionEnabled: submissionEnabled,
      ),
    ),
  );
}

void main() {
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  testWidgets('starts empty and gives accept and split equal action weight', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(
      const Size(DialektikSizing.moderationMinimum + 176, 900),
    );
    addTearDown(() => tester.binding.setSurfaceSize(null));
    Set<String>? accepted;
    List<Set<String>>? split;
    await tester.pumpWidget(
      fixture(
        onAccept: (Set<String> value) => accepted = value,
        onSplit: (List<Set<String>> value) => split = value,
      ),
    );

    final Iterable<Checkbox> initialCheckboxes = tester.widgetList<Checkbox>(
      find.byType(Checkbox),
    );
    expect(initialCheckboxes, hasLength(3));
    expect(
      initialCheckboxes.every((Checkbox box) => box.value == false),
      isTrue,
    );
    final Finder acceptButton = find.widgetWithText(
      OutlinedButton,
      'Propose accept-subset',
    );
    final Finder splitButton = find.widgetWithText(
      OutlinedButton,
      'Propose split',
    );
    expect(tester.widget<OutlinedButton>(acceptButton).onPressed, isNull);
    expect(tester.widget<OutlinedButton>(splitButton).onPressed, isNull);
    expect(tester.getSize(acceptButton), tester.getSize(splitButton));
    expect(
      tester.getSize(acceptButton).height,
      greaterThanOrEqualTo(DialektikSizing.touchMinimum),
    );

    await tester.tap(find.byType(Checkbox).at(0));
    await tester.pump();
    expect(tester.widget<OutlinedButton>(splitButton).onPressed, isNotNull);
    await tester.tap(splitButton);
    expect(split?[0], <String>{'assertion-a'});
    expect(split?[1], <String>{'assertion-b', 'assertion-c'});

    await tester.tap(find.byType(Checkbox).at(1));
    await tester.pump();
    await tester.tap(acceptButton);
    expect(accepted, <String>{'assertion-a', 'assertion-b'});
  });

  testWidgets('exposes grounded semantics and no candidate rejection action', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      fixture(
        onAccept: (Set<String> value) {},
        onSplit: (List<Set<String>> value) {},
      ),
    );

    expect(
      find.bySemanticsLabel(
        'Assertion from Source Alpha; comparison base annual rate',
      ),
      findsOneWidget,
    );
    expect(
      find.textContaining('Interpretation (not a source quote)'),
      findsNWidgets(3),
    );
    expect(find.textContaining('Reject candidate'), findsNothing);
    expect(find.byType(TextField), findsNothing);
    semantics.dispose();
  });

  testWidgets('server presentation hint disables selection and submission', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      fixture(
        onAccept: (Set<String> value) {},
        onSplit: (List<Set<String>> value) {},
        submissionEnabled: false,
      ),
    );

    expect(
      tester.widget<Checkbox>(find.byType(Checkbox).first).onChanged,
      isNull,
    );
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Propose accept-subset'),
          )
          .onPressed,
      isNull,
    );
  });

  testWidgets('guards smaller viewports and survives 200 percent text', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(900, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      fixture(
        onAccept: (Set<String> value) {},
        onSplit: (List<Set<String>> value) {},
      ),
    );
    expect(find.textContaining('Available on desktop widths'), findsOneWidget);
    expect(find.byType(Checkbox), findsNothing);

    await tester.binding.setSurfaceSize(const Size(1200, 1400));
    await tester.pumpWidget(
      fixture(
        textScale: 2,
        onAccept: (Set<String> value) {},
        onSplit: (List<Set<String>> value) {},
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Equivalence review'), findsOneWidget);
  });
}
