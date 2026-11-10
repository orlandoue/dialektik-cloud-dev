import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

/// The owner reads with large Android text. Any `RenderFlex overflowed`
/// raised while walking the six screens fails these tests.
void main() {
  const double scale = 1.45;

  for (final Size size in const <Size>[Size(360, 740), Size(412, 915)]) {
    final String device = '${size.width.toInt()}x${size.height.toInt()}';

    Future<void> scrollThrough(WidgetTester tester, String key) async {
      final Finder scroll = find.byKey(Key(key));
      for (int i = 0; i < 12; i++) {
        await tester.drag(scroll, const Offset(0, -500));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '$key paso $i');
      }
      for (int i = 0; i < 12; i++) {
        await tester.drag(scroll, const Offset(0, 500));
        await tester.pumpAndSettle();
      }
      expect(tester.takeException(), isNull, reason: key);
    }

    Future<void> tapTab(WidgetTester tester, String label) async {
      await tester.tap(
        find.descendant(
          of: find.byKey(const Key('arena-bottom-navigation')),
          matching: find.text(label),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'pestaña $label');
    }

    testWidgets('fuente 1.45 sin desbordes · Inicio y Explorar · $device', (
      WidgetTester tester,
    ) async {
      await pumpArena(tester, ArenaFakeCore(), textScale: scale, size: size);
      expect(
        MediaQuery.textScalerOf(
          tester.element(find.byKey(const Key('arena-coliseo-scroll'))),
        ),
        const TextScaler.linear(scale),
      );
      expect(tester.takeException(), isNull);
      await scrollThrough(tester, 'arena-coliseo-scroll');

      await tester.tap(
        find.byKey(const ValueKey<String>('arena-pill-Explorar')),
      );
      await tester.pumpAndSettle();
      await scrollThrough(tester, 'arena-explore-scroll');
      await tester.tap(find.byKey(const Key('arena-blindspot-banner')));
      await tester.pumpAndSettle();
      expect(find.text('Acontecimientos fuera de tus medios'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pageBack();
      await tester.pumpAndSettle();

      final Finder following = find.byKey(
        const ValueKey<String>('arena-pill-Siguiendo'),
      );
      await tester.ensureVisible(following);
      await tester.pumpAndSettle();
      await tester.tap(following);
      await tester.pumpAndSettle();
      await scrollThrough(tester, 'arena-following-scroll');

      await tester.tap(find.byKey(const Key('arena-search')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('arena-search-input')),
        'codelco',
      );
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(find.text(storyTitle), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('fuente 1.45 sin desbordes · VS, duelo y comunidad · $device', (
      WidgetTester tester,
    ) async {
      await pumpArena(
        tester,
        ArenaFakeCore(),
        textScale: scale,
        size: size,
        initialTab: ArenaTab.vs,
      );
      await scrollThrough(tester, 'arena-vs-scroll');
      await reveal(tester, find.text(duelTitle), 'arena-vs-scroll');
      await tester.tap(find.text(duelTitle));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      for (final String tab in <String>[
        'Evidencia',
        'Contexto',
        'Análisis IA',
      ]) {
        final Finder target = find.byKey(ValueKey<String>('arena-subtab-$tab'));
        await reveal(tester, target, 'arena-duel-scroll');
        await tester.ensureVisible(target);
        await tester.pumpAndSettle();
        await tester.tap(target);
        await tester.pumpAndSettle();
        await scrollThrough(tester, 'arena-duel-scroll');
      }
      // The fixed vote button grows with the text instead of clipping it.
      final Finder vote = find.byKey(const Key('arena-vote-button'));
      expect(tester.getSize(vote).height, greaterThanOrEqualTo(48));
      await tester.tap(vote);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Abrir comunidad del caso'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Abrir comunidad del caso'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      for (final String pill in <String>['Debate', 'Notas', 'Aportes']) {
        await tester.tap(find.byKey(ValueKey<String>('arena-pill-$pill')));
        await tester.pumpAndSettle();
        await scrollThrough(tester, 'arena-community-scroll');
      }
      await tester.tap(find.byKey(const Key('arena-community-attach')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('fuente 1.45 sin desbordes · Historias y caso vivo · $device', (
      WidgetTester tester,
    ) async {
      await pumpArena(
        tester,
        ArenaFakeCore(),
        textScale: scale,
        size: size,
        initialTab: ArenaTab.historias,
      );
      await scrollThrough(tester, 'arena-stories-scroll');
      for (final String title in <String>[storyTitle, duelTitle]) {
        await reveal(tester, find.text(title), 'arena-stories-scroll');
        await tester.ensureVisible(find.text(title));
        await tester.pumpAndSettle();
        await tester.tap(find.text(title));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        for (final String tab in <String>[
          'Resumen',
          'Cronología',
          'Versiones',
          'Evidencia',
        ]) {
          final Finder target = find.byKey(
            ValueKey<String>('arena-subtab-$tab'),
          );
          await reveal(tester, target, 'arena-event-scroll');
          await tester.ensureVisible(target);
          await tester.pumpAndSettle();
          await tester.tap(target);
          await tester.pumpAndSettle();
          await scrollThrough(tester, 'arena-event-scroll');
        }
        await tester.pageBack();
        await tester.pumpAndSettle();
      }
    });

    testWidgets(
      'fuente 1.45 sin desbordes · Medios, perfil de medio y Perfil · $device',
      (WidgetTester tester) async {
        await pumpArena(
          tester,
          ArenaFakeCore(),
          textScale: scale,
          size: size,
          initialTab: ArenaTab.medios,
        );
        await scrollThrough(tester, 'arena-media-tab-scroll');
        final Finder card = find.byKey(
          const ValueKey<String>('arena-media-$terceraId'),
        );
        await reveal(tester, card, 'arena-media-tab-scroll');
        await tester.tap(
          find.descendant(of: card, matching: find.text('La Tercera')),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        for (final String tab in <String>[
          'Radiografía',
          'Cobertura',
          'Historial',
        ]) {
          final Finder target = find.byKey(
            ValueKey<String>('arena-subtab-$tab'),
          );
          await reveal(tester, target, 'arena-media-scroll');
          await tester.ensureVisible(target);
          await tester.pumpAndSettle();
          await tester.tap(target);
          await tester.pumpAndSettle();
          await scrollThrough(tester, 'arena-media-scroll');
        }
        await tester.tap(find.byKey(const Key('arena-media-compare')));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(ListTile, 'BioBioChile'));
        await tester.pumpAndSettle();
        expect(find.text('Comparar cobertura'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pageBack();
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Volver'));
        await tester.pumpAndSettle();

        await tapTab(tester, 'Perfil');
        await scrollThrough(tester, 'arena-profile-scroll');
        await tapTab(tester, 'Inicio');
        await tapTab(tester, 'VS');
        await tapTab(tester, 'Historias');
      },
    );
  }
}
