import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/presentation/story_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../arena/arena_fixtures.dart';
import '../support/public_api_fixtures.dart';
import 'science_fixtures.dart';

/// The story fixture with no literal quote left.
final EventDetailDto quoteless = EventDetailDto.fromJson(<String, Object?>{
  ...eventDetailJson(
    id: storyEvent.id,
    title: storyEvent.titleDescriptive,
    analysisState: 'PUBLISHED',
    positionCount: 1,
    withPrimaryFact: false,
  ),
  'category': storyEvent.category,
  'source_count': 3,
  'positions': <Object?>[
    <String, Object?>{
      'id': 'p9',
      'title': 'Codelco confirma desvinculaciones',
      'assertions': <Object?>[],
    },
  ],
  'articles': <Object?>[],
});

class _QuotelessCore extends ArenaScienceCore {
  @override
  Future<EventDetailDto> getEvent(
    String eventId, {
    bool refresh = false,
    dynamic requestToken,
  }) async => eventId == storyEvent.id
      ? quoteless
      : super.getEvent(eventId, refresh: refresh);
}

Future<void> _openVaccineComments(WidgetTester tester, {String? title}) async {
  await tester.tap(
    find.descendant(
      of: find.byKey(const Key('arena-bottom-navigation')),
      matching: find.text('En desarrollo'),
    ),
  );
  await tester.pumpAndSettle();
  final Finder story = find.text(title ?? vaccineTitle).first;
  await tester.ensureVisible(story);
  await tester.pumpAndSettle();
  await tester.tap(story);
  await tester.pumpAndSettle();
  final Finder tab = find.byKey(
    const ValueKey<String>('arena-subtab-Comentarios'),
  );
  await tester.ensureVisible(tab);
  await tester.pumpAndSettle();
  await tester.tap(tab);
  await tester.pumpAndSettle();
}

void main() {
  test(
    'suggestions: the study\'s topic first, then the newest; search ignores accents',
    () {
      EventCardDto card(String id, String title, String category, int day) =>
          EventCardDto(
            id: id,
            titleDescriptive: title,
            category: category,
            detectedAt: DateTime.utc(2026, 11, day),
            analysisState: AnalysisState.published,
            sourceCount: 2,
            positionCount: 2,
          );
      final List<EventCardDto> stories = <EventCardDto>[
        card('a', 'Presupuesto 2027 en el Congreso', 'economia', 16),
        card('b', 'Glaciares andinos pierden masa', 'medioambiente', 10),
        card('c', 'Nuevo telescopio en Atacama', 'ciencia', 12),
      ];
      expect(
        storySuggestions(
          stories,
          topic: StudyTopic.environment,
        ).map((EventCardDto e) => e.id),
        <String>['b', 'a', 'c'],
      );
      expect(storySuggestions(stories).map((EventCardDto e) => e.id), <String>[
        'a',
        'c',
        'b',
      ]);
      expect(
        storySuggestions(
          stories,
          query: 'atacamá TELESCOPIO',
        ).map((EventCardDto e) => e.id),
        <String>['c'],
      );
      expect(storySuggestions(stories, query: 'vacunas'), isEmpty);
      expect(literalQuotesLabel(1), '1 cita literal');
      expect(literalQuotesLabel(3), '3 citas literales');
    },
  );

  testWidgets(
    'C2 · the story picker searches, counts quotes and closes stories without them',
    (WidgetTester tester) async {
      await pumpArena(tester, _QuotelessCore());
      await _openVaccineComments(tester);
      await tester.tap(find.byKey(const Key('sci-composer-study')));
      await tester.pumpAndSettle();
      await tester.tap(find.text(hviid.title).last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('sci-story-change')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('sci-story-picker')), findsOneWidget);
      expect(find.text('Sugerencias'), findsOneWidget);

      final Finder vaccine = find.byKey(
        const ValueKey<String>('sci-story-$vaccineEventId'),
      );
      expect(
        find.descendant(
          of: vaccine,
          matching: find.textContaining('2 citas literales'),
        ),
        findsOneWidget,
      );
      final Finder closed = find.byKey(
        ValueKey<String>('sci-story-${storyEvent.id}'),
      );
      expect(
        find.descendant(
          of: closed,
          matching: find.textContaining('Sin citas para conectar'),
        ),
        findsOneWidget,
      );
      expect(tester.widget<InkWell>(closed).onTap, isNull);

      await tester.enterText(
        find.byKey(const Key('sci-story-search')),
        'vacunacion',
      );
      await tester.pumpAndSettle();
      expect(find.text('Resultados'), findsOneWidget);
      expect(closed, findsNothing);
      await tester.tap(vaccine);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('sci-story-picker')), findsNothing);
      expect(find.byKey(const Key('sci-comment-sheet')), findsOneWidget);

      await tester.tap(find.byKey(const Key('sci-story-change')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('sci-story-search')),
        'nada parecido',
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('sci-story-none')), findsOneWidget);
    },
  );

  testWidgets('C3 · «¿Conoces un estudio sobre esto?» opens C2 on this story', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaScienceCore());
    await _openVaccineComments(tester);
    expect(find.text('¿Conoces un estudio sobre esto?'), findsOneWidget);
    await tester.tap(find.byKey(const Key('sci-know-study-open')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(hviid.title).last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('sci-comment-sheet')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('sci-comment-sheet')),
        matching: find.text(vaccineTitle),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'C3 · a story without literal quotes says it cannot be connected',
    (WidgetTester tester) async {
      await pumpArena(tester, _QuotelessCore());
      await _openVaccineComments(tester, title: storyEvent.titleDescriptive);
      expect(find.text('¿Conoces un estudio sobre esto?'), findsNothing);
      expect(
        find.text(
          'Esta noticia aún no tiene citas literales para conectar un estudio.',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('sci-know-study-open')), findsNothing);
    },
  );
}
