import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

void main() {
  group('ajustes de formato', () {
    test('el prefijo de relación se quita del título', () {
      expect(
        arenaTitle('Contraste de enfoques: $steinertTitle'),
        steinertTitle,
      );
      expect(arenaTitle('Contradicción: Caso X'), 'Caso X');
      expect(arenaTitle(steinertTitle), steinertTitle);
    });

    test('el proceso político no cae en Otros', () {
      for (final String title in <String>[
        '¿Qué va a pasar con la presentación de la AC contra Rabat?',
        'La oposición rechaza el informe de la comisión',
        'Acusación constitucional avanza en el Senado',
        'Diputados citan al ministro',
      ]) {
        expect(arenaTopicOfText(title), ArenaTopic.politica, reason: title);
      }
      expect(
        arenaTopicOfText('Carabineros detiene a banda'),
        ArenaTopic.seguridad,
      );
      // «AC» only as the abbreviation, never inside another word.
      expect(arenaTopicOfText('Actividad sin clasificar'), ArenaTopic.otros);
    });

    test('la edad completa es indivisible', () {
      final DateTime now = DateTime(2026, 11, 10, 12);
      expect(
        arenaAgo(now.subtract(const Duration(hours: 1)), now: now),
        'hace 1 h',
      );
    });

    test(
      'una cita de dos palabras se reemplaza por el titular de esa fuente',
      () {
        final ({String text, bool literal}) posture = arenaPostureText(
          steinertEvent,
          steinertEvent.coveragePositions[1],
        );
        expect(posture.text, steinertHeadline);
        expect(posture.literal, isFalse);
        expect(
          arenaPositionSummary(
            steinertEvent,
            steinertEvent.coveragePositions[1],
          ),
          steinertHeadline,
        );
        final ({String text, bool literal}) full = arenaPostureText(
          steinertEvent,
          steinertEvent.coveragePositions[0],
        );
        expect(full.literal, isTrue);
      },
    );
  });

  for (final double scale in <double>[1, 1.45]) {
    testWidgets(
      'duelo servido por Core: sin prefijo, una fila y píldora activa '
      '· escala $scale',
      (WidgetTester tester) async {
        await pumpArena(
          tester,
          ArenaServedCore(),
          textScale: scale,
          size: const Size(360, 740),
        );
        final Finder duel = find.byKey(const Key('arena-duel-of-the-day'));
        expect(
          find.descendant(of: duel, matching: find.text(steinertTitle)),
          findsOneWidget,
        );
        expect(find.textContaining('Contraste de enfoques:'), findsNothing);

        // Medio 1 · VS · Medio 2 share one horizontal row.
        final Finder faceOff = find.descendant(
          of: duel,
          matching: find.byType(DuelFaceOff),
        );
        final Finder a = find.descendant(
          of: faceOff,
          matching: find.text('BioBioChile'),
        );
        final Finder vs = find.descendant(
          of: faceOff,
          matching: find.text('VS'),
        );
        // The emblem also reads «T13»; the name is the last match.
        final Finder b = find
            .descendant(of: faceOff, matching: find.text('T13'))
            .last;
        expect(tester.getCenter(a).dy, closeTo(tester.getCenter(vs).dy, 1));
        expect(tester.getCenter(b).dy, closeTo(tester.getCenter(vs).dy, 1));
        expect(tester.getCenter(a).dx, lessThan(tester.getCenter(vs).dx));
        expect(tester.getCenter(vs).dx, lessThan(tester.getCenter(b).dx));
        // The name stays on a single line instead of breaking inside the word.
        expect(tester.getSize(a).height, lessThan(30 * scale));

        await tester.ensureVisible(find.byTooltip('Abrir duelo completo'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Abrir duelo completo'));
        await tester.pumpAndSettle();
        expect(find.text(steinertTitle), findsOneWidget);
        expect(
          find.bySemanticsLabel('Clasificación: Distinto enfoque'),
          findsOneWidget,
        );
        expect(find.textContaining('nuevo cargo”'), findsNothing);
        expect(find.text('nuevo cargo'), findsNothing);
        expect(find.text(steinertHeadline), findsOneWidget);
        expect(find.text('Titular de su publicación'), findsOneWidget);
        expect(find.text('Cita literal verificada'), findsOneWidget);

        await reveal(
          tester,
          find.byKey(const ValueKey<String>('arena-subtab-Análisis IA')),
          'arena-duel-scroll',
        );
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('arena-subtab-Análisis IA')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey<String>('arena-subtab-Análisis IA')),
        );
        await tester.pumpAndSettle();
        await reveal(
          tester,
          find.text('Por qué es distinto enfoque'),
          'arena-duel-scroll',
        );
        expect(
          find.textContaining('no tiene una clasificación publicada'),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'acontecimiento vivo: resumen sustantivo y fila única de seguir',
    (WidgetTester tester) async {
      await pumpArena(
        tester,
        ArenaServedCore(),
        initialTab: ArenaTab.historias,
      );
      await tester.tap(find.text(steinertTitle));
      await tester.pumpAndSettle();

      final Finder sources = find.text('📚 2 fuentes');
      final Finder follow = find.byKey(const Key('arena-follow-story'));
      expect(
        tester.getCenter(sources).dy,
        closeTo(tester.getCenter(follow).dy, 12),
      );
      expect(
        tester.getCenter(sources).dx,
        lessThan(tester.getCenter(follow).dx),
      );
      expect(find.textContaining('Sin seguir'), findsNothing);

      expect(find.text('• nuevo cargo'), findsNothing);
      expect(find.text('• $steinertHeadline'), findsOneWidget);
      await reveal(tester, find.text('Qué pasó'), 'arena-event-scroll');
      await reveal(
        tester,
        find.text('Quiénes están involucrados'),
        'arena-event-scroll',
      );
      // «Qué pasó» explains the fact; it never repeats the header title.
      final Iterable<String?> texts = tester
          .widgetList<Text>(find.byType(Text))
          .map((Text t) => t.data);
      expect(
        texts.where(
          (String? t) => t != null && t.startsWith('Según BioBioChile:'),
        ),
        hasLength(1),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Inicio: país en la cabecera y Tema en la fila de píldoras', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore(), size: const Size(360, 740));
    final Finder country = find.byKey(const Key('arena-country'));
    final Finder topic = find.byKey(const Key('arena-topic-filter'));
    final Finder coliseo = find.byKey(
      const ValueKey<String>('arena-pill-Coliseo'),
    );
    expect(
      tester.getCenter(country).dy,
      closeTo(tester.getCenter(find.text('Dialektik')).dy, 12),
    );
    expect(
      tester.getCenter(country).dx,
      lessThan(tester.getCenter(find.byKey(const Key('arena-search'))).dx),
    );
    // The topic dropdown sits on the pill row: no extra row of filters.
    expect(
      tester.getCenter(topic).dy,
      closeTo(tester.getCenter(coliseo).dy, 1),
    );
    expect(
      tester.getTopLeft(topic).dx,
      greaterThan(
        tester
            .getTopRight(
              find.byKey(const ValueKey<String>('arena-pill-Siguiendo')),
            )
            .dx,
      ),
    );
    final double duelTop = tester
        .getTopLeft(find.byKey(const Key('arena-duel-of-the-day')))
        .dy;

    await tester.tap(country);
    await tester.pumpAndSettle();
    expect(find.text('Perú'), findsOneWidget);
    expect(find.text('Argentina'), findsOneWidget);
    expect(find.text('Próximamente'), findsWidgets);
    await tester.tap(find.text('Chile').last);
    await tester.pumpAndSettle();

    await tester.tap(topic);
    await tester.pumpAndSettle();
    for (final String option in <String>[
      'Todos',
      'Política',
      'Justicia',
      'Economía',
      'Seguridad',
      'Deportes',
      'Sociedad',
    ]) {
      expect(find.text(option), findsOneWidget);
    }
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-topic-option-economia')),
    );
    await tester.pumpAndSettle();
    // The chip turns soft violet and names the topic.
    expect(
      find.descendant(of: topic, matching: find.text('Economía')),
      findsOneWidget,
    );
    expect(
      tester
          .widget<Material>(
            find.descendant(of: topic, matching: find.byType(Material)).first,
          )
          .color,
      const Color(0xFFEDE9FE),
    );
    expect(find.byKey(const Key('arena-duel-of-the-day')), findsNothing);
    expect(find.text('No hay duelos publicados en Economía.'), findsOneWidget);
    expect(find.text(storyTitle), findsOneWidget);

    await tester.tap(topic);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-topic-option-todos')),
    );
    await tester.pumpAndSettle();
    // Filtering never pushed the duel of the day down.
    expect(
      tester.getTopLeft(find.byKey(const Key('arena-duel-of-the-day'))).dy,
      duelTop,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'un medio registrado dos veces aparece una vez y se sigue completo',
    (WidgetTester tester) async {
      final ArenaServedCore core = ArenaServedCore()..followed.clear();
      await pumpArena(tester, core, initialTab: ArenaTab.medios);
      expect(find.text('4 fuentes registradas · sigues 0'), findsOneWidget);
      expect(find.text('La Tercera'), findsOneWidget);
      final Finder card = find.byKey(
        const ValueKey<String>('arena-media-$terceraId'),
      );
      expect(tester.getSize(card).width, 168);
      await tester.tap(
        find.descendant(of: card, matching: find.text('+ Seguir')),
      );
      await tester.pumpAndSettle();
      expect(core.followed, <String>{terceraId, terceraVideo.id});
      expect(find.text('4 fuentes registradas · sigues 1'), findsOneWidget);

      await tester.tap(
        find.descendant(
          of: find.byKey(const Key('arena-bottom-navigation')),
          matching: find.text('Perfil'),
        ),
      );
      await tester.pumpAndSettle();
      await reveal(
        tester,
        find.text('Medios que sigues'),
        'arena-profile-scroll',
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('arena-profile-scroll')),
          matching: find.byWidgetPredicate(
            (Widget w) => w is MediaNameRow && w.name.startsWith('La Tercera'),
          ),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
