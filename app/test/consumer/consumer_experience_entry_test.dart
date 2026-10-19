import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/data/public_api_models.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/live/data/candidate_source_registry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart' show Locale;

import '../live/live_fixtures.dart';
import '../support/public_api_fixtures.dart';

Future<void> _tap(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Acontecimientos remains the consumer root in personal mode', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      DialektikApp(
        environment: AppEnvironment.test,
        loadInterFromDependency: false,
        consumerRepository: FakeConsumerRepository(
          feedPages: <PublicPage<EventCardDto>>[
            const PublicPage<EventCardDto>(
              items: <EventCardDto>[],
              nextCursor: null,
            ),
          ],
        ),
        liveNewsRepository: liveTestClient(),
        personalOwnerModeEnabled: true,
        initialRoute: ConsumerRoutes.feed,
        locale: const Locale('es'),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('No hay eventos públicos disponibles por ahora.'),
      findsOneWidget,
    );
    expect(find.text('Administración · estado local'), findsNothing);
  });

  testWidgets(
    'personal mode can open the consumer reader and reach administration separately',
    (WidgetTester tester) async {
      final List<CandidateSourceInfo>? candidates = await tester.runAsync(
        () => CandidateSourceRegistry.load(),
      );
      expect(candidates, hasLength(50));
      await tester.pumpWidget(
        DialektikApp(
          environment: AppEnvironment.test,
          loadInterFromDependency: false,
          consumerRepository: FakeConsumerRepository(
            feedPages: <PublicPage<EventCardDto>>[
              const PublicPage<EventCardDto>(
                items: <EventCardDto>[],
                nextCursor: null,
              ),
            ],
          ),
          liveNewsRepository: liveTestClient(),
          personalOwnerModeEnabled: true,
          initialRoute: ConsumerRoutes.liveNews,
          locale: const Locale('es'),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('Noticia escrita para pruebas: océano & atmósfera — señales'),
        findsOneWidget,
      );
      expect(find.text('Administración · estado local'), findsNothing);
      expect(find.text('Administración'), findsNothing);
      expect(find.byTooltip('Más opciones'), findsOneWidget);

      await _tap(tester, find.text('Acontecimientos'));
      expect(
        find.text('No hay eventos públicos disponibles por ahora.'),
        findsOneWidget,
      );
      await _tap(tester, find.text('Fuentes'));
      expect(find.text('Candidatas · 50'), findsOneWidget);
      expect(find.text('Editorial de pruebas · sintético'), findsOneWidget);
      await _tap(tester, find.byTooltip('Más opciones'));
      await _tap(tester, find.text('Contradicciones'));
      expect(find.text('Contradicciones publicadas'), findsOneWidget);
      await _tap(tester, find.text('Actualidad'));
      expect(
        find.text('Noticia escrita para pruebas: océano & atmósfera — señales'),
        findsOneWidget,
      );

      await _tap(tester, find.byTooltip('Más opciones'));
      await _tap(tester, find.text('Administración'));
      expect(find.text('Administración · estado local'), findsOneWidget);

      await _tap(tester, find.byTooltip('Volver a Actualidad'));
      expect(find.text('Administración · estado local'), findsNothing);
      expect(
        find.text('Noticia escrita para pruebas: océano & atmósfera — señales'),
        findsOneWidget,
      );
    },
  );
}
