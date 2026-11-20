// Stories: one card for several events of one topic in «En desarrollo», and
// the moderator's «Fusiones» tab where nothing is grouped without approval.
import 'package:dialektik/features/arena/data/story_groups.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../science/science_fixtures.dart';
import 'arena_fixtures.dart';

class StoryCore extends ArenaScienceCore implements StoryGroupsRepository {
  StoryCore({super.science});

  final List<(String, bool, String?)> decisions = <(String, bool, String?)>[];

  @override
  Future<List<StoryGroup>> storyGroups() async => <StoryGroup>[
    StoryGroup(
      id: 'G1',
      title: 'Crisis en Codelco y la fiscalía',
      eventIds: const <String>[storyEventId, duelEventId],
      sourceIds: const <String>['s1', 's2', 's3', 's4'],
      sourceCount: 4,
      coverEventId: storyEventId,
      lastCoverageAt: DateTime.now().subtract(const Duration(hours: 2)),
    ),
  ];

  @override
  Future<List<StoryProposal>> storyProposals() async => <StoryProposal>[
    const StoryProposal(
      id: 'P1',
      suggestedTitle: 'Gira de Kast por Asia',
      events: <StoryProposalEvent>[
        StoryProposalEvent(
          id: 'E1',
          title: 'Presidente Kast inicia viaje a Asia',
          outlets: <String>['Cooperativa.cl', 'Meganoticias'],
        ),
        StoryProposalEvent(
          id: 'E2',
          title: 'Gira por Asia de Presidente Kast en Vietnam',
          outlets: <String>['La Tercera', 'Meganoticias'],
        ),
      ],
    ),
  ];

  @override
  Future<void> decideStoryProposal(
    String proposalId, {
    required bool approve,
    String? title,
  }) async => decisions.add((proposalId, approve, title));
}

void main() {
  testWidgets(
    'En desarrollo shows one card per story, with its coverages inside',
    (WidgetTester tester) async {
      await pumpArena(tester, StoryCore(), initialTab: ArenaTab.historias);
      expect(
        find.byKey(const ValueKey<String>('arena-story-G1')),
        findsOneWidget,
      );
      expect(find.text('Crisis en Codelco y la fiscalía'), findsOneWidget);
      expect(find.textContaining('4 medios · 2 coberturas'), findsOneWidget);
      // Its events are not listed again on their own.
      expect(
        find.byKey(const ValueKey<String>('arena-event-$storyEventId')),
        findsNothing,
      );

      await tester.tap(find.byKey(const ValueKey<String>('arena-story-G1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('arena-story-scroll')), findsOneWidget);
      expect(
        find.byKey(const ValueKey<String>('arena-event-$storyEventId')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey<String>('arena-event-$duelEventId')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('«Fusiones»: the moderator joins a proposal with its title', (
    WidgetTester tester,
  ) async {
    final StoryCore core = StoryCore(
      science: FakeScienceRepository(
        scienceAccess: const ScienceAccess(enabled: true, moderator: true),
      ),
    );
    await pumpArena(tester, core, initialTab: ArenaTab.perfil);
    final Finder open = find.byKey(const Key('arena-open-science-moderation'));
    await tester.scrollUntilVisible(
      open,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(open);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('sci-mod-tab-stories')));
    await tester.pumpAndSettle();
    expect(find.text('Gira de Kast por Asia'), findsOneWidget);
    expect(
      find.text('Gira por Asia de Presidente Kast en Vietnam'),
      findsOneWidget,
    );
    expect(core.decisions, isEmpty, reason: 'nothing is grouped by itself');

    await tester.tap(
      find.byKey(const ValueKey<String>('sci-mod-story-join-P1')),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('sci-mod-story-title')),
      'La gira de Kast por Asia',
    );
    await tester.tap(find.byKey(const Key('sci-mod-story-save')));
    await tester.pumpAndSettle();
    expect(core.decisions, <(String, bool, String?)>[
      ('P1', true, 'La gira de Kast por Asia'),
    ]);

    await tester.tap(
      find.byKey(const ValueKey<String>('sci-mod-story-reject-P1')),
    );
    await tester.pumpAndSettle();
    expect(core.decisions.last, ('P1', false, null));
  });

  test('a story reads from Core JSON', () {
    final List<StoryGroup> list = StoryGroup.listFromJson(<String, dynamic>{
      'stories': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'G1',
          'title': 'Gira de Kast por Asia',
          'cover_event_id': 'E1',
          'event_ids': <String>['E1', 'E2'],
          'source_ids': <String>['S1', 'S2', 'S3'],
          'source_count': 3,
          'last_coverage_at': '2026-11-19T10:00:00Z',
        },
      ],
    });
    expect(list.single.sourceCount, 3);
    expect(list.single.eventIds, <String>['E1', 'E2']);
  });
}
