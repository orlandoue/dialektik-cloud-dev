// «También lo cubren N medios · Comparar →» under a note of a followed
// medium whose case is published (Phase 5 of the audit).
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/arena/presentation/arena_tabs.dart';
import 'package:dialektik/features/arena/presentation/living_event_screen.dart';
import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

class AlsoCoveredCore extends ArenaFakeCore {
  @override
  Future<LiveNewsPageDto> listScopedLiveNews({
    required String scope,
    String? cursor,
    String? format,
    String? topic,
    String? query,
    String? sourceId,
    DateTime? publishedFrom,
    DateTime? publishedTo,
    bool refresh = false,
    dynamic requestToken,
  }) async => LiveNewsPageDto(
    items: <LiveNewsItemDto>[
      if (scope == 'following') ...<LiveNewsItemDto>[
        newsItem(
          'f1',
          'Despidos en Codelco tras el ajuste',
          tercera,
          publishedEventId: storyEventId,
        ),
        newsItem(
          'f2',
          'Hermosilla y la fiscalía',
          tercera,
          publishedEventId: duelEventId,
        ),
        newsItem('f3', 'Balance económico del trimestre', tercera),
      ],
    ],
  );
}

void main() {
  testWidgets('a followed note of a published case points to the others', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, AlsoCoveredCore());
    final Finder story = find.byKey(
      const ValueKey<String>('arena-also-covered-$storyEventId'),
    );
    final Finder duel = find.byKey(
      const ValueKey<String>('arena-also-covered-$duelEventId'),
    );
    await tester.scrollUntilVisible(
      duel,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(story, findsOneWidget);
    expect(
      find.descendant(
        of: story,
        matching: find.text('También lo cubren 2 medios · Comparar →'),
      ),
      findsOneWidget,
    );
    // The duel's case says so; the other does not.
    expect(
      find.descendant(of: duel, matching: find.text('En duelo')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: story, matching: find.text('En duelo')),
      findsNothing,
    );
    expect(
      find.descendant(
        of: duel,
        matching: find.text('También lo cubre 1 medio · Comparar →'),
      ),
      findsOneWidget,
    );
    // A note without a published case has no line.
    expect(find.textContaining('Comparar →'), findsNWidgets(2));

    await tester.ensureVisible(story);
    await tester.pumpAndSettle();
    await tester.tap(story);
    await tester.pumpAndSettle();
    expect(find.byType(LivingEventScreen), findsOneWidget);
  });

  testWidgets('Perfil explains the words of the app in a glossary', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore(), initialTab: ArenaTab.perfil);
    final Finder entry = find.byKey(const Key('arena-glossary'));
    await tester.scrollUntilVisible(
      entry,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(entry);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('arena-glossary-sheet')), findsOneWidget);
    for (final (String term, String _) in arenaGlossary) {
      expect(find.textContaining('$term. '), findsOneWidget);
    }
  });
}
