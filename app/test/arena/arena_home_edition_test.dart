// The hour's edition: «En desarrollo» follows it, says when and how it was
// ordered, and moderators pin, hide or choose the duel with a reason.
import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/arena/data/home_edition.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/arena/presentation/home_edition_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

HomeEdition editionOf(
  List<String> order, {
  String? pinReason,
  DateTime? at,
}) => HomeEdition.fromJson(<String, dynamic>{
  'generated_at': (at ?? DateTime.utc(2026, 11, 24, 17)).toIso8601String(),
  'next_at': DateTime.utc(2026, 11, 24, 18).toIso8601String(),
  'trigger': 'hourly',
  'rules_version': 'v1',
  'rules':
      'Ordenada por medios que lo cubren y novedad (mitad de peso cada 12 h); sin IA.',
  'duel_event_id': duelEventId,
  'duel_reason': 'score',
  'duel_pin_reason': null,
  'hidden': <Object>[],
  'cards': <String, Object>{},
  'story_titles': <String, Object>{},
  'items': <Object>[
    for (final (int i, String id) in order.indexed)
      <String, Object?>{
        'kind': 'event',
        'id': id,
        'event_ids': <String>[id],
        'lead_event_id': id,
        'category': 'politica',
        'outlets': 3 - i,
        'first_coverage_at': '2026-11-24T15:00:00.000Z',
        'last_coverage_at': '2026-11-24T16:00:00.000Z',
        'score': 3.0 - i,
        'pinned': i == 0 && pinReason != null,
        'pin_reason': i == 0 ? pinReason : null,
      },
  ],
});

class EditionCore extends ArenaFullCore
    implements HomeEditionRepository, HomeEditionModerationRepository {
  EditionCore(this.current);

  HomeEdition current;
  final List<(String, String, String, String, int)> pins =
      <(String, String, String, String, int)>[];

  @override
  Future<HomeEdition?> homeEdition(String country) async => current;

  @override
  Future<(HomeEdition?, List<HomeEditionPin>)> moderationEdition(
    String country,
  ) async => (current, const <HomeEditionPin>[]);

  @override
  Future<HomeEdition?> pinEdition({
    required String country,
    required String targetKind,
    required String targetId,
    required String action,
    required String reason,
    required int hours,
  }) async {
    pins.add((targetKind, targetId, action, reason, hours));
    return current = editionOf(<String>[
      targetId,
      storyEventId,
    ], pinReason: reason);
  }

  @override
  Future<HomeEdition?> unpinEdition(String pinId) async => current;
}

double topOf(WidgetTester tester, String key) =>
    tester.getTopLeft(find.byKey(ValueKey<String>(key))).dy;

void main() {
  testWidgets('En desarrollo follows the edition and says how it was ordered', (
    WidgetTester tester,
  ) async {
    // The feed lists the story case first; the edition puts the duel's case first.
    await pumpArena(
      tester,
      EditionCore(editionOf(<String>[duelEventId, storyEventId])),
      initialTab: ArenaTab.historias,
    );
    expect(find.text('Ordenar: Edición de la hora'), findsOneWidget);
    expect(find.byKey(const Key('arena-edition-caption')), findsOneWidget);
    expect(
      find.textContaining('medios que lo cubren y novedad'),
      findsOneWidget,
    );
    expect(
      topOf(tester, 'arena-event-$duelEventId') <
          topOf(tester, 'arena-event-$storyEventId'),
      isTrue,
    );
    // Recientes still exists.
    await tester.tap(find.byKey(const Key('arena-stories-order')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-stories-order-0')).last,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('arena-edition-caption')), findsNothing);
  });

  testWidgets('a pinned case shows the moderator\'s reason', (
    WidgetTester tester,
  ) async {
    await pumpArena(
      tester,
      EditionCore(
        editionOf(<String>[
          storyEventId,
          duelEventId,
        ], pinReason: 'Contexto clave'),
      ),
      initialTab: ArenaTab.historias,
    );
    expect(
      find.text('Destacado por moderación: Contexto clave'),
      findsOneWidget,
    );
  });

  testWidgets(
    'moderation: pin with a reason and an expiry; the edition updates',
    (WidgetTester tester) async {
      final EditionCore core = EditionCore(
        editionOf(<String>[storyEventId, duelEventId]),
      );
      final ArenaStore store = ArenaStore(consumer: core, live: core);
      addTearDown(store.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: EditionModerationView(store: store)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('arena-edition-moderation')), findsOneWidget);
      expect(
        find.textContaining('el caso con más puntaje que tiene duelo'),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(ValueKey<String>('arena-edition-actions-$duelEventId')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Destacar arriba').last);
      await tester.pumpAndSettle();
      // A reason is required.
      await tester.tap(find.byKey(const Key('arena-edition-confirm')));
      await tester.pumpAndSettle();
      expect(core.pins, isEmpty);
      await tester.enterText(
        find.byKey(const Key('arena-edition-reason')),
        'Contexto clave',
      );
      await tester.tap(find.byKey(const Key('arena-edition-confirm')));
      await tester.pumpAndSettle();
      expect(core.pins, <(String, String, String, String, int)>[
        ('event', duelEventId, 'pin', 'Contexto clave', 12),
      ]);
      expect(find.text('Edición actualizada'), findsOneWidget);
    },
  );
}
