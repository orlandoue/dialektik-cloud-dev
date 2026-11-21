// Phase 6 of the audit: anonymous usage statistics. A vote is counted by
// the duel's kind, the place on screen and blindness, never by the version
// or the outlets; the reader can turn it off.
import 'package:dialektik/core/infrastructure/usage_analytics.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';
import 'arena_fixtures.dart';

class RecordingAnalytics implements UsageAnalytics {
  final List<(String, Map<String, Object>?)> events =
      <(String, Map<String, Object>?)>[];
  final List<bool> enabled = <bool>[];

  @override
  Future<void> log(String name, [Map<String, Object>? parameters]) async =>
      events.add((name, parameters));

  @override
  Future<void> screen(String name) async => events.add(('screen:$name', null));

  @override
  Future<void> setEnabled({required bool value}) async => enabled.add(value);
}

void main() {
  late RecordingAnalytics analytics;
  setUp(() => usageAnalytics = analytics = RecordingAnalytics());
  tearDown(() => usageAnalytics = const NoUsageAnalytics());

  test('without its build values Firebase stays off', () {
    expect(firebaseConfigured, isFalse);
  });

  testWidgets('a vote is logged without its version or outlets', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFullCore());
    await tester.tap(find.text(duelTitle).first);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arena-vote-button')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-vote-position-$positionBId')),
    );
    await tester.pumpAndSettle();

    expect(
      analytics.events.map(((String, Object?) e) => e.$1),
      contains('duel_open'),
    );
    final Map<String, Object>? vote = analytics.events
        .firstWhere(((String, Map<String, Object>?) e) => e.$1 == 'duel_vote')
        .$2;
    expect(vote!.keys.toSet(), <String>{'kind', 'shown', 'blind', 'changed'});
    expect(vote['shown'], anyOf('first', 'second'));
    final String all = analytics.events.toString();
    expect(all, isNot(contains(positionBId)));
    expect(all, isNot(contains('BioBio')));
    expect(all, isNot(contains('La Tercera')));
  });

  testWidgets('Ajustes turns the statistics off', (WidgetTester tester) async {
    await pumpArena(tester, ArenaFakeCore(), initialTab: ArenaTab.perfil);
    final Finder toggle = find.byKey(const Key('arena-share-usage'));
    await tester.scrollUntilVisible(
      toggle,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<SwitchListTile>(
            find.descendant(of: toggle, matching: find.byType(SwitchListTile)),
          )
          .value,
      isTrue,
    );
    await tester.tap(toggle);
    await tester.pumpAndSettle();
    expect(analytics.enabled, <bool>[false]);
    expect(
      tester
          .widget<SwitchListTile>(
            find.descendant(of: toggle, matching: find.byType(SwitchListTile)),
          )
          .value,
      isFalse,
    );
  });
}
