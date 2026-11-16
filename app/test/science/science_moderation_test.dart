import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/presentation/moderation_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../arena/arena_fixtures.dart';
import 'science_fixtures.dart';

/// A study whose metadata has no abstract (10.5555 is Crossref's test prefix).
final Study withoutAbstract = Study(
  doi: '10.5555/sin-resumen',
  title: 'Cobertura de vacunación escolar en Chile, 2015–2024',
  review: StudyReview.peerReviewed,
  authors: 'Pérez A, Soto M',
  journal: 'Revista de ejemplo',
  publishedAt: DateTime.utc(2025, 3, 1),
);

Future<void> _openVaccineComments(WidgetTester tester) async {
  await tester.tap(
    find.descendant(
      of: find.byKey(const Key('arena-bottom-navigation')),
      matching: find.text('Historias'),
    ),
  );
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text(vaccineTitle).first);
  await tester.pumpAndSettle();
  await tester.tap(find.text(vaccineTitle).first);
  await tester.pumpAndSettle();
  final Finder tab = find.byKey(
    const ValueKey<String>('arena-subtab-Comentarios'),
  );
  await tester.ensureVisible(tab);
  await tester.pumpAndSettle();
  await tester.tap(tab);
  await tester.pumpAndSettle();
}

Future<void> _scrollTo(WidgetTester tester, Finder target, String scrollKey) =>
    tester.scrollUntilVisible(
      target,
      200,
      scrollable: find
          .descendant(
            of: find.byKey(Key(scrollKey)),
            matching: find.byType(Scrollable),
          )
          .first,
    );

Future<void> _openModeration(WidgetTester tester) async {
  final Finder open = find.byKey(const Key('arena-open-science-moderation'));
  await tester.ensureVisible(open);
  await tester.pumpAndSettle();
  await tester.tap(open);
  await tester.pumpAndSettle();
}

Future<void> _giveReason(WidgetTester tester, String reason) async {
  expect(find.byKey(const Key('sci-mod-reason-sheet')), findsOneWidget);
  final Finder confirm = find.byKey(const Key('sci-mod-reason-confirm'));
  // A reason is required.
  expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
  await tester.enterText(find.byKey(const Key('sci-mod-reason')), reason);
  await tester.pump();
  await tester.tap(confirm);
  await tester.pumpAndSettle();
}

FakeScienceRepository _moderatorRepository(DateTime now) {
  final List<StoryComment> thread = <StoryComment>[
    ...sampleThread(now),
    StoryComment(
      id: 'c9',
      author: 'lector_nuevo',
      body: 'Sin el estudio no se entiende nada.',
      createdAt: now.subtract(const Duration(minutes: 5)),
      status: CommentStatus.inReview,
      attachment: StudyAttachmentData(
        study: withoutAbstract,
        claim: vaccineClaim,
        relation: StudyRelation.qualifies,
        abstractFragment: 'cobertura',
      ),
    ),
  ];
  final FakeScienceRepository repository = FakeScienceRepository(
    studies: <Study>[hviid, bendavid, wakefield, withoutAbstract],
    comments: <String, List<StoryComment>>{vaccineEventId: thread},
    scienceAccess: const ScienceAccess(enabled: true, moderator: true),
  );
  repository.reports['c1'] = <CommentReport>[
    const CommentReport(
      reason: ReportReason.offensive,
      note: 'Trata mal a otra lectora',
    ),
    const CommentReport(reason: ReportReason.spam),
  ];
  repository.usageDays = <ApiUsageDay>[
    ApiUsageDay(
      source: 'openalex',
      day: DateTime(2026, 11, 16),
      calls: 42,
      errors: 1,
    ),
    ApiUsageDay(
      source: 'openalex',
      day: DateTime(2026, 11, 15),
      calls: 30,
      errors: 0,
    ),
    ApiUsageDay(
      source: 'crossref',
      day: DateTime(2026, 11, 16),
      calls: 40,
      errors: 0,
    ),
  ];
  return repository;
}

void main() {
  testWidgets('C2 · a study without an abstract closes step 4 and publishing', (
    WidgetTester tester,
  ) async {
    final ArenaScienceCore core = ArenaScienceCore(
      science: FakeScienceRepository(studies: <Study>[hviid, withoutAbstract]),
    );
    await pumpArena(tester, core);
    await _openVaccineComments(tester);
    await tester.tap(find.byKey(const Key('sci-composer-study')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(withoutAbstract.title).last);
    await tester.pumpAndSettle();
    final Finder message = find.byKey(const Key('sci-no-abstract'));
    await _scrollTo(tester, message, 'sci-sheet-scroll');
    expect(
      find.text('Este estudio no tiene resumen disponible'),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const ValueKey<String>('sci-claim-$vaccineClaimId')),
    );
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('sci-comment-input')),
      'Quiero conectarlo igual.',
    );
    await tester.pump();
    final Finder publish = find.byKey(const Key('sci-publish'));
    await tester.ensureVisible(publish);
    expect(tester.widget<FilledButton>(publish).onPressed, isNull);
    expect(core.science.studyCalls, isEmpty);
  });

  testWidgets('C3 · «Reportar» from the menu of someone else\'s comment', (
    WidgetTester tester,
  ) async {
    final DateTime now = DateTime.now();
    final FakeScienceRepository repository = FakeScienceRepository(
      comments: <String, List<StoryComment>>{
        vaccineEventId: <StoryComment>[
          ...sampleThread(now),
          StoryComment(
            id: 'mine',
            author: 'yo',
            body: 'Mi propio comentario',
            createdAt: now,
            mine: true,
          ),
        ],
      },
    );
    await pumpArena(tester, ArenaScienceCore(science: repository));
    await _openVaccineComments(tester);
    // Never on one's own comment.
    expect(
      find.byKey(const ValueKey<String>('sci-comment-menu-mine')),
      findsNothing,
    );
    final Finder menu = find.byKey(
      const ValueKey<String>('sci-comment-menu-c1'),
    );
    await _scrollTo(tester, menu, 'arena-event-scroll');
    await tester.pumpAndSettle();
    expect(tester.getSize(menu).height, greaterThanOrEqualTo(44));
    await tester.tap(menu);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reportar'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('sci-report-sheet')), findsOneWidget);
    final Finder send = find.byKey(const Key('sci-report-send'));
    expect(tester.widget<FilledButton>(send).onPressed, isNull);
    await tester.tap(find.byKey(const ValueKey<String>('sci-report-ofensivo')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('sci-report-note')),
      'Insulta a otra lectora',
    );
    await tester.tap(send);
    await tester.pumpAndSettle();
    expect(find.text('Gracias. Un moderador lo revisará.'), findsOneWidget);
    expect(repository.reports['c1']!.single.reason, ReportReason.offensive);
    expect(repository.reports['c1']!.single.note, 'Insulta a otra lectora');
    // Once per comment.
    expect(menu, findsNothing);
  });

  testWidgets('a reader who is not a moderator has no way into moderation', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaScienceCore(), initialTab: ArenaTab.perfil);
    expect(
      find.byKey(const Key('arena-open-science-moderation')),
      findsNothing,
    );
  });

  testWidgets('moderation · queue, reasons, reports and API usage', (
    WidgetTester tester,
  ) async {
    final FakeScienceRepository repository = _moderatorRepository(
      DateTime.now(),
    );
    await pumpArena(
      tester,
      ArenaScienceCore(science: repository),
      initialTab: ArenaTab.perfil,
    );
    await _openModeration(tester);
    expect(find.text('Cola · 2'), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('sci-mod-review-c9')),
      findsOneWidget,
    );
    expect(
      find.text('Resumen: Este estudio no tiene resumen disponible'),
      findsOneWidget,
    );

    // Rejecting needs a reason.
    await tester.tap(find.byKey(const ValueKey<String>('sci-mod-reject-c9')));
    await tester.pumpAndSettle();
    await _giveReason(tester, 'El fragmento no está en el resumen');
    expect(
      repository.decisions['c9'],
      'reject:El fragmento no está en el resumen',
    );
    expect(find.text('Comentario rechazado'), findsOneWidget);

    final Finder report = find.byKey(
      const ValueKey<String>('sci-mod-report-c1'),
    );
    await tester.ensureVisible(report);
    expect(find.text('2 reportes'), findsOneWidget);
    expect(
      find.text('· Insulto u ofensa: Trata mal a otra lectora'),
      findsOneWidget,
    );
    final Finder hide = find.byKey(const ValueKey<String>('sci-mod-hide-c1'));
    await tester.ensureVisible(hide);
    await tester.tap(hide);
    await tester.pumpAndSettle();
    await _giveReason(tester, 'Insulto personal');
    expect(repository.decisions['c1'], 'hide:Insulto personal');
    expect(find.text('No hay nada pendiente.'), findsOneWidget);

    await tester.tap(find.byKey(const Key('sci-mod-tab-usage')));
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('sci-mod-usage-openalex')),
        matching: find.text('72 llamadas · 1 error'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('sci-mod-usage-crossref')),
        matching: find.text('40 llamadas · 0 errores'),
      ),
      findsOneWidget,
    );
    expect(find.text('OpenAlex: 42 llamadas, 1 error'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'moderation · complete a study and load its abstract with a source',
    (WidgetTester tester) async {
      final FakeScienceRepository repository = _moderatorRepository(
        DateTime.now(),
      );
      await pumpArena(
        tester,
        ArenaScienceCore(science: repository),
        initialTab: ArenaTab.perfil,
      );
      await _openModeration(tester);
      await tester.tap(find.byKey(const ValueKey<String>('sci-mod-edit-c9')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('sci-mod-study-form')), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey<String>('sci-mod-field-design')),
        'Estudio transversal',
      );
      await tester.enterText(
        find.byKey(const ValueKey<String>('sci-mod-field-sample_size')),
        '1200',
      );
      await tester.enterText(
        find.byKey(const Key('sci-mod-field-abstract')),
        'Se analizó la cobertura de vacunación escolar entre 2015 y 2024.',
      );
      final Finder save = find.byKey(const Key('sci-mod-study-save'));
      await _scrollTo(tester, save, 'sci-mod-study-form');
      await tester.tap(save);
      await tester.pumpAndSettle();
      // The abstract needs the place it was copied from.
      expect(find.text('Indica de dónde copiaste el resumen.'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('sci-mod-field-abstract_source')),
        'Revista de ejemplo',
      );
      await _scrollTo(tester, save, 'sci-mod-study-form');
      await tester.tap(save);
      await tester.pumpAndSettle();
      final Study saved = repository.studies.firstWhere(
        (Study s) => s.doi == withoutAbstract.doi,
      );
      expect(saved.design, 'Estudio transversal');
      expect(saved.sampleSize, 1200);
      expect(saved.population, isNull);
      expect(saved.abstractSource, 'Revista de ejemplo');
      expect(saved.hasAbstract, isTrue);
      expect(find.byKey(const Key('sci-mod-queue')), findsOneWidget);
    },
  );

  for (final (String name, HarvestStatus status, String text)
      in <(String, HarvestStatus, String)>[
        (
          'late',
          HarvestStatus(
            lastRunAt: DateTime.utc(2026, 11, 13, 12),
            lastStatus: 'ok',
            stale: true,
          ),
          'La cosecha diaria no termina hace más de 48 horas. Última: 13 nov.',
        ),
        (
          'on time',
          HarvestStatus(
            lastRunAt: DateTime.utc(2026, 11, 16, 12),
            lastStatus: 'partial',
            stale: false,
            added: 120,
            deleted: 1,
          ),
          'Última cosecha: 16 nov (parcial) · 120 agregados · 1 borrado por antigüedad.',
        ),
        (
          'never',
          const HarvestStatus(),
          'La cosecha diaria todavía no ha terminado ninguna corrida.',
        ),
      ]) {
    testWidgets('moderation · harvest notice when $name', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ApiUsageView(days: const <ApiUsageDay>[], harvest: status),
          ),
        ),
      );
      expect(find.text(text), findsOneWidget);
    });
  }
}
