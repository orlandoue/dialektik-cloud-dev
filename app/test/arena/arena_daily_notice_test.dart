// Phase 6 of the audit: the «Duelo del día» notice is offered once, after
// the first vote; Android's permission is asked only if the reader accepts;
// Ajustes changes it; a tapped notice opens its duel.
import 'package:dialektik/core/infrastructure/push_notices.dart';
import 'package:dialektik/features/arena/data/push_devices.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/public_api_fixtures.dart';
import 'arena_fixtures.dart';

class FakePushGateway implements PushGateway {
  int permissionAsks = 0;

  @override
  bool get available => true;

  @override
  Future<bool> requestPermission() async {
    permissionAsks += 1;
    return true;
  }

  @override
  Future<String?> token() async => 'fcm-token-of-this-phone-0123456789';

  @override
  Stream<String> get tokenRefresh => const Stream<String>.empty();

  @override
  Stream<String> get openedEventIds => const Stream<String>.empty();

  @override
  Future<String?> initialEventId() async => null;
}

class PushCore extends ArenaFullCore implements PushDeviceRepository {
  final List<(String, bool, int, String)> registered =
      <(String, bool, int, String)>[];
  final List<String> removed = <String>[];

  @override
  Future<void> registerPushDevice(
    String token, {
    required bool dailyEnabled,
    required int dailyHour,
    required String country,
  }) async => registered.add((token, dailyEnabled, dailyHour, country));

  @override
  Future<void> removePushDevice(String token) async => removed.add(token);
}

Future<void> voteOnce(WidgetTester tester) async {
  await tester.tap(find.text(duelTitle).first);
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('arena-vote-button')));
  await tester.pumpAndSettle();
  await tester.tap(
    find.byKey(const ValueKey<String>('arena-vote-position-$positionBId')),
  );
  await tester.pumpAndSettle();
}

void main() {
  late FakePushGateway gateway;
  setUp(() => pushGateway = gateway = FakePushGateway());
  tearDown(() {
    pushGateway = const NoPushGateway();
    tappedNoticeEventId.value = null;
  });

  testWidgets(
    'after the first vote the notice is offered; accepting registers the phone',
    (WidgetTester tester) async {
      final PushCore core = PushCore();
      await pumpArena(tester, core);
      expect(gateway.permissionAsks, 0, reason: 'never at startup');
      await voteOnce(tester);
      expect(find.byKey(const Key('arena-daily-notice-offer')), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('arena-pill-21:00')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('arena-pill-21:00')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('arena-daily-notice-accept')));
      await tester.pumpAndSettle();
      expect(gateway.permissionAsks, 1);
      expect(core.registered, <(String, bool, int, String)>[
        ('fcm-token-of-this-phone-0123456789', true, 21, 'CL'),
      ]);
      expect(find.textContaining('te avisaremos a las 21:00'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('«Ahora no» is final: the next vote asks nothing', (
    WidgetTester tester,
  ) async {
    final PushCore core = PushCore();
    await pumpArena(tester, core);
    await voteOnce(tester);
    await tester.tap(find.byKey(const Key('arena-daily-notice-decline')));
    await tester.pumpAndSettle();
    expect(gateway.permissionAsks, 0);
    // Withdraw and vote again: no offer.
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-vote-position-$positionBId')),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-vote-position-$positionBId')),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('arena-daily-notice-offer')), findsNothing);
    expect(core.registered, isEmpty);
  });

  testWidgets('Ajustes turns the notice on and off', (
    WidgetTester tester,
  ) async {
    final PushCore core = PushCore();
    await pumpArena(tester, core, initialTab: ArenaTab.perfil);
    final Finder card = find.byKey(const Key('arena-daily-notice'));
    await tester.scrollUntilVisible(
      card,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.descendant(of: card, matching: find.byType(Switch)));
    await tester.pumpAndSettle();
    expect(core.registered.single.$3, 9);
    await tester.tap(find.descendant(of: card, matching: find.byType(Switch)));
    await tester.pumpAndSettle();
    expect(core.removed, <String>['fcm-token-of-this-phone-0123456789']);
  });

  testWidgets('a tapped notice opens its duel', (WidgetTester tester) async {
    await pumpArena(tester, PushCore());
    tappedNoticeEventId.value = duelEventId;
    await tester.pumpAndSettle();
    expect(find.byType(DuelScreen), findsOneWidget);
    expect(tappedNoticeEventId.value, isNull);
  });
}
