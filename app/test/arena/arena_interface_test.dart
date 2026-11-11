import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:dialektik/features/arena/presentation/duel_screen.dart';
import 'package:dialektik/features/social/data/arena_social_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

void main() {
  for (final double scale in <double>[1, 1.45]) {
    testWidgets('el duelo del día es un carrusel deslizable con puntos '
        '· escala $scale', (WidgetTester tester) async {
      await pumpArena(
        tester,
        ArenaManyDuelsCore(),
        textScale: scale,
        size: const Size(360, 740),
      );
      final Finder carousel = find.byKey(const Key('arena-duel-carousel'));
      // The five most recent duels, never more.
      expect(
        find.descendant(of: carousel, matching: find.byType(DuelOfTheDayCard)),
        findsNWidgets(5),
      );
      final Finder dots = find.byKey(const Key('arena-duel-dots'));
      expect(
        find.descendant(of: dots, matching: find.byType(AnimatedContainer)),
        findsNWidgets(5),
      );
      double dotWidth(int i) => tester
          .getSize(find.byKey(ValueKey<String>('arena-duel-dot-$i')))
          .width;
      expect(dotWidth(0), greaterThan(dotWidth(1)));

      // Each page fills the viewport; only the first is on screen.
      final Finder first = find.byKey(const Key('arena-duel-of-the-day'));
      final Finder second = find.byKey(const Key('arena-duel-page-1'));
      expect(tester.getSize(first).width, tester.getSize(carousel).width);
      expect(tester.getTopLeft(second).dx, greaterThanOrEqualTo(360 - 16));
      // Every page is as tall as the tallest card: nothing is clipped.
      expect(tester.getSize(first).height, tester.getSize(second).height);

      await tester.drag(carousel, const Offset(-250, 0));
      await tester.pumpAndSettle();
      // The page snapped: the second duel now sits where the first was.
      expect(tester.getTopLeft(second).dx, closeTo(16, 0.5));
      expect(dotWidth(1), greaterThan(dotWidth(0)));
      expect(find.bySemanticsLabel(RegExp('Duelo 2 de 5')), findsOneWidget);

      // Tapping a dot also moves the carousel.
      // With large text the dots sit below the fold: scroll to them first.
      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('arena-duel-dot-4')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('arena-duel-dot-4')));
      await tester.pumpAndSettle();
      expect(
        tester.getTopLeft(find.byKey(const Key('arena-duel-page-4'))).dx,
        closeTo(16, 0.5),
      );
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('con un solo duelo no hay puntos ni deslizamiento', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore());
    expect(find.byKey(const Key('arena-duel-of-the-day')), findsOneWidget);
    expect(find.byKey(const Key('arena-duel-dots')), findsNothing);
  });

  testWidgets('la sección de historias usa la píldora menta refinada', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore());
    final Finder pill = find.byType(ArenaSectionPill);
    await reveal(tester, pill, 'arena-coliseo-scroll');
    final BoxDecoration decoration =
        tester
                .widget<DecoratedBox>(
                  find
                      .descendant(of: pill, matching: find.byType(DecoratedBox))
                      .first,
                )
                .decoration
            as BoxDecoration;
    expect(decoration.color, const Color(0xFFE8F7F0));
    expect(decoration.borderRadius, BorderRadius.circular(20));
    expect((decoration.border! as Border).top.color, const Color(0xFFBBE5D0));
    final Text label = tester.widget<Text>(
      find.descendant(of: pill, matching: find.text('Historias en desarrollo')),
    );
    expect(label.style?.fontSize, 12);
    expect(label.style?.fontWeight, FontWeight.w700);
    expect(label.style?.color, const Color(0xFF065F46));
  });

  testWidgets('cada duelo muestra solo su clasificación, con su estilo', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaManyDuelsCore(), initialTab: ArenaTab.vs);
    BoxDecoration badge() =>
        tester
                .widget<DecoratedBox>(find.byKey(const Key('arena-duel-kind')))
                .decoration
            as BoxDecoration;

    await tester.tap(find.text(ArenaManyDuelsCore.titleOf(0)));
    await tester.pumpAndSettle();
    expect(find.text('⚔️ Contradicción factual'), findsOneWidget);
    expect(find.textContaining('Distinto enfoque'), findsNothing);
    expect(find.textContaining('compatible'), findsNothing);
    expect(badge().color, const Color(0xFFFDE8E8));
    // Informative only: the badge is not a button.
    expect(
      find.ancestor(
        of: find.byKey(const Key('arena-duel-kind')),
        matching: find.byType(InkWell),
      ),
      findsNothing,
    );
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text(ArenaManyDuelsCore.titleOf(1)));
    await tester.pumpAndSettle();
    expect(find.text('⚡ Distinto enfoque'), findsOneWidget);
    expect(find.textContaining('Contradicción'), findsNothing);
    expect(badge().color, const Color(0xFFEDE9FE));
  });

  testWidgets('Evidencia: enlaces evidentes y aporte de un enlace con nota', (
    WidgetTester tester,
  ) async {
    final ArenaFullCore core = ArenaFullCore();
    final List<Uri> opened = await pumpArena(
      tester,
      core,
      initialTab: ArenaTab.vs,
    );
    await tester.tap(find.text(duelTitle));
    await tester.pumpAndSettle();

    final Finder link = find.byKey(
      const ValueKey<String>('arena-source-link-art1'),
    );
    await reveal(tester, link, 'arena-duel-scroll');
    final Text headline = tester.widget<Text>(
      find.descendant(
        of: link,
        matching: find.text(
          'Defensa de Hermosilla confirma conversaciones con fiscalía',
        ),
      ),
    );
    expect(headline.style?.fontSize, 14.5);
    expect(headline.style?.fontWeight, FontWeight.w700);
    expect(headline.style?.color, const Color(0xFF1A1A1A));
    expect(
      find.descendant(of: link, matching: find.byType(MediaEmblem)),
      findsOneWidget,
    );
    expect(
      find.descendant(of: link, matching: find.text('Leer en medio original')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: link, matching: find.byIcon(Icons.open_in_new)),
      findsOneWidget,
    );
    await tester.tap(
      find.descendant(of: link, matching: find.text('Leer en medio original')),
    );
    expect(opened.single.toString(), 'https://latercera.com/nota/art1');

    final Finder add = find.byKey(const Key('arena-add-evidence'));
    await reveal(tester, add, 'arena-duel-scroll');
    expect(
      find.descendant(of: add, matching: find.byIcon(Icons.add_link_rounded)),
      findsOneWidget,
    );
    await tester.tap(add);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('arena-evidence-link')),
      'sin-esquema.cl/doc',
    );
    await tester.tap(find.byKey(const Key('arena-evidence-send')));
    await tester.pumpAndSettle();
    expect(find.textContaining('enlace completo'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('arena-evidence-link')),
      'https://www.pjud.cl/resolucion.pdf',
    );
    await tester.enterText(
      find.byKey(const Key('arena-evidence-note')),
      'Resolución del tribunal sobre el procedimiento.',
    );
    await tester.tap(find.byKey(const Key('arena-evidence-send')));
    await tester.pumpAndSettle();
    expect(core.entries.first.channel, CommunityChannel.aporte);
    expect(
      core.entries.first.url.toString(),
      'https://www.pjud.cl/resolucion.pdf',
    );
    expect(
      core.entries.first.body,
      'Resolución del tribunal sobre el procedimiento.',
    );
    expect(
      find.text('Tu aporte quedó publicado en la comunidad.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('el botón inferior invita a tomar partido', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFullCore(), initialTab: ArenaTab.vs);
    await tester.tap(find.text(duelTitle));
    await tester.pumpAndSettle();
    final Finder button = find.byKey(const Key('arena-vote-button'));
    expect(
      find.descendant(
        of: button,
        matching: find.text('¿A qué versión le crees más?'),
      ),
      findsOneWidget,
    );
    expect(find.textContaining('tiene más respaldo'), findsNothing);
    expect(
      find.descendant(of: button, matching: find.byIcon(Icons.bolt)),
      findsOneWidget,
    );
    final BoxDecoration decoration =
        tester
                .widget<DecoratedBox>(
                  find
                      .descendant(
                        of: button,
                        matching: find.byType(DecoratedBox),
                      )
                      .first,
                )
                .decoration
            as BoxDecoration;
    expect((decoration.gradient! as LinearGradient).colors, const <Color>[
      Color(0xFF6D28D9),
      Color(0xFF4F46E5),
    ]);
    expect(decoration.borderRadius, BorderRadius.circular(24));
    expect(decoration.boxShadow, isNotEmpty);
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.text('La Tercera · 2 votos'), findsOneWidget);
  });

  testWidgets('la comunidad se lee como un hilo con burbujas', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFullCore(), initialTab: ArenaTab.vs);
    await tester.tap(find.text(duelTitle));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arena-vote-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Abrir comunidad del caso'));
    await tester.pumpAndSettle();

    final Finder entry = find.byKey(const ValueKey<String>('arena-entry-e2'));
    // Avatar with the initials of the alias, then name and relative time.
    expect(
      find.descendant(of: entry, matching: find.text('AP')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: entry, matching: find.textContaining('Ana P.')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: entry, matching: find.textContaining('hace 3 h')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: entry, matching: find.text('PDF')),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('arena-entry-up-e2')),
        matching: find.text('5'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey<String>('arena-entry-down-e2')),
        matching: find.text('1'),
      ),
      findsOneWidget,
    );
    // The quick-entry bar stays fixed at the bottom of the screen.
    final Finder input = find.byKey(const Key('arena-community-input'));
    expect(
      find.text('Aporta contexto, evidencia o tu análisis...'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('arena-community-attach')), findsOneWidget);
    expect(
      tester.getCenter(input).dy,
      greaterThan(tester.getBottomLeft(entry).dy),
    );
    await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Debate')));
    await tester.pumpAndSettle();
    expect(find.text('Opiniones e interpretaciones'), findsNothing);
    expect(find.text('L3'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
