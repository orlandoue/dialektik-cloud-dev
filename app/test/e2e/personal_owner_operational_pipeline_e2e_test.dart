import 'dart:async';
import 'dart:io';

import 'package:dialektik/core/infrastructure/api_configuration.dart';
import 'package:dialektik/features/personal_owner/data/personal_owner_operational.dart';
import 'package:dialektik/features/personal_owner/presentation/personal_owner_operational_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

const String _baseUrl = String.fromEnvironment('DIALEKTIK_E2E_BASE_URL');
const String _ownerToken = String.fromEnvironment(
  'DIALEKTIK_PERSONAL_OWNER_E2E_TOKEN',
);
const String _completedJobId = String.fromEnvironment(
  'DIALEKTIK_PERSONAL_OWNER_E2E_JOB_ID',
);

void main() {
  testWidgets(
    'recovers the real Core job and renders Article provenance and shadow observations',
    (WidgetTester tester) async {
      final IOClient ioClient = HttpOverrides.runWithHttpOverrides(
        () => IOClient(HttpClient()),
        _RealLocalHttpOverrides(),
      );
      final http.Client connectedClient = _RealZoneHttpClient(ioClient);
      final PersonalOwnerOperationalClient client =
          PersonalOwnerOperationalClient(
            configuration: ApiConfiguration.fromBaseUrl(_baseUrl),
            httpClient: connectedClient,
          );
      addTearDown(connectedClient.close);
      final Map<String, Object?> job =
          await tester.runAsync<Map<String, Object?>>(
            () => client.job(_ownerToken, _completedJobId),
          ) ??
          (throw StateError('Connected Core request did not complete.'));
      expect((job['job'] as Map<String, Object?>)['state'], 'COMPLETED');
      final List<OwnerJson> articles =
          await tester.runAsync<List<OwnerJson>>(
            () => client.articles(_ownerToken),
          ) ??
          (throw StateError(
            'Connected Core article request did not complete.',
          ));
      expect(
        articles.map((OwnerJson article) => article['headline']),
        contains('Synthetic regulator filed a compliance notice'),
        reason:
            'Core articles after recovery: ${articles.map((article) => article['headline']).toList()}',
      );
      tester.view.physicalSize = const Size(1280, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: PersonalOwnerOperationalScreen(
            repository: client,
            initialOwnerToken: _ownerToken,
          ),
        ),
      );
      await _waitFor(tester, find.text('V7-II synthetic publisher'));

      final Finder articlesTab = find.descendant(
        of: find.byType(TabBar),
        matching: find.text('Articles'),
      );
      expect(articlesTab, findsOneWidget);
      await tester.tap(articlesTab);
      await tester.pumpAndSettle();
      final Finder articleSection = find.text(
        'Articles persistidos y su procedencia',
      );
      final List<String?> visibleText = tester
          .widgetList<Text>(find.byType(Text))
          .map((Text widget) => widget.data)
          .toList();
      expect(
        articleSection,
        findsOneWidget,
        reason: 'Screen after selecting Articles: $visibleText',
      );
      await _waitFor(
        tester,
        find.text('Synthetic regulator filed a compliance notice'),
      );
      expect(
        find.textContaining('https://publisher.invalid/primary'),
        findsOneWidget,
      );
      expect(find.textContaining('EXCERPT_EPHEMERAL'), findsNWidgets(3));

      await tester.tap(find.text('Jobs'));
      await tester.pumpAndSettle();
      final Finder completedJob = find.textContaining('COMPLETED ·');
      await _waitFor(tester, completedJob);
      await tester.tap(completedJob.first);
      await _waitFor(tester, find.textContaining('SHADOW_NOT_AUTHORITATIVE'));
      expect(find.textContaining('SHADOW_NOT_AUTHORITATIVE'), findsOneWidget);
      expect(
        find.textContaining('product-cloudflare-workers-ai-v1.'),
        findsOneWidget,
      );
      expect(find.textContaining('Evidencia excerpt'), findsNWidgets(2));
    },
    skip: _baseUrl.isEmpty || _ownerToken.isEmpty || _completedJobId.isEmpty,
  );
}

final class _RealLocalHttpOverrides extends HttpOverrides {}

final class _RealZoneHttpClient extends http.BaseClient {
  _RealZoneHttpClient(this._delegate);

  final http.Client _delegate;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    final Completer<http.StreamedResponse> response =
        Completer<http.StreamedResponse>();
    Zone.root.run(() {
      _delegate
          .send(request)
          .then(
            response.complete,
            onError: (Object error, StackTrace stackTrace) {
              response.completeError(error, stackTrace);
            },
          );
    });
    return response.future;
  }

  @override
  void close() => _delegate.close();
}

Future<void> _waitFor(WidgetTester tester, Finder finder) async {
  for (int attempt = 0; attempt < 120; attempt += 1) {
    if (finder.evaluate().isNotEmpty) return;
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pump();
  }
  expect(finder, findsOneWidget);
}
