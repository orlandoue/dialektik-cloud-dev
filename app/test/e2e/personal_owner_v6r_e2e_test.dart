import 'package:dialektik/app/dialektik_app.dart';
import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/core/infrastructure/app_environment.dart';
import 'package:dialektik/features/consumer/presentation/navigation/consumer_routes.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_test_shadow.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/loopback_socket_client.dart';

const String _baseUrl = String.fromEnvironment('DIALEKTIK_E2E_BASE_URL');
const String _ownerToken = String.fromEnvironment(
  'DIALEKTIK_PERSONAL_OWNER_TEST_TOKEN',
);
const String _existingJobId = String.fromEnvironment(
  'DIALEKTIK_E2E_EXISTING_JOB_ID',
);
const String _title =
    'Synthetic housing regulator issues an institutional compliance notice';

void main() {
  testWidgets(
    'synthetic fixture runs through real Core HTTP, PostgreSQL and Flutter UI',
    (WidgetTester tester) async {
      final LoopbackSocketClient transport = LoopbackSocketClient();
      addTearDown(transport.close);
      final PersonalOwnerTestShadowClient client =
          PersonalOwnerTestShadowClient(
            configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
            httpClient: transport,
          );
      addTearDown(client.close);

      await tester.pumpWidget(
        DialektikApp(
          environment: AppEnvironment.test,
          loadInterFromDependency: false,
          personalOwnerModeEnabled: true,
          personalOwnerTestShadowRepository: client,
          initialRoute: ConsumerRoutes.personalOwnerTestShadow,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('No usa noticias auténticas'), findsOneWidget);
      _traceStage('APP_READY');

      final Finder tokenField = find.byWidgetPredicate(
        (Widget widget) =>
            widget is TextField &&
            widget.decoration?.labelText == 'Credencial local',
      );
      final Stopwatch visibleJobTimer = Stopwatch();
      if (_existingJobId.isEmpty) {
        await tester.enterText(tokenField, _ownerToken);
        await tester.tap(find.text('Adquirir fixture sintético'));
        await _waitFor(tester, find.text(_title));
        _traceStage('SYNTHETIC_FIXTURE_INGESTED');

        await tester.enterText(tokenField, _ownerToken);
        await tester.tap(find.text('Cargar permisos de prueba'));
        await _waitFor(tester, find.text('synthetic-owner-v6r'));
        await tester.dragUntilVisible(
          find.text('Permisos activos'),
          find.byType(ListView),
          const Offset(0, -220),
        );
        await tester.pumpAndSettle();
        expect(find.text('2'), findsOneWidget);
        _traceStage('TEST_AUTHORIZATIONS_LOADED');

        await tester.dragUntilVisible(
          tokenField,
          find.byType(ListView),
          const Offset(0, 220),
        );
        await tester.pumpAndSettle();
        await tester.enterText(tokenField, _ownerToken);
        await tester.ensureVisible(find.text('Procesar en SHADOW'));
        await tester.pumpAndSettle();
        visibleJobTimer.start();
        await tester.tap(find.text('Procesar en SHADOW'));
        _traceStage('JOB_SUBMITTED');
      } else {
        final Finder jobIdField = find.byWidgetPredicate(
          (Widget widget) =>
              widget is TextField &&
              widget.decoration?.labelText == 'ID del trabajo',
        );
        await tester.enterText(tokenField, _ownerToken);
        _traceStage('RECOVERY_TOKEN_READY');
        await tester.ensureVisible(jobIdField);
        _traceStage('RECOVERY_JOB_FIELD_VISIBLE');
        await tester.enterText(jobIdField, _existingJobId);
        _traceStage('RECOVERY_JOB_ID_READY');
        await tester.ensureVisible(find.text('Consultar shadow'));
        await tester.pumpAndSettle();
        _traceStage('RECOVERY_LOAD_BUTTON_VISIBLE');
        visibleJobTimer.start();
        await tester.tap(find.text('Consultar shadow'));
        _traceStage('PERSISTED_JOB_REQUESTED');
      }
      try {
        await _waitForInScrollView(
          tester,
          find.text('COMPLETED'),
          find.byType(ListView),
        );
        visibleJobTimer.stop();
        _traceStage('COMPLETED_STATE_VISIBLE');
      } catch (_) {
        // Safe transport trace contains only route templates and status codes.
        // ignore: avoid_print
        print('V6R_FLUTTER_HTTP_TRACE ${transport.safeOutcomes.join('|')}');
        // ignore: avoid_print
        print(
          'V6R_FLUTTER_GENERIC_ERROR_VISIBLE '
          '${find.text('No se pudo completar la operación local.').evaluate().isNotEmpty}',
        );
        rethrow;
      }

      await tester.dragUntilVisible(
        find.text('INSUFFICIENT_EVIDENCE'),
        find.byType(ListView),
        const Offset(0, -160),
      );
      expect(find.text('INSUFFICIENT_EVIDENCE'), findsOneWidget);
      await tester.dragUntilVisible(
        find.text('UNASSIGNED'),
        find.byType(ListView),
        const Offset(0, -120),
      );
      expect(find.text('UNASSIGNED'), findsOneWidget);
      await tester.dragUntilVisible(
        find.text('Hechos grounded'),
        find.byType(ListView),
        const Offset(0, -140),
      );
      // ignore: avoid_print
      print('V6R_FLUTTER_HTTP_TRACE ${transport.safeOutcomes.join('|')}');
      // ignore: avoid_print
      print(
        'V6R_FLUTTER_JOB_VISIBLE_MS ${visibleJobTimer.elapsedMilliseconds}',
      );
      if (_existingJobId.isNotEmpty) {
        // ignore: avoid_print
        print(
          'V6R_FLUTTER_RECOVERED_JOB_VISIBLE_MS '
          '${visibleJobTimer.elapsedMilliseconds}',
        );
      }
      // ignore: avoid_print
      print(
        'V6R_FLUTTER_HTTP_LATENCY_MS ${transport.safeLatenciesMs.join(',')}',
      );
      final List<String> safeResult = find
          .byType(SelectableText)
          .evaluate()
          .map(
            (Element element) => (element.widget as SelectableText).data ?? '',
          )
          .where((String value) => value.isNotEmpty)
          .toList(growable: false);
      // ignore: avoid_print
      print('V6R_FLUTTER_RESULT_STATE ${safeResult.join('|')}');
      expect(find.textContaining('1/1'), findsOneWidget);
      expect(find.textContaining(_ownerToken), findsNothing);
      expect(find.text('B001 title [0,'), findsNothing);
      await tester.dragUntilVisible(
        find.textContaining('Bloques citados'),
        find.byType(ListView),
        const Offset(0, -160),
      );
      expect(find.textContaining('Bloques citados'), findsOneWidget);
      _traceStage('PROVENANCE_VISIBLE');
    },
    skip: _baseUrl.isEmpty || _ownerToken.isEmpty,
  );
}

void _traceStage(String stage) {
  // ignore: avoid_print
  print('V6R_FLUTTER_STAGE $stage');
}

Future<void> _waitForInScrollView(
  WidgetTester tester,
  Finder finder,
  Finder scrollable,
) async {
  for (int attempt = 0; attempt < 80; attempt += 1) {
    if (finder.evaluate().isNotEmpty) return;
    // Advance Flutter's fake clock so the screen's 250 ms job poll can fire.
    await tester.pump(const Duration(milliseconds: 250));
    // Then allow the real loopback Socket future to exchange HTTP bytes.
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 250)),
    );
    await tester.pump();
    if (finder.evaluate().isEmpty) {
      await tester.drag(scrollable, const Offset(0, -220));
      await tester.pump();
    }
  }
  final List<String> safeText = find
      .byType(SelectableText)
      .evaluate()
      .map((Element element) => (element.widget as SelectableText).data ?? '')
      .where((String value) => value.isNotEmpty)
      .toList(growable: false);
  // ignore: avoid_print
  print('V6R_FLUTTER_VISIBLE_STATE ${safeText.join('|')}');
  expect(finder, findsOneWidget);
}

Future<void> _waitFor(WidgetTester tester, Finder finder) async {
  for (int attempt = 0; attempt < 80; attempt += 1) {
    if (finder.evaluate().isNotEmpty) return;
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 250)),
    );
    await tester.pump();
  }
  expect(finder, findsOneWidget);
}
