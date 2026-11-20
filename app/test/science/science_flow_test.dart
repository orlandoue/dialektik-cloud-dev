import 'package:dialektik/features/arena/data/arena_store.dart';
import 'package:dialektik/features/science/data/science_models.dart';
import 'package:dialektik/features/science/presentation/science_feed.dart';
import 'package:dialektik/features/science/presentation/science_format.dart';
import 'package:dialektik/features/science/presentation/story_comments.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../arena/arena_fixtures.dart';
import 'science_fixtures.dart';

Future<void> _switchToScience(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('sci-mode-button')));
  await tester.pumpAndSettle();
  expect(find.text('Modo'), findsOneWidget);
  await tester.tap(find.byKey(const ValueKey<String>('sci-mode-ciencia')));
  await tester.pumpAndSettle();
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

/// Selects [fragment] inside the selectable abstract, as a reader would.
Future<void> _selectFragment(WidgetTester tester, String fragment) async {
  await tester.scrollUntilVisible(
    find.byKey(const Key('sci-abstract')),
    200,
    scrollable: find
        .descendant(
          of: find.byKey(const Key('sci-sheet-scroll')),
          matching: find.byType(Scrollable),
        )
        .first,
  );
  await tester.pumpAndSettle();
  final EditableTextState editable = tester.state<EditableTextState>(
    find.descendant(
      of: find.byKey(const Key('sci-abstract')),
      matching: find.byType(EditableText),
    ),
  );
  final String text = editable.textEditingValue.text;
  final int start = text.indexOf(fragment);
  expect(start, isNonNegative, reason: 'fragment is in the abstract');
  editable.userUpdateTextEditingValue(
    editable.textEditingValue.copyWith(
      selection: TextSelection(
        baseOffset: start,
        extentOffset: start + fragment.length,
      ),
    ),
    SelectionChangedCause.drag,
  );
  await tester.pumpAndSettle();
}

Future<void> _filter(WidgetTester tester, String wire) async {
  final Finder chip = find.byKey(ValueKey<String>('sci-topic-$wire'));
  await tester.ensureVisible(chip);
  await tester.pumpAndSettle();
  await tester.tap(chip);
  await tester.pumpAndSettle();
}

Future<void> _pickStudy(WidgetTester tester, Study study) async {
  await tester.tap(find.byKey(const Key('sci-composer-study')));
  await tester.pumpAndSettle();
  await tester.tap(find.text(study.title).last);
  await tester.pumpAndSettle();
}

void main() {
  test('plurals and literal check follow the product rules', () {
    expect(connectedStoriesLabel(1), 'Conectado a 1 historia');
    expect(connectedStoriesLabel(2), 'Conectado a 2 historias');
    expect(moreRepliesLabel(3), 'Ver 3 respuestas más');
    expect(moreRepliesLabel(1), 'Ver 1 respuesta más');
    // Spaces and quotation marks are normalised, words are not.
    expect(
      isLiteralFragment(
        'does not  increase the “risk”',
        'MMR vaccination does not increase the "risk" for autism',
      ),
      isTrue,
    );
    expect(
      isLiteralFragment(
        'does not raise the risk',
        'MMR vaccination does not increase the risk for autism',
      ),
      isFalse,
    );
  });

  testWidgets('with the remote flag off, Science and comments stay hidden', (
    WidgetTester tester,
  ) async {
    final ArenaScienceCore core = ArenaScienceCore(
      science: FakeScienceRepository(scienceAccess: ScienceAccess.off),
    );
    await pumpArena(tester, core);
    expect(find.byKey(const Key('sci-mode-button')), findsNothing);
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
    expect(
      find.byKey(const ValueKey<String>('arena-subtab-Comentarios')),
      findsNothing,
    );
    expect(find.byKey(const Key('arena-open-community')), findsOneWidget);
  });

  test('a stored Science mode is ignored while the flag is off', () async {
    final ArenaScienceCore core = ArenaScienceCore(
      science: FakeScienceRepository(scienceAccess: ScienceAccess.off),
    );
    final ArenaStore store = ArenaStore(consumer: core, live: core);
    addTearDown(store.dispose);
    await store.load();
    store.setMode(ArenaMode.ciencia);
    expect(store.scienceEnabled, isFalse);
    expect(store.mode, ArenaMode.general);
  });

  testWidgets('the mode replaces the country and the Science bar appears', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaScienceCore());
    expect(
      find.bySemanticsLabel('Cambiar de modo, modo actual: General'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('arena-country')), findsNothing);
    await _switchToScience(tester);
    expect(
      find.bySemanticsLabel('Cambiar de modo, modo actual: Ciencia'),
      findsOneWidget,
    );
    for (final String tab in <String>[
      'Inicio',
      'Duelos',
      'En desarrollo',
      'Medios',
      'Perfil',
    ]) {
      expect(find.byKey(ValueKey<String>('arena-tab-$tab')), findsOneWidget);
    }
    expect(
      tester.getSize(find.byKey(const Key('arena-bottom-navigation'))).height,
      greaterThanOrEqualTo(68),
    );
    expect(
      tester.getSize(find.byKey(const Key('sci-mode-button'))).height,
      greaterThanOrEqualTo(44),
    );
  });

  testWidgets('C1 · topics, order, empty and error states', (
    WidgetTester tester,
  ) async {
    final ArenaScienceCore core = ArenaScienceCore();
    await pumpArena(tester, core);
    await _switchToScience(tester);
    // «Todos» and «Recientes» by default; every topic is a chip.
    for (final StudyTopic topic in StudyTopic.values) {
      expect(
        find.byKey(ValueKey<String>('sci-topic-${topic.wire}')),
        findsOneWidget,
        reason: topic.label,
      );
    }
    expect(core.science.browseCalls.last, (StudyTopic.all, StudySort.recent));
    expect(find.text('Recientes'), findsOneWidget);
    expect(find.text(hviid.title, skipOffstage: false), findsOneWidget);
    expect(
      find.text('Conectado a 1 historia', skipOffstage: false),
      findsOneWidget,
    );
    expect(find.text('Preprint', skipOffstage: false), findsOneWidget);
    // Unconnected studies say so in their meta line.
    expect(
      find.textContaining('sin noticias conectadas', skipOffstage: false),
      findsWidgets,
    );
    // A retracted study cannot be connected.
    await tester.scrollUntilVisible(
      find.text(wakefield.title),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    final Finder retracted = find.byKey(
      ValueKey<String>('sci-study-${wakefield.doi}'),
    );
    final OutlinedButton connect = tester.widget<OutlinedButton>(
      find.descendant(
        of: find.descendant(
          of: retracted,
          matching: find.byKey(const Key('sci-study-connect')),
        ),
        matching: find.byType(OutlinedButton),
      ),
    );
    expect(connect.onPressed, isNull);

    // «Recientes ▾» becomes «Conectados a noticias».
    await tester.tap(find.byKey(const Key('sci-sort')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('sci-sort-conectados')));
    await tester.pumpAndSettle();
    expect(core.science.browseCalls.last, (
      StudyTopic.all,
      StudySort.connected,
    ));
    expect(find.text('Conectados a noticias'), findsOneWidget);
    // The most connected study comes first.
    expect(
      tester.widgetList<StudyCard>(find.byType(StudyCard)).first.study.doi,
      hviid.doi,
    );

    await _filter(tester, 'salud');
    expect(core.science.browseCalls.last, (
      StudyTopic.health,
      StudySort.connected,
    ));
    expect(find.text(hviid.title), findsOneWidget);

    await _filter(tester, 'astronomia');
    expect(
      find.text('Aún no hay estudios en «Astronomía y espacio»'),
      findsOneWidget,
    );
    await tester.tap(find.text('Ver todos'));
    await tester.pumpAndSettle();
    expect(core.science.browseCalls.last.$1, StudyTopic.all);
    expect(find.text(bendavid.title, skipOffstage: false), findsOneWidget);

    core.science.failStudies = true;
    await _filter(tester, 'chile');
    expect(find.text('No pudimos cargar los estudios'), findsOneWidget);
    expect(find.text('Reintentar'), findsOneWidget);
  });

  testWidgets('C2 + C3 · a peer-reviewed study comment enters review', (
    WidgetTester tester,
  ) async {
    final ArenaScienceCore core = ArenaScienceCore();
    await pumpArena(tester, core);
    await _openVaccineComments(tester);
    expect(find.text('Sé la primera persona en comentar'), findsOneWidget);

    await _pickStudy(tester, hviid);
    expect(find.byKey(const Key('sci-comment-sheet')), findsOneWidget);
    FilledButton publish() =>
        tester.widget<FilledButton>(find.byKey(const Key('sci-publish')));
    expect(publish().onPressed, isNull, reason: 'nothing chosen yet');
    // 44 pt targets, including the text actions.
    expect(
      tester.getSize(find.byKey(const Key('sci-sheet-cancel'))).height,
      greaterThanOrEqualTo(44),
    );
    expect(
      tester.getSize(find.byKey(const Key('sci-story-change'))).height,
      greaterThanOrEqualTo(44),
    );
    // No relation is preselected.
    for (final StudyRelation r in StudyRelation.values) {
      expect(
        tester.getSemantics(
          find.byKey(ValueKey<String>('sci-relation-${r.wire}')),
        ),
        isNot(matchesSemantics(isChecked: true)),
      );
    }

    await tester.tap(
      find.byKey(const ValueKey<String>('sci-claim-$vaccineClaimId')),
    );
    await tester.pump();
    await tester.tap(
      find.byKey(const ValueKey<String>('sci-relation-contradice')),
    );
    await tester.pump();
    await _selectFragment(tester, 'does not increase the risk for autism');
    expect(find.byKey(const Key('sci-fragment')), findsOneWidget);
    expect(find.byKey(const Key('sci-fragment-error')), findsNothing);
    await tester.enterText(
      find.byKey(const Key('sci-comment-input')),
      'Una cohorte de 657 mil niños lo contradice.',
    );
    await tester.pump();
    expect(publish().onPressed, isNotNull);
    await tester.tap(find.byKey(const Key('sci-publish')));
    await tester.pumpAndSettle();

    expect(find.text('Tu comentario está en revisión'), findsOneWidget);
    expect(core.science.studyCalls, <String>[hviid.doi]);
    // Its author sees it at full opacity with the «En revisión» tag.
    expect(find.text('En revisión'), findsOneWidget);
    expect(find.text('con estudio'), findsOneWidget);
    expect(
      find
          .byType(Opacity)
          .evaluate()
          .where((Element e) => (e.widget as Opacity).opacity < 1),
      isEmpty,
    );
  });

  testWidgets('C2 · a preprint can be cited; a retracted study cannot', (
    WidgetTester tester,
  ) async {
    final ArenaScienceCore core = ArenaScienceCore();
    await pumpArena(tester, core);
    await _openVaccineComments(tester);

    await _pickStudy(tester, wakefield);
    expect(
      find.text('La revista retractó este artículo el 2 feb 2010'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('sci-publish')))
          .onPressed,
      isNull,
    );
    await tester.tap(find.byKey(const Key('sci-sheet-cancel')));
    await tester.pumpAndSettle();

    await _pickStudy(tester, bendavid);
    expect(find.textContaining('Preprint'), findsWidgets);
    await tester.tap(
      find.byKey(const ValueKey<String>('sci-claim-$calendarClaimId')),
    );
    await tester.tap(
      find.byKey(const ValueKey<String>('sci-relation-contexto')),
    );
    await tester.pump();
    // A fragment shorter than 6 words and 40 characters shows no relation.
    await _selectFragment(tester, 'prevalence of antibodies to SARS-CoV-2');
    expect(find.byKey(const Key('sci-fragment-short')), findsOneWidget);
    await _selectFragment(
      tester,
      'prevalence of antibodies to SARS-CoV-2 in Santa Clara',
    );
    expect(find.byKey(const Key('sci-fragment-short')), findsNothing);
    expect(find.byKey(const Key('sci-fragment')), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('sci-comment-input')),
      'Da contexto sobre cómo se mide la inmunidad.',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('sci-publish')));
    await tester.pumpAndSettle();
    expect(core.science.studyCalls, <String>[bendavid.doi]);
    expect(find.text('Tu comentario está en revisión'), findsOneWidget);
  });

  testWidgets('C2 · the same study on the same claim is a duplicate', (
    WidgetTester tester,
  ) async {
    final DateTime now = DateTime.now();
    final ArenaScienceCore core = ArenaScienceCore(
      science: FakeScienceRepository(
        comments: <String, List<StoryComment>>{
          vaccineEventId: sampleThread(now),
        },
      ),
    );
    await pumpArena(tester, core);
    await _openVaccineComments(tester);
    await _pickStudy(tester, hviid);
    await tester.tap(
      find.byKey(const ValueKey<String>('sci-claim-$vaccineClaimId')),
    );
    await tester.pump();
    expect(
      find.text('Este estudio ya está conectado a esta afirmación'),
      findsOneWidget,
    );
    expect(find.text('Ver comentario'), findsOneWidget);
  });

  testWidgets('C2 · a duplicate still in review is named, never linked', (
    WidgetTester tester,
  ) async {
    final DateTime now = DateTime.now();
    final List<StoryComment> thread = <StoryComment>[
      for (final StoryComment c in sampleThread(now))
        c.attachment == null ? c : c.copyWith(status: CommentStatus.inReview),
    ];
    final ArenaScienceCore core = ArenaScienceCore(
      science: FakeScienceRepository(
        comments: <String, List<StoryComment>>{vaccineEventId: thread},
      ),
    );
    await pumpArena(tester, core);
    await _openVaccineComments(tester);
    await _pickStudy(tester, hviid);
    await tester.tap(
      find.byKey(const ValueKey<String>('sci-claim-$vaccineClaimId')),
    );
    await tester.pump();
    expect(
      find.text('Ya hay un aporte con este estudio en revisión'),
      findsOneWidget,
    );
    expect(find.text('Ver comentario'), findsNothing);
  });

  testWidgets('C3 · mixed thread, filters, replies and reactions', (
    WidgetTester tester,
  ) async {
    final DateTime now = DateTime.now();
    final List<StoryComment> thread = <StoryComment>[
      ...sampleThread(now),
      for (int i = 0; i < 3; i++)
        StoryComment(
          id: 'r$i',
          author: 'lector_$i',
          parentId: 'c1',
          body: 'Respuesta $i',
          createdAt: now.subtract(Duration(minutes: 30 - i)),
        ),
    ];
    final ArenaScienceCore core = ArenaScienceCore(
      science: FakeScienceRepository(
        comments: <String, List<StoryComment>>{vaccineEventId: thread},
      ),
    );
    await pumpArena(tester, core);
    await _openVaccineComments(tester);

    expect(find.text('Comentarios 6'), findsOneWidget);
    expect(find.text('Todos 6'), findsOneWidget);
    expect(find.text('Con estudio 1'), findsOneWidget);
    // Recent first: the study comment leads; scroll to the normal one.
    final Finder camila = find.textContaining('@camila_r', findRichText: true);
    await tester.scrollUntilVisible(
      camila,
      200,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('arena-event-scroll')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    expect(camila, findsOneWidget);
    // The relation reads in bold inside the author's own sentence; no tally
    // of relations anywhere.
    expect(
      find.textContaining('lo contradice', findRichText: true),
      findsOneWidget,
    );
    expect(find.textContaining('contradicen'), findsNothing);
    // Two replies shown, the third behind «Ver 1 respuesta más».
    expect(find.text('Respuesta 0'), findsOneWidget);
    expect(find.text('Respuesta 2'), findsNothing);
    await tester.ensureVisible(find.text('Ver 1 respuesta más'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ver 1 respuesta más'));
    await tester.pumpAndSettle();
    expect(find.text('Respuesta 2'), findsOneWidget);

    // Screen-reader summary of the study comment.
    final StoryComment study = thread[1];
    expect(
      commentSemantics(study, now: now),
      'Comentario de @lectora_vina, hace 1 hora, con estudio. Responde a: '
      'Las vacunas provocan autismo. ${study.body} Estudio adjunto: '
      '${hviid.title}, cohorte, revisado por pares.',
    );

    await tester.scrollUntilVisible(
      find.byKey(const Key('sci-comments-study')),
      -300,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('arena-event-scroll')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.tap(find.byKey(const Key('sci-comments-study')));
    await tester.pumpAndSettle();
    expect(find.textContaining('@camila_r', findRichText: true), findsNothing);
    expect(
      find.textContaining('@lectora_vina', findRichText: true),
      findsOneWidget,
    );
    await tester.ensureVisible(find.text('Pertinente · 28'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pertinente · 28'));
    await tester.pumpAndSettle();
    expect(find.text('Pertinente · 29'), findsOneWidget);

    // «Ver etiqueta completa» is a 44 pt target and opens C4.
    final Finder attachment = find.byKey(
      ValueKey<String>('sci-attachment-${hviid.doi}'),
    );
    expect(tester.getSize(attachment).height, greaterThanOrEqualTo(44));
    await tester.tap(attachment);
    await tester.pumpAndSettle();
    expect(find.text('Etiqueta del estudio'), findsOneWidget);
  });

  testWidgets('C4 · label rows, «No informado» and the retraction', (
    WidgetTester tester,
  ) async {
    final ArenaScienceCore core = ArenaScienceCore();
    await pumpArena(tester, core);
    await _switchToScience(tester);
    await tester.scrollUntilVisible(
      find.text(wakefield.title),
      300,
      scrollable: find.byType(Scrollable).last,
    );
    final Finder ficha = find.descendant(
      of: find.byKey(ValueKey<String>('sci-study-${wakefield.doi}')),
      matching: find.text('Ver ficha'),
    );
    await tester.ensureVisible(ficha);
    await tester.pumpAndSettle();
    await tester.tap(ficha);
    await tester.pumpAndSettle();
    for (final String section in <String>[
      'IDENTIDAD',
      'DISEÑO',
      'TRANSPARENCIA',
      'ESTADO',
    ]) {
      expect(find.text(section), findsOneWidget);
    }
    expect(find.text('Sí, 2 feb 2010'), findsOneWidget);
    expect(find.text('No informado'), findsWidgets);
    expect(find.text(wakefield.doi), findsOneWidget);
    expect(
      find.text(
        'Datos tomados del propio artículo y de la revista. '
        'Dialektik no califica estudios ni revistas.',
        skipOffstage: false,
      ),
      findsOneWidget,
    );
    await tester.scrollUntilVisible(
      find.byKey(const Key('sci-label-original')),
      200,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('sci-label-scroll')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.pumpAndSettle();
    expect(
      tester.getSize(find.byKey(const Key('sci-label-original'))).height,
      greaterThanOrEqualTo(48),
    );
    await tester.tap(find.byKey(const Key('sci-label-original')));
    await tester.pumpAndSettle();
  });
}
