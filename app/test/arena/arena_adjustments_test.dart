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

    test('una encuesta de aprobación es Política aunque Core diga Otros', () {
      expect(
        arenaTopicOfText('Aprobación de Kast baja a 27%', category: 'otros'),
        ArenaTopic.politica,
      );
      expect(
        arenaTopicOfText(
          'La aprobación de Kast se sitúa por primera vez bajo el 20%',
        ),
        ArenaTopic.politica,
      );
      // A real topic from Core still wins over the headline.
      expect(
        arenaTopicOfText('Encuesta sobre fútbol', category: 'deportes'),
        ArenaTopic.deportes,
      );
      expect(
        arenaTopicOfText('Hallazgo sin tema', category: 'otros'),
        ArenaTopic.otros,
      );
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

        // The card shows the two versions without their outlets.
        expect(
          find.descendant(of: duel, matching: find.text('VERSIÓN A')),
          findsOneWidget,
        );
        expect(
          find.descendant(of: duel, matching: find.byType(DuelFaceOff)),
          findsNothing,
        );

        // The whole card opens the duel.
        await tester.tap(
          find.descendant(of: duel, matching: find.text(steinertTitle)),
        );
        await tester.pumpAndSettle();
        expect(find.text(steinertTitle), findsOneWidget);
        expect(
          find.bySemanticsLabel(
            'Tipo de duelo según Dialektik: Distinto enfoque. Toca para '
            'saber qué significa',
          ),
          findsOneWidget,
        );
        expect(find.textContaining('nuevo cargo»'), findsNothing);
        expect(find.text('nuevo cargo'), findsNothing);
        expect(find.text(steinertHeadline), findsOneWidget);
        expect(find.text('Titular de su publicación'), findsOneWidget);
        expect(
          find.text('Cita literal · verificada contra el original'),
          findsOneWidget,
        );

        await reveal(
          tester,
          find.byKey(const ValueKey<String>('arena-subtab-Qué significa')),
          'arena-duel-scroll',
        );
        await tester.ensureVisible(
          find.byKey(const ValueKey<String>('arena-subtab-Qué significa')),
        );
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey<String>('arena-subtab-Qué significa')),
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
    'acontecimiento vivo: resumen sustantivo y Seguir en la cabecera',
    (WidgetTester tester) async {
      await pumpArena(
        tester,
        ArenaServedCore(),
        initialTab: ArenaTab.historias,
      );
      await tester.tap(find.text(steinertTitle));
      await tester.pumpAndSettle();

      // Compact header: the case, its topic and outlets, and «Seguir».
      final Finder follow = find.byKey(const Key('arena-follow-story'));
      expect(
        find.descendant(of: find.byType(AppBar), matching: follow),
        findsOneWidget,
      );
      expect(tester.getSize(follow).height, greaterThanOrEqualTo(44));
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.textContaining('2 medios'),
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Sin seguir'), findsNothing);

      // A two-word fragment is never a position; the headline stands in,
      // attributed to its outlet, once.
      // The loose fragment alone never stands for a position.
      expect(find.text('nuevo cargo'), findsNothing);
      expect(
        find.textContaining('Según T13: nuevo cargo', findRichText: true),
        findsNothing,
      );
      expect(
        find.textContaining('Según BioBioChile: ', findRichText: true),
        findsOneWidget,
      );
      // T13's two-word fragment is replaced by its own headline.
      expect(
        find.textContaining('Según T13: $steinertHeadline', findRichText: true),
        findsOneWidget,
      );
      expect(find.text('Qué pasó'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Inicio sin selector de país: la edición vive en Perfil', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore(), size: const Size(360, 740));
    expect(find.byKey(const Key('arena-country')), findsNothing);
    expect(find.byKey(const Key('arena-topic-filter')), findsNothing);
    // Brand, search and alerts share the header; the duel follows at once.
    expect(
      tester.getCenter(find.text('Dialektik')).dy,
      closeTo(tester.getCenter(find.byKey(const Key('arena-search'))).dy, 12),
    );
    expect(find.byKey(const Key('arena-duel-of-the-day')), findsOneWidget);

    await tester.tap(
      find.descendant(
        of: find.byKey(const Key('arena-bottom-navigation')),
        matching: find.text('Perfil'),
      ),
    );
    await tester.pumpAndSettle();
    final Finder edition = find.byKey(const Key('arena-edition'));
    await reveal(tester, edition, 'arena-profile-scroll');
    expect(find.text('Edición: Chile'), findsOneWidget);
    await tester.tap(edition);
    await tester.pumpAndSettle();
    for (final String name in <String>[
      'Chile',
      'España',
      'Argentina',
      'EE. UU.',
    ]) {
      expect(find.text(name), findsWidgets);
    }
    // Only Chile is open; the others are listed as «Pronto».
    expect(find.text('Pronto'), findsNWidgets(3));
    await tester.tap(find.text('Cerrar'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'si Core rechaza uno de los registros del medio, se sigue igual y sin error',
    (WidgetTester tester) async {
      final ArenaServedCore core = ArenaServedCore()..followed.clear();
      core.refusedFollows.add(terceraVideo.id);
      await pumpArena(tester, core, initialTab: ArenaTab.medios);
      final Finder card = find.byKey(
        const ValueKey<String>('arena-media-$terceraId'),
      );
      await tester.tap(
        find.descendant(of: card, matching: find.text('Seguir')),
      );
      await tester.pumpAndSettle();
      expect(core.followed, <String>{terceraId});
      expect(find.text('No se pudo actualizar el seguimiento.'), findsNothing);
      expect(find.textContaining('medios · sigues 1'), findsOneWidget);
    },
  );

  testWidgets(
    'solo si Core rechaza todos los registros del medio se avisa el error',
    (WidgetTester tester) async {
      final ArenaServedCore core = ArenaServedCore()..followed.clear();
      core.refusedFollows.addAll(<String>{terceraId, terceraVideo.id});
      await pumpArena(tester, core, initialTab: ArenaTab.medios);
      final Finder card = find.byKey(
        const ValueKey<String>('arena-media-$terceraId'),
      );
      await tester.tap(
        find.descendant(of: card, matching: find.text('Seguir')),
      );
      await tester.pumpAndSettle();
      expect(core.followed, isEmpty);
      expect(
        find.text('No se pudo actualizar el seguimiento.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'un medio registrado dos veces aparece una vez y se sigue completo',
    (WidgetTester tester) async {
      final ArenaServedCore core = ArenaServedCore()..followed.clear();
      await pumpArena(tester, core, initialTab: ArenaTab.medios);
      expect(find.textContaining('medios · sigues 0'), findsOneWidget);
      expect(find.text('La Tercera'), findsOneWidget);
      final Finder card = find.byKey(
        const ValueKey<String>('arena-media-$terceraId'),
      );
      // One row per outlet, tall enough to tap comfortably.
      expect(tester.getSize(card).height, greaterThanOrEqualTo(64));
      await tester.tap(
        find.descendant(of: card, matching: find.text('Seguir')),
      );
      await tester.pumpAndSettle();
      expect(core.followed, <String>{terceraId, terceraVideo.id});
      expect(find.textContaining('medios · sigues 1'), findsOneWidget);

      await tester.tap(
        find.descendant(
          of: find.byKey(const Key('arena-bottom-navigation')),
          matching: find.text('Perfil'),
        ),
      );
      await tester.pumpAndSettle();
      await reveal(
        tester,
        find.text('Medios que sigues · 1'),
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
