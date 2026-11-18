import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../arena/arena_fixtures.dart';
import 'science_fixtures.dart';

Future<void> _openPolls(
  WidgetTester tester,
  FakeScienceRepository science, {
  double textScale = 1,
}) async {
  await pumpArena(
    tester,
    ArenaScienceCore(science: science),
    initialTab: ArenaTab.perfil,
    textScale: textScale,
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
}

FakeScienceRepository _moderator() => FakeScienceRepository(
  scienceAccess: const ScienceAccess(enabled: true, moderator: true),
);

void main() {
  test('the poll log reads every reason and «Distinta cifra»', () {
    final List<PollDecision> list = PollDecision.listFromJson(<String, dynamic>{
      'decisions': <Map<String, dynamic>>[
        <String, dynamic>{
          'decided_at': '2026-11-16T12:00:00Z',
          'stage': 'candidate',
          'outcome': 'veto',
          'reason': 'different_pollster',
          'left_outlet': 'Ex-Ante',
          'right_outlet': 'Cooperativa.cl',
          'left_title': 'Criteria: aprobación de Kast 18%',
          'right_title': 'Cadem: aprobación de Kast 27%',
          'left_pollster': 'Criteria',
          'right_pollster': 'Cadem',
        },
        <String, dynamic>{
          'decided_at': '2026-11-16T12:00:00Z',
          'stage': 'promotion',
          'outcome': 'distinta_cifra',
          'reason': null,
          'left_title': 'a',
          'right_title': 'b',
        },
      ],
    });
    expect(list.first.reason, PollDecisionReason.differentPollster);
    expect(list.first.stage, PollDecisionStage.beforeAi);
    expect(list.last.reason, PollDecisionReason.differentFigure);
    expect(list.last.stage, PollDecisionStage.atPublication);
    expect(
      PollDecisionStage.parse('retroactive').label,
      'duelo ya publicado, retirado',
    );
    expect(
      PollDecisionReason.values.map((PollDecisionReason r) => r.label),
      containsAll(<String>[
        'Encuestadoras distintas',
        'Falta encuestadora',
        'Encuesta contra no encuesta',
        'Ronda distinta',
        'Distinta cifra',
      ]),
    );
  });

  testWidgets('moderation · «Encuestas» lists each veto with its reason', (
    WidgetTester tester,
  ) async {
    final FakeScienceRepository science = _moderator()
      ..polls = <PollDecision>[
        PollDecision(
          decidedAt: DateTime.utc(2026, 11, 16, 12),
          reason: PollDecisionReason.differentPollster,
          stage: PollDecisionStage.beforeAi,
          leftTitle: 'Criteria: aprobación de Kast se sitúa bajo el 20%',
          rightTitle: 'Cadem: aprobación de Kast cayó al 27%',
          leftOutlet: 'Ex-Ante',
          rightOutlet: 'Cooperativa.cl',
          leftPollster: 'Criteria',
          rightPollster: 'Cadem',
        ),
        PollDecision(
          decidedAt: DateTime.utc(2026, 11, 15, 12),
          reason: PollDecisionReason.pollAndNonPoll,
          stage: PollDecisionStage.retroactive,
          leftTitle: 'El Presidente Kast rechaza la política transaccional',
          rightTitle: 'Criteria: aprobación a Kast cayó a 18%',
          leftOutlet: 'La Tercera',
          rightOutlet: 'Cooperativa.cl',
          rightPollster: 'Criteria',
        ),
      ];
    await _openPolls(tester, science);
    await tester.tap(find.byKey(const Key('sci-mod-tab-polls')));
    await tester.pumpAndSettle();
    expect(find.text('Encuestadoras distintas'), findsOneWidget);
    expect(find.text('Encuesta contra no encuesta'), findsOneWidget);
    expect(find.text('Ex-Ante · Criteria'), findsOneWidget);
    expect(find.text('La Tercera · sin encuestadora'), findsOneWidget);
    expect(find.textContaining('antes de la IA'), findsOneWidget);
    expect(find.textContaining('duelo ya publicado, retirado'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('moderation · «Encuestas» empty, and without the route in Core', (
    WidgetTester tester,
  ) async {
    final FakeScienceRepository science = _moderator();
    await _openPolls(tester, science);
    await tester.tap(find.byKey(const Key('sci-mod-tab-polls')));
    await tester.pumpAndSettle();
    expect(
      find.text('La regla no ha separado duelos en estos 14 días.'),
      findsOneWidget,
    );
    // An older Core: the queue still works and the tab says so.
    science.polls = null;
    await tester.tap(find.byKey(const Key('sci-mod-refresh')));
    await tester.pumpAndSettle();
    expect(find.text('Core todavía no entrega este registro.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('sci-mod-tab-queue')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('sci-mod-queue')), findsOneWidget);
  });

  testWidgets('moderation · three tabs do not overlap at 200 %', (
    WidgetTester tester,
  ) async {
    await _openPolls(tester, _moderator(), textScale: 2);
    final List<Rect> tabs = <Rect>[
      for (final String key in <String>[
        'sci-mod-tab-queue',
        'sci-mod-tab-usage',
        'sci-mod-tab-polls',
      ])
        tester.getRect(find.byKey(Key(key))),
    ];
    expect(tabs[0].overlaps(tabs[1]), isFalse);
    expect(tabs[1].overlaps(tabs[2]), isFalse);
    expect(tabs[2].right, lessThanOrEqualTo(390));
    expect(tester.takeException(), isNull);
  });
}
