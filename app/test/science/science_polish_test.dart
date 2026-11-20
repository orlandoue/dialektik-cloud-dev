import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/study_label_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../arena/arena_fixtures.dart';
import 'science_fixtures.dart';

void main() {
  test(
    'a repository record is not called peer reviewed; a year is only a year',
    () {
      final Study zenodo = Study.fromJson(<String, dynamic>{
        'doi': '10.5281/zenodo.123',
        'title': 'Education and development in Latin America',
        'review': 'not_reported',
        'journal': 'Zenodo',
        'published_at': '2026-01-01',
        'published_precision': 'year',
      });
      expect(zenodo.review, StudyReview.notReported);
      expect(studyTagLabels(zenodo), isNot(contains('Revisado por pares')));
      expect(sciStudyDate(zenodo), '2026');
      expect(sciStudyDate(zenodo, long: true), '2026');
      final Study month = Study.fromJson(<String, dynamic>{
        'doi': '10.1/m',
        'title': 'T',
        'review': 'peer_reviewed',
        'published_at': '2026-03-01',
        'published_precision': 'month',
      });
      expect(sciStudyDate(month), 'mar 2026');
      // An older Core without the field keeps the full date.
      expect(sciStudyDate(hviid, long: true), '5 mar 2019');
    },
  );

  testWidgets(
    'C4 says «No informado» when the source does not state the review',
    (WidgetTester tester) async {
      final Study zenodo = Study.fromJson(<String, dynamic>{
        'doi': '10.5281/zenodo.123',
        'title': 'Measuring attitudes in teacher education',
        'review': 'not_reported',
        'published_at': '2026-01-01',
        'published_precision': 'year',
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: StudyLabel(study: zenodo)),
          ),
        ),
      );
      expect(find.text('Revisado por pares'), findsNothing);
      expect(
        find.bySemanticsLabel(RegExp('Revisión por pares: No informado')),
        findsOneWidget,
      );
      expect(find.textContaining('1 ene'), findsNothing);
    },
  );

  testWidgets(
    'the mode button shows «General» whole at 360 pt with large text',
    (WidgetTester tester) async {
      await pumpArena(
        tester,
        ArenaScienceCore(),
        size: const Size(360, 740),
        textScale: 1.45,
      );
      final Finder mode = find.byKey(const Key('sci-mode-button'));
      expect(
        find.descendant(of: mode, matching: find.text('General')),
        findsOneWidget,
      );
      expect(find.textContaining('Gene…'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'the bottom bar keeps «En desarrollo» whole and visible at 200 %',
    (WidgetTester tester) async {
      await pumpArena(
        tester,
        ArenaScienceCore(),
        size: const Size(360, 740),
        textScale: 2,
      );
      final Finder bar = find.byKey(const Key('arena-bottom-navigation'));
      for (final String label in <String>[
        'Inicio',
        'Duelos',
        'En desarrollo',
        'Medios',
        'Perfil',
      ]) {
        final Finder text = find.descendant(
          of: bar,
          matching: find.text(label),
        );
        expect(text, findsOneWidget, reason: label);
        final Rect tab = tester.getRect(
          find.byKey(ValueKey<String>('arena-tab-$label')),
        );
        final Rect drawn = tester.getRect(text);
        expect(drawn.width, lessThanOrEqualTo(tab.width), reason: label);
      }
      expect(tester.takeException(), isNull);
    },
  );
}
