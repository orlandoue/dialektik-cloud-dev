import 'package:dialektik/features/arena/data/arena_format.dart';
import 'package:dialektik/features/arena/presentation/arena_shell.dart';
import 'package:dialektik/features/arena/presentation/arena_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'arena_fixtures.dart';

void main() {
  group('formato', () {
    test('las edades usan espacio duro para no dejar la unidad suelta', () {
      final DateTime now = DateTime(2026, 11, 10, 12);
      expect(
        arenaAgo(now.subtract(const Duration(days: 4)), now: now),
        'hace\u00A04\u00A0d',
      );
      expect(
        arenaAgo(now.subtract(const Duration(hours: 3)), now: now),
        'hace\u00A03\u00A0h',
      );
    });

    test('una cita que parte en minúscula se marca como fragmento', () {
      expect(arenaQuote('no existe acuerdo'), '“[...] no existe acuerdo”');
      expect(arenaQuote('La defensa confirmó'), '“La defensa confirmó”');
    });

    test('los temas siguen los patrones de Core', () {
      expect(
        arenaTopicOfText('Fiscal pide condena por fraude'),
        ArenaTopic.justicia,
      );
      expect(arenaTopicOfText('', category: 'economia'), ArenaTopic.economia);
      expect(arenaTopicOfText('Algo sin clasificar'), ArenaTopic.otros);
    });

    test('los emblemas conocidos usan su sigla', () {
      expect(arenaEmblemOf('La Tercera').label, 'LT');
      expect(arenaEmblemOf('BioBioChile').label, 'RBB');
      expect(arenaEmblemOf('CIPER Chile').label, 'CiPER');
      expect(arenaEmblemOf('24 Horas TVN (YouTube)').label, '24H');
      expect(arenaEmblemOf('ADN Radio').label, 'ADN');
    });
  });

  testWidgets('navegación inferior con las 5 pestañas exactas', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore());
    final Finder bar = find.byKey(const Key('arena-bottom-navigation'));
    for (final String label in <String>[
      'Inicio',
      'VS',
      'Historias',
      'Medios',
      'Perfil',
    ]) {
      expect(
        find.descendant(of: bar, matching: find.text(label)),
        findsOneWidget,
      );
    }
    await tester.tap(find.descendant(of: bar, matching: find.text('Medios')));
    await tester.pumpAndSettle();
    expect(find.text('3 fuentes registradas · sigues 1'), findsOneWidget);
    await tester.tap(find.descendant(of: bar, matching: find.text('Perfil')));
    await tester.pumpAndSettle();
    expect(find.text('Configurar mi radar'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'Pantalla 1 · Coliseo muestra duelo del día, desarrollo y video',
    (WidgetTester tester) async {
      await pumpArena(tester, ArenaFakeCore());
      expect(find.text('Dialektik'), findsOneWidget);
      expect(find.byKey(const Key('arena-search')), findsOneWidget);
      expect(find.byKey(const Key('arena-alerts')), findsOneWidget);
      for (final String pill in <String>['Coliseo', 'Explorar', 'Siguiendo']) {
        expect(
          find.byKey(ValueKey<String>('arena-pill-$pill')),
          findsOneWidget,
        );
      }
      final Finder duel = find.byKey(const Key('arena-duel-of-the-day'));
      expect(
        find.descendant(of: duel, matching: find.text('🔥 DUELO DEL DÍA')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: duel, matching: find.text(duelTitle)),
        findsOneWidget,
      );
      expect(
        find.descendant(of: duel, matching: find.text('La Tercera')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: duel, matching: find.text('BioBioChile')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: duel, matching: find.text('VS')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: duel,
          matching: find.text('Termómetro de evidencia'),
        ),
        findsOneWidget,
      );
      expect(find.text('67% de respaldo · 3 votos'), findsOneWidget);
      expect(find.byTooltip('Compartir duelo'), findsOneWidget);
      expect(find.byTooltip('Guardar duelo'), findsOneWidget);
      expect(find.byTooltip('Abrir duelo completo'), findsOneWidget);

      await reveal(tester, find.text(storyTitle), 'arena-coliseo-scroll');
      expect(find.text('● EN DESARROLLO'), findsOneWidget);
      expect(
        find.textContaining('3 fuentes · Actualizada hace'),
        findsOneWidget,
      );

      final Finder video = find.text(
        'Debate presidencial: el cruce por pensiones',
      );
      await reveal(tester, video, 'arena-coliseo-scroll');
      final Finder card = find.ancestor(
        of: video,
        matching: find.byType(ArenaVideoCard),
      );
      final AspectRatio frame = tester.widget<AspectRatio>(
        find.descendant(of: card, matching: find.byType(AspectRatio)),
      );
      expect(frame.aspectRatio, 16 / 9);
      expect(
        find.descendant(
          of: card,
          matching: find.byIcon(Icons.play_arrow_rounded),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('las píldoras de Inicio conservan su estado en memoria', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore());
    await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Explorar')));
    await tester.pump();
    expect(find.text('Lo que no viste hoy'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-pill-Siguiendo')),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('La Tercera: balance económico del trimestre'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Coliseo')));
    await tester.pump();
    // A single frame is enough: nothing is refetched or rebuilt from scratch.
    expect(find.byKey(const Key('arena-duel-of-the-day')), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('Pantalla 2 · VS Duelo de Medios con citas, pestañas y voto', (
    WidgetTester tester,
  ) async {
    final ArenaFakeCore core = ArenaFakeCore();
    final List<Uri> opened = await pumpArena(
      tester,
      core,
      initialTab: ArenaTab.vs,
    );
    expect(find.text('VS · Duelos'), findsOneWidget);
    expect(find.text('DISTINTO ENFOQUE'), findsOneWidget);
    await tester.tap(find.text(duelTitle));
    await tester.pumpAndSettle();

    expect(find.text('VS · Duelo de Medios'), findsOneWidget);
    expect(find.textContaining('JUSTICIA · 9'), findsOneWidget);
    for (final String pill in <String>[
      'Contradicción',
      'Distinto enfoque',
      'Compatible',
    ]) {
      expect(find.text(pill), findsOneWidget);
    }
    expect(
      find.text(
        '“La defensa confirmó conversaciones con el Ministerio Público”',
      ),
      findsOneWidget,
    );
    expect(
      find.text('“[...] no existe ni existirá un acuerdo con el imputado”'),
      findsOneWidget,
    );
    // Both posture cards sit side by side with the same height.
    final Finder cards = find.byWidgetPredicate(
      (Widget w) => w.runtimeType.toString() == '_PostureCard',
    );
    expect(cards, findsNWidgets(2));
    expect(tester.getTopLeft(cards.first).dy, tester.getTopLeft(cards.last).dy);
    expect(
      tester.getSize(cards.first).height,
      tester.getSize(cards.last).height,
    );
    expect(
      tester.getTopLeft(cards.first).dx,
      lessThan(tester.getTopLeft(cards.last).dx),
    );

    final Finder original = find.text(
      'Fiscalía descarta acuerdo en el caso Audios',
    );
    await reveal(tester, original, 'arena-duel-scroll');
    await tester.tap(original);
    expect(opened.single.toString(), 'https://biobiochile.cl/nota/art2');
    await reveal(
      tester,
      find.text('¿Qué falta por saber?'),
      'arena-duel-scroll',
    );
    expect(find.text('Cobertura comparada'), findsOneWidget);

    await reveal(
      tester,
      find.byKey(const ValueKey<String>('arena-subtab-Contexto')),
      'arena-duel-scroll',
    );
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-subtab-Contexto')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Antecedentes del acontecimiento'), findsOneWidget);
    expect(
      find.text('• El acta del tribunal respalda esta versión.'),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const ValueKey<String>('arena-subtab-Análisis IA')),
    );
    await tester.pumpAndSettle();
    expect(find.text('En qué coinciden'), findsOneWidget);
    expect(find.text('Por qué es distinto enfoque'), findsOneWidget);

    await tester.tap(find.byKey(const Key('arena-vote-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey<String>('arena-vote-SOLID')));
    await tester.pumpAndSettle();
    expect(core.reactions, <String>['SOLID']);
    expect(find.text('75% de respaldo · 4 votos'), findsWidgets);
    expect(find.text('✓ Tiene respaldo sólido'), findsOneWidget);
    expect(find.text('Abrir comunidad del caso'), findsOneWidget);
    expect(find.text('Crear tarjeta para X y WhatsApp'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Pantalla 3 · Acontecimiento vivo con sus 4 pestañas', (
    WidgetTester tester,
  ) async {
    final List<Uri> opened = await pumpArena(
      tester,
      ArenaFakeCore(),
      initialTab: ArenaTab.historias,
    );
    expect(find.text('Historias vivas'), findsOneWidget);
    final Finder economy = find.byKey(
      const ValueKey<String>('arena-pill-Economía'),
    );
    await tester.ensureVisible(economy);
    await tester.pumpAndSettle();
    await tester.tap(economy);
    await tester.pumpAndSettle();
    expect(find.text(duelTitle), findsNothing);
    await tester.tap(find.text(storyTitle));
    await tester.pumpAndSettle();

    expect(find.text('● ACONTECIMIENTO VIVO'), findsOneWidget);
    expect(find.text('📚 3 fuentes'), findsOneWidget);
    expect(find.byKey(const Key('arena-follow-story')), findsOneWidget);
    expect(find.text('Estado actual'), findsOneWidget);
    expect(find.text('● En desarrollo'), findsOneWidget);

    final Finder change = find.byKey(const Key('arena-last-change'));
    await reveal(tester, change, 'arena-event-scroll');
    expect(
      find.descendant(
        of: change,
        matching: find.textContaining('⚡ Último cambio · '),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: change,
        matching: find.text(
          'Ministra Williams responde por los despidos en Codelco',
        ),
      ),
      findsOneWidget,
    );
    await reveal(tester, find.text('Impacto'), 'arena-event-scroll');
    expect(find.text('Qué pasó'), findsOneWidget);
    expect(find.text('Quiénes están involucrados'), findsOneWidget);

    Future<void> openTab(String label) async {
      final Finder tab = find.byKey(ValueKey<String>('arena-subtab-$label'));
      await tester.dragUntilVisible(
        tab,
        find.byKey(const Key('arena-event-scroll')),
        const Offset(0, 220),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(tab);
      await tester.pumpAndSettle();
      await tester.tap(tab);
      await tester.pumpAndSettle();
    }

    await openTab('Cronología');
    final Finder first = find.text(
      'Codelco confirma 300 despidos en Chuquicamata',
    );
    final Finder second = find.text(
      'Sindicatos de Codelco anuncian movilización',
    );
    await reveal(tester, second, 'arena-event-scroll');
    expect(tester.getTopLeft(first).dy, lessThan(tester.getTopLeft(second).dy));
    expect(tester.widget<Text>(first).style?.color, const Color(0xFF0F172A));
    await tester.tap(second);
    expect(opened.last.toString(), 'https://biobiochile.cl/nota/art4');

    await openTab('Versiones');
    expect(find.text('Las versiones tienen memoria'), findsOneWidget);
    expect(find.text('Anuncio / Primeras coberturas'), findsOneWidget);
    await reveal(tester, find.text('Síntesis vigente'), 'arena-event-scroll');
    expect(find.text('Nuevos ángulos / fuentes sumadas'), findsOneWidget);
    expect(find.textContaining('Se sumaron: BioBioChile, T13'), findsOneWidget);

    await openTab('Evidencia');
    expect(
      find.text('“La estatal confirmó la desvinculación de 300 trabajadores”'),
      findsOneWidget,
    );
    await reveal(
      tester,
      find.byKey(const Key('arena-open-community')),
      'arena-event-scroll',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('un acontecimiento con contraste enlaza su duelo VS', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore(), initialTab: ArenaTab.historias);
    await tester.tap(find.text(duelTitle));
    await tester.pumpAndSettle();
    final Finder open = find.byKey(const Key('arena-open-duel'));
    await reveal(tester, open, 'arena-event-scroll');
    await tester.tap(open);
    await tester.pumpAndSettle();
    expect(find.text('VS · Duelo de Medios'), findsOneWidget);
  });

  testWidgets('Pantalla 4 · Perfil de medio con radiografía y seguimiento', (
    WidgetTester tester,
  ) async {
    final ArenaFakeCore core = ArenaFakeCore();
    await pumpArena(tester, core, initialTab: ArenaTab.medios);
    expect(
      find.text('Sincronizar mis fuentes con YouTube o X'),
      findsOneWidget,
    );
    final Finder card = find.byKey(
      const ValueKey<String>('arena-media-$biobioId'),
    );
    await reveal(tester, card, 'arena-media-tab-scroll');
    await tester.tap(
      find.descendant(of: card, matching: find.text('BioBioChile')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Prensa escrita · 12 seguidores'), findsOneWidget);
    expect(find.byIcon(Icons.verified), findsOneWidget);
    expect(find.text('+ Seguir'), findsOneWidget);
    expect(find.text('⇄ Comparar'), findsOneWidget);
    for (final String tab in <String>[
      'Radiografía',
      'Cobertura',
      'Historial',
    ]) {
      expect(find.byKey(ValueKey<String>('arena-subtab-$tab')), findsOneWidget);
    }
    expect(find.text('Perfil editorial / Formato'), findsOneWidget);
    final Finder donut = find.byKey(const Key('arena-coverage-donut'));
    await reveal(tester, donut, 'arena-media-scroll');
    expect(find.text('Cobertura del último mes'), findsOneWidget);
    for (final String topic in <String>[
      'Política',
      'Economía',
      'Justicia',
      'Sociedad',
      'Deportes',
      'Otros',
    ]) {
      expect(
        find.descendant(of: donut, matching: find.text(topic)),
        findsOneWidget,
      );
    }
    // 3 real publications: one political, one judicial, one sports.
    expect(
      find.descendant(of: donut, matching: find.text('33%')),
      findsNWidgets(3),
    );
    await reveal(
      tester,
      find.textContaining('Contrasta más con: La Tercera (1)'),
      'arena-media-scroll',
    );
    expect(find.text('Precisión, trazabilidad y duelos VS'), findsOneWidget);

    await tester.dragUntilVisible(
      find.byKey(const Key('arena-media-follow')),
      find.byKey(const Key('arena-media-scroll')),
      const Offset(0, 300),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arena-media-follow')));
    await tester.pumpAndSettle();
    expect(core.followed, contains(biobioId));
    expect(find.text('✓ Siguiendo'), findsOneWidget);

    await tester.tap(
      find.byKey(const ValueKey<String>('arena-subtab-Historial')),
    );
    await tester.pumpAndSettle();
    await reveal(tester, find.text(storyTitle), 'arena-media-scroll');

    await tester.dragUntilVisible(
      find.byKey(const Key('arena-media-compare')),
      find.byKey(const Key('arena-media-scroll')),
      const Offset(0, 300),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('arena-media-compare')));
    await tester.pumpAndSettle();
    expect(find.text('Comparar BioBioChile con…'), findsOneWidget);
    await tester.tap(find.widgetWithText(ListTile, 'La Tercera'));
    await tester.pumpAndSettle();
    expect(find.text('Comparar cobertura'), findsOneWidget);
    expect(find.text('Historias que cubren ambos (2)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tocar un medio en una tarjeta abre su perfil', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore());
    await tester.tap(find.text('BioBioChile').first);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('arena-media-compare')), findsOneWidget);
  });

  testWidgets(
    'Pantalla 5 · Comunidad sigue publicando aportes con un Core anterior',
    (WidgetTester tester) async {
      final ArenaFakeCore core = ArenaFakeCore();
      final List<Uri> opened = await pumpArena(
        tester,
        core,
        initialTab: ArenaTab.vs,
      );
      await tester.tap(find.text(duelTitle));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('arena-vote-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Abrir comunidad del caso'));
      await tester.pumpAndSettle();

      expect(find.text('Comunidad del caso'), findsOneWidget);
      for (final String pill in <String>['Debate', 'Aportes', 'Notas']) {
        expect(
          find.byKey(ValueKey<String>('arena-pill-$pill')),
          findsOneWidget,
        );
      }
      expect(
        find.text('El acta del tribunal respalda esta versión.'),
        findsOneWidget,
      );
      expect(find.text('Enlace'), findsOneWidget);
      expect(find.text('https://latercera.com/nota/art1'), findsOneWidget);
      expect(find.text('Responder'), findsOneWidget);
      await tester.tap(find.text('https://latercera.com/nota/art1'));
      expect(opened.single.toString(), 'https://latercera.com/nota/art1');

      expect(
        find.text('Aporta contexto, evidencia o tu análisis...'),
        findsOneWidget,
      );
      await tester.enterText(
        find.byKey(const Key('arena-community-input')),
        'BioBio publicó el comunicado completo de la fiscalía.',
      );
      await tester.tap(find.byKey(const Key('arena-community-attach')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.text('Fiscalía descarta acuerdo en el caso Audios'),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('arena-community-send')));
      await tester.pumpAndSettle();
      expect(core.postedComments, <(String, String)>[
        ('art2', 'BioBio publicó el comunicado completo de la fiscalía.'),
      ]);
      expect(
        find.text('BioBio publicó el comunicado completo de la fiscalía.'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Debate')));
      await tester.pumpAndSettle();
      expect(find.text('Opiniones e interpretaciones'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Notas')));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('todavía no están habilitadas en el servidor'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Pantalla 6 · Explorar con banner, tendencias y temas', (
    WidgetTester tester,
  ) async {
    await pumpArena(tester, ArenaFakeCore());
    await tester.tap(find.byKey(const ValueKey<String>('arena-pill-Explorar')));
    await tester.pumpAndSettle();

    final Finder banner = find.byKey(const Key('arena-blindspot-banner'));
    expect(
      find.descendant(of: banner, matching: find.text('Lo que no viste hoy')),
      findsOneWidget,
    );
    expect(
      find.text('Ángulos y datos que no aparecen en tus medios habituales →'),
      findsOneWidget,
    );
    final Ink ink = tester.widget<Ink>(
      find.ancestor(of: banner, matching: find.byType(Ink)).first,
    );
    expect(
      ((ink.decoration! as BoxDecoration).gradient! as LinearGradient).colors,
      const <Color>[Color(0xFF6D28D9), Color(0xFF4F46E5)],
    );
    expect(find.text('Tendencias en Dialektik'), findsOneWidget);
    // Ranked by number of sources: the 3-source story leads.
    final Finder top = find.byKey(const ValueKey<String>('arena-trend-1'));
    expect(find.descendant(of: top, matching: find.text('1')), findsOneWidget);
    expect(
      find.descendant(of: top, matching: find.text(storyTitle)),
      findsOneWidget,
    );
    expect(
      find.descendant(of: top, matching: find.text('🔥 3 fuentes')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: top, matching: find.byIcon(Icons.trending_up)),
      findsOneWidget,
    );
    await reveal(
      tester,
      find.byKey(const ValueKey<String>('arena-topic-sociedad')),
      'arena-explore-scroll',
    );
    for (final String topic in <String>[
      'politica',
      'justicia',
      'economia',
      'medioambiente',
      'ciencia',
      'deportes',
      'sociedad',
    ]) {
      expect(
        find.byKey(ValueKey<String>('arena-topic-$topic')),
        findsOneWidget,
      );
    }

    await tester.dragUntilVisible(
      banner,
      find.byKey(const Key('arena-explore-scroll')),
      const Offset(0, 300),
    );
    await tester.pumpAndSettle();
    await tester.tap(banner);
    await tester.pumpAndSettle();
    expect(find.text('Acontecimientos fuera de tus medios'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Investigación revela contratos sin licitación'),
      220,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Cobertura de un medio que no sigues'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
