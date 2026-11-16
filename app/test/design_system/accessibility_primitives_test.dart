import 'package:dialektik/core/accessibility/accessible_action.dart';
import 'package:dialektik/core/accessibility/dialektik_semantics.dart';
import 'package:dialektik/design_system/components/dialektik_surface.dart';
import 'package:dialektik/design_system/components/operational_notice.dart';
import 'package:dialektik/design_system/foundations/sizing.dart';
import 'package:dialektik/design_system/foundations/spacing.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/test_app.dart';

void main() {
  testWidgets(
    'custom actions meet target, semantics, focus, and keyboard rules',
    (WidgetTester tester) async {
      var activationCount = 0;
      final SemanticsHandle semantics = tester.ensureSemantics();

      await tester.pumpWidget(
        testApp(
          child: Align(
            alignment: Alignment.topLeft,
            child: AccessibleAction(
              semanticLabel: 'Run accessible action',
              onActivate: () => activationCount += 1,
              child: const Text('Run'),
            ),
          ),
        ),
      );

      final Size size = tester.getSize(find.byType(AccessibleAction));
      expect(size.width, greaterThanOrEqualTo(DialektikSizing.touchMinimum));
      expect(size.height, greaterThanOrEqualTo(DialektikSizing.touchMinimum));
      expect(find.bySemanticsLabel('Run accessible action'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(FocusManager.instance.primaryFocus, isNotNull);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(activationCount, 1);
      semantics.dispose();
    },
  );

  testWidgets('semantic labels replace ambiguous child semantics', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      testApp(
        child: const DialektikSemanticLabel(
          label: 'Explicit accessible label',
          child: Text('Visual shorthand'),
        ),
      ),
    );

    expect(find.bySemanticsLabel('Explicit accessible label'), findsOneWidget);
    expect(find.bySemanticsLabel('Visual shorthand'), findsNothing);
    semantics.dispose();
  });

  testWidgets('operational notices provide icon, text, and semantic status', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      testApp(
        child: const OperationalNotice(
          kind: OperationalNoticeKind.error,
          message: 'Network request failed.',
        ),
      ),
    );

    expect(find.text('Error · Network request failed.'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Error: Network request failed.'),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('foundation text remains available at 200 percent scaling', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      testApp(
        textScale: 2,
        child: const SizedBox(
          width: DialektikSizing.baseViewport,
          child: SingleChildScrollView(child: _ScalingFixture()),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    expect(find.textContaining('scales without truncation'), findsOneWidget);
  });
}

class _ScalingFixture extends StatelessWidget {
  const _ScalingFixture();

  @override
  Widget build(BuildContext context) {
    return const DialektikSurface(
      child: Padding(
        padding: EdgeInsets.all(DialektikSpacing.space4),
        child: Text(
          'Foundation content scales without truncation or a fixed text box.',
        ),
      ),
    );
  }
}
