import 'dart:math' as math;

import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/arena/theme/arena_theme.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../arena/arena_fixtures.dart';
import 'science_fixtures.dart';

double _luminance(Color c) {
  double channel(double v) =>
      v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

double _contrast(Color a, Color b) {
  final double la = _luminance(a);
  final double lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

Future<void> _openVaccineComments(WidgetTester tester) async {
  await tester.tap(
    find.descendant(
      of: find.byKey(const Key('arena-bottom-navigation')),
      matching: find.text('En desarrollo'),
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

Future<void> _pickStudy(WidgetTester tester, Study study) async {
  await tester.tap(find.byKey(const Key('sci-composer-study')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(study.title).last);
  await tester.pumpAndSettle();
}

Future<void> _scrollSheet(
  WidgetTester tester,
  Finder target, {
  bool up = false,
}) async {
  await tester.scrollUntilVisible(
    target,
    up ? -200 : 200,
    scrollable: find
        .descendant(
          of: find.byKey(const Key('sci-sheet-scroll')),
          matching: find.byType(Scrollable),
        )
        .first,
  );
  await tester.pumpAndSettle();
}

MyComment _mine(String id, String body, CommentStatus status) => MyComment(
  comment: StoryComment(
    id: id,
    author: 'yo',
    body: body,
    createdAt: DateTime(2026, 11, 16),
    status: status,
    mine: true,
  ),
  eventId: vaccineEventId,
  eventTitle: vaccineTitle,
);

void main() {
  test('control borders reach 3:1 on white and on the app background', () {
    expect(
      _contrast(SciColors.borderControl, SciColors.surface),
      greaterThanOrEqualTo(3),
    );
    expect(
      _contrast(SciColors.borderControl, SciColors.bgApp),
      greaterThanOrEqualTo(3),
    );
  });

  test('a fragment needs 6 words or 40 characters', () {
    expect(fragmentLongEnough('seroprevalence'), isFalse);
    expect(fragmentLongEnough('does not increase the risk'), isFalse);
    expect(fragmentLongEnough('does not increase the risk for autism'), isTrue);
    expect(
      fragmentLongEnough('seroprevalence-adjusted-population-weighted'),
      isTrue,
    );
  });

  test('a lookup candidate is never assumed to be peer reviewed', () {
    LookupCandidate of(Object? review) =>
        LookupCandidate.fromJson(<String, dynamic>{
          'doi': '10.5281/zenodo.1',
          'title': 'T',
          'review': review,
        });
    expect(of('not_reported').review, StudyReview.notReported);
    expect(of(null).review, StudyReview.notReported);
    expect(of('preprint').review, StudyReview.preprint);
    expect(of('peer_reviewed').review, StudyReview.peerReviewed);
  });

  test('«Tus comentarios» reads every state from Core', () {
    final List<MyComment> list = MyComment.listFromJson(<String, dynamic>{
      'comments': <Map<String, dynamic>>[
        for (final String status in <String>[
          'published',
          'in_review',
          'rejected',
        ])
          <String, dynamic>{
            'id': status,
            'author': 'yo',
            'body': 'x',
            'created_at': '2026-11-16T12:00:00Z',
            'status': status,
            'event_id': 'e1',
            'event_title': 'Historia',
          },
      ],
    });
    expect(list.map((MyComment c) => c.comment.status), <CommentStatus>[
      CommentStatus.published,
      CommentStatus.inReview,
      CommentStatus.hidden,
    ]);
    expect(list.first.eventTitle, 'Historia');
  });

  testWidgets(
    'C2 · a retracted study closes steps 3 to 5 and offers another study',
    (WidgetTester tester) async {
      final ArenaScienceCore core = ArenaScienceCore();
      await pumpArena(tester, core);
      await _openVaccineComments(tester);
      await _pickStudy(tester, wakefield);
      for (final StudyRelation r in StudyRelation.values) {
        final Finder chip = find.byKey(
          ValueKey<String>('sci-relation-${r.wire}'),
        );
        await _scrollSheet(tester, chip);
        await tester.tap(chip, warnIfMissed: false);
        await tester.pump();
        expect(
          tester.getSemantics(chip),
          isNot(matchesSemantics(isChecked: true)),
          reason: r.wire,
        );
      }
      final Finder closed = find.byKey(const Key('sci-step-closed'));
      await _scrollSheet(tester, closed);
      expect(
        find.text('Un artículo retractado no se puede citar'),
        findsOneWidget,
      );
      final Finder input = find.byKey(const Key('sci-comment-input'));
      await _scrollSheet(tester, input);
      expect(tester.widget<TextField>(input).enabled, isFalse);
      final Finder other = find.byKey(const Key('sci-choose-other'));
      await _scrollSheet(tester, other, up: true);
      await tester.tap(other);
      await tester.pumpAndSettle();
      // Back to the study picker, with the story kept.
      expect(find.text(hviid.title), findsWidgets);
      await tester.tap(find.text(hviid.title).last);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('sci-choose-other')), findsNothing);
      expect(find.byKey(const Key('sci-comment-sheet')), findsOneWidget);
    },
  );

  testWidgets('Perfil with Science on: «Tus comentarios» with each state', (
    WidgetTester tester,
  ) async {
    final FakeScienceRepository science = FakeScienceRepository()
      ..mine = <MyComment>[
        _mine('p', 'Publicado ya', CommentStatus.published),
        _mine('r', 'Esperando revisión', CommentStatus.inReview),
        _mine('h', 'Lo ocultaron', CommentStatus.hidden),
      ];
    await pumpArena(
      tester,
      ArenaScienceCore(science: science),
      initialTab: ArenaTab.perfil,
    );
    final Finder section = find.byKey(const Key('sci-my-comments'));
    await tester.scrollUntilVisible(
      section,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Aportes'), findsNothing);
    expect(find.text('Tus comentarios · 3'), findsOneWidget);
    for (final (String id, String label) in <(String, String)>[
      ('p', 'Publicado'),
      ('r', 'En revisión'),
      ('h', 'Oculto'),
    ]) {
      final Finder tag = find.byKey(
        ValueKey<String>('sci-my-comment-status-$id'),
      );
      await tester.ensureVisible(tag);
      expect(
        find.descendant(of: tag, matching: find.text(label)),
        findsOneWidget,
      );
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('Perfil without Science keeps «Aportes»', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFullCore(), initialTab: ArenaTab.perfil);
    expect(find.byKey(const Key('sci-my-comments')), findsNothing);
    await tester.scrollUntilVisible(
      find.text('Aportes'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Aportes'), findsOneWidget);
  });

  testWidgets('moderation tabs do not overlap at 200 %', (
    WidgetTester tester,
  ) async {
    final FakeScienceRepository science = FakeScienceRepository(
      scienceAccess: const ScienceAccess(enabled: true, moderator: true),
    );
    await pumpArena(
      tester,
      ArenaScienceCore(science: science),
      initialTab: ArenaTab.perfil,
      size: const Size(390, 844),
      textScale: 2,
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
    final Rect queue = tester.getRect(
      find.byKey(const Key('sci-mod-tab-queue')),
    );
    final Rect usage = tester.getRect(
      find.byKey(const Key('sci-mod-tab-usage')),
    );
    expect(queue.overlaps(usage), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('«Reportar» opens a standard menu: white, radius 12, no border', (
    WidgetTester tester,
  ) async {
    final DateTime now = DateTime.now();
    await pumpArena(
      tester,
      ArenaScienceCore(
        science: FakeScienceRepository(
          comments: <String, List<StoryComment>>{
            vaccineEventId: sampleThread(now),
          },
        ),
      ),
    );
    await _openVaccineComments(tester);
    final Finder finder = find.byKey(
      const ValueKey<String>('sci-comment-menu-c1'),
    );
    await tester.scrollUntilVisible(
      finder,
      200,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('arena-event-scroll')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    final PopupMenuButton<String> menu = tester.widget<PopupMenuButton<String>>(
      finder,
    );
    expect(menu.color, SciColors.surface);
    final RoundedRectangleBorder shape = menu.shape! as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(12));
    expect(shape.side, BorderSide.none);
    expect(menu.elevation, greaterThan(0));
  });
}
