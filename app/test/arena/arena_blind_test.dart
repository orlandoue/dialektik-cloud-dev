// Phase 4: reading blind for real, and no outlet gets the first place or a
// bigger picture by default.
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

void main() {
  test(
    'the order of the versions is a fair coin, stable per reader and case',
    () {
      expect(arenaCoinFlip('ana@x.cl:E1'), arenaCoinFlip('ana@x.cl:E1'));
      final int heads = <bool>[
        for (int i = 0; i < 400; i++) arenaCoinFlip('reader$i:E1'),
      ].where((bool h) => h).length;
      expect(heads, inInclusiveRange(160, 240), reason: 'about half each way');
    },
  );

  testWidgets('«Leer siempre a ciegas» hides the outlets in the VS list', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFullCore(), initialTab: ArenaTab.perfil);
    final Finder toggle = find.byKey(const Key('arena-always-blind'));
    await tester.scrollUntilVisible(
      toggle,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(toggle);
    await tester.pumpAndSettle();

    final Finder bar = find.byKey(const Key('arena-bottom-navigation'));
    await tester.tap(find.descendant(of: bar, matching: find.text('Duelos')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Versión A: '), findsWidgets);
    expect(find.textContaining('La Tercera: '), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
