import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../arena/arena_fixtures.dart';
import 'science_fixtures.dart';

Future<void> _openUsage(WidgetTester tester, DatabaseSize? size) async {
  final FakeScienceRepository science = FakeScienceRepository(
    scienceAccess: const ScienceAccess(enabled: true, moderator: true),
  )..database = size;
  await pumpArena(
    tester,
    ArenaScienceCore(science: science),
    initialTab: ArenaTab.perfil,
  );
  final Finder open = find.byKey(const Key('arena-open-science-moderation'));
  await tester.scrollUntilVisible(
    open,
    300,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
  await tester.tap(open);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('sci-mod-tab-usage')));
  await tester.pumpAndSettle();
}

void main() {
  test('Core\'s database size is read, and missing in older Cores', () {
    final ApiUsage usage = ApiUsage.fromJson(<String, dynamic>{
      'days': <Object?>[],
      'harvest': null,
      'database': <String, dynamic>{
        'size_mb': 455.2,
        'limit_mb': 500,
        'warning': true,
        'largest_tables': <Object?>[
          <String, dynamic>{
            'name': 'live_acquisition_receipts',
            'size_mb': 310,
          },
        ],
      },
    });
    expect(usage.database!.sizeMb, 455.2);
    expect(usage.database!.warning, isTrue);
    expect(
      usage.database!.largestTables.single.$1,
      'live_acquisition_receipts',
    );
    expect(
      ApiUsage.fromJson(<String, dynamic>{'days': <Object?>[]}).database,
      isNull,
    );
  });

  testWidgets(
    'moderation shows the database size without a warning below 450 MB',
    (WidgetTester tester) async {
      await _openUsage(
        tester,
        const DatabaseSize(
          sizeMb: 430.6,
          largestTables: <(String, double)>[('live_acquisition_receipts', 310)],
        ),
      );
      expect(find.text('Base de datos: 430,6 MB de 500,0 MB'), findsOneWidget);
      expect(
        find.textContaining('live_acquisition_receipts 310,0 MB'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('sci-mod-database-warning')), findsNothing);
    },
  );

  testWidgets('from 450 MB the warning is visible', (
    WidgetTester tester,
  ) async {
    await _openUsage(tester, const DatabaseSize(sizeMb: 452.1, warning: true));
    expect(find.text('Base de datos: 452,1 MB de 500,0 MB'), findsOneWidget);
    expect(find.byKey(const Key('sci-mod-database-warning')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an older Core without the size shows nothing new', (
    WidgetTester tester,
  ) async {
    await _openUsage(tester, null);
    expect(find.byKey(const Key('sci-mod-database')), findsNothing);
  });
}
